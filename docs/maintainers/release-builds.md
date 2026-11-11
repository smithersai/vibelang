# Cross-platform compiler builds

Run `sh scripts/release/build-binaries.sh --local` to build all six platform
binaries. The script waits for every target and checks that each successful
command produced a nonempty binary. It also checks the host binary's version.

Each target keeps a receipt at `dist-npm/bin/<platform>.status` containing its
platform, UTC completion time and exit status. The overall command fails if
any target fails. Its diagnostic names the platform, exit status and log path;
a failure with an empty log is identified explicitly. For example, a child
terminated by `SIGKILL` has exit status `137`.

On failure, the script retains each target's log and the binaries of the
targets that succeeded. Read `dist-npm/bin/<platform>.log` beside its receipt
before retrying. Every run first deletes `dist-npm/bin/`, so a failed target
never keeps a binary, receipt or log from an earlier run. Successful matrix
runs keep the receipts and remove the temporary logs.

## One commit per release

Two builds of one version print the same version, so each stage records the
commit it used and the next stage compares it.

- `build-binaries.sh` writes `dist-npm/bin/revision` with the source revision
  and `clean=true` or `clean=false`, links the revision into every binary
  (`<id>-dirty` for a tree with uncommitted changes), and fails unless all six
  binaries carry it. `vibelang --version` does not print the revision; the
  scripts read it from the binary's bytes. With `ES_REMOTE_HOST`, the machine
  that starts the build passes its revision to the build host and checks the
  record that comes back.
- `make-packages.mjs` fails when the tree has uncommitted changes, when a
  target's receipt is missing or records a nonzero exit, when a binary does
  not carry the recorded revision, or when that revision is not the
  checkout's. It deletes `packages/runtime/dist` and the packaged extension
  before building them, and writes the revision to
  `dist-npm/tarballs/manifest.json`.
- `publish.sh`, including `--dry-run`, fails when the manifest's revision is
  not the checkout's or the tree has uncommitted changes.

In a jj workspace the tree is clean when the working-copy commit is empty; in
a git checkout, when `git status` reports nothing. `scripts/release/revision.mjs`
prints the revision and that state.

`make-packages.mjs --rehearsal` accepts a changed tree and binaries from
another revision, and `--skip-build` reuses `packages/runtime/dist` and the
packaged extension as found. The manifest lists either flag under
`rehearsalOnly`, and `publish.sh` refuses those tarballs; `rehearse.sh`
accepts them.

## Only tracked files are packed

`make-packages.mjs` copies each package's sources from the files the revision
tracks (`jj file list` or `git ls-files`), not from the directory. A stray
`.env`, a lockfile from a local install, an editor backup or test output under
`templates/app` or a package's source directory is never packed, whether or
not an ignore rule covers it. The app template also leaves out the names in
`scripts/template-files.mjs`, the one exclusion list the packager, the local
template installer and the example checks share.

## Skipping platforms

`VIBELANG_SKIP=win32` makes `rehearse.sh` and `publish.sh` leave out the
matching packages and repack `vibelang` without those optional dependencies
and dprint plugin entries. The first repack keeps the assembled tarball as
`vibelang-<version>.full.tgz`, and every run derives `vibelang-<version>.tgz`
from that copy, so a later run without `VIBELANG_SKIP` publishes every
platform again. A run fails when the full tarball's optional dependencies or
plugin entries differ from the platform packages in the manifest; assemble
again in that case.

Release rehearsals report each package’s manifest version. The
`vibelang-typescript` shim follows TypeScript’s major and minor version, so its
version differs from the compiler’s. The isolated registry check includes both
Windows packages and the shim before the packed-install rehearsal.

Run `sh scripts/release/rehearse.sh` after packaging. It installs the tarballs
from an isolated registry with npm, Bun and pnpm, then checks the installed
compiler version, both formatter entry points, builds, startup and tests.
`check-app.sh <registry-url> <version>` defaults to all three managers;
pass manager names after the version to select a subset. Every manager
scaffolds `create-vibelang` at that version, so `verify-published.sh <version>`
checks the release it names even when the `latest` tag is another one.

Each app runs `vibelang-format --check` on its scaffolded VibeLang sources and
`dprint check` with the README's `npm:vibelang/dprint-plugin.json`
configuration and pinned TypeScript plugin. A formatter failure stops the
rehearsal. pnpm keeps its isolated dependency layout and a fresh store, with
explicit build approval for `dprint` in app and TypeScript alias fixtures; no hoisting is required. Optional
platform packages are verified from the compiler's package scope. Registry
configuration includes pnpm's `pnpm_config_registry` namespace. The rehearsal
also verifies the installed formatter's SHA-256 against its tarball, identifying
a wrong registry even when the public and candidate versions match. Each
manager uses a separate dprint cache and disables the formatter's clean cache.

Windows package names and package verification are described in
[Windows release additions](windows-release.md).

Before packaging a new version, finalize its release-notes heading and keep each
fix in the version that ships it. Publication checks validate the candidate's
bug list and preserve required historical fixes in their original release;
a version bump does not require copying those fixes into the new list.

The Effect-pin metadata tests execute the real packager in a temporary tree.
Keep its local module dependencies, including `scripts/release/zip-times.mjs`,
`scripts/release/revision.mjs` and `scripts/template-files.mjs`,
in that fixture when the packager gains an import. Its smoke check must reach
all six missing-binary diagnostics without building or staging packages;
the generated invalid-pin controls then check the actual metadata policy.
