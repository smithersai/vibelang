package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// VIP-4, amended 2026-11-02 (Retirement of the empty legacy trust wrapper):
// the historical trusted(f, []) runtime wrapper is not an accepted form.
// EK0407 reports each call of vibelang-runtime's trusted whose failure list
// is an empty array literal, and names vibelang --fix, whose migration
// (fix_trusted_empty.go) writes the identity-mapped Effect.try / Effect.orDie
// bridge. A wrapper the migration cannot rewrite keeps the error with a note
// that says so, the located refusal. A local function named trusted and a
// wrapper with listed failure classes are outside this retirement.
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
