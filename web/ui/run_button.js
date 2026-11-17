/**
 * The plugin's own run button.
 *
 * It sits next to ComfyUI's own run button and differs from it in one way:
 * the workflow is frozen into a snapshot the moment the button is pressed,
 * and that snapshot waits in the plugin's queue until a pre-submit slot
 * frees up. Editing the canvas afterwards cannot change what a queued task
 * runs with, and the queued tasks are visible and cancellable in the drawer.
 *
 * The button lives in ComfyUI's own toolbar, so it cannot use the drawer's
 * shadow root styles - it brings its own.
 */

const STYLE_ID = 'rh-taskqueue-run-button-style';
const TOOLTIP_DELAY_MS = 700;
const HIDE_DELAY_MS = 120;
const FLASH_MS = 1800;

const CSS = `
.rh-tq-run-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  margin-left: 8px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  background: #1f7a4d;
  color: #ffffff;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.rh-tq-run-btn:hover { background: #1b6640; }
.rh-tq-run-btn:focus-visible { outline: 2px solid #4f9cff; outline-offset: 2px; }
.rh-tq-run-btn[data-busy="1"] { opacity: 0.65; cursor: progress; }
.rh-tq-run-btn__icon { font-size: 13px; line-height: 1; }
.rh-tq-run-btn__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.35);
  color: #ffffff;
  font-size: 11px;
}
.rh-tq-run-tip {
  position: fixed;
  z-index: 100000;
  max-width: 340px;
  padding: 10px 12px;
  border: 1px solid #3a3a3a;
  border-radius: 8px;
  background: #1b1b1b;
  color: #e6e6e6;
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.5);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-size: 12px;
  line-height: 1.65;
  pointer-events: none;
}
.rh-tq-run-tip__title {
  margin-bottom: 4px;
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
}
.rh-tq-run-tip__body { white-space: pre-line; }
`;

/** The tooltip title. Kept separate so it can be tested without a DOM. */
export function runButtonTooltipTitle() {
  return '插件运行（冻结参数）';
}

/** The tooltip body. Kept separate so it can be tested without a DOM. */
export function runButtonTooltipBody() {
  return [
    '点击时把当前工作流参数冻结成一份快照，存进任务队列。',
    '之后无论怎么改画布，排队中的任务仍按各自那次编辑的参数执行。',
    '',
    '它走插件自己的队列：按抽屉里的「预提交上限」逐个派发，排队情况在抽屉里可见、可取消，刷新页面也不丢。',
    '（原生「运行」是直接交给 ComfyUI 排队。）',
  ].join('\n');
}

export class RunButton {
  constructor({ onRun, getBadge } = {}) {
    this.onRun = onRun || (() => {});
    this.getBadge = getBadge || (() => 0);
    this.button = null;
    this.tooltip = null;
    this.observer = null;
    this.showTimer = null;
    this.hideTimer = null;
    this.flashTimer = null;
    this.defaultLabel = '运行';
    this.busy = false;
  }

  mount() {
    if (typeof document === 'undefined') return false;
    this._ensureStyle();
    this._ensureTooltip();
    if (!this.button) this._createButton();
    this._insert();
    this._observe();
    this.updateBadge();
    return true;
  }

  unmount() {
    if (this.observer) this.observer.disconnect();
    this.observer = null;
    if (this.showTimer) clearTimeout(this.showTimer);
    if (this.hideTimer) clearTimeout(this.hideTimer);
    if (this.flashTimer) clearTimeout(this.flashTimer);
    if (this.button && this.button.parentNode) this.button.parentNode.removeChild(this.button);
    if (this.tooltip && this.tooltip.parentNode) this.tooltip.parentNode.removeChild(this.tooltip);
    this.button = null;
    this.tooltip = null;
  }

  // -- internals ---------------------------------------------------------

  _ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  _ensureTooltip() {
    if (this.tooltip) return;
    const tip = document.createElement('div');
    tip.className = 'rh-tq-run-tip';
    tip.hidden = true;
    const title = document.createElement('div');
    title.className = 'rh-tq-run-tip__title';
    title.textContent = runButtonTooltipTitle();
    const body = document.createElement('div');
    body.className = 'rh-tq-run-tip__body';
    body.textContent = runButtonTooltipBody();
    tip.appendChild(title);
    tip.appendChild(body);
    document.body.appendChild(tip);
    this.tooltip = tip;
  }

