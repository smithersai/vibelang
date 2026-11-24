package vibelangmapper

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
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

func TestScopeStageChild(t *testing.T) {
	mode := os.Getenv("VIBELANG_SCOPE_PROGRESS_CHILD")
	if mode == "" {
		return
	}
	fmt.Fprint(os.Stdout, "private-source-marker")
	fmt.Fprint(os.Stderr, "private-environment-marker")
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
