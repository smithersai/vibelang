#!/bin/sh
# Runs a fuzz campaign over this package's Fuzz targets, one after another,
# then measures Go statement coverage of the compiler's packages over the
# seed corpus plus testdata/fuzz, and prints one row per package.
#
#   cd typescript/tsc
#   ES_REMOTE_HOST=ubuntu@<host> ES_REMOTE_KEY=~/.ssh/<key> \
#     sh ../../scripts/remote.sh sh internal/vibelangfuzz/campaign.sh 5m
#   ... campaign.sh 5m FuzzCompile=10m FuzzParse FuzzConfig
#   ... campaign.sh 10m FuzzTypeScriptParity FuzzDeclarationIdentity
#
# The first argument is each target's default duration; the others name the
# targets to run, each optionally with its own duration. With no targets it
# runs every Fuzz target in the package. Run it on the build host, never on a
# laptop: a campaign builds the compiler and keeps six workers busy. The host
# is shared, so a campaign uses -parallel 6 (CAMPAIGN_PARALLEL overrides it).
# Each target has its duration plus CAMPAIGN_GRACE (default 15m) to finish,
# including startup and minimization. A timeout dumps the coordinator's
# goroutines with SIGQUIT, then kills its process group after another minute.
#
# The fuzzer writes a new crasher to testdata/fuzz/<target>/; the campaign
# moves each to $CAMPAIGN_OUT/crashers/<target>/, outside the tree a remote.sh
# sync replaces, so that the coverage run measures the committed corpus and a
# crasher cannot stop it. The summary lists them; copy the ones to keep into
# the workspace's testdata/fuzz/<target>/ after minimizing them.
set -eu
# A campaign with a missing dependency fails instead of fuzzing nothing.
export VIBELANG_FUZZ_REQUIRE=1

# duration_seconds accepts Go duration units and compound durations. Reject
# anything unrecognized rather than silently choosing an unbounded deadline.
duration_seconds() {
	awk -v duration="$1" 'BEGIN {
		rest = duration
		if (rest == "0") { print 0; exit }
		if (substr(rest, 1, 1) == "+") rest = substr(rest, 2)
		seconds = 0
		parts = 0
		while (length(rest)) {
			if (match(rest, /^([0-9]+([.][0-9]*)?|[.][0-9]+)/) != 1) exit 1
			number = substr(rest, 1, RLENGTH) + 0
			rest = substr(rest, RLENGTH + 1)
			if (match(rest, /^(ns|us|µs|μs|ms|s|m|h)/) != 1) exit 1
			unit = substr(rest, 1, RLENGTH)
			rest = substr(rest, RLENGTH + 1)
			scale = 1
			if (unit == "h") scale = 3600
			else if (unit == "m") scale = 60
			else if (unit == "ms") scale = 0.001
			else if (unit == "us" || unit == "µs" || unit == "μs") scale = 0.000001
			else if (unit == "ns") scale = 0.000000001
			seconds += number * scale
			parts++
		}
		if (!parts) exit 1
		printf "%.9f\n", seconds
	}' || {
		echo "campaign: cannot parse Go duration: $1" >&2
		return 1
	}
}

here=$(cd "$(dirname "$0")" && pwd)
tsc=$(cd "$here/../.." && pwd)
cd "$tsc"
pkg=./internal/vibelangfuzz/
parallel=${CAMPAIGN_PARALLEL:-6}
duration=${1:-5m}
[ $# -gt 0 ] && shift
grace_seconds=$(duration_seconds "${CAMPAIGN_GRACE:-15m}") || exit 2
duration_seconds "$duration" > /dev/null || exit 2
for spec in "$@"; do
	case "$spec" in
		*=*) duration_seconds "${spec#*=}" > /dev/null || exit 2 ;;
	esac
