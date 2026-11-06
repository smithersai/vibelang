package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestUsingScopedFixBindingBoundary(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		offer        bool
	}{
		{"hoisted-function", "const later = 2;\nexport effect function load() { const read = later; using r = open(); function later() { return 1 }; return read() }", false},
		{"closure-const", "const later = 2;\nexport effect function load() { const read = () => later; using r = open(); const later = 1; return read() }", false},
		{"closure-let", "const later = 2;\nexport effect function load() { const read = () => later; using r = open(); let later = 1; return read() }", false},
		{"closure-destructuring", "const later = 2;\nexport effect function load() { const read = () => later; using r = open(); const { later } = { later: 1 }; return read() }", false},
		{"closure-shorthand", "const later = 2;\nexport effect function load() { const read = () => ({ later }); using r = open(); const later = 1; return read().later }", false},
		{"closure-class", "const later = 2;\nexport effect function load() { const read = () => new Later().value; using r = open(); class Later { value = 1 }; return read() }", false},
		{"closure-enum", "const later = 2;\nexport effect function load() { const read = (): number => Later.Value; using r = open(); enum Later { Value = 1 }; return read() }", false},
		{"closure-resource", "const later = 2;\nexport effect function load() { const read = () => r; using r = open(); return read() }", false},
		{"prefix-function", "const later = 2;\nexport effect function load() { function read() { return later }; using r = open(); const later = 1; return read() }", false},
		{"type-alias", "const later = 2;\nexport effect function load() { type Before = Later; using r = open(); type Later = number; const result: Before = 1; return result }", false},
		{"interface", "const later = 2;\nexport effect function load() { interface Before extends Later {}; using r = open(); interface Later { value: number }; const result: Before = { value: 1 }; return result.value }", false},
		{"type-query", "const later = 2;\nexport effect function load() { type Before = typeof later; using r = open(); const later = 1; const result: Before = 1; return result }", false},
		{"outer-fallback", "const later = 2;\nexport effect function load() { const read = () => later; using r = open(); const later = 3; return read() }", false},
		{"outer-shorthand-fallback", "const later = 2;\nexport effect function load() { const read = () => ({ later }); using r = open(); const later = 3; return read().later }", false},
		{"suffix-closure", "const later = 2;\nexport effect function load() { using r = open(); const read = () => later; const later = 1; return read() }", true},
		{"prefix-local", "const later = 2;\nexport effect function load() { const earlier = 1; const read = () => earlier; using r = open(); const later = 2; return read() + later }", true},
		{"shadowed-parameter", "const later = 2;\nexport effect function load() { const read = (later: number) => later; using r = open(); const later = 1; return read(later) }", true},
		{"property-name", "const later = 2;\nexport effect function load() { const earlier = { later: 1 }; using r = open(); const later = 2; return earlier.later + later }", true},
		{"type-property-name", "const later = 2;\nexport effect function load() { type Before = { later: number }; using r = open(); const later = 2; const result: Before = { later }; return result.later }", true},
		{"nested-block-binding", "const later = 2;\nexport effect function load() { const read = () => { const later = 1; return later }; using r = open(); const later = 2; return read() + later }", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "const open = (): Disposable => ({ [Symbol.dispose]() { } })\n" + tc.source
			program, file, service, converters := editorProgram(t, source)
			items := append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...)
			count := 0
			warnings := 0
			for _, d := range items {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("invalid original: %s", d.String())
				}
				if d.Code() != EK0801.Code {
					continue
				}
				warnings++
				actions, err := usingScopedActions(t.Context(), &ls.CodeFixContext{SourceFile: file, Span: d.Loc(), ErrorCode: d.Code(), Program: program, LS: service})
				if err != nil {
					t.Fatal(err)
				}
				for _, action := range actions {
					if action.Description != "Acquire with acquireDisposable inside scoped" {
						continue
					}
					count++
					got := applyEditorEdits(t, file, converters, action.Changes)
					if !tc.offer {
						t.Logf("unsafe scope move offered:\n%s", got)
					} else {
						checked, edited, _, _ := editorProgram(t, got)
						for _, d := range append(checked.GetSyntacticDiagnostics(t.Context(), edited), checked.GetSemanticDiagnostics(t.Context(), edited)...) {
							if d.Category() == diagnostics.CategoryError {
								t.Errorf("invalid scoped conversion: %s\n%s", d.String(), got)
							}
						}
						if !strings.Contains(got, "try acquireDisposable(") || !strings.Contains(got, "return try scoped(effect {") {
							t.Errorf("missing acquisition: %s", got)
						}
					}
				}
			}
			want := 0
			if tc.offer {
				want = 1
			}
			if warnings != 1 || count != want {
				t.Fatalf("warnings %d; actions %d, want %d", warnings, count, want)
			}
		})
	}
}
