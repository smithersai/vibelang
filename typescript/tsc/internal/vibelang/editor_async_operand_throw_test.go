package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestEditorAsyncAwaitOperandThrows(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		want       int
	}{
		{"throw-number", "const v = await do { if (stop) throw 7; input }; return v", 0},
		{"throw-error", "const v = await do { if (stop) throw new Error('bad'); input }; return v", 0},
		{"parenthesized-throw", "const v = await (do { if (stop) throw 7; input }); return v", 0},
		{"call-argument-throw", "const v = await Promise.resolve(do { if (stop) throw 7; input }); return v", 0},
		{"throw-expression", "const v = await (stop ? throw 7 : input); return v", 0},
		{"conditional-do-throw", "const v = await (stop ? do { throw 7 } : input); return v", 0},
		{"outside-operand-control", "if (stop) throw 7; const v = await input; return v", 2},
		{"nested-async-arrow-control", "const v = await do { const nested = async () => { throw 7 }; input }; return v", 2},
		{"nested-async-method-control", "const v = await do { const nested = { async method() { throw 7 } }; input }; return v", 2},
		{"awaited-async-value-control", "await Promise.resolve(async function nested() { throw 7 }); return 1", 2},
		{"throwing-call-control", "const v = await do { JSON.parse('null'); input }; return v", 2},
		{"promise-control", "const v = await input; return v", 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "export async function load(input: Promise<number>, stop: boolean) { " + tc.body + " }"
			pos := strings.Index(source, "async")
			program, file, service, converters := editorProgram(t, source)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("invalid original: %s\n%s", d.String(), source)
				}
			}
			count := 0
			for _, action := range vibelangRefactors(t.Context(), &ls.RefactorContext{SourceFile: file, Span: core.NewTextRange(pos, pos), Program: program, LS: service}) {
				if !strings.HasPrefix(action.Description, "Convert to a VibeLang function") {
					continue
				}
				count++
				got := applyEditorEdits(t, file, converters, action.Changes)
				checked, edited, _, _ := editorProgram(t, got)
				for _, d := range append(checked.GetSyntacticDiagnostics(t.Context(), edited), checked.GetSemanticDiagnostics(t.Context(), edited)...) {
					if d.Category() == diagnostics.CategoryError {
						t.Errorf("invalid converted throw: %s\n%s", d.String(), got)
					}
				}
			}
			if count != tc.want {
				t.Errorf("offered %d conversions, want %d", count, tc.want)
			}
		})
	}
}
