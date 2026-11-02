//go:build linux || darwin

package vibelangfuzz

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

func budgetLogProbe(mode, path string) *exec.Cmd {
	cmd := exec.Command(os.Args[0], "-test.run=^TestBudgetLogProbe$")
	for _, entry := range os.Environ() {
		if !strings.HasPrefix(entry, "VIBELANG_FUZZ_BUDGET_LOG=") &&
			!strings.HasPrefix(entry, "VIBELANG_BUDGET_LOG_PROBE=") &&
			!strings.HasPrefix(entry, "GOMAXPROCS=") {
			cmd.Env = append(cmd.Env, entry)
		}
	}
	cmd.Env = append(cmd.Env, "VIBELANG_BUDGET_LOG_PROBE="+mode, "GOMAXPROCS=2")
	if path != "" || mode == "empty" {
		cmd.Env = append(cmd.Env, "VIBELANG_FUZZ_BUDGET_LOG="+path)
	}
	return cmd
}

func TestBudgetLogProbe(t *testing.T) {
	mode := os.Getenv("VIBELANG_BUDGET_LOG_PROBE")
	if mode == "" {
		return
	}
	limit := time.Hour
	if mode == "fail" {
		limit = time.Nanosecond
	}
	for _, name := range []string{"first", "second"} {
		t.Run(name, func(t *testing.T) {
			enforceFuzzBudget(t, limit)
			var x uint64
			for i := range 100000 {
				x = x*1664525 + uint64(i)
			}
			runtime.KeepAlive(x)
		})
	}
}

func checkBudgetLog(t *testing.T, data []byte, limit time.Duration, copies int) {
	t.Helper()
	if len(data) == 0 || data[len(data)-1] != '\n' {
		t.Fatalf("budget records must end with a newline: %q", data)
	}
	lines := strings.Split(strings.TrimSuffix(string(data), "\n"), "\n")
	if len(lines) != 2*copies {
		t.Fatalf("got %d budget lines, want %d: %q", len(lines), 2*copies, data)
	}
	counts := map[string]int{}
	for _, line := range lines {
		fields := strings.Split(line, "\t")
		if len(fields) != 5 {
			t.Fatalf("budget line needs five tab-separated fields: %q", line)
		}
		if fields[0] != "TestBudgetLogProbe/first" && fields[0] != "TestBudgetLogProbe/second" {
			t.Fatalf("unexpected target: %q", fields[0])
		}
		counts[fields[0]]++
		if !regexp.MustCompile(`^[0-9]+\.[0-9]{3}$`).MatchString(fields[1]) {
			t.Errorf("CPU seconds must have three decimals: %q", fields[1])
		}
		seconds, err := strconv.ParseFloat(fields[2], 64)
		if err != nil || seconds != limit.Seconds() {
			t.Errorf("limit seconds = %q, want %v", fields[2], limit.Seconds())
		}
		if fields[3] != "2" || fields[4] != strconv.Itoa(runtime.NumCPU()) {
			t.Errorf("runtime fields = %q, want GOMAXPROCS=2 NumCPU=%d", fields[3:], runtime.NumCPU())
		}
	}
	for name, n := range counts {
		if n != copies {
			t.Errorf("%s: got %d records, want %d", name, n, copies)
		}
	}
}

func TestShortBudgetLog(t *testing.T) {
	for _, mode := range []string{"pass", "fail", "unset", "empty", "unwritable", "write-error"} {
		t.Run(mode, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "budget log.tsv")
			logPath := path
			if mode == "unset" || mode == "empty" {
				logPath = ""
			} else if mode == "unwritable" {
				logPath = dir // Opening a directory for append fails even as root.
			}
			if mode == "write-error" {
				if _, err := os.Stat("/dev/full"); err != nil {
					t.Skip("/dev/full is unavailable")
				}
				logPath = "/dev/full"
			}
			cmd := budgetLogProbe(mode, logPath)
			cmd.Dir = dir
			if mode == "unwritable" || mode == "write-error" {
				cmd.Args = append(cmd.Args, "-test.v")
			}
			out, err := cmd.CombinedOutput()
			if mode == "fail" {
				if err == nil || !strings.Contains(string(out), "short seed CPU budget exceeded") {
					t.Fatalf("probe must fail its budget: %v: %s", err, out)
				}
			} else if err != nil {
				t.Fatalf("probe: %v: %s", err, out)
			}
			if mode == "unset" || mode == "empty" || mode == "unwritable" || mode == "write-error" {
				if _, err := os.Stat(path); !os.IsNotExist(err) {
					t.Fatalf("unexpected log file: %v", err)
				}
				if mode == "unwritable" || mode == "write-error" {
					if !strings.Contains(string(out), "budget log") {
						t.Fatalf("I/O error must only be logged: %s", out)
					}
				} else if files, err := os.ReadDir(dir); err != nil || len(files) != 0 {
					t.Fatalf("disabled logging created files: %v: %v", files, err)
				}
				return
			}
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			limit := time.Hour
			if mode == "fail" {
				limit = time.Nanosecond
			}
			checkBudgetLog(t, data, limit, 1)
		})
	}
}

func TestShortBudgetLogConcurrentAppend(t *testing.T) {
	path := filepath.Join(t.TempDir(), "budget.tsv")
	const prefix = "existing baseline\n"
	if err := os.WriteFile(path, []byte(prefix), 0600); err != nil {
		t.Fatal(err)
	}
	const processes = 6
	results := make(chan error, processes)
	for range processes {
		go func() {
			out, err := budgetLogProbe("pass", path).CombinedOutput()
			if err != nil {
				err = fmt.Errorf("%w: %s", err, out)
			}
			results <- err
		}()
	}
	for range processes {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(data), prefix) {
		t.Fatalf("append truncated existing baseline: %q", data)
	}
	checkBudgetLog(t, data[len(prefix):], time.Hour, processes)
}
