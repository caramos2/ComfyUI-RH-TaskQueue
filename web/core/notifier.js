/**
 * Sound and desktop notifications.
 *
 * Two rules shape this module:
 *   - a prompt_id may only ever produce one notification, no matter whether
 *     the websocket or the poller noticed the finish first,
 *   - the AudioContext may only be created or resumed from a user gesture,
 *     because browsers block audio otherwise.
 */

export class Notifier {
  constructor(settings) {
    this.settings = settings;
    this.context = null;
    this.notified = new Set();
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

  playChime() {
    if (!this.settings.get('soundEnabled')) return false;
    const context = this.unlock();
    if (!context) return false;
    const now = context.currentTime;
    const volume = Math.max(0.01, Math.min(1, Number(this.settings.get('soundVolume')) || 0.3));

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    gain.connect(context.destination);

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
