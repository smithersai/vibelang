package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// isEffectOperandType implements Chapter 2's operand test (VIP-5/17/18).
// Native assignability handles any, never, constraints, unions and structural
// members together. A variance property alone does not prove assignability.
// Keep this separate from isEffectType: throw tracking and result diagnostics
// have different rules for top/bottom types and Effect subtypes.
func isEffectOperandType(c *checker.Checker, t *checker.Type) bool {
	if t == nil {
		return false
	}
	base := analyzerFor(c).programEffectInterface()
	if base == nil {
		return false
	}
	any := c.GetAnyType()
	return c.IsTypeAssignableTo(t, c.NewTypeReference(base, []*checker.Type{any, any, any}))
}

// operandType reads a direct call before try/catch unwraps its success.
// Non-call expressions use their ordinary value type, including a catch
// expression nested on the left of another catch.
func effectOperandType(c *checker.Checker, operand *ast.Node) *checker.Type {
	inner := ast.SkipParentheses(operand)
	if isInvocation(inner) && catchExpressionOf(inner) == nil && !isTryCall(inner) {
		if signature := c.GetResolvedSignature(inner); signature != nil {
			// The resolved signature already retains the optional call's
			// absent branch. A syntactic ?. on a narrowed/proven-present
			// receiver adds no undefined, just as in TypeScript.
			return c.GetReturnTypeOfSignature(signature)
		}
	}
	return c.GetTypeAtLocation(operand)
}

// Execution syntax on a catch's left has already produced its success
// value. Check that value, not the Effect returned by its hidden helper.
func catchOperandType(c *checker.Checker, operand *ast.Node) *checker.Type {
	inner := ast.SkipParentheses(operand)
	if isTry(inner) || isKeywordFormCall(inner) || runsInPlace(inner) {
		return c.GetTypeAtLocation(operand)
	}
	return effectOperandType(c, operand)
}

// runsInPlace reports whether node is a do or match in effect code, which
// runs where it stands (markedForm): like try, it has produced its value
// before a catch on its left runs that value.
func runsInPlace(node *ast.Node) bool {
	if !ast.IsCallExpression(node) {
		return false
	}
	fn := ast.SkipParentheses(node.Expression())
	return isCalledInPlace(fn) && markedForm(fn) == formEffect
}
