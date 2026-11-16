/**
 * Sound and desktop notifications.
 *
 * Three rules shape this module:
 *   - a prompt_id may only ever produce one notification, no matter whether
 *     the websocket or the poller noticed the finish first,
 *   - the AudioContext may only be created or resumed from a user gesture,
 *     because browsers block audio otherwise,
 *   - several tasks often finish within the same second, so the chimes are
 *     merged into one. Playing them all at once sums their amplitude and
 *     clips into a blast.
 */

/**
 * How long a chime keeps the room to itself.
 *
 * The window is longer than the chime itself (about half a second), so two
 * chimes can never overlap.
 */
export const CHIME_MERGE_WINDOW_MS = 1200;

/**
 * Gate for the completion chime.
 *
 * The first chime inside a window sounds; every chime that follows within
 * that window is merged into it instead of being played on top of it.
 */
export class ChimeGate {
  constructor(windowMs = CHIME_MERGE_WINDOW_MS) {
    this.windowMs = windowMs;
    this.lastPlayedAt = null;
    this.mergedCount = 0;
  }

  /**
   * Ask whether a chime may sound now.
   *
   * Returns true when it may (and the window restarts), false when it is
   * merged into the chime that just played.
   */
  request(now = Date.now()) {
    if (this.lastPlayedAt === null || now - this.lastPlayedAt >= this.windowMs) {
      this.lastPlayedAt = now;
      this.mergedCount = 0;
      return true;
    }
    this.mergedCount += 1;
    return false;
  }

  /** Sound anyway (the test button) and restart the window. */
  force(now = Date.now()) {
    this.lastPlayedAt = now;
    this.mergedCount = 0;
  }
}

export class Notifier {
  constructor(settings) {
    this.settings = settings;
    this.context = null;
    this.notified = new Set();
    this.chimeGate = new ChimeGate();
    this.bus = null;
    this.busContext = null;
  }

  unlock() {
    if (typeof window === 'undefined') return null;
    if (!this.context) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      try {
        this.context = new Ctx();
      } catch (err) {
        return null;
      }
    }
    if (this.context.state === 'suspended') {
      this.context.resume().catch(() => {});
    }
    return this.context;
  }

  /**
   * The shared output bus of every chime.
   *
   * All chimes run through one compressor, so even the rare case where two
   * of them do overlap is smoothed instead of clipping. The threshold sits
   * above the normal chime level, so a single chime is not touched at all.
   */
  _bus(context) {
    if (this.bus && this.busContext === context) return this.bus;
    try {
      const bus = context.createGain();
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;
      bus.connect(limiter);
      limiter.connect(context.destination);
      this.bus = bus;
      this.busContext = context;
      return bus;
    } catch (err) {
      this.bus = context.destination;
      this.busContext = context;
      return context.destination;
    }
  }

  playChime(options = {}) {
    if (!this.settings.get('soundEnabled')) return false;
    const context = this.unlock();
    if (!context) return false;

    const stamp = Date.now();
    if (options.force) {
      this.chimeGate.force(stamp);
    } else if (!this.chimeGate.request(stamp)) {
      // Several tasks finished at the same moment. One chime carries them:
      // stacking the tones would sum their amplitude and burst.
      console.info(
        '[rh_queue] merged ' + this.chimeGate.mergedCount + ' chimes into one',
      );
      return false;
    }

    const now = context.currentTime;
    const volume = Math.max(0.01, Math.min(1, Number(this.settings.get('soundVolume')) || 0.3));

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    gain.connect(this._bus(context));

    const tones = [880, 1174.66];
    tones.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      const start = now + index * 0.13;
      oscillator.start(start);
      oscillator.stop(start + 0.24);
    });
    return true;
  }

  isNotified(id) {
    return this.notified.has(id);
  }

  markNotified(id) {
    this.notified.add(id);
    return true;
  }

  notify(title, body, tag) {
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission !== 'granted') return false;
    try {
      new Notification(title, { body, tag });
      return true;
    } catch (err) {
      return false;
    }
  }

  async requestPermission() {
    if (typeof Notification === 'undefined') return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    try {
      return await Notification.requestPermission();
    } catch (err) {
      return 'denied';
    }
  }

  permissionState() {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;
  }

  /**
   * Report a finished task. Returns true when something was actually
   * announced, which keeps the caller from announcing it twice.
   */
  announceSuccess(record, { durationText, outputCount }) {
    const id = record.id;
    if (this.isNotified(id)) return false;
    this.markNotified(id);
    this.playChime();
    this.notify(
      'ComfyUI 任务已完成',
      '耗时 ' + durationText + ' · 输出 ' + outputCount + ' 项',
      'rh-taskqueue-' + id,
    );
    return true;
  }

  announceFailure(record, { durationText, message }) {
    const id = record.id;
    if (this.isNotified(id)) return false;
    this.markNotified(id);
    if (this.settings.get('notifyOnFailure')) {
      this.notify(
        'ComfyUI 任务执行失败',
        '耗时 ' + durationText + ' · ' + (message || '未知错误'),
        'rh-taskqueue-' + id,
      );
    }
    return true;
  }
}
