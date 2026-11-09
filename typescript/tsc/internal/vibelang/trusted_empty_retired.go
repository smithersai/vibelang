package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// The retired trusted(f, []) wrapper reports EK0407. Local functions named
// trusted and wrappers with listed failure classes retain their existing behavior.
var EK0407 = message(407, errorCategory, "The empty legacy trust wrapper trusted(f, []) is retired. Write each direct call in effect code as Effect.orDie(Effect.try({ try: () => f(…), catch: (e) => e })), or call a reviewed .ts helper declared @throws {never}.")

func init() { fileChecks = append(fileChecks, checkTrustedEmpty) }

func checkTrustedEmpty(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsCallExpression(n) && isTrustedEmptyCall(c, n) {
			report(c, n, EK0407)
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// isTrustedEmptyCall reports whether call is trusted(f, []) with trusted
// resolved to vibelang-runtime's export.
func isTrustedEmptyCall(c *checker.Checker, call *ast.Node) bool {
	args := call.Arguments()
	if len(args) != 2 {
		return false
	}
	list := ast.SkipParentheses(args[1])
	if !ast.IsArrayLiteralExpression(list) || len(list.AsArrayLiteralExpression().Elements.Nodes) != 0 {
		return false
	}
	return runtimeExportOf(c, ast.SkipParentheses(call.Expression())) == "trusted"
}
