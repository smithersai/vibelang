package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Include parser diagnostics: EK1702 is a syntax error, not a checker error.
func expressionNameErrors(t *testing.T, source string) []*ast.Diagnostic {
	p, file, _, _ := editorProgram(t, source)
	var errors []*ast.Diagnostic
	all := append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...)
	for _, d := range all {
		if d.Category() == diagnostics.CategoryError {
			errors = append(errors, d)
		}
	}
	return errors
}

func TestEffectExpressionNames(t *testing.T) {
	for _, name := range []string{"fork", "join", "f\\u006frk", "j\\u006fin"} {
		for _, star := range []string{"", "*"} {
			body := "return 1"
			if star != "" {
				body = "yield 1"
			}
			source := "export const item = effect function" + star + " " + name + "() { " + body + " }"
			errors := expressionNameErrors(t, source)
			if len(errors) != 1 || errors[0].Code() != 1702 || errors[0].Source() != diagnosticSource {
				t.Errorf("%s: got %v, want EK1702", source, errors)
			}
		}
	}
}

func TestEffectExpressionNameControls(t *testing.T) {
	for _, source := range []string{
		"export effect function fork() { return 1 }",
		"export effect function* join() { yield 1 }",
		"export const item = effect function forkOne() { return 1 }",
		"export const item = { effect join() { return 1 } }",
		"export class Item { effect *fork() { yield 1 } }",
		"effect function outer() { const item = function fork() { return 1 }; return 1 }",
		"effect function outer() { const item = function* join() { yield 1 }; return 1 }",
	} {
		if errors := expressionNameErrors(t, source); len(errors) != 0 {
			t.Errorf("%s: %v", source, errors)
		}
	}
}
