package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestPipeObjectStatement(t *testing.T) {
	const helpers = `function f(x:unknown){return x}; function g(x:unknown){return x}; `
	for _, expression := range []string{`{a:1}`, `{a:{b:2}}`, `{get value(){return 1}}`, `class {}`} {
		for _, prefix := range []string{"", "const result = "} {
			source := helpers + prefix + "f(g(" + expression + "))"
			t.Run(prefix+expression, func(t *testing.T) {
				program, file, service, converters := editorProgram(t, source)
				offset := strings.LastIndex(source, "f(g(")
				actions := vibelangRefactors(t.Context(), &ls.RefactorContext{SourceFile: file, Span: core.NewTextRange(offset, offset), Program: program, LS: service})
				for _, action := range actions {
					if action.Description == "Convert to a pipe" {
						after := applyEditorEdits(t, file, converters, action.Changes)
						p, f, _, _ := editorProgram(t, after)
						for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
							if d.Category() == diagnostics.CategoryError {
								t.Errorf("rewritten diagnostic: %s\n%s", d.String(), after)
							}
						}
						return
					}
				}
				t.Fatal("missing pipe action")
			})
		}
	}
}
