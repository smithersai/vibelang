package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Service-tag migration clients keep the existing four-result protocol.
// They append the opening text themselves; the helper's precise-offset
// variant must not break those clients or lose a held catch operand.
func TestFixVIPValueCallClientProtocol(t *testing.T) {
	for _, c := range []struct{ name, declarations, head, fallback string }{
		{"stored-config", "const Port = Config.String(\"FOLDKIT_PROBE\")", "Port", "\"\""},
		{"config-factory", "", "Config.option(Config.String(\"FOLDKIT_PROBE\"))", "Option.none<string>()"},
		{"effect-factory", "", "Effect.succeed(7)", "0"},
	} {
		t.Run(c.name, func(t *testing.T) {
			prefix := "import { Config } from \"effect\"\n" + c.declarations + "\nexport effect function program() { return "
			source := prefix + c.head + "() catch () => " + c.fallback + " }\n"
			program, file, _, _ := editorProgram(t, source)
			program.GetSemanticDiagnostics(t.Context(), file)
			checker, done := program.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			var call *ast.Node
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if ast.IsCallExpression(node) && source[scanner.SkipTrivia(source, node.Pos()):node.End()] == c.head+"()" {
					call = node
					return false
				}
				return node.ForEachChild(visit)
			}
			visit(file.AsNode())
			if call == nil {
				t.Fatal("missing real value call")
			}
			at, open, edits, ok := effectValueCallEdits(analyzerFor(checker), file, call)
			if !ok {
				t.Fatal("four-result caller did not receive the catch-head repair")
			}
			edits = append(edits, sourceEdit{at, at, open})
			got := applyEdits(source, edits)
			want := prefix + "(" + c.head + ") catch () => " + c.fallback + " }\n"
			if got != want {
				t.Fatalf("four-result caller wrote\n%s\nwant\n%s", got, want)
			}
		})
	}
}
