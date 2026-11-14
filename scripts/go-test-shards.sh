#!/bin/sh
# go test -exec program: runs one package's test binary as GO_TEST_SHARDS processes at once (default 6, or one per core
# on a smaller machine), each with its own -test.run list, and exits with the first failing process's status.
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
# GO_TEST_SLICE=i/n (1 <= i <= n) runs only the names whose key k has k mod n = i - 1, so n runs of the same command
# on n hosts run every name exactly once between them. testdata/shard-slices.txt in the package directory records each
# name's key ("<key> <name>" lines). A name it does not list keys by the 32-bit FNV-1a hash of its bytes, so adding or
# removing a test moves no other test between slices, and //:<label> N holds the same existing tests on two trees. A
# line for a name the binary no longer lists is ignored. Only a rebalance rewrites the file: in the package directory,
# GO_TEST_SLICE_REBALANCE=n with the slice run's flags (no selector) deals every listed name longest first onto the
# least-loaded of n slices, by testdata/shard-seconds.txt, writes the keys and runs no test. Commit a rebalance alone.
# A package that lists no names runs whole in slice 1 and not at all in the others; a slice that holds no name of a
# package with names runs nothing. smthrs gives a target only its declared environment, so under the
# graph the slice comes from scripts/go-test-slice, one line "i/n <host>" (git-ignored), and applies only on the host it
# names (uname -n): a CI machine that runs one slice writes it after committing its tree, and a copy that reaches any
# other checkout slices nothing. GO_TEST_SLICE, when set, wins.
#
# The processes share two threads per core, so each runs with GOMAXPROCS set to its share or to a smaller inherited
# value. Six processes of GOMAXPROCS=4 on a 4-vCPU box took about 1600 s and put FuzzDeclarationIdentity at 15m50s of CPU,
# over its 12-minute limit; four of GOMAXPROCS=2 took 534 s and 6m07s (2026-11-05). GO_TEST_CORES overrides the core
# count for tests.
#
# Use: go test -exec "$PWD/scripts/go-test-shards.sh" ./pkg/...   Test: scripts/go-test-shards.test.mjs.
set -u
bin=$1
shift
cores=${GO_TEST_CORES:-$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 6)}
case $cores in ''|*[!0-9]*|0) cores=6 ;; esac
default_shards=6
[ "$cores" -ge 6 ] || default_shards=$cores
shards=${GO_TEST_SHARDS:-$default_shards}
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
  # Overflow is a failed comparison, not evidence that the slice is in range.
  # Require both comparisons to succeed before discovery can run.
  if ! { [ "$si" -ge 1 ] && [ "$si" -le "$sn" ]; } 2>/dev/null; then
    echo "go-test-shards: GO_TEST_SLICE=$slice is not i/n with 1 <= i <= n" >&2
    exit 2
  fi
fi
rebalance=${GO_TEST_SLICE_REBALANCE:-}
case $rebalance in
  '') ;;
  *[!0-9]*|0*) echo "go-test-shards: GO_TEST_SLICE_REBALANCE=$rebalance is not a slice count n >= 1" >&2; exit 2 ;;
  *) si=1 sn=$rebalance ;;
esac
# Runs the binary unchanged. A rebalance must list the whole package and run no test, so it refuses instead.
native() {
  if [ -n "$rebalance" ]; then
    echo "go-test-shards: GO_TEST_SLICE_REBALANCE lists the whole package; $arg would run tests instead" >&2
    exit 2
  fi
  exec "$bin" "$@"
}
# Coverage and profiling share one output path. Use one process so shards
# cannot truncate each other's measurements.
for arg in "$@"; do
  # Go stops parsing options at a positional argument or --, so a selector
  # appended below would be ignored. Split flag values also take this safe
  # path: custom flag types cannot be inferred here.
  case $arg in
    -|--) native "$@" ;;
    -*) ;;
    *) native "$@" ;;
  esac
  # Go accepts one or two leading dashes. Inspect a copy; keep "$@" intact.
  case $arg in --test.*) arg=${arg#-} ;; esac
  case $arg in
    # A suite-wide fail-fast run needs one native process, including flag validation.
    -test.failfast|-test.failfast=*|--test.failfast|--test.failfast=*) native "$@" ;;
    -test.coverprofile|-test.coverprofile=*|-test.cpuprofile|-test.cpuprofile=*|-test.memprofile|-test.memprofile=*|-test.blockprofile|-test.blockprofile=*|-test.mutexprofile|-test.mutexprofile=*|-test.trace|-test.trace=*) native "$@" ;;
    -test.run|-test.run=*|-test.list|-test.list=*|-test.fuzz|-test.fuzz=*|-test.bench|-test.bench=*|-test.v=test2json) native "$@" ;;
  esac
done
[ "$shards" -gt 1 ] || [ "$sn" -gt 1 ] || [ -n "$rebalance" ] || exec "$bin" "$@"

threads=$((cores * 2 / (shards > 0 ? shards : 1)))
[ "$threads" -ge 2 ] || threads=2
case ${GOMAXPROCS:-} in
  ''|*[!0-9]*|0) ;;
  *) [ "$GOMAXPROCS" -ge "$threads" ] || threads=$GOMAXPROCS ;;
esac

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
echo "go-test-shards: listing tests" >&2
"$bin" "$@" -test.list '.*' > "$dir/listed" 2>&1 &
pids=$!
wait "$pids"
listed_status=$?
pids=
if [ "$listed_status" -ne 0 ]; then
  echo "go-test-shards: listing failed: exit $listed_status" >&2
  cat "$dir/listed"
  exit 1
