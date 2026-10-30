#!/bin/sh
# Compiler benchmark: VibeLang check and emit time and memory against plain
# tsgo on equivalent Effect TypeScript, plus the docs corpus, the examples,
# and the app template. Run it on a quiet machine (the build host).
#
#   sh scripts/bench/compiler.sh [--upstream <tsgo>] [--modules 200] [--runs 5] [--scale "50 100 200 400"] [--shapes "chain dense single"] [--out <dir>]
#
#   --upstream  an upstream tsgo binary (for example built from the import
#               commit 0c804b2f) to compile the Effect TypeScript project with
#   --modules   synthetic project size
#   --runs      runs per measurement; the table reports medians
#   --scale     module counts for the scaling tables ("" skips them)
#   --shapes    synthetic shapes to scale (see gen-synthetic.mjs)
#   --out       working directory (default: a new temp directory)
#
# The compiler under test is $VIBELANG, else the native build output.
# A legacy typescript/built/local/tsc build remains a fallback.
# Needs node, bun, python3, and a built packages/runtime.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
native=vibelang
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) native=vibelang.exe ;; esac
vibelang=${VIBELANG:-$root/packages/compiler/native/$native}
if [ -z "${VIBELANG:-}" ] && [ ! -x "$vibelang" ] && [ -x "$root/typescript/built/local/tsc" ]; then
  vibelang="$root/typescript/built/local/tsc"
fi
upstream=""
modules=200
runs=5
scale="50 100 200 400"
shapes="chain dense single"
out=""
while [ $# -gt 0 ]; do
  case $1 in
    --upstream) upstream=$2; shift 2 ;;
    --modules) modules=$2; shift 2 ;;
    --runs) runs=$2; shift 2 ;;
    --scale) scale=$2; shift 2 ;;
    --shapes) shapes=$2; shift 2 ;;
    --out) out=$2; shift 2 ;;
    *) echo "compiler.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -x "$vibelang" ] || { echo "compiler.sh: no compiler at $vibelang (build it or set VIBELANG)" >&2; exit 1; }
out=${out:-$(mktemp -d "${TMPDIR:-/tmp}/vibelang-bench-XXXXXX")}
mkdir -p "$out"
sh "$root/scripts/bench/modules.sh" "$out"

# One measurement: median wall time, check time, and total time, and the
# largest peak RSS, over $runs runs of `<binary> -p <tsconfig> --extendedDiagnostics`.
measure() { # label binary tsconfig
  label=$1 bin=$2 config=$3
  rm -rf "$(dirname "$config")/dist"
  i=0
  : > "$out/runs.txt"
  while [ $i -lt "$runs" ]; do
    python3 "$root/scripts/bench/measure.py" "$bin" -p "$config" --extendedDiagnostics --pretty false > "$out/run.log" 2>&1 || true
    files=$(sed -n 's/^Files: *//p' "$out/run.log")
    check=$(sed -n 's/^Check time: *\([0-9.]*\)s/\1/p' "$out/run.log")
    total=$(sed -n 's/^Total time: *\([0-9.]*\)s/\1/p' "$out/run.log")
    errors=$(grep -c ' error ' "$out/run.log" || true)
    sed -n 's/^MEASURE wall_s=\([0-9.]*\) rss_mb=\([0-9.]*\) exit=\([0-9]*\)/\1 \2 \3/p' "$out/run.log" | while read -r wall rss code; do
      echo "$wall $rss $code ${check:-0} ${total:-0} ${files:-0} $errors" >> "$out/runs.txt"
    done
    i=$((i + 1))
  done
  python3 - "$label" "$out/runs.txt" <<'EOF'
import statistics, sys
label, path = sys.argv[1], sys.argv[2]
rows = [line.split() for line in open(path) if line.strip()]
med = lambda k: statistics.median(float(r[k]) for r in rows)
rss = max(float(r[1]) for r in rows)
codes = {r[2] for r in rows}
errors = max(int(r[6]) for r in rows)
note = "" if codes == {"0"} and errors == 0 else f" (exit {','.join(sorted(codes))}, {errors} errors)"
print(f"| {label} | {rows[0][5]} | {med(0):.2f} | {med(3):.2f} | {med(4):.2f} | {rss:.0f} |{note}")
EOF
}

