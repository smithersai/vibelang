package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"strings"
	"testing"
)

func TestUsingScopedFixDeclarationComments(t *testing.T) {
	for _, tc := range []struct{ name, declaration string }{
		{"after-using", "using /* resource note */ resource = open();"},
		{"after-name", "using resource /* resource note */ = open();"},
		{"before-value", "using resource = /* resource note */ open();"},
		{"line-before-value", "using resource = // resource note\n open();"},
		{"after-value", "using resource = open() /* resource note */;"},
		{"between-bindings", "using resource = open(), /* resource note */ other = open();"},
		{"inside-value", "using resource = open(/* resource note */);"},
		{"before-using", "/* resource note */ using resource = open();"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "const open = (): Disposable => ({ [Symbol.dispose]() {} });\nexport effect function load(): number!! { " + tc.declaration + " return 1 }"
			program, file, service, converters := editorProgram(t, source)
			warnings, actions := 0, 0
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("invalid original: %s", d.String())
				}
				if d.Code() != EK0801.Code {
					continue
				}
				warnings++
				fixes, err := usingScopedActions(t.Context(), &ls.CodeFixContext{SourceFile: file, Span: d.Loc(), ErrorCode: d.Code(), Program: program, LS: service})
				if err != nil {
					t.Fatal(err)
				}
				for _, fix := range fixes {
					if fix.Description != "Acquire with acquireDisposable inside scoped" {
						continue
					}
					actions++
					edited := applyEditorEdits(t, file, converters, fix.Changes)
					if strings.Count(edited, "resource note") != 1 {
						t.Errorf("lost comment: %s", edited)
					}
					checked, changed, _, _ := editorProgram(t, edited)
					for _, issue := range append(checked.GetSyntacticDiagnostics(t.Context(), changed), checked.GetSemanticDiagnostics(t.Context(), changed)...) {
						if issue.Category() == diagnostics.CategoryError {
							t.Errorf("invalid edit: %s", issue.String())
						}
					}
				}
			}
			if warnings != 1 || actions != 1 {
				t.Fatalf("warnings %d actions %d", warnings, actions)
			}
		})
	}
}
