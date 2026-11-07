package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestEditorAsyncAwaitOperandJumps(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		want       int
	}{
		{"return", "const v = await do { if (stop) return 7; input }; return v", 0},
		{"parenthesized-return", "const v = await (do { if (stop) return 7; input }); return v", 0},
		{"call-argument-return", "const v = await Promise.resolve(do { if (stop) return 7; input }); return v", 0},
		{"break", "for (const item of [0]) { const v = await do { if (stop) break; input }; return v }; return 1", 0},
		{"continue", "for (const item of [0]) { const v = await do { if (stop) continue; input }; return v }; return 1", 0},
		{"labeled-break", "outer: for (const item of [0]) { const v = await do { if (stop) break outer; input }; return v }; return 1", 0},
		{"labeled-continue", "outer: for (const item of [0]) { const v = await do { if (stop) continue outer; input }; return v }; return 1", 0},
		{"local-break-control", "const v = await do { local: { if (stop) break local; } input }; return v", 2},
		{"local-loop-control", "const v = await do { for (const item of [0]) { if (stop) continue; break }; input }; return v", 2},
		{"local-switch-control", "const v = await do { switch (stop) { case true: break; default: break }; input }; return v", 2},
		{"nested-function-control", "const v = await do { const nested = () => { return 7 }; input }; return v", 2},
		{"nested-method-control", "const v = await do { const nested = { method() { return 7 } }; input }; return v", 2},
		{"outside-operand-control", "if (stop) return 7; const v = await input; return v", 2},
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
						t.Errorf("invalid converted jump: %s\n%s", d.String(), got)
					}
				}
			}
			if count != tc.want {
				t.Errorf("offered %d conversions, want %d", count, tc.want)
			}
		})
	}
}