done
command -v timeout > /dev/null 2>&1 || { echo "campaign: timeout is required" >&2; exit 2; }
coverpkg=./internal/vibelang,./internal/vibelangfmt,./internal/vibelangestree,./internal/vibelangmapper,./internal/parser,./internal/checker,./internal/ls,./internal/format,./internal/printer
out=${CAMPAIGN_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/vibelangfuzz-campaign.XXXXXX")}
mkdir -p "$out"
out=$(cd "$out" && pwd) # the workers run in the package's directory

targets=$*
if [ -z "$targets" ]; then
	targets=$(GOFLAGS= go test -list '^Fuzz' "$pkg" | grep '^Fuzz')
fi

summary="$out/summary.txt"
: > "$summary"
failed=0
names=""
for spec in $targets; do
	target=${spec%%=*}
	time=$duration
	[ "$spec" != "$target" ] && time=${spec#*=}
	seconds=$(duration_seconds "$time") || exit 2
	awk -v seconds="$seconds" 'BEGIN { exit !(seconds > 0) }' || {
		echo "campaign: target duration must be positive: $time" >&2
		exit 2
	}
	limit=$(awk -v seconds="$seconds" -v grace="$grace_seconds" 'BEGIN { printf "%.9fs", seconds + grace }')
	names="$names${names:+|}$target"
	corpus="$here/testdata/fuzz/$target"
	before=$(ls "$corpus" 2>/dev/null | sort || true)
	echo "== $target for $time (-parallel $parallel; timeout $limit)" >&2
	status=0
	# The fuzz engine discards its workers' standard error; each worker
	# appends it to $target.workers.log instead (main_test.go), so a worker
	# that dies of a hang or a fatal error leaves its reason there.
	: > "$out/$target.workers.log"
	VIBELANG_FUZZ_WORKER_LOG="$out/$target.workers.log" GOFLAGS= timeout -s QUIT -k 60 "$limit" go test -run '^$' -fuzz "^$target\$" -fuzztime "$time" -parallel "$parallel" "$pkg" > "$out/$target.log" 2>&1 || status=$?
	last=$(grep -E '^fuzz: elapsed' "$out/$target.log" | tail -1 || true)
	after=$(ls "$corpus" 2>/dev/null | sort || true)
	new=$(printf '%s\n' "$after" | grep -vxF -e "$before" -e '' || true)
	[ -z "$before" ] && new=$after
	{
		case "$status" in
			124|137) echo "$target  $time  timed out (exit $status; limit $limit)" ;;
			*) echo "$target  $time  exit $status" ;;
		esac
		echo "  ${last:-no progress line; see $out/$target.log}"
		for file in $new; do
			echo "  new crasher: $out/crashers/$target/$file"
			mkdir -p "$out/crashers/$target" && mv "$corpus/$file" "$out/crashers/$target/"
		done
		if [ "$status" -ne 0 ]; then
			failed=1
			grep -m 5 -E '^\s+--- FAIL|Failing input|panic:|hang:' "$out/$target.log" | sed 's/^/  /' || true
			grep -m 3 -E '^(panic|fatal error):' "$out/$target.workers.log" | cut -c1-300 | sed 's/^/  worker: /' || true
		fi
	} >> "$summary"
done

echo "== ordinary short seed CPU budgets" >&2
# Even a full-seed nightly reports the ordinary short selection separately.
# -v preserves CPU logs from successful tests; count=1 avoids filesystem
# input-log recording and result-cache rehashing.
if ! VIBELANG_FUZZ_SEEDS= GOFLAGS= go test -short -count=1 -v -run "^($names)\$" "$pkg" > "$out/short-budget.log" 2>&1; then
 failed=1
 echo "short seed budget check failed; see $out/short-budget.log" >> "$summary"
fi
echo "Short targets above 120 CPU-seconds:" >> "$summary"
if ! grep 'short seed CPU above 120s budget:' "$out/short-budget.log" >> "$summary"; then
 echo "  none" >> "$summary"
fi

echo "== coverage over the seed corpus and testdata/fuzz" >&2
profile="$out/cover.out"
# Instrumented, the compiler runs several times slower, so a stage that
# takes seconds is not a hang here; the campaign above hunted those.
VIBELANG_FUZZ_HANG=${VIBELANG_FUZZ_HANG:-300s} GOFLAGS= go test -run "^($names)\$" -count=1 -coverpkg="$coverpkg" -coverprofile="$profile" "$pkg" > "$out/coverage.log" 2>&1 || {
	failed=1
	echo "the coverage run failed; see $out/coverage.log" >&2
	tail -20 "$out/coverage.log" >&2
}

echo
echo "Campaign ($out)"
cat "$summary"
echo
echo "Statement coverage over the seed corpus and testdata/fuzz"
if [ -s "$profile" ]; then
	# A block may appear more than once in a profile; count it once, as
	# covered when any copy ran.
	awk -F'[: ]' 'NR > 1 {
		key = $1 ":" $2
		stmts[key] = $3
		if ($4 > 0) hit[key] = 1
	}
	END {
		if (length(stmts) == 0) { print "the profile holds no blocks"; exit }
		for (key in stmts) {
			file = key; sub(/:.*/, "", file)
			pkg = file; sub(/\/[^\/]*$/, "", pkg); sub(/^.*\/internal\//, "internal/", pkg)
			total[pkg] += stmts[key]; all += stmts[key]
			if (key in hit) { covered[pkg] += stmts[key]; done += stmts[key] }
		}
		printf "%-28s %10s %10s %8s\n", "package", "statements", "covered", "percent"
		n = 0
		for (pkg in total) names[++n] = pkg
		for (i = 1; i <= n; i++) for (j = i + 1; j <= n; j++) if (names[j] < names[i]) { t = names[i]; names[i] = names[j]; names[j] = t }
		for (i = 1; i <= n; i++) {
			pkg = names[i]
			printf "%-28s %10d %10d %7.1f%%\n", pkg, total[pkg], covered[pkg], 100 * covered[pkg] / total[pkg]
		}
		printf "%-28s %10d %10d %7.1f%%\n", "total", all, done, 100 * done / all
	}' "$profile"
else
	echo "no profile"
fi
# The status is nonzero when a target found a failure or a run broke.
exit "$failed"
