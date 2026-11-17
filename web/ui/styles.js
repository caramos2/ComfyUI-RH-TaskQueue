/**
 * Drawer styles.
 *
 * They live in a JavaScript template string on purpose: ComfyUI only serves
 * .js files from an extension's WEB_DIRECTORY (the /extensions listing picks
 * up javascript files recursively, nothing else), so a standalone .css file
 * would never be referenced by the frontend and the drawer would render
 * unstyled.
 *
 * The whole drawer lives inside a shadow root, so these selectors cannot leak
 * into ComfyUI and ComfyUI's styles cannot leak in here.
 */

export const CSS = `
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-size: 13px;
  color: var(--rh-tq-text, #e6e6e6);
}
* { box-sizing: border-box; }

.rh-tq-tab {
  position: fixed;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
  writing-mode: vertical-rl;
  padding: 14px 6px;
  background: #242424;
  color: #d8d8d8;
  border: 1px solid #3a3a3a;
  border-right: none;
  border-radius: 8px 0 0 8px;
  cursor: pointer;
  letter-spacing: 2px;
  font-size: 12px;
  z-index: 10010;
  user-select: none;
  /* The host sets pointer-events:none so it never blocks ComfyUI's own UI.
     pointer-events is inherited, so the tab must opt back in or it is
     invisible to real mouse clicks (elementFromPoint hits the canvas). */
  pointer-events: auto;
}
.rh-tq-tab:hover { background: #2e2e2e; color: #fff; }
.rh-tq-tab__badge {
  display: inline-block;
  margin-top: 8px;
  padding: 1px 6px;
  border-radius: 8px;
  background: #3f6fd8;
  color: #fff;
  font-size: 11px;
  letter-spacing: 0;
}

.rh-tq-panel {
  position: fixed;
  /* The offset is measured at runtime so the panel starts below
     ComfyUI's own toolbar row (queue button + plugin run button). */
  top: var(--rh-tq-top, 8px);
  right: 8px;
  bottom: 8px;
  width: var(--rh-tq-width, 380px);
  max-width: 92vw;
  background: #1f1f1f;
  border: 1px solid #383838;
  border-radius: 10px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.55);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform: translateX(calc(100% + 16px));
  transition: transform 0.18s ease;
  z-index: 10009;
  /* Closed drawer stays inert; only the open panel accepts pointer events. */
  pointer-events: none;
}
.rh-tq-panel.is-open { transform: translateX(0); pointer-events: auto; }

.rh-tq-head {
  padding: 10px 12px;
  border-bottom: 1px solid #333;
  display: flex;
  align-items: center;
  gap: 8px;
}
.rh-tq-head__title { font-weight: 600; font-size: 14px; flex: 1; }
.rh-tq-mode {
  font-size: 10px;
  color: #8a8a8a;
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  padding: 1px 4px;
}
.rh-tq-iconbtn {
  background: transparent;
  border: 1px solid #3a3a3a;
  color: #bbb;
  border-radius: 4px;
  width: 24px;
  height: 24px;
  cursor: pointer;
  line-height: 1;
}
.rh-tq-iconbtn:hover { background: #2c2c2c; color: #fff; }

.rh-tq-summary {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid #2c2c2c;
}
.rh-tq-stat {
  flex: 1;
  background: #262626;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 6px 8px;
  text-align: center;
}
.rh-tq-stat__num { font-size: 17px; font-weight: 700; line-height: 1.1; }
.rh-tq-stat__label { font-size: 11px; color: #9a9a9a; margin-top: 2px; }
.rh-tq-stat--running .rh-tq-stat__num { color: #59c98a; }
.rh-tq-stat--pending .rh-tq-stat__num { color: #e0b341; }
.rh-tq-stat--queued .rh-tq-stat__num { color: #7fa8e0; }

.rh-tq-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid #2c2c2c;
  font-size: 12px;
}
.rh-tq-controls label { display: inline-flex; align-items: center; gap: 4px; color: #c8c8c8; cursor: pointer; }
.rh-tq-select {
  background: #262626; color: #e0e0e0; border: 1px solid #3a3a3a;
  border-radius: 4px; padding: 2px 4px; font-size: 12px;
}
.rh-tq-btn {
  background: #2f2f2f; color: #e0e0e0; border: 1px solid #3d3d3d;
  border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 12px;
}
.rh-tq-btn:hover { background: #3a3a3a; }
.rh-tq-btn--primary { background: #3f6fd8; border-color: #3f6fd8; color: #fff; }
.rh-tq-btn--primary:hover { background: #4d7ce4; }
.rh-tq-btn--danger { color: #ff9b9b; }
.rh-tq-hint { width: 100%; color: #7d7d7d; font-size: 11px; }

.rh-tq-filters {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid #2c2c2c;
  flex-wrap: wrap;
}
.rh-tq-filter {
  background: transparent; border: 1px solid #3a3a3a; color: #b5b5b5;
  border-radius: 12px; padding: 2px 10px; cursor: pointer; font-size: 12px;
}
.rh-tq-filter.is-active { background: #3f6fd8; border-color: #3f6fd8; color: #fff; }

.rh-tq-list { flex: 1; overflow-y: auto; padding: 8px 10px 20px; }
.rh-tq-empty { color: #7d7d7d; text-align: center; padding: 30px 10px; }

.rh-tq-card {
  background: #262626;
  border: 1px solid #333;
  border-left: 3px solid #555;
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 8px;
}
.rh-tq-card--running { border-left-color: #59c98a; }
.rh-tq-card--pending { border-left-color: #e0b341; }
.rh-tq-card--queued { border-left-color: #7fa8e0; }
.rh-tq-card--completed { border-left-color: #6f6f6f; }
.rh-tq-card--failed { border-left-color: #e06c6c; }
.rh-tq-card--cancelled { border-left-color: #a08080; }
.rh-tq-card--submit_failed { border-left-color: #e06c6c; }

.rh-tq-card__head { display: flex; align-items: center; gap: 6px; }
.rh-tq-badge {
  font-size: 11px; padding: 1px 6px; border-radius: 4px;
  background: #333; color: #ddd; white-space: nowrap;
}
.rh-tq-card--running .rh-tq-badge { background: #244a37; color: #8fe3b4; }
.rh-tq-card--pending .rh-tq-badge { background: #4a4024; color: #f0cf7a; }
.rh-tq-card--queued .rh-tq-badge { background: #2b3d56; color: #a8c8f0; }
.rh-tq-card--failed .rh-tq-badge, .rh-tq-card--submit_failed .rh-tq-badge { background: #4a2b2b; color: #f0a8a8; }
.rh-tq-title { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rh-tq-meta { color: #8a8a8a; font-size: 11px; margin-top: 3px; }
.rh-tq-timing { margin-top: 3px; font-variant-numeric: tabular-nums; }
.rh-tq-ref { color: #9aa7b5; font-size: 11px; margin-top: 3px; }
.rh-tq-out { color: #8a8a8a; font-size: 11px; margin-top: 3px; }
.rh-tq-error {
  margin-top: 6px; padding: 5px 7px; background: #332525; color: #f0b0b0;
  border-radius: 4px; font-size: 11px; white-space: pre-wrap; word-break: break-word;
  max-height: 120px; overflow: auto;
}
.rh-tq-actions { display: flex; gap: 6px; margin-top: 7px; }

.rh-tq-thumbs { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; }
.rh-tq-thumb {
  width: 62px; height: 62px; object-fit: cover; border-radius: 4px;
  border: 1px solid #3a3a3a; background: #1a1a1a; cursor: zoom-in;
}
.rh-tq-media { max-width: 100%; border-radius: 4px; margin-top: 6px; border: 1px solid #3a3a3a; }
.rh-tq-file { color: #8fb3e8; text-decoration: none; font-size: 11px; display: inline-block; margin-top: 4px; }
.rh-tq-file:hover { text-decoration: underline; }
.rh-tq-text {
  margin-top: 5px; background: #1c1c1c; border: 1px solid #333; border-radius: 4px;
  padding: 5px 7px; font-size: 11px; color: #c3c3c3; max-height: 140px; overflow: auto;
  white-space: pre-wrap; word-break: break-word;
}
.rh-tq-sig { color: #6f6f6f; font-size: 10px; margin-top: 4px; font-family: monospace; }
`;
