package vibelangmapper

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

func readScopeRecords(t *testing.T, output []byte) []scopeStageRecord {
	t.Helper()
	var records []scopeStageRecord
	for _, line := range bytes.Split(bytes.TrimSpace(output), []byte("\n")) {
		if !bytes.HasPrefix(line, []byte("[mapper-scope] ")) {
			t.Fatalf("unexpected diagnostic: %q", line)
		}
		var record scopeStageRecord
		if err := json.Unmarshal(bytes.TrimPrefix(line, []byte("[mapper-scope] ")), &record); err != nil {
			t.Fatal(err)
		}
		records = append(records, record)
	}
	return records
}

// This regression uses the existing handover entrypoint, so the unmodified
// scope helper runs successfully but fails the diagnostic assertion.
func TestScopeHandoverReportsStage(t *testing.T) {
	dir := t.TempDir()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIBELANG_MAPPER_TEST_TSC", executable)
	if err := os.Mkdir(filepath.Join(dir, "bin"), 0700); err != nil {
		t.Fatal(err)
	}
	original := os.Stderr
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stderr = writer
	err = provideScopeTool(dir, dir, "tsc")
	os.Stderr = original
	writer.Close()
	output, readErr := io.ReadAll(reader)
	reader.Close()
	if err != nil || readErr != nil {
		t.Fatalf("handover: %v; read: %v", err, readErr)
	}
	if len(output) == 0 {
		t.Fatal("successful tool handover emitted no stage diagnostics")
	}
	records := readScopeRecords(t, output)
	if len(records) != 2 || records[0].State != "start" || records[1].State != "pass" {
		t.Fatalf("handover records: %+v", records)
	}
	for _, r := range records {
		if r.Stage != "handover-tsc" || r.ID != records[0].ID {
			t.Fatalf("handover correlation: %+v", records)
		}
	}
	if bytes.Contains(output, []byte(dir)) || bytes.Contains(output, []byte(executable)) {
		t.Fatal("handover leaked a path")
	}
}

func TestScopeStageChild(t *testing.T) {
	mode := os.Getenv("VIBELANG_SCOPE_PROGRESS_CHILD")
	if mode == "" {
		return
	}
	fmt.Fprint(os.Stdout, "private-source-marker")
	fmt.Fprint(os.Stderr, "private-environment-marker")
	if mode == "wait" {
		time.Sleep(time.Minute)
	}
	if mode == "fail" {
		os.Exit(7)
	}
	os.Exit(0)
}

func TestScopeStageRetainsRealCommandResults(t *testing.T) {
	for _, mode := range []string{"pass", "fail", "missing"} {
		t.Run(mode, func(t *testing.T) {
			executable, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			cmd := exec.Command(executable, "-test.run=^TestScopeStageChild$")
			cmd.Env = append(os.Environ(), "VIBELANG_SCOPE_PROGRESS_CHILD="+mode)
			if mode == "missing" {
				cmd.Path = filepath.Join(t.TempDir(), "missing-program")
			}
			var diagnostics bytes.Buffer
			out, err := observeScopeStage("runtime-compile", &diagnostics, time.Hour, cmd.CombinedOutput)
			if mode == "pass" && err != nil || mode != "pass" && err == nil {
				t.Fatalf("unexpected result: %v", err)
			}
			if mode != "missing" {
				for _, marker := range []string{"private-source-marker", "private-environment-marker"} {
					if !bytes.Contains(out, []byte(marker)) {
						t.Fatalf("lost captured output: %q", out)
					}
				}
			}
			if bytes.Contains(diagnostics.Bytes(), []byte("private-")) || bytes.Contains(diagnostics.Bytes(), []byte(executable)) {
				t.Fatal("diagnostic disclosed command input/output")
			}
			records := readScopeRecords(t, diagnostics.Bytes())
			if len(records) != 2 || records[0].State != "start" || records[1].ID != records[0].ID {
				t.Fatalf("bad lifecycle: %+v", records)
			}
			final := records[1]
			code, state := 0, "pass"
			if mode == "fail" {
				code, state = 7, "fail"
			}
			if mode == "missing" {
				code, state = -1, "fail"
			}
			if final.State != state || final.ExitCode == nil || *final.ExitCode != code || final.OutputBytes == nil || *final.OutputBytes != len(out) {
				t.Fatalf("bad result record: %+v", final)
			}
		})
	}
}

