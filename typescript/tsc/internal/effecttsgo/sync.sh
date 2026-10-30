#!/bin/sh
# Vendors the Effect language service rules (Effect-TS/tsgo, MIT) into this directory.
#
#   sh tsc/internal/effecttsgo/sync.sh <release tag>     (from typescript/)
#   sh tsc/internal/effecttsgo/sync.sh @effect/tsgo@0.57.0
#
# 1. Downloads the release's source tarball from GitHub.
# 2. Applies the TypeScript patches named in patches.txt to ../.. (tsc/), with
#    github.com/effect-ts/tsgo/ rewritten to this directory's import path. A patch
#    upstream left unchanged since the last sync is skipped. A changed one replaces
#    the old: the old copy in _patches/ is reversed, then the new one applied; a
#    hunk that fails stops the sync and names the file to port by hand.
# 3. Copies the Go packages that the roots in packages.txt import (no tests), with
#    the same import rewrite, and the rules' diagnostic messages.
# 4. Regenerates tsc/internal/diagnostics with the rules' messages.
# 5. Generates shim/ with upstream's own _tools/gen_shims over this tsc/, so the
#    shims mirror this compiler's structs and unexported functions.
# 6. Records the release in UPSTREAM and builds tsc/.
#
# Nothing here is edited by hand except sync.sh, packages.txt, patches.txt and
# UPSTREAM's notes, the shim layout guard and tests; VibeLang's glue lives in tsc/internal/vibelang/effectlint*.go.
set -eu
tag=${1:?usage: sync.sh <Effect-TS/tsgo release tag, such as @effect/tsgo@0.57.0>}
here=$(cd "$(dirname "$0")" && pwd)
tsc=$(cd "$here/../.." && pwd)
work=${EFFECTTSGO_WORK:-$(mktemp -d)}
mod=github.com/microsoft/TypeScript/tsc
self=$mod/internal/effecttsgo

encoded=$(printf %s "$tag" | sed 's#@#%40#g; s#/#%2F#g')
if [ ! -d "$work/src" ]; then
  mkdir -p "$work/src"
  curl -fsSL "https://codeload.github.com/Effect-TS/tsgo/tar.gz/refs/tags/$encoded" | tar -xz -C "$work/src" --strip-components=1
fi
src=$work/src

# rewrite FILE...: point Effect's module and shim paths at this directory.
rewrite() {
  sed -i \
    -e "s#github.com/effect-ts/tsgo/#$self/#g" \
    -e "s#$mod/shim/#$self/shim/#g" \
    -e 's#filepath.Join("..", "..", "..", "..", "internal", "diagnostics", "effectDiagnosticMessages.json")#filepath.Join("..", "effecttsgo", "internal", "diagnostics", "effectDiagnosticMessages.json")#' \
    "$@"
}

# 2. Patches to tsc/.
mkdir -p "$here/_patches"
grep -v '^#' "$here/patches.txt" | while read -r name; do
  [ -n "$name" ] || continue
  new=$work/$name
  cp "$src/_patches/typescript/$name" "$new"
  rewrite "$new"
  old=$here/_patches/$name
  if [ -f "$here/_patches/upstream/$name" ] && cmp -s "$new" "$here/_patches/upstream/$name"; then
    continue
  fi
  if [ -f "$old" ]; then
    (cd "$tsc/.." && patch -p1 -R -s -f --no-backup-if-mismatch < "$old") || {
      echo "sync: cannot reverse $old; reverse it by hand" >&2; exit 1; }
  fi
  (cd "$tsc/.." && patch -p1 -s -f --no-backup-if-mismatch < "$new") || {
    echo "sync: $name does not apply; port the .rej hunks under tsc/, then save the applied diff as _patches/$name" >&2; exit 1; }
  mkdir -p "$here/_patches/upstream"
  cp "$new" "$old"
  cp "$new" "$here/_patches/upstream/$name"
done

