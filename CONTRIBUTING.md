# Contributing

Thanks for taking the time to help. This document explains how to get a change
through.

## Before you start

- Open an issue first for anything larger than a bug fix, so the approach can
  be agreed on before the work is done.
- The plugin must keep working on a stock ComfyUI install. It may not require
  a specific model, a specific GPU or a specific ComfyUI fork.

## Ground rules for the code

- **No third-party dependencies.** The backend may only use the Python standard
  library, the frontend only browser APIs. A new dependency has to be argued
  for in an issue first.
- **No new ComfyUI nodes.** The plugin registers no custom node classes; it is
  a frontend extension plus a small set of HTTP routes.
- **Every user visible string goes through `web/core/i18n.js`.** A hardcoded
  label in the UI breaks the Chinese and the English pack, and the test suite
  compares both key lists.
- **Never touch ComfyUI's own run button.** `app.queuePrompt` is not wrapped.
  The plugin submits through its own queue.
- **Media URLs always go through ComfyUI's `/view` endpoint.** Never assemble
  a disk path in the browser.

## Development

```powershell
# Frontend unit tests (pure logic, no browser needed)
node --test tests/js

# Backend unit tests
python -m pytest tests -q

# End-to-end check - needs ComfyUI running on 127.0.0.1:8188
node tests/verify/verify_duration.mjs
```

The frontend tests use the Node built-in test runner and need no npm install.
The backend tests need `pytest`.

Two self-test workflows live in `example_workflows/`:

- `zerogpu-selftest.api.json` - a string literal saved to a text file, it does
  not touch the GPU,
- `min-sdxl-512.api.json` - a 512x512 SDXL run in four steps.

## Pull requests

1. Branch off `master`.
2. Keep the change focused; unrelated cleanups belong in their own pull request.
3. Add or update tests for the behaviour you changed.
4. Update `CHANGELOG.md` under *Unreleased*.
5. Update both `README.md` and `README.zh-CN.md` - the two must carry the same
   information.

## Adding a translation

Language packs live in `web/locales/`:

1. Add the key to `web/locales/zh-CN.js` **and** `web/locales/en.js`. The
   test suite fails if the two packs drift apart.
2. Use `{name}` placeholders for values, and pass them through
   `t('key', { name: value })`.
3. Use `i18n.t()` in every module that renders text. For the DOM modules,
   register static labels with the drawer's binding list so a language change
   can rewrite them in place.
