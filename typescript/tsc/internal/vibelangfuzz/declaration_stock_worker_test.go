package vibelangfuzz

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

type stockDeclarationResult struct {
	ID          uint64
	Rejected    bool
	Output      string
	Error       string
	EmitSkipped bool
}

// Keep native TypeScript's own API beside the exact executable under test.
// Other pinned compilers and fake failure controls retain their CLI adapter.
func stockDeclarationAPIModule(executable string) string {
	for dir := filepath.Dir(executable); dir != filepath.Dir(dir); dir = filepath.Dir(dir) {
		if filepath.Base(dir) != "node_modules" {
			continue
		}
		module := filepath.Join(dir, "typescript/dist/api/async/api.js")
		if _, err := os.Stat(module); err == nil {
			return module
		}
		break
	}
	return ""
}

type stockDeclarationWorker struct {
	mu                 sync.Mutex
	tsc, module, label string
	cmd                *exec.Cmd
	input              io.WriteCloser
	scanner            *bufio.Scanner
	stderr             *identityStderr
	serial             uint64
	starts, requests   int
	cpu                time.Duration
}

func newStockDeclarationWorker(tsc, label string) *stockDeclarationWorker {
	return &stockDeclarationWorker{tsc: tsc, module: stockDeclarationAPIModule(tsc), label: label}
}
func (w *stockDeclarationWorker) start() error {
	cmd := exec.Command("node", filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/declaration_stock_worker.mjs"), w.module, w.tsc)
	for _, entry := range os.Environ() {
		if !strings.HasPrefix(entry, "GOMAXPROCS=") && !strings.HasPrefix(entry, "GOGC=") && !strings.HasPrefix(entry, "GOMEMLIMIT=") {
			cmd.Env = append(cmd.Env, entry)
		}
	}
	// This is one stock compilation at a time, as the cold --singleThreaded
	// baseline is. A persistent process collects its discarded program state.
	cmd.Env = append(cmd.Env, "GOMAXPROCS=1", "GOGC=300", "GOMEMLIMIT=1GiB")
	input, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		input.Close()
		return err
	}
	stderr := &identityStderr{}
	cmd.Stderr = stderr
	if err = startChild(cmd); err != nil {
		input.Close()
		output.Close()
		return err
	}
	w.cmd, w.input, w.stderr = cmd, input, stderr
	w.scanner = bufio.NewScanner(output)
	w.scanner.Buffer(make([]byte, 65536), 16<<20)
	w.starts++
	return nil
}
func (w *stockDeclarationWorker) stop(kill bool) error {
	if w.cmd == nil {
		return nil
	}
	cmd := w.cmd
	_ = w.input.Close()
	if kill {
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
	done := make(chan error, 1)
	go func() { done <- waitChild(cmd) }()
	var err error
	select {
	case err = <-done:
	case <-time.After(HangLimit):
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		<-done
		err = fmt.Errorf("stock declaration worker did not shut down")
	}
	if state := cmd.ProcessState; state != nil {
		w.cpu += state.UserTime() + state.SystemTime()
	}
	w.cmd, w.input, w.scanner = nil, nil, nil
	return err
}
func (w *stockDeclarationWorker) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	err := w.stop(false)
	declarationCostRecord(w.label, "stock-worker-close", map[string]any{"cpu_seconds": w.cpu.Seconds(), "requests": w.requests, "starts": w.starts})
	fmt.Fprintf(os.Stderr, "stock declaration scope=%s requests=%d starts=%d cpu=%s\n", w.label, w.requests, w.starts, w.cpu)
	return err
}
func (w *stockDeclarationWorker) Compile(ctx context.Context, dir string) (stockDeclarationResult, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return stockDeclarationResult{}, err
	}
	if w.cmd == nil {
		if err := w.start(); err != nil {
			return stockDeclarationResult{}, err
		}
	}
	w.serial++
	w.requests++
	if err := json.NewEncoder(w.input).Encode(struct {
		ID        uint64 `json:"id"`
		Directory string `json:"directory"`
	}{w.serial, dir}); err != nil {
		_ = w.stop(true)
		return stockDeclarationResult{}, fmt.Errorf("stock declaration worker write: %w", err)
	}
	type received struct {
		reply stockDeclarationResult
		err   error
	}
	done := make(chan received, 1)
	scanner := w.scanner
	go func() {
		var r received
		if !scanner.Scan() {
			r.err = scanner.Err()
			if r.err == nil {
				r.err = io.ErrUnexpectedEOF
			}
		} else {
			r.err = json.Unmarshal(scanner.Bytes(), &r.reply)
		}
		done <- r
	}()
	select {
	case <-ctx.Done():
		_ = w.stop(true)
		return stockDeclarationResult{}, ctx.Err()
	case r := <-done:
		if r.err != nil || r.reply.ID != w.serial {
			stderr := w.stderr.String()
			_ = w.stop(true)
			return stockDeclarationResult{}, fmt.Errorf("stock declaration worker protocol: %v (reply %d request %d): %.1200s", r.err, r.reply.ID, w.serial, stderr)
		}
		if r.reply.Error != "" {
			return r.reply, fmt.Errorf("stock declaration worker: %s", r.reply.Error)
		}
		return r.reply, nil
	}
}

func runStockDeclaration(ctx context.Context, t *testing.T, tsc, dir string) (stockDeclarationResult, error) {
	name, _, _ := strings.Cut(t.Name(), "/")
	declarationIdentityScopes.Lock()
	scope := declarationIdentityScopes.fuzz[name]
	declarationIdentityScopes.Unlock()
	if name == "FuzzDeclarationIdentity" && scope != nil && stockDeclarationAPIModule(tsc) != "" {
		scope.Lock()
		if scope.stock == nil {
			scope.stock = newStockDeclarationWorker(tsc, name)
		}
		worker := scope.stock
		scope.Unlock()
		if worker.tsc != tsc {
			return stockDeclarationResult{}, fmt.Errorf("stock declaration executable changed within a scope")
		}
		return worker.Compile(ctx, dir)
	}
	return runStockDeclarationCLI(ctx, t, tsc, dir)
}
func runStockDeclarationCLI(ctx context.Context, t *testing.T, tsc, dir string) (stockDeclarationResult, error) {
	cmd := stockCompile(ctx, tsc, "-p", ".", "--pretty", "false")
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if state := cmd.ProcessState; state != nil {
		declarationCostRecord(t.Name(), "stock-process", map[string]any{"cpu_seconds": (state.UserTime() + state.SystemTime()).Seconds()})
	}
	result := stockDeclarationResult{Output: string(out), Rejected: err != nil}
	if exit, ok := err.(*exec.ExitError); err != nil && (!ok || exit.ExitCode() != 1 && exit.ExitCode() != 2) {
		return result, err
	}
	return result, nil
}