type scopeProgressWriter struct {
	bytes.Buffer
	progress chan struct{}
	once     sync.Once
}

func (w *scopeProgressWriter) Write(b []byte) (int, error) {
	n, err := w.Buffer.Write(b)
	if bytes.Contains(b, []byte(`"state":"progress"`)) {
		w.once.Do(func() { close(w.progress) })
	}
	return n, err
}

func TestScopeStageProgressAndFailureIdentity(t *testing.T) {
	diagnostics := &scopeProgressWriter{progress: make(chan struct{})}
	failure := errors.New("private-path-marker")
	var timedOut bool
	out, err := observeScopeStage("build-tsc", diagnostics, time.Millisecond, func() ([]byte, error) {
		select {
		case <-diagnostics.progress:
		case <-time.After(10 * time.Second):
			timedOut = true
		}
		return []byte("complete failure output"), failure
	})
	if timedOut {
		t.Fatal("silent operation emitted no progress")
	}
	if err != failure || string(out) != "complete failure output" {
		t.Fatal("operation result changed")
	}
	records := readScopeRecords(t, diagnostics.Bytes())
	if len(records) < 3 || records[0].State != "start" || records[len(records)-1].State != "fail" {
		t.Fatalf("bad lifecycle: %+v", records)
	}
	for i, r := range records {
		if r.ID != records[0].ID || r.Stage != "build-tsc" || r.ElapsedMS < 0 || i > 0 && r.ElapsedMS < records[i-1].ElapsedMS {
			t.Fatalf("bad correlation/time: %+v", records)
		}
		if i > 0 && i < len(records)-1 && (r.State != "progress" || r.ExitCode != nil || r.OutputBytes != nil) {
			t.Fatalf("invalid progress: %+v", r)
		}
	}
	if strings.Contains(diagnostics.String(), failure.Error()) {
		t.Fatal("error text leaked")
	}
}

// A real tiny Go command exercises the fallback entrypoint and its error
// wrapping; the compiler's own source tree is not needed for this control.
func TestScopeFallbackBuildReportsStages(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("Go is required for the native build control")
	}
	for _, broken := range []bool{false, true} {
		t.Run(fmt.Sprint(broken), func(t *testing.T) {
			root := t.TempDir()
			scope := filepath.Join(root, "scope")
			module := filepath.Join(root, "typescript", "tsc")
			for _, dir := range []string{filepath.Join(scope, "bin"), filepath.Join(module, "cmd", "tsc")} {
				if err := os.MkdirAll(dir, 0700); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.WriteFile(filepath.Join(module, "go.mod"), []byte("module scopefixture\n\ngo 1.26\n"), 0600); err != nil {
				t.Fatal(err)
			}
			source := "package main\nfunc main() {}\n"
			if broken {
				source = "package main\nfunc main() { undefinedScopeFixture() }\n"
			}
			if err := os.WriteFile(filepath.Join(module, "cmd", "tsc", "main.go"), []byte(source), 0600); err != nil {
				t.Fatal(err)
			}
			t.Setenv("VIBELANG_MAPPER_TEST_TSC", "")
			t.Setenv("GOWORK", "off")
			original := os.Stderr
			reader, writer, err := os.Pipe()
			if err != nil {
				t.Fatal(err)
			}
			os.Stderr = writer
			buildErr := provideScopeTool(root, scope, "tsc")
			os.Stderr = original
			writer.Close()
			output, readErr := io.ReadAll(reader)
			reader.Close()
			if readErr != nil {
				t.Fatal(readErr)
			}
			if broken {
				if buildErr == nil || !strings.Contains(buildErr.Error(), "undefinedScopeFixture") {
					t.Fatalf("lost compiler failure: %v", buildErr)
				}
			} else {
				if buildErr != nil {
					t.Fatal(buildErr)
				}
				if out, err := exec.Command(filepath.Join(scope, "bin", "tsc")).CombinedOutput(); err != nil {
					t.Fatalf("built executable: %v\n%s", err, out)
				}
			}
			records := readScopeRecords(t, output)
			state := "pass"
			if broken {
				state = "fail"
			}
			final := records[len(records)-1]
			if records[0].State != "start" || final.State != state || final.Stage != "build-tsc" {
				t.Fatalf("fallback records: %+v", records)
			}
			if bytes.Contains(output, []byte(root)) || bytes.Contains(output, []byte("undefinedScopeFixture")) {
				t.Fatal("build diagnostics disclosed command output or paths")
			}
		})
	}
}

