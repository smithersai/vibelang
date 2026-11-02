package vibelang

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"
	"time"
)

// Run in a subprocess so a regression cannot exhaust the test runner. Count
// total allocated bytes (a stricter budget than retained heap) and bound wall
// time, including program creation. The watchdog also stops a broken compiler
// before it builds the exponentially large channel lists.
func TestInferredChannelsScale(t *testing.T) {
	const budget = 512 << 20
	const deadline = 20 * time.Second
	if os.Getenv("VIBELANG_INFER_SCALE_CHILD") != "1" {
		ctx, cancel := context.WithTimeout(t.Context(), deadline)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestInferredChannelsScale$", "-test.v")
		cmd.Env = append(os.Environ(), "VIBELANG_INFER_SCALE_CHILD=1", "GOMEMLIMIT=256MiB")
		start := time.Now()
		output, err := cmd.CombinedOutput()
		t.Logf("200 functions, fan-out 2: %s\n%s", time.Since(start), output)
		if err != nil {
			t.Fatalf("inference must finish within %s and allocate under %d MiB: %v", deadline, budget>>20, err)
		}
		return
	}
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	done := make(chan struct{})
	defer close(done)
	go func() {
		ticker := time.NewTicker(10 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				var current runtime.MemStats
				runtime.ReadMemStats(&current)
				if current.TotalAlloc-before.TotalAlloc > budget {
					fmt.Fprintf(os.Stderr, "inference exceeded %d MiB allocation budget (%d MiB)\n", budget>>20, (current.TotalAlloc-before.TotalAlloc)>>20)
					os.Exit(2)
				}
			}
		}
	}()
	var source strings.Builder
	source.WriteString("export function f0(x: number) { return x + 1 }\n")
	for i := 1; i < 200; i++ {
		fmt.Fprintf(&source, "export function f%d(x: number) { sleep(\"0 millis\"); const a = f%d(x); return a > 0 ? a : f%d(x + 1) }\n", i, i-1, i-1)
	}
	program, file, _, _ := editorProgram(t, source.String())
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		t.Errorf("unexpected diagnostic: %s", d.String())
	}
	runtime.ReadMemStats(&after)
	allocated := after.TotalAlloc - before.TotalAlloc
	t.Logf("allocated %d bytes (budget %d)", allocated, budget)
	if allocated > budget {
		t.Fatalf("inference allocated %d bytes; budget %d", allocated, budget)
	}
}
