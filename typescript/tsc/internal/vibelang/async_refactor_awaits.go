package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// JavaScript awaits scalars too; Effect.tryPromise needs a Promise-producing
// thunk. Leave an unproven operand for explicit normalization before conversion.
func asyncHasUnbridgedAwait(c *checker.Checker, body *ast.Node) bool {
	if body == nil {
		return false
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isFunctionBoundary(node) {
			return false
		}
		if node.Kind == ast.KindAwaitExpression {
			for _, member := range unionMembers(c.GetTypeAtLocation(node.Expression())) {
				if member.Flags()&checker.TypeFlagsAnyOrUnknown != 0 || c.GetPromisedTypeOfPromise(member) == nil {
					return true
				}
			}
		}
		return node.ForEachChild(visit)
	}
	return visit(body)
}
