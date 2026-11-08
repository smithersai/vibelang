package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"maps"
	"os"
	"strings"
	"testing"
)

const relicMigrationFixQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"

func TestRelicStatementFixQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil || !strings.Contains(string(text), relicMigrationFixQuote) {
		t.Fatalf("missing preserving-fix authority: %v", err)
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
