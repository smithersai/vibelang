package vibelangfuzz

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime/debug"
	"strings"
	"testing"
)

// configureFuzzCollection collects less often, up to a limit per process. These
// targets allocate and discard whole programs, and collection was 15% of their CPU,
// which counts against the 12-minute limit. Explicit settings win.
func configureFuzzCollection() {
	if os.Getenv("GOGC") == "" {
		debug.SetGCPercent(300)
	}
	if os.Getenv("GOMEMLIMIT") == "" {
		debug.SetMemoryLimit(2 << 30)
	}
}

// TestMain marks the fuzz engine's pipes before m.Run can start any target
// or child. This belongs to the test binary's startup, rather than package
// initialization, and leaves descriptors alone outside fuzz workers. With
// VIBELANG_FUZZ_WORKER_LOG set to an absolute path, a worker's standard
// error goes to that file (campaign.sh), so a worker that dies says why.
func TestMain(m *testing.M) {
	configureFuzzCollection()
	if isFuzzWorker(os.Args[1:]) {
		if err := closeOnExec(3, 4, 5); err != nil {
			fmt.Fprintf(os.Stderr, "fuzz worker pipes: %v\n", err)
			os.Exit(1)
		}
		if path := os.Getenv("VIBELANG_FUZZ_WORKER_LOG"); path != "" {
			if err := logStderr(path); err != nil {
				fmt.Fprintf(os.Stderr, "fuzz worker log: %v\n", err)
				os.Exit(1)
			}
		}
	}
	code := m.Run()
	closeDeclarationIdentityUnitWorkers()
	if !isFuzzWorker(os.Args[1:]) {
		if code == 0 {
			code = reportUnusedPending()
		} else if os.Getenv("VIBELANG_FUZZ_REQUIRE") == "1" {
			fmt.Fprintln(os.Stderr, "note: tests failed, so the unused pending-line audit did not run; fix the failures and rerun to judge testdata/pending/")
		}
	}
	os.Exit(code)
}

// reportUnusedPending fails a gate run that ran a target whole without
// using one of its pending lines (pending.go), and returns the exit status.
func reportUnusedPending() int {
	flagValue := func(name string) string {
		if f := flag.Lookup(name); f != nil {
			return f.Value.String()
		}
		return ""
	}
	ran := wholeTargets(os.Getenv, flagValue)
	if ran == nil || !pendingLedgerFound() {
		return 0
	}
	entries, err := pendingEntries()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	unused := UnusedPending(entries, pendingCompanions, judgedTargets(ran), func(entry PendingEntry) bool {
		_, ok := pendingUsed.Load(entry.Target + " " + entry.Key)
		return ok
	})
	for _, entry := range unused {
		fmt.Fprintf(os.Stderr, "XPASS %s %s: %s and every test that raises its keys ran whole and no oracle raised or deliberately omitted this key, so its line is stale or misspelt and would excuse the failure if it came back; delete its line in testdata/pending/, or add the corpus input that raises it (%s: %s)\n", entry.Target, entry.Key, entry.Target, entry.Owner, entry.Reason)
	}
	if len(unused) != 0 {
		fmt.Fprintln(os.Stderr, "FAIL: unused pending lines")
		return 1
	}
	return 0
}

// wholeTargets returns the test of whether this process ran every seed of a
// target, or nil when no target's pending lines can be judged: outside a
// gate run, which may skip for a missing dependency; when pending features
// are generated or a hang probe runs one input; and when the run fuzzes,
// lists, skips or selects subtests.
func wholeTargets(env, flagValue func(string) string) func(target string) bool {
	if env("VIBELANG_FUZZ_REQUIRE") != "1" || env("VIBELANG_FUZZ_PENDING") == "1" || env("VIBELANG_FUZZ_HANG_PROBE") == "1" {
		return nil
	}
	if flagValue("test.fuzz") != "" || flagValue("test.list") != "" || flagValue("test.skip") != "" {
		return nil
	}
	run := flagValue("test.run")
	if run == "" {
		return func(string) bool { return true }
	}
	// go test matches each slash-separated element against one level, so a
	// slash selects subtests: some seeds did not run.
	if strings.Contains(run, "/") {
		return nil
	}
	pattern, err := regexp.Compile(run)
	if err != nil {
		return nil
	}
	return pattern.MatchString
}

// pendingLedgerFound reports whether this process can locate the checkout
// and its testdata/pending/. A child test binary that a test starts in a
// temporary directory cannot, read no corpus, and has no line to judge.
func pendingLedgerFound() (found bool) {
	defer func() {
		if recover() != nil {
			found = false
		}
	}()
	_, err := os.Stat(filepath.Join(repoTestdata(), "pending"))
	return err == nil
}

func isFuzzWorker(args []string) bool {
	for _, arg := range args {
		if arg == "-test.fuzzworker" || arg == "-test.fuzzworker=true" {
			return true
		}
	}
	return false
}

func TestFuzzCollectionSettings(t *testing.T) {
	if os.Getenv("GOGC") != "" || os.Getenv("GOMEMLIMIT") != "" {
		t.Skip("explicit settings win")
	}
	percent := debug.SetGCPercent(300)
	limit := debug.SetMemoryLimit(-1)
	if percent != 300 || limit != 2<<30 {
		t.Fatalf("GC percent %d, memory limit %d", percent, limit)
	}
}
