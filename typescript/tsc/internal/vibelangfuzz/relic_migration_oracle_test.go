package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const relicMigrationFixQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"

func TestRelicStatementFixQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil || !strings.Contains(string(text), relicMigrationFixQuote) {
		t.Fatalf("missing preserving-fix authority: %v", err)
	}
}

// 007 requires the same public declarations, Exit and source effects.
// Reuse the existing tools worker and its Cause/Exit comparison.
func checkRelicMigration(t *testing.T, w *Workspace, node **Node, target, key, source, want string) {
	t.Helper()
	checkRelicMigrationFiles(t, w, node, target, key, map[string]string{"main.vibe": source}, want)
}
func checkRelicMigrationFiles(t *testing.T, w *Workspace, node **Node, target, key string, files map[string]string, want string) {
	t.Helper()
	source := files["main.vibe"]
	before := toolsCompile(t, w, target, files)
	defer before.Remove()
	if !toolsErrorFree(before) {
		t.Fatalf("invalid legacy source: %v\n%s", before.Diagnostics, source)
	}
	fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
	if strings.HasPrefix(want, "refused:") {
		reason := strings.TrimPrefix(want, "refused:")
		if fixed.Err != nil || len(fixed.Files) != 0 || len(fixed.Refused) != 1 || !strings.Contains(fixed.Refused[0].Error, reason) {
			Gap(t, target, key, "007: unsafe declaration migration was not refused: %+v", fixed)
		}
		return
	}
	if fixed.Err != nil || len(fixed.Refused) > 0 {
		t.Fatalf("fix failed: %v %+v", fixed.Err, fixed.Refused)
	}
	for name, file := range fixed.Files {
		if strings.HasSuffix(name.AsString(), "/main.vibe") {
			files["main.vibe"] = file.Text
		}
	}
	matches := strings.Contains(files["main.vibe"], want)
	if strings.HasPrefix(want, "absent:") {
		matches = !strings.Contains(files["main.vibe"], strings.TrimPrefix(want, "absent:"))
	}
	if !matches {
		Gap(t, target, key, "preserving migration missing: %s", files["main.vibe"])
		return
	}
	after := toolsCompile(t, w, target, files)
	defer after.Remove()
	if !toolsErrorFree(after) {
		t.Fatalf("fixed source rejected: %v\n%s", after.Diagnostics, files["main.vibe"])
	}
	for name, text := range before.Outputs {
		if strings.HasSuffix(name, ".d.ts") && after.Outputs[name] != text {
			Gap(t, target, key, "007: declaration bytes changed: before %s after %s", text, after.Outputs[name])
			return
		}
	}
	if *node == nil {
		var err error
		*node, err = NewNode(w.Dir)
		if err != nil {
			t.Fatal(err)
		}
	}
	found := false
	for name := range before.Outputs {
		if filepath.Base(name) != "main.js" {
			continue
		}
		found = true
		was, now := (*node).Run(before, name, "main"), (*node).Run(after, name, "main")
		if toolsInvalidOutcome(was) || toolsInvalidOutcome(now) {
			t.Fatalf("invalid outcomes: %+v %+v", was, now)
		}
		if !toolsSameOutcome(was, now) {
			Gap(t, target, key, "007: Exit/order changed: before %+v after %+v", was, now)
			return
		}
	}
	if !found {
		t.Fatal("no runnable main")
	}
	again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{})
	if again.Err != nil || len(again.Files) > 0 {
		t.Fatalf("migration not idempotent: %+v", again)
	}
}