header() {
  echo
  echo "| Target | Files | Wall s | Check s | Total s | Peak RSS MiB |"
  echo "| --- | ---: | ---: | ---: | ---: | ---: |"
}

echo "compiler: $("$vibelang" --version)"
[ -z "$upstream" ] || echo "upstream: $("$upstream" --version)"
echo "runs per row: $runs (medians; peak RSS is the largest)"

# Synthetic project at the headline size.
node "$root/scripts/bench/gen-synthetic.mjs" "$out/synth" "$modules" > /dev/null
header
measure "synthetic $modules modules, VibeLang" "$vibelang" "$out/synth/vibelang/tsconfig.json"
measure "synthetic $modules modules, Effect TS, this compiler" "$vibelang" "$out/synth/effect-ts/tsconfig.json"
[ -z "$upstream" ] || measure "synthetic $modules modules, Effect TS, upstream tsgo" "$upstream" "$out/synth/effect-ts/tsconfig.json"

# Examples and the template, copied under $out so they share its node_modules.
for dir in "$root"/examples/*/ "$root/templates/app/"; do
  name=$(basename "$dir")
  [ -f "$dir/tsconfig.json" ] || continue
  rm -rf "$out/apps/$name"
  mkdir -p "$out/apps/$name"
  cp "$dir/tsconfig.json" "$out/apps/$name/"
  cp -R "$dir/src" "$out/apps/$name/src"
  [ -f "$dir/package.json" ] && cp "$dir/package.json" "$out/apps/$name/"
  measure "$name" "$vibelang" "$out/apps/$name/tsconfig.json"
done

# The docs corpus as one program: check-snippets writes one project per page;
# a root tsconfig lists every page's files.
corpus=$(VIBELANG_BINARY="$vibelang" bun "$root/docs/tools/check-snippets.ts" --keep | sed -n 's/^Temporary projects: //p')
if [ -n "$corpus" ]; then
  python3 - "$corpus" <<'EOF'
import json, os, sys
root = sys.argv[1]
files = []
for page in sorted(os.listdir(root)):
    config = os.path.join(root, page, "tsconfig.json")
    if os.path.isfile(config):
        files += [os.path.join(page, f) for f in json.load(open(config))["files"]]
json.dump({"compilerOptions": {"strict": True, "target": "ESNext", "module": "NodeNext", "moduleResolution": "NodeNext",
           "skipLibCheck": True, "types": [], "rewriteRelativeImportExtensions": True, "outDir": "dist"},
           "files": files}, open(os.path.join(root, "tsconfig.json"), "w"))
print(f"corpus: {len(files)} files", file=sys.stderr)
EOF
  measure "docs corpus as one program (expected-error blocks included)" "$vibelang" "$corpus/tsconfig.json"
  rm -rf "$corpus"
fi

# Scaling: wall time against module count, to expose superlinear passes.
if [ -n "$scale" ]; then
  for shape in $shapes; do
    echo
    echo "Scaling, $shape shape (VibeLang, then the same modules as Effect TS on ${upstream:+upstream tsgo}${upstream:-this compiler}):"
    header
    for n in $scale; do
      node "$root/scripts/bench/gen-synthetic.mjs" "$out/scale" "$n" "$shape" > /dev/null
      measure "$n modules, VibeLang" "$vibelang" "$out/scale/vibelang/tsconfig.json"
      measure "$n modules, Effect TS" "${upstream:-$vibelang}" "$out/scale/effect-ts/tsconfig.json"
    done
  done
fi
echo
echo "working directory: $out"
