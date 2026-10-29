#!/bin/sh
# Runs this package's fuzz campaigns against the latest main every night on
# the build host and keeps a report of what they found.
#
# Each run downloads main from GitHub into a fresh directory, installs what
# the targets need (Effect, the runtime, the stock TypeScript the mapper
# pins), and runs campaign.sh over every Fuzz target at low priority. Go keeps
# the inputs each campaign found interesting in its build cache, so the next
# night continues where this one stopped. On Sundays it also runs the seed
# corpus under the race detector, which found the declaration-emit race.
# Before the campaigns it runs every seed once, as the campaigns add them, and
# the report lists the seeds that fail first.
#
# It runs on nyc-02 as the lane user, which has the cores to spare. Install it
# once there:
#
#   mkdir -p ~/es-nightly
#   scp typescript/tsc/internal/vibelangfuzz/nightly.sh <host>:es-nightly/nightly.sh
#   crontab: 0 1 * * * sh $HOME/es-nightly/nightly.sh >> $HOME/es-nightly/cron.log 2>&1
#
# Each run copies the newest nightly.sh from main over ~/es-nightly/nightly.sh
# for the next night; the running shell keeps reading the copy it started
# with, because the update writes a new file and renames it into place.
#
# A run writes ~/es-nightly/runs/<date>/report.md, which excerpts the log of
# every target that failed and names its new failing inputs, which are under
# crashers/. ~/es-nightly/latest points at the newest run. Runs older than 30
# days are deleted.
#
# NIGHTLY_TARGET_TIME (default 20m) is each target's campaign, and
# NIGHTLY_PARALLEL (default 16) its workers, on NIGHTLY_GOMAXPROCS (default
# 24) threads. A night with less than
# NIGHTLY_MIN_FREE_GB (default 40) free on the disk is skipped. To test this
# script, NIGHTLY_SRC names a checkout to run instead of main, and
# NIGHTLY_ROOT a directory to use instead of ~/es-nightly.
set -eu

root=${NIGHTLY_ROOT:-$HOME/es-nightly}
# The lane user's tools are in ~/.local, and lanes/env.sh, when a host has
# one, sets the rest; on nyc-01, ubuntu's are in es-tools.
if [ -f "$HOME/lanes/env.sh" ]; then
	. "$HOME/lanes/env.sh"
fi
export PATH=$HOME/.local/go/bin:$HOME/.local/node/bin:$HOME/.local/bin:$HOME/es-tools/go/bin:$HOME/es-tools/node/bin:$HOME/es-tools/bun/bin:$PATH
# lanes/env.sh pins GOMAXPROCS for interactive lanes; a campaign wants more.
export GOMAXPROCS=${NIGHTLY_GOMAXPROCS:-24}
export GOFLAGS=-trimpath CGO_ENABLED=0
# A hang is a stage that never ends; on a loaded shared host an ordinary
# compile can take longer than the 10 s default.
export VIBELANG_FUZZ_HANG=${VIBELANG_FUZZ_HANG:-30s}

mkdir -p "$root/runs"
exec 9> "$root/lock"
if ! flock -n 9; then
	echo "$(date -u +%FT%TZ) another run holds $root/lock; skipping"
	exit 0
fi

# The host is shared, and a full disk fails every lane's build.
free=$(df -Pk "$HOME" | awk 'NR == 2 { print int($4 / 1048576) }')
if [ "$free" -lt "${NIGHTLY_MIN_FREE_GB:-40}" ]; then
	echo "$(date -u +%FT%TZ) only ${free} GB free; skipping"
	exit 0
fi

day=$(date -u +%F)
out=$root/runs/$day
mkdir -p "$out"
# Go builds and tests write under TMPDIR, and a fuzz worker that the hang
# watchdog or the engine kills leaves its t.TempDir and build directories
# behind. Each run gets its own, removed at the end, so they cannot fill the
# shared disk.
export TMPDIR=$root/tmp
rm -rf "$TMPDIR"
mkdir -p "$TMPDIR"
rm -rf "$root/src"
if [ -n "${NIGHTLY_SRC:-}" ]; then
	# A checkout to run instead of main, to test this script.
	sha=local
	src=$root/src/$sha
	mkdir -p "$src"
	cp -a "$NIGHTLY_SRC/." "$src/"
