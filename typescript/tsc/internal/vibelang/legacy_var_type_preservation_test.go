package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 7 requires a quick fix to preserve types and declaration output.
// A readonly tuple exposes literal narrowing even when ordinary arithmetic
// and the value printed at runtime stay unchanged.
func TestLegacyVarQuickFixPreservesTypes(t *testing.T) {
	for _, test := range []struct{ name, source string }{
		{"number", "export function run() { var x = 1; return [x] as const }"},
		{"string", "export function run() { var x = \"hello\"; return [x] as const }"},
		{"negative", "export function run() { var x = -2; return [x] as const }"},
		{"bigint", "export function run() { var x = 3n; return [x] as const }"},
		{"conditional", "export function run(flag: boolean) { var x = flag ? 1 : 2; return [x] as const }"},
		{"type query", "export function run() { var x = 1; const y: typeof x = 2; return y }"},
		{"generic inference", "function keep<const T>(x: T): T { return x }; export function run() { var x = 1; return keep(x) }"},
		{"annotated control", "export function run() { var x: number = 1; return [x] as const }"},
	} {
		t.Run(test.name, func(t *testing.T) {
			contract := func(source string, fixed bool) string {
				program, file, _, _ := editorProgram(t, source)
				for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
					if d.Category() == diagnostics.CategoryError && (fixed || d.Source() != diagnosticSource || d.Code() != EK0107.Code) {
						t.Fatalf("unexpected diagnostic: %s\n%s", d.String(), source)
					}
				}
				c, done := program.GetTypeCheckerForFile(t.Context(), file)
				defer done()
				for _, statement := range file.Statements.Nodes {
					if ast.IsFunctionDeclaration(statement) && statement.Name() != nil && statement.Name().Text() == "run" {
						return c.TypeToString(c.GetTypeAtLocation(statement.Name()))
					}
				}
				t.Fatal("no run declaration")
				return ""
			}
			before := contract(test.source, false)
			titles, results := legacyVarActions(t, test.source)
			if len(titles) == 0 || !strings.HasSuffix(titles[0], " instead of var") {
				t.Fatalf("missing block scoped rewrite: %v", titles)
			}
			if after := contract(results[0], true); before != after {
				t.Fatalf("quick fix changed exported type\nbefore: %s\nafter: %s\n%s", before, after, results[0])
			}
		})
	}
}
