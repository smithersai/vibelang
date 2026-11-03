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
# -json) or selects benchmarks (-test.bench) runs the binary unchanged.
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
# Coverage and profiling share one output path. Use one process so shards
# cannot truncate each other's measurements.
for arg in "$@"; do
  # Go accepts one or two leading dashes. Inspect a copy; keep "$@" intact.
  case $arg in --test.*) arg=${arg#-} ;; esac
  case $arg in
    -test.coverprofile|-test.coverprofile=*|-test.cpuprofile|-test.cpuprofile=*|-test.memprofile|-test.memprofile=*|-test.blockprofile|-test.blockprofile=*|-test.mutexprofile|-test.mutexprofile=*|-test.trace|-test.trace=*) exec "$bin" "$@" ;;
    -test.run|-test.run=*|-test.list|-test.list=*|-test.fuzz|-test.fuzz=*|-test.bench|-test.bench=*|-test.v=test2json) exec "$bin" "$@" ;;
  esac
done
[ "$shards" -gt 1 ] || [ "$sn" -gt 1 ] || exec "$bin" "$@"

dir=$(mktemp -d "${TMPDIR:-/tmp}/go-test-shards.XXXXXX") || exit 1
pids=
cleanup() {
  trap '' HUP INT TERM
  if [ -n "$pids" ]; then
    kill $pids 2>/dev/null || true
    for pid in $pids; do wait "$pid" 2>/dev/null || true; done
  fi
  rm -rf "$dir"
}
trap cleanup EXIT
trap 'exit 143' HUP INT TERM

# Listing can run TestMain too. Keep its PID so cancellation reaps it just
# like the shard processes below.
"$bin" "$@" -test.list '.*' > "$dir/listed" 2>&1 &
pids=$!
wait "$pids"
listed_status=$?
pids=
if [ "$listed_status" -ne 0 ]; then
  cat "$dir/listed"
  exit 1
fi
weights=testdata/shard-seconds.txt
[ -f "$weights" ] || weights=/dev/null
# Check every stage before running any subset of the tests. A POSIX shell
# pipeline reports only the last command's status; an earlier failure can
# otherwise leave a partial, apparently successful partition.
if ! awk -v weights="$weights" '
  BEGIN { while ((getline line < weights) > 0) { split(line, f, " "); if (line !~ /^#/ && f[2] != "") w[f[2]] = f[1] } }
  /^(Test|Fuzz|Example)[^[:space:]]*$/ { print (($0 in w) ? w[$0] : 1), $0 }
' "$dir/listed" > "$dir/weighted"; then
  echo "go-test-shards: weighting tests failed" >&2
  exit 1
fi
if ! sort -k1,1nr -k2,2 "$dir/weighted" > "$dir/ordered"; then
  echo "go-test-shards: sorting tests failed" >&2
  exit 1
fi
if ! awk -v i="$si" -v n="$sn" '
  { best = 0; for (j = 1; j < n; j++) if (load[j] < load[best]) best = j; load[best] += $1; if (best == i - 1) print }
' "$dir/ordered" > "$dir/sliced"; then
  echo "go-test-shards: slicing tests failed" >&2
  exit 1
fi
if ! awk -v k="$shards" -v dir="$dir" '
  { best = 0; for (i = 1; i < k; i++) if (load[i] < load[best]) best = i; load[best] += $1; print $2 > (dir "/names" best) }
' "$dir/sliced"; then
  echo "go-test-shards: partitioning tests failed" >&2
  exit 1
fi

n=0
for list in "$dir"/names*; do
  [ -f "$list" ] || continue
  i=${list##*/names}
  # Join with shell builtins. An unchecked external join can fail and turn
  # this into ^()$, silently running no tests while every shard reports success.
  run="^("
  separator=
  while IFS= read -r name; do
    run="$run$separator$name"
    separator="|"
  done < "$list"
  run="$run)\$"
  ( child=
    cancel() {
      trap '' HUP INT TERM
      if [ -n "$child" ]; then
        kill "$child" 2>/dev/null || true
        wait "$child" 2>/dev/null || true
      fi
      exit 143
    }
    # The launcher owns this shell, and this shell owns the test binary.
    # Killing only the shell leaves the binary running after cancellation.
    trap cancel HUP INT TERM
    start=$(date +%s)
    "$bin" "$@" "-test.run=$run" > "$dir/out$i" 2>&1 &
    child=$!
    wait "$child"
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