# 3. Go packages.
python3 - "$src" "$here" <<'PY'
import os, re, shutil, sys
src, here = sys.argv[1], sys.argv[2]
roots = [l.strip() for l in open(os.path.join(here, "packages.txt")) if l.strip() and not l.startswith("#")]
deps = {}
for d, _, files in os.walk(src):
    rel = os.path.relpath(d, src)
    for f in files:
        if f.endswith(".go") and not f.endswith("_test.go"):
            for m in re.findall(r'"github.com/effect-ts/tsgo/([^"]+)"', open(os.path.join(d, f)).read()):
                deps.setdefault(rel, set()).add(m)
seen, stack = set(), list(roots)
while stack:
    p = stack.pop()
    if p not in seen:
        seen.add(p)
        stack.extend(deps.get(p, ()))
for top in ("etscore", "internal") + tuple(sorted({p.split("/")[0] for p in seen if p.startswith("ets")})):
    shutil.rmtree(os.path.join(here, top), ignore_errors=True)
for p in sorted(seen):
    os.makedirs(os.path.join(here, p), exist_ok=True)
    for f in os.listdir(os.path.join(src, p)):
        if f.endswith(".go") and not f.endswith("_test.go"):
            shutil.copy(os.path.join(src, p, f), os.path.join(here, p, f))
os.makedirs(os.path.join(here, "internal/diagnostics"), exist_ok=True)
shutil.copy(os.path.join(src, "internal/diagnostics/effectDiagnosticMessages.json"), os.path.join(here, "internal/diagnostics"))
shutil.copy(os.path.join(src, "LICENSE"), os.path.join(here, "LICENSE"))
open(os.path.join(here, ".packages"), "w").write("\n".join(sorted(seen)) + "\n")
PY
find "$here" -path "$here/shim" -prune -o -path "$here/_patches" -prune -o -name '*.go' -print | while read -r f; do rewrite "$f"; done
# core imports etscore, so etscore takes collections from tsc itself, not from a shim.
sed -i "s#$self/shim/collections#$mod/internal/collections#" "$here"/etscore/*.go

# 4. The rules' messages join tsc's diagnostics, which the shims below re-export.
(cd "$tsc/internal/diagnostics" && go run generate.go -diagnostics diagnostics_generated.go -loc loc_generated.go -locdir loc \
  -locproject ../../../tools/LocProject.json -locsource diagnosticMessages.generated.json)

# 5. Shims, generated over this tsc/ and kept for the packages the vendored code imports.
(cd "$src/_tools/gen_shims" && GOWORK=off go run . --no-cache \
  --repository-root "$src" --source-root "$tsc" \
  --module-prefix "$mod" --provider-shim-prefix "$mod/shim" \
  --extra-shim-root "$src/_tools/gen_shims/providers/typescript" >/dev/null)
# Keep VibeLang-owned layout checks when refreshing upstream-generated shims.
find "$here/shim" -type f ! -name '*_test.go' ! -path "$here/shim/checker/layout.go" -delete
grep -rhoE "\"$self/shim/[^\"]+\"" "$here" --include='*.go' | tr -d '"' | sed "s#$self/shim/##" | sort -u | while read -r p; do
  mkdir -p "$here/shim/$p"
  for f in "$src/shim/$p"/*.go; do
    case $f in *_test.go) continue ;; esac
    cp "$f" "$here/shim/$p/"
  done
done
find "$here/shim" -name '*.go' | while read -r f; do rewrite "$f"; done
# The import rewrite changes the imports' order; vendored files are always regenerated, so format them.
"$(go env GOROOT)/bin/gofmt" -w "$here/internal" "$here"/ets* "$here/shim"

# 6. The record.
commit=$(curl -fsSL "https://api.github.com/repos/Effect-TS/tsgo/commits/$encoded" | python3 -c 'import json,sys; print(json.load(sys.stdin)["sha"])' 2>/dev/null || echo unknown)
python3 - "$here/UPSTREAM" "$tag" "$commit" <<'PY'
import re, sys
path, tag, commit = sys.argv[1:]
s = open(path).read()
s = re.sub(r"(?m)^tag: .*$", "tag: " + tag, s)
s = re.sub(r"(?m)^commit: .*$", "commit: " + commit, s)
open(path, "w").write(s)
PY
(cd "$tsc" && go build ./...)
echo "synced Effect-TS/tsgo $tag ($commit)"
