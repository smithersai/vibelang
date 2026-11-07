package vibelang

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestFixAuditRetainsIntermediateRefusal(t *testing.T) {
	root := t.TempDir()
	t.Setenv("VIBELANG_FIX_AUDIT_DIR", root)
	name := tspath.RootedFilePath("/project/main.vibe")
	original := "export const value = legacy()\n"
	current := "// 😀\r\nexport const value = effect { return 42 }\r\n"
	sites := newFixSites(func(tspath.RootedFilePath) string { return original })
	start := strings.Index(current, "return 42")
	sites.add(name, current, start, start+len("return 42"), "EK2128", "keep")
	runs, err := os.ReadDir(root)
	if err != nil || len(runs) != 1 {
		t.Fatalf("audit runs: %v %v", runs, err)
	}
	run := filepath.Join(root, runs[0].Name())
	bytes, err := os.ReadFile(filepath.Join(run, "refusals.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	var receipt struct {
		Source string `json:"source"`
		Start  int    `json:"start"`
		End    int    `json:"end"`
		Line   int    `json:"line"`
		Column int    `json:"column"`
		Code   string `json:"code"`
		Phase  string `json:"phase"`
	}
	if err := json.Unmarshal(bytes, &receipt); err != nil {
		t.Fatal(err)
	}
	snapshot, err := os.ReadFile(filepath.Join(run, receipt.Source))
	if err != nil {
		t.Fatal(err)
	}
	if string(snapshot) != current || string(snapshot[receipt.Start:receipt.End]) != "return 42" ||
		receipt.Line != 2 || receipt.Column != 31 || receipt.Code != "EK2128" || receipt.Phase == "" {
		t.Fatalf("receipt does not identify intermediate refusal: %+v", receipt)
	}
	if strings.Contains(string(bytes), "return 42") {
		t.Fatal("metadata contains source")
	}
	info, err := os.Stat(filepath.Join(run, receipt.Source))
	if err != nil || runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
		t.Fatalf("snapshot mode: %v %v", info, err)
	}
	// A later source state must neither overwrite nor substitute for this snapshot.
	sites.add(name, "unrelated text", 0, 3, "EK0501", "other")
	unchanged, err := os.ReadFile(filepath.Join(run, receipt.Source))
	if err != nil || string(unchanged) != current {
		t.Fatalf("snapshot changed: %v", err)
	}
}

func TestFixAuditIsOptInAndSeparatesRuns(t *testing.T) {
	t.Setenv("VIBELANG_FIX_AUDIT_DIR", "")
	sites := newFixSites(func(tspath.RootedFilePath) string { return "source" })
	if sites.audit != nil {
		t.Fatal("audit enabled without request")
	}
	root := t.TempDir()
	t.Setenv("VIBELANG_FIX_AUDIT_DIR", root)
	for i := 0; i < 2; i++ {
		sites := newFixSites(func(tspath.RootedFilePath) string { return "source" })
		sites.auditPhase("round", 3)
		sites.add(tspath.RootedFilePath("/project/main.vibe"), "source", 1, 3, "EK2128", "keep")
		if sites.audit.err != nil {
			t.Fatal(sites.audit.err)
		}
		record, err := os.ReadFile(filepath.Join(sites.audit.run, "refusals.jsonl"))
		if err != nil || !strings.Contains(string(record), `"phase":"round","round":3`) {
			t.Fatalf("round missing: %s %v", record, err)
		}
	}
	runs, err := os.ReadDir(root)
	if err != nil || len(runs) != 2 {
		t.Fatalf("runs collided: %v %v", runs, err)
	}
}

func TestFixAuditReportsStorageFailure(t *testing.T) {
	path := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(path, nil, 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIBELANG_FIX_AUDIT_DIR", path)
	sites := newFixSites(func(tspath.RootedFilePath) string { return "source" })
	sites.add(tspath.RootedFilePath("/project/main.vibe"), "source", 0, 3, "EK2128", "keep")
	if sites.audit.err == nil {
		t.Fatal("storage failure was hidden")
	}
}

func TestFixAuditFailureReachesFixResult(t *testing.T) {
	path := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(path, nil, 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIBELANG_FIX_AUDIT_DIR", path)
	source := "export effect function* g(n: number) {\n  " + refusedProducerTry + "\n}\n"
	_, file, _, _ := editorProgramWith(t, source, map[string]string{})
	result := fixCase(t, filepath.Dir(file.FileName().AsString()))
	if result.Err == nil || !strings.Contains(result.Err.Error(), "cannot write refusal audit") {
		t.Fatalf("missing audit failure: %v", result.Err)
	}
}
