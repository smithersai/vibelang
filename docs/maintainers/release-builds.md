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

Windows package names and package verification are described in
[Windows release additions](windows-release.md).