func TestScopeStageSignal(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows reports process termination as an exit code")
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(executable, "-test.run=^TestScopeStageChild$")
	cmd.Env = append(os.Environ(), "VIBELANG_SCOPE_PROGRESS_CHILD=wait")
	var diagnostics bytes.Buffer
	_, err = observeScopeStage("runtime-compile", &diagnostics, time.Hour, func() ([]byte, error) {
		if err := cmd.Start(); err != nil {
			return nil, err
		}
		if err := cmd.Process.Kill(); err != nil {
			return nil, err
		}
		return nil, cmd.Wait()
	})
	if err == nil {
		t.Fatal("killed process passed")
	}
	records := readScopeRecords(t, diagnostics.Bytes())
	final := records[len(records)-1]
	if final.State != "fail" || final.Cause != "signal" || final.ExitCode == nil || *final.ExitCode != -1 {
		t.Fatalf("signal record: %+v", final)
	}
}

func TestScopeStageLargeOutputRemainsPrivate(t *testing.T) {
	for _, size := range []int{0, 1024, 1024 * 1024} {
		t.Run(fmt.Sprint(size), func(t *testing.T) {
			source := bytes.Repeat([]byte("s"), size)
			var diagnostics bytes.Buffer
			out, err := observeScopeStage("runtime-compile", &diagnostics, time.Hour, func() ([]byte, error) { return source, nil })
			if err != nil || !bytes.Equal(out, source) {
				t.Fatal("output changed")
			}
			records := readScopeRecords(t, diagnostics.Bytes())
			if len(records) != 2 || *records[1].OutputBytes != size || diagnostics.Len() > 512 {
				t.Fatalf("unbounded diagnostic: %d bytes", diagnostics.Len())
			}
		})
	}
}

func TestScopeStagesKeepConcurrentRecordsSeparate(t *testing.T) {
	diagnostics, err := os.CreateTemp(t.TempDir(), "records")
	if err != nil {
		t.Fatal(err)
	}
	defer diagnostics.Close()
	const count = 16
	var stages sync.WaitGroup
	for range count {
		stages.Go(func() {
			_, _ = observeScopeStage("runtime-compile", diagnostics, time.Hour, func() ([]byte, error) { return nil, nil })
		})
	}
	stages.Wait()
	output, err := os.ReadFile(diagnostics.Name())
	if err != nil {
		t.Fatal(err)
	}
	records := readScopeRecords(t, output)
	if len(records) != 2*count {
		t.Fatalf("record count: %d", len(records))
	}
	seen := make(map[uint64]string)
	for _, r := range records {
		if r.RunID != os.Getpid() {
			t.Fatal("lost process correlation")
		}
		if r.State == "start" {
			if seen[r.ID] != "" {
				t.Fatalf("duplicate ID %d", r.ID)
			}
			seen[r.ID] = "start"
		} else {
			if r.State != "pass" || seen[r.ID] != "start" {
				t.Fatalf("invalid stage completion: %+v", r)
			}
			seen[r.ID] = "pass"
		}
	}
	if len(seen) != count {
		t.Fatal("stages shared an ID")
	}
}
