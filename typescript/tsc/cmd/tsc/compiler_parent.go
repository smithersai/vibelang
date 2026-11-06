package main

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// A synchronous loader cannot run an exit hook when its process is killed.
// Its native compiler watches the originating caller, including through a
// launcher, so an interrupted test or build cannot leave that compile running.
func watchCompilerParent() (func(), error) {
	value := os.Getenv("VIBELANG_COMPILER_PARENT_PID")
	if value == "" || !processAliveSupported {
		return func() {}, nil
	}
	pid, err := strconv.Atoi(value)
	if err != nil || pid <= 0 {
		return nil, fmt.Errorf("invalid compiler parent process")
	}
	if !isProcessAlive(pid) {
		return nil, fmt.Errorf("loader process %d exited before compilation", pid)
	}
	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(200 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				if !isProcessAlive(pid) {
					fmt.Fprintf(os.Stderr, "vibelang: loader process %d exited; stopping compiler\n", pid)
					// Type checking may be inside work that does not poll a
					// cancellation context. The caller can no longer consume
					// or cache output, so stop this private process promptly.
					os.Exit(1)
				}
			}
		}
	}()
	return func() { close(done) }, nil
}
