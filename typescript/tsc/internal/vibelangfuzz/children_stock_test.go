package vibelangfuzz

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestStockConsumerChildren(t *testing.T) {
	if mode := os.Getenv("FUZZ_STOCK_CHILD_TEST"); mode != "" {
		dir := os.Getenv("FUZZ_STOCK_CHILD_DIR")
		tsc := filepath.Join(dir, "tsc")
		stockTypeScript = func() (string, error) { return tsc, nil }
		oc := &OutputChecker{Ctx: t.Context(), G: &Gaps{}}
		if mode == "deadline" {
			HangLimit = 500 * time.Millisecond
			Within("outputs", func() { oc.checkStockConsumer(dir, nil) })
			if len(oc.G.found) != 1 || oc.G.found[0].key != "feature:declaration-consumer" {
				t.Fatalf("expected a bounded stock consumer gap, got %+v", oc.G.found)
			}
			children.Lock()
			remaining := len(children.commands)
			children.Unlock()
			if remaining != 0 {
				t.Fatalf("%d stock children remain registered", remaining)
			}
			return
		}
		HangLimit = 10 * time.Second
		done := make(chan struct{})
		go func() { oc.checkStockConsumer(dir, nil); close(done) }()
		awaitStockPID(t, dir)
		killChildren()
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Fatal("stock compiler survived watchdog cleanup")
		}
		return
	}
	for _, mode := range []string{"deadline", "watchdog"} {
		t.Run(mode, func(t *testing.T) {
			dir := t.TempDir()
			script := "#!/bin/sh\necho $$ > stock.pid\nexec sleep 60\n"
			if err := os.WriteFile(filepath.Join(dir, "tsc"), []byte(script), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"files":[]}`), 0600); err != nil {
				t.Fatal(err)
			}
			// Also clean up the deliberately unregistered child on the broken implementation.
			defer func() {
				data, _ := os.ReadFile(filepath.Join(dir, "stock.pid"))
				pid, _ := strconv.Atoi(strings.TrimSpace(string(data)))
				if pid > 0 {
					_ = syscall.Kill(-pid, syscall.SIGKILL)
					_ = syscall.Kill(pid, syscall.SIGKILL)
				}
			}()
			ctx, cancel := context.WithTimeout(t.Context(), 6*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestStockConsumerChildren$", "-test.v")
			cmd.Env = append(os.Environ(), "FUZZ_STOCK_CHILD_TEST="+mode, "FUZZ_STOCK_CHILD_DIR="+dir)
			output, err := cmd.CombinedOutput()
			if err != nil {
				t.Fatalf("%s: %v\n%s", mode, err, output)
			}
		})
	}
}

func awaitStockPID(t *testing.T, dir string) int {
	t.Helper()
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		data, _ := os.ReadFile(filepath.Join(dir, "stock.pid"))
		if pid, err := strconv.Atoi(strings.TrimSpace(string(data))); err == nil && pid > 0 {
			return pid
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal(fmt.Sprintf("stock helper did not record its child pid in %s", filepath.Base(dir)))
	return 0
}

func TestStockLSPCancellation(t *testing.T) {
	dir := t.TempDir()
	script := "#!/bin/sh\necho $$ > stock.pid\nexec sleep 60\n"
	tsc := filepath.Join(dir, "tsc")
	if err := os.WriteFile(tsc, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := stockLSPSpans(ctx, tsc, dir, nil); done <- err }()
	pid := awaitStockPID(t, dir)
	defer syscall.Kill(pid, syscall.SIGKILL)
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Error("cancelled LSP worker returned successful diagnostics")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("cancelled LSP worker did not finish")
	}
	// An orphan killed with its parent can briefly remain as a zombie until
	// the process supervisor reaps it. It must no longer be running.
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		state, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
		if os.IsNotExist(err) || strings.HasPrefix(string(state)[strings.LastIndex(string(state), ")")+1:], " Z") {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("LSP server survived cancellation of its worker")
}

func TestOutputStageBudget(t *testing.T) {
	for _, args := range [][]string{nil, {"-test.fuzzworker"}, {"-test.fuzzworker=true"}} {
		for _, limit := range []time.Duration{time.Second, 10 * time.Second, 120 * time.Second} {
			output := stageHangLimit("outputs", limit, args)
			child := min(2*limit, output*2/3)
			if child >= output {
				t.Fatalf("child %v cannot finish before output stage %v", child, output)
			}
			if args != nil && output >= 60*time.Second {
				t.Fatal("output watchdog exceeds fuzz worker deadline")
			}
			if got := stageHangLimit("compile", limit, args); got > limit {
				t.Fatal("compiler watchdog was extended")
			}
		}
	}
}
