package vibelangfuzz

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"testing"
	"time"
)

// External scripts can run multiple compilers and record an entire migration.
func newOracleContext(t *testing.T) (context.Context, context.CancelFunc) {
	limit := max(HangLimit, workerHangLimit)
	if slices.Contains(os.Args[1:], "-test.fuzzworker") || slices.Contains(os.Args[1:], "-test.fuzzworker=true") {
		limit = workerHangLimit
	}
	return context.WithTimeout(t.Context(), limit)
}

func checkOracleContext(t *testing.T, ctx context.Context) {
	t.Helper()
	if err := ctx.Err(); err != nil {
		Missing(t, "external oracle infrastructure: %v", err)
	}
}

// runJSONOracle owns the script's scratch tree, including when a timeout
// prevents the script from reaching its own cleanup.
func runJSONOracle(t *testing.T, cmd *exec.Cmd) ([]byte, error) {
	t.Helper()
	scratch, err := os.MkdirTemp("", "vibelang-oracle-")
	if err != nil {
		return nil, err
	}
	defer func() {
		if err := os.RemoveAll(scratch); err != nil {
			t.Errorf("remove oracle scratch: %v", err)
		}
	}()
	cmd.Env = append(cmd.Environ(), "VIBELANG_ORACLE_SCRATCH="+scratch)
	cliIsolate(cmd)
	if cmd.Cancel != nil {
		cmd.Cancel = func() error {
			if err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL); err != nil {
				if err == syscall.ESRCH {
					return os.ErrProcessDone
				}
				return err
			}
			return nil
		}
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	stdout, err := cmd.Output()
	if err != nil {
		return stdout, fmt.Errorf("%w\nstderr:\n%s", err, stderr.String())
	}
	if !json.Valid(stdout) {
		return stdout, fmt.Errorf("oracle stdout is not JSON\nstderr:\n%s", stderr.String())
	}
	if stderr.Len() != 0 {
		t.Logf("oracle stderr:\n%s", stderr.String())
	}
	return stdout, nil
}

func TestJSONOracleSeparatesStderr(t *testing.T) {
	cmd := exec.CommandContext(t.Context(), "sh", "-c", `printf '{"ok":true}'; printf 'a warning\n' >&2`)
	out, err := runJSONOracle(t, cmd)
	if err != nil || string(out) != `{"ok":true}` {
		t.Fatalf("oracle output %q: %v", out, err)
	}

	cmd = exec.CommandContext(t.Context(), "sh", "-c", `printf 'invalid'; printf 'script diagnostic\n' >&2`)
	if _, err := runJSONOracle(t, cmd); err == nil || !strings.Contains(err.Error(), "script diagnostic") {
		t.Fatalf("invalid receipt lost stderr: %v", err)
	}
}

func TestJSONOracleCleansScratchOnCancel(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "scratch")
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	cmd := exec.CommandContext(ctx, "sh", "-c", `
		touch "$VIBELANG_ORACLE_SCRATCH/file"
		printf '%s' "$VIBELANG_ORACLE_SCRATCH" > "$1.tmp"
		mv "$1.tmp" "$1"
		sleep 60
	`, "oracle", marker)
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		for {
			if _, err := os.Stat(marker); err == nil {
				cancel()
				return
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(10 * time.Millisecond):
			}
		}
	}()
	timer := time.AfterFunc(5*time.Second, cancel)
	defer timer.Stop()
	_, err := runJSONOracle(t, cmd)
	cancel()
	<-finished
	if err == nil {
		t.Fatal("canceled oracle succeeded")
	}
	path, err := os.ReadFile(marker)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(string(path)); !os.IsNotExist(err) {
		t.Fatalf("oracle scratch remains after cancellation: %v", err)
	}
}
