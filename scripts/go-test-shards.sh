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
# Use: go test -exec "$PWD/scripts/go-test-shards.sh" ./pkg/...   Test: scripts/go-test-shards.test.mjs.
set -u
bin=$1
shift
shards=${GO_TEST_SHARDS:-6}
for arg in "$@"; do
  case $arg in
    -test.run|-test.run=*|-test.list|-test.list=*|-test.fuzz=*|-test.v=test2json) exec "$bin" "$@" ;;
  esac
done
[ "$shards" -gt 1 ] || exec "$bin" "$@"

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
' "$dir/listed" | sort -k1,1nr -k2,2 | awk -v k="$shards" -v dir="$dir" '
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
[ "$n" -gt 0 ] || exec "$bin" "$@"
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
