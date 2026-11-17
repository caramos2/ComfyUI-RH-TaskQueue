# Security policy

## Supported versions

Only the latest release is supported. Fixes land on `master` and are picked up
by the next release.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private reporting for this repository
("Security" -> "Report a vulnerability" on the repository page, or
`Security -> Advisories -> Report a vulnerability`). If that is not available
to you, open a regular issue that says only *"security report, please contact
me privately"* - without any details - and a maintainer will arrange a private
channel.

Please include:

- what the problem is and what an attacker could do with it,
- the ComfyUI version, the operating system and the browser you used,
- the steps to reproduce it.

You will get an acknowledgement, and a fix or an explanation of why the report
is considered out of scope.

## What this plugin does with your data

- The duration archive is a local SQLite file inside the plugin folder
  (`data/duration_history.sqlite3`). It holds a workflow signature, the
  measured duration and a prompt id. It never leaves the machine.
- The plugin never uploads anything. It only talks to the ComfyUI server it is
  served from.
- The "reveal output" action asks the backend to open the file manager on the
  machine running ComfyUI. The backend rejects paths that try to escape the
  output directories.
