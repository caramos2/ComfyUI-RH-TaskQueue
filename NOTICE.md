# Third-party notices

**This project contains no third-party code.**

Every line of code in this repository was written for this project. There is
no vendored library, no copied snippet and no generated bundle from another
project.

The one piece that could look borrowed is the SHA-256 implementation in
`web/core/fingerprint.js`. It is an independent implementation, written for
this project, of the algorithm published as **FIPS PUB 180-4** (NIST,
"Secure Hash Standard"). SHA-256 and its round constants `K` are part of that
public standard - they are not somebody's code, and they carry no third party
licence. The reason the project ships its own implementation instead of using
the browser's `crypto.subtle` is documented at the top of that file:
`crypto.subtle` is only available in a secure context, and ComfyUI is very
often served over plain HTTP on a LAN.

## Runtime dependencies

The plugin has none:

- the backend uses the Python standard library only (`sqlite3` plus the
  aiohttp routes ComfyUI already provides),
- the frontend uses browser APIs only (ES modules, Web Audio, Notifications,
  IndexedDB, localStorage, BroadcastChannel).

## Other projects

This plugin is an extension for [ComfyUI](https://github.com/comfyanonymous/ComfyUI).
ComfyUI itself is a separate project with its own licence; this repository
does not redistribute any part of it.
