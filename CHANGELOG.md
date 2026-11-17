# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.1.0] - 2026-11-17

First public release.

### Added

- **Task drawer** - a RunningHub-style panel on the right edge of ComfyUI that
  lists every task the plugin knows about, with status, workflow name, output
  count and the reason for a failure.
- **Real execution timing** - the drawer separates *waiting in the backend*
  from *actually running*, and counts the running time from the server's own
  `execution_start` event instead of guessing it from a poll.
- **Workflow names** - the backend indexes the workflow files in
  `user/default/workflows` and reports a graph id to title map, so a card can
  show the name of the workflow that ran.
- **Frozen-parameter run button** - a green `❄ Run` button next to ComfyUI's
  own run button. It freezes the canvas into a snapshot and queues that
  snapshot, so a queued task keeps the parameters it had when it was queued
  instead of whatever the canvas carries when its turn arrives.
- **Plugin-managed queue** - the plugin's own submission queue with a
  configurable pre-submit limit (1-8), auto dispatch, and a badge on the run
  button showing how many tasks are waiting. Queued tasks survive a page
  reload and are shared between browser tabs.
- **Output previews** - images, video, audio, 3D files and text are rendered
  per media type. Unknown media types are kept as a downloadable entry rather
  than dropped silently.
- **Open folder** - reveals the first output file of a task in the file
  explorer.
- **Workflow duration archive** - successful runs are stored in a local
  SQLite database, keyed by a SHA-256 signature of the workflow, so a card can
  show "last run" and "average" as a reference.
- **Completion chime and desktop notifications** - several tasks finishing at
  the same moment are merged into a single chime, and every chime runs through
  one shared limiter so they cannot stack into a blast of sound.
- **Bilingual interface** - Simplified Chinese and English, chosen from the
  browser language or pinned in the drawer.

### Fixed

- The drawer panel no longer covers ComfyUI's toolbar row, so the native queue
  button and the plugin's own run button stay clickable while the drawer is
  open.

[Unreleased]: https://github.com/caramos2/ComfyUI-RH-TaskQueue/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/caramos2/ComfyUI-RH-TaskQueue/releases/tag/v0.1.0