  _createButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rh-tq-run-btn';
    button.dataset.testid = 'rh-taskqueue-run-button';
    button.setAttribute('aria-label', runButtonTooltipTitle());

    const icon = document.createElement('span');
    icon.className = 'rh-tq-run-btn__icon';
    icon.textContent = '❄';

    const label = document.createElement('span');
    label.className = 'rh-tq-run-btn__label';
    label.textContent = this.defaultLabel;

    const badge = document.createElement('span');
    badge.className = 'rh-tq-run-btn__badge';
    badge.hidden = true;

    button.appendChild(icon);
    button.appendChild(label);
    button.appendChild(badge);

    button.addEventListener('click', () => this._fire());
    button.addEventListener('mouseenter', () => this._scheduleShow());
    button.addEventListener('mouseleave', () => this._hide());
    button.addEventListener('focus', () => this._scheduleShow());
    button.addEventListener('blur', () => this._hide());

    this.button = button;
    this.label = label;
    this.badge = badge;
  }

  /**
   * Put the button right of ComfyUI's own run control.
   *
   * The native control is a group (the run button plus its mode menu), so
   * the button goes next to the group - not inside it, which would split
   * the native control in two.
   */
  _insert() {
    if (!this.button) return false;
    const runButton = document.querySelector('[data-testid="queue-button"]');
    if (!runButton) return false;
    const group = runButton.closest('.queue-button-group');
    const anchor = group || runButton;
    if (this.button.parentNode === anchor.parentNode && anchor.nextSibling === this.button) {
      return true;
    }
    if (this.button.parentNode) this.button.parentNode.removeChild(this.button);
    anchor.insertAdjacentElement('afterend', this.button);
    return true;
  }

  /**
   * ComfyUI re-renders its toolbar, which would take the button with it.
   * The observer puts it back as soon as it disappears.
   */
  _observe() {
    if (this.observer || typeof MutationObserver === 'undefined') return;
    let pending = false;
    this.observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      const restore = () => {
        pending = false;
        if (!this.button) return;
        if (!this.button.isConnected) this._insert();
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restore);
      else setTimeout(restore, 0);
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  async _fire() {
    if (this.busy) return;
    this.busy = true;
    if (this.button) this.button.dataset.busy = '1';
    try {
      const result = await this.onRun();
      const message = result && result.message ? result.message : '已加入队列';
      this.flash(message);
    } catch (err) {
      this.flash('提交失败');
      console.warn('[rh_queue] run button failed:', err && err.message);
    } finally {
      this.busy = false;
      if (this.button) this.button.dataset.busy = '0';
      this.updateBadge();
    }
  }

  /** Show a short message on the button itself. */
  flash(message, duration = FLASH_MS) {
    if (!this.label) return;
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.label.textContent = message;
    this.flashTimer = setTimeout(() => {
      this.label.textContent = this.defaultLabel;
      this.flashTimer = null;
    }, duration);
  }

  /** The number of tasks waiting in the plugin's own queue. */
  updateBadge() {
    if (!this.badge) return;
    let count = 0;
    try {
      count = Number(this.getBadge()) || 0;
    } catch (err) {
      count = 0;
    }
    this.badge.hidden = count <= 0;
    this.badge.textContent = count > 0 ? String(count) : '';
  }

  // -- tooltip -----------------------------------------------------------

  _scheduleShow() {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    if (this.showTimer) return;
    this.showTimer = setTimeout(() => {
      this.showTimer = null;
      this._show();
    }, TOOLTIP_DELAY_MS);
  }

  _show() {
    if (!this.tooltip || !this.button) return;
    const rect = this.button.getBoundingClientRect();
    this.tooltip.hidden = false;
    const tipRect = this.tooltip.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - tipRect.width - 8));
    const top = rect.bottom + 8;
    this.tooltip.style.left = left + 'px';
    this.tooltip.style.top = top + 'px';
  }

  _hide() {
    if (this.showTimer) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (this.tooltip) this.tooltip.hidden = true;
    }, HIDE_DELAY_MS);
  }
}
