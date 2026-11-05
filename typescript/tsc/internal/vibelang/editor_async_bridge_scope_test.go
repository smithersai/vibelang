package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestEditorAsyncBridgeScope(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		want       bool
	}{
		{"block", "{ const Effect = { tryPromise: 1 }; return await input }", false},
		{"block-later", "{ const value = await input; const Effect = { tryPromise: 1 }; return value }", false},
		{"loop", "for (const Effect of [1]) { return await input }; return 0", false},
		{"switch", "switch (1) { case 1: const Effect = 1; return await input }; return 0", false},
		{"destructuring", "{ const { Effect } = { Effect: 1 }; return await input }", false},
		{"class-binding", "{ class Effect {}; return await input }", false},
		{"function-binding", "{ function Effect() {}; return await input }", false},
		{"nested-block", "{ const Effect = 1; { return await input } }", false},
		{"sibling-control", "{ const Effect = 1 }; return await input", true},
		{"nested-function-control", "function nested(Effect: number) { return Effect }; return await input", true},
		{"type-control", "{ type Effect = number; return await input }", true},
		{"plain-control", "{ return await input }", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "type Existing = Effect.Effect<never>; export async function load(input: Promise<number>) { " + tc.body + " }"
			pos := strings.Index(source, "async")
			program, file, service, converters := editorProgram(t, source)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("invalid original: %s", d.String())
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
						t.Errorf("invalid conversion: %s\n%s", d.String(), got)
					}
				}
			}
			want := 0
			if tc.want {
				want = 2
			}
			if count != want {
				t.Errorf("offered %d conversions, want %d", count, want)
			}
		})
	}
}
