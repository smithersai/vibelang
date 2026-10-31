#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
command -v go >/dev/null 2>&1 || { echo "build-vibelang: Go is required." >&2; exit 1; }
export GOFLAGS="${GOFLAGS:+$GOFLAGS }-trimpath"
mkdir -p "$root/packages/compiler/native"
exe=vibelang
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exe=vibelang.exe ;; esac
entry=./cmd/tsc
[ ! -d "$root/typescript/tsc/cmd/vibelang" ] || entry=./cmd/vibelang
echo "build-vibelang: CGO_ENABLED=0 go build $entry"
(cd "$root/typescript/tsc" && CGO_ENABLED=0 sh "$root/scripts/native-output.sh" build "$root/packages/compiler/native/$exe" "$entry")
echo "build-vibelang: $root/packages/compiler/native/$exe"
# The case harness, smoke.sh and lsp-smoke.sh --no-build run typescript/built/local/tsc, the build graph's
# //typescript:compiler output; installing the same binary there makes a case run test this build. The helper's
# final mv replaces a link at that path instead of writing through it.
tsc="$root/typescript/built/local/tsc${exe#vibelang}"
sh "$root/scripts/native-output.sh" copy "$tsc" "$root/packages/compiler/native/$exe"
echo "build-vibelang: $tsc"
# The dprint plugin for .vibe files runs this binary; its manifest names a zip of it.
"$root/packages/compiler/native/$exe" --write-dprint-plugin "$root/packages/compiler" >/dev/null
echo "build-vibelang: $root/packages/compiler/dprint-plugin.json"
