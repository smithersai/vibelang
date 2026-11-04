package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-7/VIP-29's class matcher remains part of a preserving class upgrade.
func TestSchemaErrorMatcherClassFix(t *testing.T) {
	for _, prefix := range []string{
		"",
		"const $schemaErrorMatcher = 0; const $ErrorMatcher = 1; const $ErrorMatcher2 = 2;\n",
		"const Schema = 0;\n",
	} {
		t.Run(prefix, func(t *testing.T) {
			source := prefix + "export schema error E { id: string; static marker = 1 }\nexport function probe(subject: unknown) { return match(subject) { when E(let item): item; default: undefined; } }\n"
			fixed := applyQuickFixOf(t, source, 1302, diagnostics.CategoryError)
			program, file, _, _ := editorProgram(t, fixed)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("class upgrade: %s\n%s", d.String(), fixed)
				}
			}
			c, done := program.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			calls := 0
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if ast.IsCallExpression(n) && runtimeExportOf(c, n.Expression()) == "$schemaErrorMatcher" {
					calls++
					args := n.Arguments()
					if len(args) != 2 || args[0].Kind != ast.KindThisKeyword || !ast.IsStringLiteral(args[1]) || args[1].Text() != "E" {
						t.Fatalf("matcher must register this class and its original tag:\n%s", fixed)
					}
					parent := n.Parent
					for parent != nil && parent.Kind != ast.KindClassStaticBlockDeclaration {
						parent = parent.Parent
					}
					if parent == nil {
						t.Fatalf("matcher registration must run in the class static block:\n%s", fixed)
					}
				}
				return n.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if calls != 1 {
				t.Fatalf("class upgrade must retain one bound runtime matcher registration; got %d:\n%s", calls, fixed)
			}
		})
	}
}
