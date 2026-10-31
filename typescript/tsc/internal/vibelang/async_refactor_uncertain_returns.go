package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Async return adopts its value after evaluating the return expression.
// An awaited object can expose a then getter again at that step. Static
// primitive types rule out the uncertain cases checked by this refactor.
func asyncReturnsUncertainValue(c *checker.Checker, body *ast.Node) bool {
	uncertain := func(t *checker.Type) bool {
		if t == nil {
			return true
		}
		t = unwrapSubstitution(t)
		// Structural object types are open: even { tag: number }, an array
		// or a callable can hide a then method. Only primitive returns rule
		// out adoption without adding an await bridge.
		// A void-returning callback may legally return an object: its
		// contextual return type discards the value only statically.
		const nonThenable = (checker.TypeFlagsPrimitive &^ checker.TypeFlagsVoid) | checker.TypeFlagsNever | checker.TypeFlagsIndex
		for _, member := range unionMembers(t) {
			if member.Flags()&nonThenable != 0 {
				continue
			}
			if member.Flags()&checker.TypeFlagsInstantiableNonPrimitive == 0 {
				return true
			}
			constraint := c.GetBaseConstraintOfType(member)
			if constraint == nil || constraint == member {
				return true
			}
			for _, part := range unionMembers(constraint) {
				if part.Flags()&nonThenable == 0 {
					return true
				}
			}
		}
		return false
	}
	returnsUncertain := func(node *ast.Node) bool {
		if node == nil || ast.IsVoidExpression(ast.SkipParentheses(node)) {
			return false // an absent value or an explicit void operator is undefined
		}
		return uncertain(c.GetTypeAtLocation(node))
	}
	if body == nil {
		return false
	}
	if !ast.IsBlock(body) {
		return returnsUncertain(body)
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isFunctionBoundary(node) {
			return false
		}
		if ast.IsReturnStatement(node) && returnsUncertain(node.Expression()) {
			return true
		}
		return node.ForEachChild(visit)
	}
	return visit(body)
}
