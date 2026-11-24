//go:build unix

package vibelangfuzz

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"
)

// Each fuzz target owns its parallel seed children until its cleanup runs.
// RUSAGE_CHILDREN includes completed stock compiler/Node subprocesses, so the
// report includes subprocess CPU time as well as process-wide overhead.
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
	closeDeclarationIdentityUnitWorkers()
	if testing.Short() && !toolsFuzzing() {
		reportFuzzCPU(f, 120*time.Second)
	}
	registerDeclarationIdentityScope(f)
}

func reportFuzzCPU(t testing.TB, threshold time.Duration) {
	t.Helper()
	var startSelf, startChildren syscall.Rusage
	_ = syscall.Getrusage(syscall.RUSAGE_SELF, &startSelf)
	_ = syscall.Getrusage(syscall.RUSAGE_CHILDREN, &startChildren)
	start, err := fuzzCPU()
	if err != nil {
		t.Logf("short seed CPU unavailable: %v", err)
		return
	}
	t.Cleanup(func() {
		end, err := fuzzCPU()
		if err != nil {
			t.Logf("short seed CPU unavailable: %v", err)
			return
		}
		used := end - start
		var endSelf, endChildren syscall.Rusage
		_ = syscall.Getrusage(syscall.RUSAGE_SELF, &endSelf)
		_ = syscall.Getrusage(syscall.RUSAGE_CHILDREN, &endChildren)
		seconds := func(r syscall.Rusage) float64 {
			return float64(r.Utime.Sec+r.Stime.Sec) + float64(r.Utime.Usec+r.Stime.Usec)/1e6
		}
		declarationCostRecord(t.Name(), "cpu", map[string]any{"self_cpu_seconds": seconds(endSelf) - seconds(startSelf), "children_cpu_seconds": seconds(endChildren) - seconds(startChildren), "limit_seconds": threshold.Seconds()})
		if path := os.Getenv("VIBELANG_FUZZ_BUDGET_LOG"); path != "" {
			file, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND|os.O_CREATE, 0666)
			if err == nil {
				// One append write keeps records intact across test processes.
				_, err = file.WriteString(fmt.Sprintf("%s\t%.3f\t%g\t%d\t%d\n",
					t.Name(), used.Seconds(), threshold.Seconds(), runtime.GOMAXPROCS(0), runtime.NumCPU()))
				if closeErr := file.Close(); err == nil {
					err = closeErr
				}
			}
			if err != nil {
				t.Logf("%s: budget log: %v", t.Name(), err)
			}
		}
		t.Logf("%s: short seed CPU: %v", t.Name(), used)
		if used > threshold {
			t.Logf("%s: short seed CPU above %gs budget: %v", t.Name(), threshold.Seconds(), used)
		}
	})
}

func TestShortBudgetReports(t *testing.T) {
	if os.Getenv("VIBELANG_BUDGET_PROBE") == "1" {
		reportFuzzCPU(t, 0)
		// A child exercises RUSAGE_CHILDREN rather than merely the parent clock.
		child := exec.Command(os.Args[0], "-test.run=^TestBudgetCPUChild$")
		child.Env = append(os.Environ(), "VIBELANG_BUDGET_CHILD=1")
		if out, err := child.CombinedOutput(); err != nil {
			t.Fatalf("%v: %s", err, out)
		}
		return
	}
	cmd := exec.Command(os.Args[0], "-test.v", "-test.run=^TestShortBudgetReports$")
	cmd.Env = append(os.Environ(), "VIBELANG_BUDGET_PROBE=1", "VIBELANG_FUZZ_BUDGET_LOG=")
	out, err := cmd.CombinedOutput()
	if err != nil || !strings.Contains(string(out), "short seed CPU above 0s budget:") {
		t.Fatalf("CPU report did not pass: %v: %s", err, out)
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
