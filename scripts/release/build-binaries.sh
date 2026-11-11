#!/bin/sh
# Cross-compiles the native VibeLang compiler for the six npm platforms into
# dist-npm/bin/<platform>/vibelang (vibelang.exe on Windows).
#
#   ES_REMOTE_HOST=user@host ES_REMOTE_KEY=~/.ssh/key sh scripts/release/build-binaries.sh
#   sh scripts/release/build-binaries.sh --local
#
# With ES_REMOTE_HOST set, the six Go builds run on that host through
# scripts/remote.sh and the binaries are copied back, so this machine needs
# neither the disk nor the CPU for them. --local builds here instead. Either
# way, the binaries this machine can run must print the expected version.
#
# Every run first deletes dist-npm/bin/, so a target that fails leaves no
# binary from an earlier run. dist-npm/bin/revision records the source
# revision and whether the tree had uncommitted changes. The revision is
# linked into each binary, the run fails unless all six carry it, and
# make-packages.mjs refuses binaries whose revision is not the checkout's.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
out="$root/dist-npm/bin"
platforms="darwin-arm64 darwin-x64 linux-arm64 linux-x64 win32-arm64 win32-x64"
version=$(node -p 'require(process.argv[1]).version' "$root/packages/compiler/package.json")

# The build host's copy has no version control, so the machine that starts a
# remote build passes its revision in VIBELANG_RELEASE_REVISION.
if [ -n "${VIBELANG_RELEASE_REVISION:-}" ]; then
  revision=$VIBELANG_RELEASE_REVISION
  clean=${VIBELANG_RELEASE_CLEAN:-false}
else
  record=$(node "$root/scripts/release/revision.mjs" "$root")
  revision=${record% *}
  clean=${record#* }
fi
# The revision each binary carries; a changed tree is not that commit.
stamp=$revision
[ "$clean" = true ] || stamp="$revision-dirty"

check() {
  # check <platform> runs one binary's --version.
  platform=$1
  printed=$("$out/$platform/vibelang" --version)
  case $printed in
    "VibeLang $version ("*) echo "build-binaries: $platform prints: $printed" ;;
    *) echo "build-binaries: $platform printed '$printed', expected VibeLang $version" >&2; exit 1 ;;
  esac
}

# No output of an earlier run may survive a target that fails in this one.
rm -rf "$out"
mkdir -p "$out"
if [ "${1:-}" != "--local" ] && [ -n "${ES_REMOTE_HOST:-}" ]; then
  key=${ES_REMOTE_KEY:-$HOME/.ssh/id_ed25519}
  (cd "$root" && sh scripts/remote.sh env "VIBELANG_RELEASE_REVISION=$revision" "VIBELANG_RELEASE_CLEAN=$clean" sh scripts/release/build-binaries.sh --local)
  # remote.sh keeps the workspace under ~/es-remote/<workspace directory name>.
  rsync -a --delete -e "ssh -i $key -o IdentitiesOnly=yes -o BatchMode=yes" \
    "$ES_REMOTE_HOST:es-remote/$(basename "$root")/dist-npm/bin/" "$out/"
  [ "$(cat "$out/revision")" = "$(printf 'revision=%s\nclean=%s\n' "$revision" "$clean")" ] || {
    echo "build-binaries: the build host recorded another revision than $revision in dist-npm/bin/revision" >&2
    exit 1
  }
else
  command -v go >/dev/null 2>&1 || { echo "build-binaries: Go is required." >&2; exit 1; }
  printf 'revision=%s\nclean=%s\n' "$revision" "$clean" > "$out/revision"
  echo "build-binaries: revision $stamp"
  pids=""
  for platform in $platforms; do
    os=${platform%-*}
    cpu=${platform#*-}
    exe=vibelang
    goos=$os
    [ "$os" = win32 ] && { goos=windows; exe=vibelang.exe; }
    goarch=$cpu
    [ "$cpu" = x64 ] && goarch=amd64
    mkdir -p "$out/$platform"
    echo "build-binaries: GOOS=$goos GOARCH=$goarch go build ./cmd/tsc -> dist-npm/bin/$platform/$exe"
    (cd "$root/typescript/tsc" && CGO_ENABLED=0 GOOS=$goos GOARCH=$goarch \
      sh "$root/scripts/native-output.sh" build "$out/$platform/$exe" -trimpath \
        -ldflags="-s -w -X github.com/microsoft/TypeScript/tsc/internal/vibelang.Revision=$stamp" ./cmd/tsc) >"$out/$platform.log" 2>&1 &
    pids="$pids $platform:$!"
  done
  failed=0
  for job in $pids; do
    platform=${job%:*}
    pid=${job##*:}
    rc=0
    wait "$pid" || rc=$?
    exe=vibelang
    case $platform in win32-*) exe=vibelang.exe ;; esac
    if [ "$rc" -eq 0 ] && [ ! -s "$out/$platform/$exe" ]; then
      echo "build-binaries: $platform returned success without a nonempty binary" >&2
      rc=1
    fi
    # Keep one receipt per target, including silent failures or killed children.
    printf 'platform=%s\ncompleted=%s\nexit=%s\n' "$platform" "$(date -u +%FT%TZ)" "$rc" > "$out/$platform.status"
    if [ "$rc" -ne 0 ]; then
      failed=1
      echo "build-binaries: $platform failed (exit $rc); log: $out/$platform.log" >&2
      if [ -s "$out/$platform.log" ]; then
        cat "$out/$platform.log" >&2
      else
        echo "build-binaries: $platform failed without diagnostic output" >&2
      fi
    fi
  done
  if [ "$failed" -ne 0 ]; then
    echo "build-binaries: a build failed; per-target receipts: $out/*.status" >&2
    exit 1
  fi
  rm -f "$out"/*.log
fi

for platform in $platforms; do
  exe=vibelang
  case $platform in win32-*) exe=vibelang.exe ;; esac
  [ -f "$out/$platform/$exe" ] || { echo "build-binaries: missing dist-npm/bin/$platform/$exe" >&2; exit 1; }
  printf 'build-binaries: %-13s %s bytes\n' "$platform" "$(wc -c <"$out/$platform/$exe" | tr -d ' ')"
  # Version output is the same for every build of a version, and five of the
  # six binaries cannot run here: read the linked revision from the bytes.
  node -e 'process.exit(require("node:fs").readFileSync(process.argv[1]).includes(process.argv[2]) ? 0 : 1)' "$out/$platform/$exe" "$stamp" || {
    echo "build-binaries: dist-npm/bin/$platform/$exe does not carry revision $stamp" >&2
    exit 1
  }
done

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)
    check darwin-arm64 ;;
  Darwin-x86_64) check darwin-x64 ;;
  Linux-x86_64) check linux-x64 ;;
  Linux-aarch64) check linux-arm64 ;;
esac
