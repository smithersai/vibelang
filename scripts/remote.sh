#!/bin/sh
# Runs a command for the current jj workspace on a Linux x64 build host, so
# builds and test suites do not use this machine's disk or CPU. Parallel
# workspaces each fill about 2 GB of Go build cache locally; on the host they
# share one cache.
#
#   export ES_REMOTE_HOST=ubuntu@<host> ES_REMOTE_KEY=~/.ssh/<key>
#   cd <workspace>/typescript && ../scripts/remote.sh sh vibelang/smoke.sh --status
#   scripts/remote.sh --clean            # delete this workspace's copy on the host
#
# It syncs the workspace's source tree (no .jj, node_modules, or build
# outputs) to ~/es-remote/<workspace dir name>/ on the host, prepares
# experiments/node_modules, docs/tools/node_modules, and
# packages/runtime/dist there when missing or stale, then runs the command in
# the same relative directory. The exit code is the command's. Binaries built
# there are Linux x64; build locally when you need one on this machine.
#
# The host needs Go 1.27, Node 22.22.3, and Bun 1.4 under ~/es-tools:
#   mkdir -p ~/es-tools && cd ~/es-tools
#   curl -fsSL https://go.dev/dl/go1.27.0.linux-amd64.tar.gz | tar xz
#   curl -fsSL https://nodejs.org/dist/v22.22.3/node-v22.22.3-linux-x64.tar.xz | tar xJ && mv node-v22.22.3-linux-x64 node
#   curl -fsSL https://bun.sh/install | BUN_INSTALL=$HOME/es-tools/bun bash -s bun-v1.4.1
set -eu

HOST=${ES_REMOTE_HOST:?set ES_REMOTE_HOST to user@host of a Linux x64 build host}
KEY=${ES_REMOTE_KEY:-$HOME/.ssh/id_ed25519}
mkdir -p "$HOME/.ssh/cm"
SSH="ssh -i $KEY -o IdentitiesOnly=yes -o BatchMode=yes -o ServerAliveInterval=30 -o ControlMaster=auto -o ControlPath=$HOME/.ssh/cm/es-%C -o ControlPersist=900"

here=$(pwd)
root=$here
while [ ! -d "$root/.jj" ] && [ "$root" != / ]; do root=$(dirname "$root"); done
[ -d "$root/.jj" ] || { echo "remote.sh: not inside a jj workspace" >&2; exit 2; }
name=$(basename "$root")
rel=${here#"$root"}
dest="es-remote/$name"

if [ "${1:-}" = "--clean" ]; then
	$SSH "$HOST" "rm -rf ~/$dest"
	echo "removed $HOST:~/$dest"
	exit 0
fi
[ $# -gt 0 ] || { echo "usage: remote.sh <command...> | remote.sh --clean" >&2; exit 2; }

$SSH "$HOST" "mkdir -p ~/$dest"
rsync -a --delete -e "$SSH" \
	--exclude '/.jj' --exclude '/.git' --exclude 'node_modules' --exclude '/typescript/built' \
	--exclude 'dist' --exclude '/typescript/vibelang/cases/*/out' --exclude '/docs/user/site' \
	--exclude '/packages/compiler/native' --exclude '*.vsix' --exclude '*.tgz' --exclude '/.cache' --exclude '/dist-npm' --exclude '.vibe' \
	"$root/" "$HOST:$dest/"

# The excludes above drop build outputs, but some cases track fixtures inside
# node_modules or dist (symlinked packages, for one). Send every tracked file
# those excludes would drop, keeping symlinks as symlinks.
tracked=$(mktemp)
(cd "$root" && jj file list) | grep -E '(^|/)(node_modules|dist)(/|$)' > "$tracked" || true
if [ -s "$tracked" ]; then
	rsync -a -e "$SSH" --files-from="$tracked" "$root/" "$HOST:$dest/"
fi
rm -f "$tracked"

# Quote each argument for the remote shell.
cmd=""
for a in "$@"; do
	q=$(printf '%s' "$a" | sed "s/'/'\\\\''/g")
	cmd="$cmd '$q'"
done

$SSH "$HOST" "export PATH=\$HOME/es-tools/go/bin:\$HOME/es-tools/node/bin:\$HOME/es-tools/bun/bin:\$PATH GOFLAGS=-trimpath CGO_ENABLED=0 EFFECT_NODE_MODULES=\$HOME/$dest/experiments/node_modules
set -e
cd ~/$dest
if [ -f experiments/package.json ] && { [ ! -d experiments/node_modules ] || [ experiments/package.json -nt experiments/node_modules ]; }; then
	(cd experiments && bun install --silent) >&2
fi
if [ -f docs/tools/package.json ] && { [ ! -d docs/tools/node_modules ] || [ docs/tools/package.json -nt docs/tools/node_modules ]; }; then
	(cd docs/tools && bun install --silent) >&2
fi
if [ -f packages/runtime/package.json ]; then
	if [ ! -d packages/runtime/node_modules ]; then (cd packages/runtime && bun install --silent) >&2; fi
	if [ ! -f packages/runtime/dist/index.js ] || [ -n \"\$(find packages/runtime/src packages/runtime/package.json -newer packages/runtime/dist/index.js 2>/dev/null | head -1)\" ]; then
		(cd packages/runtime && bun run build) >&2
	fi
fi
set +e
cd ~/$dest$rel && $cmd"
