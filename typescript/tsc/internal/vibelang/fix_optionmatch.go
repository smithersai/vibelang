package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Direct Option.match is an eager choice. Keep callback construction, property
// reads, defaults and early returns at their original function boundaries.
func optionMatchOf(c *checker.Checker, call *ast.Node) bool {
	return ast.IsCallExpression(call) && call.QuestionDotToken() == nil && call.TypeArguments() == nil && len(call.Arguments()) == 2 && isEffectFunction(c, call.Expression(), "Option", "match") && !inHatch(call)
}

func holdsEffectGenerator(c *checker.Checker, file *ast.SourceFile, node *ast.Node) bool {
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if g, _ := readGeneratorCall(c, file, n); g != nil && g.generator != nil && isGeneratorExpression(g.generator) {
			return true
		}
		return n.ForEachChild(visit)
	}
	return node.ForEachChild(visit)
}
