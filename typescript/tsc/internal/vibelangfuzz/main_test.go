package vibelangfuzz

import (
	"fmt"
	"os"
	"testing"
)

// TestMain marks the fuzz engine's pipes before m.Run can start any target
// or child. This belongs to the test binary's startup, rather than package
// initialization, and leaves descriptors alone outside fuzz workers. With
// VIBELANG_FUZZ_WORKER_LOG set to an absolute path, a worker's standard
// error goes to that file (campaign.sh), so a worker that dies says why.
func TestMain(m *testing.M) {
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
