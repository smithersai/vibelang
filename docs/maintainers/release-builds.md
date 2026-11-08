# Cross-platform compiler builds

Run `sh scripts/release/build-binaries.sh --local` to build all six platform
binaries. The script waits for every target and checks that each successful
command produced a nonempty binary. It also checks the host binary's version.

Each target keeps a receipt at `dist-npm/bin/<platform>.status` containing its
platform, UTC completion time and exit status. The overall command fails if
any target fails. Its diagnostic names the platform, exit status and log path;
a failure with an empty log is identified explicitly. For example, a child
terminated by `SIGKILL` has exit status `137`.

On failure, the script retains each target's log and any completed binaries.
Read `dist-npm/bin/<platform>.log` beside its receipt before retrying. A new
matrix run replaces `dist-npm/bin/`, including the old receipts and outputs.
Successful matrix runs keep the receipts and remove the temporary logs.

Release rehearsals report each package’s manifest version. The
`vibelang-typescript` shim follows TypeScript’s major and minor version, so its
version differs from the compiler’s. The isolated registry check includes both
Windows packages and the shim before the packed-install rehearsal.

Run `sh scripts/release/rehearse.sh` after packaging. It installs the tarballs
from an isolated registry with npm, Bun and pnpm, then checks the installed
compiler version, both formatter entry points, builds, startup and tests.
`check-app.sh <registry-url> <version>` defaults to all three managers;
pass manager names after the version to select a subset.

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
in that fixture when the packager gains an import. Its smoke check must reach
all six missing-binary diagnostics without building or staging packages;
the generated invalid-pin controls then check the actual metadata policy.