else
	sha=$(curl -fsSL https://api.github.com/repos/smithersai/vibelang/commits/main | sed -n 's/^  "sha": "\([0-9a-f]*\)",$/\1/p' | head -1)
	[ -n "$sha" ] || { echo "cannot read main's commit" >&2; exit 1; }
	src=$root/src/$sha
	mkdir -p "$src"
	curl -fsSL "https://codeload.github.com/smithersai/vibelang/tar.gz/$sha" | tar xz -C "$src" --strip-components=1
	# The next night runs main's version of this script.
	cp "$src/typescript/tsc/internal/vibelangfuzz/nightly.sh" "$root/nightly.sh.new" && mv "$root/nightly.sh.new" "$root/nightly.sh"
fi

echo "$(date -u +%FT%TZ) main $sha into $src"
(cd "$src/experiments" && bun install --silent)
(cd "$src/packages/runtime" && bun install --silent && bun run build) > "$out/runtime-build.log" 2>&1
ts7_version=$(node -p 'require(process.argv[1]).devDependencies.typescript' "$src/packages/ts-mapper/package.json")
npm install --prefix "$src/packages/ts-mapper/test/.cache/typescript-$ts7_version" --no-audit --no-fund --silent "typescript@$ts7_version"
export EFFECT_NODE_MODULES=$src/experiments/node_modules

status=0
# A campaign starts by running its seeds, every one, where the gate's -short
# seed run samples a few (toolsSample, -short); a seed that fails there ends
# the campaign before it fuzzes, and the report shows it only in that
# target's log. This run reports every seed failure first, on its own.
seeds=passed
(cd "$src/typescript/tsc" && VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_SEEDS=all nice -n 15 go test -count=1 -timeout 3h ./internal/vibelangfuzz/) > "$out/seeds.log" 2>&1 || { seeds=failed; status=1; }

CAMPAIGN_OUT=$out CAMPAIGN_PARALLEL=${NIGHTLY_PARALLEL:-16} \
	nice -n 15 sh "$src/typescript/tsc/internal/vibelangfuzz/campaign.sh" "${NIGHTLY_TARGET_TIME:-20m}" > "$out/campaign.txt" 2>&1 || status=$?

race=skipped
if [ "$(date -u +%u)" = 7 ]; then
	race=passed
	(cd "$src/typescript/tsc" && CGO_ENABLED=1 VIBELANG_FUZZ_REQUIRE=1 nice -n 15 go test -race -short -count=1 ./internal/vibelangfuzz/...) > "$out/race.log" 2>&1 || { race=failed; status=1; }
fi

{
	echo "# Fuzz campaigns, $day"
	echo
	echo "main $sha. Seed run $seeds; exit status $status; race detector $race."
	echo
	if [ "$seeds" = failed ]; then
		echo "## Seed run"
		echo
		echo "Every seed, as a campaign adds them (VIBELANG_FUZZ_SEEDS=all, without -short); seeds.log has the rest."
		echo
		echo '```text'
		grep -E '^ *--- FAIL' "$out/seeds.log" | head -60 || true
		echo
		grep -m 20 -E -A 8 '^ +[a-z_]+_test\.go:[0-9]+: Fuzz|^panic:' "$out/seeds.log" || true
		echo '```'
		echo
	fi
	echo '```text'
	sed -n '/^Campaign (/,$p' "$out/campaign.txt"
	echo '```'
	# A target can fail on an input it saved before, as well as on a new one,
	# so each failing target's log is excerpted.
	failing=$(sed -n 's/^\(Fuzz[A-Za-z]*\) .* exit [1-9][0-9]*$/\1/p' "$out/summary.txt")
	if [ -n "$failing" ]; then
		echo
		echo "## Failures"
		for target in $failing; do
			echo
			echo "### $target"
			echo
			for file in "$out/crashers/$target"/*; do
				[ -e "$file" ] && echo "New failing input: crashers/$target/$(basename "$file")"
			done
			echo
			echo '```text'
			grep -v '^fuzz: elapsed' "$out/$target.log" | grep -m 3 -E -A 12 'failure while|--- FAIL|panic:|hang' || true
			echo '```'
			# What a worker that died wrote (campaign.sh), such as a hang panic.
			if grep -q -E '^(panic|fatal error):' "$out/$target.workers.log" 2> /dev/null; then
				echo
				echo '```text'
				grep -m 2 -E -A 12 '^(panic|fatal error):' "$out/$target.workers.log" | cut -c1-300
				echo '```'
			fi
		done
	fi
	if [ "$race" = failed ]; then
		echo
		echo "## Race detector"
		echo
		echo '```text'
		grep -m 40 -E -A 12 'WARNING: DATA RACE|--- FAIL' "$out/race.log" || true
		echo '```'
	fi
} > "$out/report.md"

ln -sfn "$out" "$root/latest"
find "$root/runs" -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +
rm -rf "$src" "$TMPDIR"
echo "$(date -u +%FT%TZ) done: $out/report.md (status $status)"
exit "$status"
