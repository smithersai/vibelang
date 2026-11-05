package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestLegacyJavaScriptRepair(t *testing.T) {
	for _, source := range []string{
		"export function f() { return eval(\"1\") }",
		"export function f() { return (0, eval)(\"1\") }",
		"export const f = new Function(\"return 1\")",
		"export const f = Function(\"return 1\")",
		"export const f = Function",
		"export function f() { return arguments.length }",
		"export function f() { var n = 1; return n }",
		"export function f() { if (true) { var n = 1 }; return n }",
		"export default function f() { var n = 1; return n }",
		"var n = 1; export { n as default }; export function f() { return n }",
		"var n = 1; export { n }; export function f() { return n++ }",
	} {
		t.Run(source, func(t *testing.T) {
			fixed := applyQuickFixOf(t, source, EK0107.Code, diagnostics.CategoryError)
			if !strings.Contains(fixed, "\n"+source+"\n}") || !strings.Contains(fixed, "export * from ") {
				t.Fatalf("repair must keep the entire native scope unchanged:\n%s", fixed)
			}
			program, file, _, _ := editorProgram(t, fixed)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("fixed native module: %s\n%s", d.String(), fixed)
				}
			}
		})
	}
	t.Run("empty with", func(t *testing.T) {
		fixed := applyQuickFixOf(t, "export function f() { with ({}) {} }", EK0107.Code, diagnostics.CategoryError)
		if fixed != "export function f() { {} }" {
			t.Fatal(fixed)
		}
	})
}
