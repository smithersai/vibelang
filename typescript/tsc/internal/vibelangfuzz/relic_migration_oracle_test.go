package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"maps"
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
	if target == "FuzzRelicTryStatementFix" {
		if !relicTryMigrationDiagnostics(before, key) {
			t.Fatalf("unexpected retired-try diagnostics: %v\n%s", before.Diagnostics, source)
		}
	} else if !toolsErrorFree(before) {
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

// The original is deliberately rejected by VIP-5 and the retired typed-catch
// rule. Require exactly those migration diagnostics before comparing its legacy
// emit; unrelated errors and missing emissions are never valid inputs.
func relicTryMigrationDiagnostics(r *Result, key string) bool {
	if r.EmitSkipped {
		return false
	}
	want := map[int32]int{503: 1}
	switch key {
	case "typed", "partial-return", "structural", "held-result", "combined":
		want[2112] = 1
	case "chained":
		want[2112] = 2
	}
	got := map[int32]int{}
	for _, d := range r.Diagnostics {
		if IsEK(d) && d.Code() == 2112 {
			if d.Category() != diagnostics.CategoryWarning {
				return false
			}
			got[2112]++
			continue
		}
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		if !IsEK(d) {
			return false
		}
		got[d.Code()]++
	}
	return maps.Equal(got, want)
}

func TestRelicTryMigrationDiagnosticControls(t *testing.T) {
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/project/main.vibe", PathKey: "/project/main.vibe"}, "effect function f() {}", core.ScriptKindTS)
	for _, row := range []struct {
		name, key     string
		codes         []int32
		source        string
		category      diagnostics.Category
		skipped, want bool
	}{
		{"typed", "typed", []int32{503, 2112}, "EK", diagnostics.CategoryError, false, true},
		{"chained", "chained", []int32{503, 2112, 2112}, "EK", diagnostics.CategoryError, false, true},
		{"finally", "normal", []int32{503}, "EK", diagnostics.CategoryError, false, true},
		{"missing", "typed", []int32{503}, "EK", diagnostics.CategoryError, false, false},
		{"duplicate", "normal", []int32{503, 503}, "EK", diagnostics.CategoryError, false, false},
		{"unrelated", "typed", []int32{503, 2112, 402}, "EK", diagnostics.CategoryError, false, false},
		{"native", "normal", []int32{503}, "", diagnostics.CategoryError, false, false},
		{"wrong-category", "normal", []int32{503}, "EK", diagnostics.CategoryWarning, false, false},
		{"no-emission", "normal", []int32{503}, "EK", diagnostics.CategoryError, true, false},
		{"typed-catch-error", "typed", []int32{503, 2112}, "EK", diagnostics.CategoryError, false, false},
	} {
		t.Run(row.name, func(t *testing.T) {
			r := &Result{EmitSkipped: row.skipped}
			for _, code := range row.codes {
				category := row.category
				if code == 2112 && row.name != "typed-catch-error" {
					category = diagnostics.CategoryWarning
				}
				r.Diagnostics = append(r.Diagnostics, ast.NewExternalDiagnostic(file, core.NewTextRange(0, 1), row.source, category, code, "control"))
			}
			if got := relicTryMigrationDiagnostics(r, row.key); got != row.want {
				t.Fatalf("accepted=%v want=%v", got, row.want)
			}
		})
	}
}
