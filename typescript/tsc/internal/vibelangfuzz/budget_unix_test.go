//go:build linux || darwin

package vibelangfuzz

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"testing"
	"time"
)

// Each fuzz target owns its parallel seed children until its cleanup runs.
// RUSAGE_CHILDREN includes completed stock compiler/Node subprocesses, so the
// check covers every oracle without charging time spent waiting for host CPU.
func fuzzCPU() (time.Duration, error) {
	var total time.Duration
	for _, who := range []int{syscall.RUSAGE_SELF, syscall.RUSAGE_CHILDREN} {
		var r syscall.Rusage
		if err := syscall.Getrusage(who, &r); err != nil {
			return 0, err
		}
		total += time.Duration(r.Utime.Sec+r.Stime.Sec)*time.Second +
			time.Duration(r.Utime.Usec+r.Stime.Usec)*time.Microsecond
	}
	return total, nil
}

func startShortBudget(f *testing.F) {
	if !testing.Short() || toolsFuzzing() {
		return
	}
	enforceFuzzBudget(f, 240*time.Second)
}

func enforceFuzzBudget(t testing.TB, limit time.Duration) {
	t.Helper()
	start, err := fuzzCPU()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		end, err := fuzzCPU()
		if err != nil {
			t.Fatal(err)
		}
		used := end - start
		t.Logf("%s: short seed CPU: %v (failure limit %v)", t.Name(), used, limit)
		if used > 120*time.Second {
			t.Logf("%s: short seed CPU above 120s budget: %v", t.Name(), used)
		}
		if used > limit {
			t.Errorf("short seed CPU budget exceeded: %v > %v", used, limit)
		}
	})
}

func TestShortBudgetEnforced(t *testing.T) {
	if os.Getenv("VIBELANG_BUDGET_PROBE") == "1" {
		enforceFuzzBudget(t, time.Nanosecond)
		// A child exercises RUSAGE_CHILDREN rather than merely the parent clock.
		child := exec.Command(os.Args[0], "-test.run=^TestBudgetCPUChild$")
		child.Env = append(os.Environ(), "VIBELANG_BUDGET_CHILD=1")
		if out, err := child.CombinedOutput(); err != nil {
			t.Fatalf("%v: %s", err, out)
		}
		return
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestShortBudgetEnforced$")
	cmd.Env = append(os.Environ(), "VIBELANG_BUDGET_PROBE=1")
	out, err := cmd.CombinedOutput()
	if err == nil || !strings.Contains(string(out), "short seed CPU budget exceeded") {
		t.Fatalf("budget guard did not fail: %v: %s", err, out)
	}
}

func TestBudgetCPUChild(t *testing.T) {
	if os.Getenv("VIBELANG_BUDGET_CHILD") != "1" {
		return
	}
	start, err := fuzzCPU()
	if err != nil {
		t.Fatal(err)
	}
	var x uint64
	for i := 0; i < 1000000; i++ {
		x = x*1664525 + uint64(i)
	}
	fmt.Fprint(os.Stderr, x)
	end, err := fuzzCPU()
	if err != nil || end < start {
		t.Fatalf("CPU accounting: %v", err)
	}
}