fi
echo "go-test-shards: listed tests: exit 0" >&2
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
slices=testdata/shard-slices.txt
if [ -n "$rebalance" ]; then
  # Deal every name longest first onto the least-loaded slice (ties to the lowest slice, then by name in byte order:
  # the graph's targets run with no locale), record each slice index as the name's key, and replace the file only
  # when every listed name has a line.
  listed_count=$(awk 'END { print NR }' "$dir/weighted")
  if ! mkdir -p testdata || ! {
      printf '%s\n' \
        "# Slice keys for scripts/go-test-shards.sh: GO_TEST_SLICE=i/n runs the names whose key k has k mod n = i - 1." \
        "# A name not listed keys by the FNV-1a hash of its bytes, so a new test moves no other test. Rebalanced for" \
        "# n = $sn from testdata/shard-seconds.txt; GO_TEST_SLICE_REBALANCE in scripts/go-test-shards.sh rewrites it."
      LC_ALL=C sort -k1,1nr -k2,2 "$dir/weighted" | LC_ALL=C awk -v n="$sn" '
        { best = 0; for (j = 1; j < n; j++) if (load[j] < load[best]) best = j; load[best] += $1; print best, $2 }
      ' | LC_ALL=C sort -k2,2
    } > "$dir/rebalanced" ||
    [ "$(awk '!/^#/ { rows++ } END { print rows + 0 }' "$dir/rebalanced")" != "$listed_count" ] ||
    ! cp "$dir/rebalanced" "$slices"; then
    echo "go-test-shards: writing $slices failed" >&2
    exit 1
  fi
  echo "go-test-shards: wrote $slices: $listed_count names, keys for $sn slices" >&2
  exit 0
fi
# A name's key is its line's in testdata/shard-slices.txt, else the 32-bit FNV-1a hash (offset 2166136261, prime
# 16777619) of its bytes. od prints the bytes as decimal numbers in any locale. awk has neither XOR nor 64-bit
# integers: it XORs the low byte bit by bit and multiplies as h * 2^24 + h * 403, each exact in a double.
[ "$sn" -gt 1 ] && [ -f "$slices" ] || slices=/dev/null
: > "$dir/unlisted"
: > "$dir/hashes"
if [ "$sn" -gt 1 ]; then
  if ! awk -v slices="$slices" -v unlisted="$dir/unlisted" '
      BEGIN {
        while ((getline line < slices) > 0) {
          row++
          if (line ~ /^#/ || line == "") continue
          name = substr(line, index(line, " ") + 1)
          if (line !~ /^[0-9]+ [^[:space:]]+$/ || name in key) {
            print "go-test-shards: " slices ":" row ": not a \"<key> <name>\" line of a new name: " line > "/dev/stderr"
            exit 1
          }
          key[name] = 1
        }
      }
      !($2 in key) { print $2 > unlisted }
    ' "$dir/ordered" || ! od -An -tu1 -v "$dir/unlisted" > "$dir/bytes" || ! LC_ALL=C awk '
      function xor8(a, b,   bit, r) {
        r = 0
        for (bit = 1; bit < 256; bit *= 2) { if (a % 2 != b % 2) r += bit; a = int(a / 2); b = int(b / 2) }
        return r
      }
      BEGIN { h = 2166136261 }
      {
        for (f = 1; f <= NF; f++) {
          if ($f == 10) { printf "%.0f\n", h; h = 2166136261; continue }
          low = h % 256
          h = h - low + xor8(low, $f)
          h = ((h % 256) * 16777216 + h * 403) % 4294967296
        }
      }
    ' "$dir/bytes" > "$dir/hashes"; then
    echo "go-test-shards: hashing tests failed" >&2
    exit 1
  fi
fi
if ! awk -v i="$si" -v n="$sn" -v slices="$slices" -v unlisted="$dir/unlisted" -v hashes="$dir/hashes" '
  BEGIN {
    while ((getline line < slices) > 0) if (line !~ /^#/ && line != "") key[substr(line, index(line, " ") + 1)] = line + 0
    while ((getline name < unlisted) > 0) { if ((getline hash < hashes) <= 0) exit 1; key[name] = hash + 0 }
  }
  key[$2] % n == i - 1
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
  assigned_names=
  assigned_separator=
  assigned_count=0
  while IFS= read -r name; do
    run="$run$separator$name"
    separator="|"
    assigned_names="$assigned_names$assigned_separator$name"
    assigned_separator=","
    assigned_count=$((assigned_count + 1))
  done < "$list"
  run="$run)\$"
  echo "go-test-shards: starting process $i: $assigned_count tests: $assigned_names" >&2
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
    GOMAXPROCS=$threads "$bin" "$@" "-test.run=$run" > "$dir/out$i" 2>&1 &
    child=$!
    wait "$child"
    status=$?
    echo "go-test-shards: finished process $i: exit $status" >&2
    echo "go-test-shards: process $i: $(wc -l < "$list") tests, exit $status, $(( $(date +%s) - start ))s" >> "$dir/out$i"
    echo $status > "$dir/status$i" ) &
  pids="$pids $!"
  n=$((n + 1))
done
if [ "$n" -eq 0 ]; then
  # A package with names whose keys miss this slice runs nothing here; running it whole would repeat other slices.
  [ ! -s "$dir/ordered" ] || { echo "go-test-shards: slice $slice: no test of this package has a key in this slice"; echo PASS; exit 0; }
  [ "$si" -eq 1 ] || { echo "go-test-shards: slice $slice: the package lists no tests, slice 1 runs it"; echo PASS; exit 0; }
  # exec replaces this shell without running its EXIT trap. Discovery is
  # finished; remove only its private scratch before handing off to TestMain.
  rm -rf "$dir" || exit 1
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
