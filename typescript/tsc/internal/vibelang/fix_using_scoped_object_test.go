package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestUsingScopedFixWrappedObjects(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		offer        bool
	}{
		{"asserted", "export effect function load() { using resource = { [Symbol.dispose]() {} } as Disposable; return 1 }", true},
		{"satisfies", "export effect function load() { using resource = { [Symbol.dispose]() {} } satisfies Disposable; return 1 }", true},
		{"nonnull", "export effect function load() { using resource = { [Symbol.dispose]() {} }!; return 1 }", true},
		{"asserted-nonnull", "export effect function load() { using resource = { [Symbol.dispose]() {} }! as Disposable; return 1 }", true},
		{"satisfies-nonnull", "export effect function load() { using resource = { [Symbol.dispose]() {} }! satisfies Disposable; return 1 }", true},
		{"double-asserted", "export effect function load() { using resource = { [Symbol.dispose]() {} } as unknown as Disposable; return 1 }", true},
		{"multiline", "export effect function load() { using resource = {\n  [Symbol.dispose]() {}\n} as Disposable; return 1 }", true},
		{"bare", "export effect function load() { using resource = { [Symbol.dispose]() {} }; return 1 }", true},
		{"parenthesized", "export effect function load() { using resource = ({ [Symbol.dispose]() {} }); return 1 }", true},
		{"wrapped-assertion", "export effect function load() { using resource = ({ [Symbol.dispose]() {} } as Disposable); return 1 }", true},
		{"wrapped-satisfies", "export effect function load() { using resource = ({ [Symbol.dispose]() {} } satisfies Disposable); return 1 }", true},
		{"wrapped-nonnull", "export effect function load() { using resource = ({ [Symbol.dispose]() {} }!); return 1 }", true},
		{"inner-parentheses", "export effect function load() { using resource = ({ [Symbol.dispose]() {} }) as Disposable; return 1 }", true},
		{"angle-assertion", "export effect function load() { using resource = <Disposable>{ [Symbol.dispose]() {} }; return 1 }", true},
		{"conditional", "export effect function load() { using resource = true ? { [Symbol.dispose]() {} } : { [Symbol.dispose]() {} }; return 1 }", true},
		{"factory", "export effect function load() { using resource = open(); return 1 }", true},
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
						t.Logf("unsafe initializer callback offered:\n%s", got)
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
