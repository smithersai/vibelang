package vibelangfuzz

import (
	"fmt"
	"os"
	"runtime/debug"
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
	os.Exit(code)
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
