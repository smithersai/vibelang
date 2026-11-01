#!/bin/sh
# go test -exec program: runs one package's test binary as GO_TEST_SHARDS processes at once (default 6), each with
# its own -test.run list, and exits with the first failing process's status.
#
# Go runs a package's tests one after another unless each calls t.Parallel, and a fuzz target's seed corpus likewise.
# //:go-vibelangfuzz is such a chain: 686 s on a quiet host (10-31, 614 s of it in top-level tests and fuzz targets
# run in turn), and it hit its 40-minute deadline in FuzzVIPDifferential, its last target, on every loaded main
# (42c771e16b1c, 1180893af776). Separate processes need no test to be safe to run concurrently, and each gets its own
# node worker; the go command, and so its build slot, stays alive until the last process exits.
#
# Names are split longest first onto the least-loaded process, with seconds from testdata/shard-seconds.txt in the
# package directory ("<seconds> <name>" lines; a name it does not list counts 1 s). A stale file only unbalances the
# processes. A run that already selects tests (-test.run, -test.list), fuzzes (-test.fuzz) or reports JSON (go test
# -json) runs the binary unchanged.
#
# GO_TEST_SLICE=i/n (1 <= i <= n) runs only the i-th of n slices of each package's names, dealt the same way, so n
# runs of the same command on n hosts run every name exactly once between them. A package that lists no names runs
# whole in slice 1 and not at all in the others. smthrs gives a target only its declared environment, so under the
# graph the slice comes from scripts/go-test-slice, one line "i/n <host>" (git-ignored), and applies only on the host it
# names (uname -n): a CI machine that runs one slice writes it after committing its tree, and a copy that reaches any
# other checkout slices nothing. GO_TEST_SLICE, when set, wins.
#
# Use: go test -exec "$PWD/scripts/go-test-shards.sh" ./pkg/...   Test: scripts/go-test-shards.test.mjs.
set -u
bin=$1
shift
shards=${GO_TEST_SHARDS:-6}
slice=${GO_TEST_SLICE:-}
slice_file=$(dirname "$0")/go-test-slice
if [ -z "$slice" ] && [ -f "$slice_file" ]; then
  read -r file_slice file_host < "$slice_file" || true
  if [ "${file_host:-}" = "$(uname -n)" ]; then slice=$file_slice; else
    echo "go-test-shards: ignoring $slice_file: it names host ${file_host:-(none)}, this is $(uname -n)" >&2; fi
fi
si=1 sn=1
if [ -n "$slice" ]; then
  si=${slice%%/*} sn=${slice#*/}
  case "$slice" in
    */*) ;;
    *) si=0 ;;
  esac
  case "$si/$sn" in
    *[!0-9/]* | /* | */ | */*/*) si=0 sn=0 ;;
  esac
  if [ "$si" -lt 1 ] || [ "$si" -gt "$sn" ]; then
    echo "go-test-shards: GO_TEST_SLICE=$slice is not i/n with 1 <= i <= n" >&2
    exit 2
  fi
fi
for arg in "$@"; do
  case $arg in
    -test.run|-test.run=*|-test.list|-test.list=*|-test.fuzz=*|-test.v=test2json) exec "$bin" "$@" ;;
  esac
done
[ "$shards" -gt 1 ] || [ "$sn" -gt 1 ] || exec "$bin" "$@"

dir=$(mktemp -d "${TMPDIR:-/tmp}/go-test-shards.XXXXXX") || exit 1
pids=
trap 'kill $pids 2>/dev/null; rm -rf "$dir"' EXIT
trap 'exit 143' HUP INT TERM

# TestMain and custom test flags apply during listing as well as execution.
if ! "$bin" "$@" -test.list '.*' > "$dir/listed" 2>&1; then
  cat "$dir/listed"
  exit 1
fi
weights=testdata/shard-seconds.txt
[ -f "$weights" ] || weights=/dev/null
awk -v weights="$weights" '
  BEGIN { while ((getline line < weights) > 0) { split(line, f, " "); if (line !~ /^#/ && f[2] != "") w[f[2]] = f[1] } }
  /^(Test|Fuzz|Example)[A-Za-z0-9_]*$/ { print (($0 in w) ? w[$0] : 1), $0 }
' "$dir/listed" | sort -k1,1nr -k2,2 | awk -v i="$si" -v n="$sn" '
  { best = 0; for (j = 1; j < n; j++) if (load[j] < load[best]) best = j; load[best] += $1; if (best == i - 1) print }
' | awk -v k="$shards" -v dir="$dir" '
  { best = 0; for (i = 1; i < k; i++) if (load[i] < load[best]) best = i; load[best] += $1; print $2 > (dir "/names" best) }
'

n=0
for list in "$dir"/names*; do
  [ -f "$list" ] || continue
  i=${list##*/names}
  run="^($(paste -sd '|' "$list"))\$"
  ( start=$(date +%s)
    "$bin" "$@" "-test.run=$run" > "$dir/out$i" 2>&1
    status=$?
    echo "go-test-shards: process $i: $(wc -l < "$list") tests, exit $status, $(( $(date +%s) - start ))s" >> "$dir/out$i"
    echo $status > "$dir/status$i" ) &
  pids="$pids $!"
  n=$((n + 1))
done
if [ "$n" -eq 0 ]; then
  # Only a package that lists no names gets here: slice 1 always holds the first name.
  [ "$si" -eq 1 ] || { echo "go-test-shards: slice $slice: the package lists no tests, slice 1 runs it"; echo PASS; exit 0; }
  exec "$bin" "$@"
fi
wait
pids=
status=0
for list in "$dir"/names*; do
  i=${list##*/names}
  cat "$dir/out$i"
  code=$(cat "$dir/status$i" 2>/dev/null || echo 1)
  [ "$status" -ne 0 ] || status=$code
done
exit "$status"
