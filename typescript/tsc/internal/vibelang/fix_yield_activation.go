package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Effect TypeScript's yield* e runs e; VIP-5 spells that try e. A redundant
// yield* before a try yielding a value loses the delegator; a returned Effect
// still runs. Do not turn an
// emission into an Effect run, or make parameter initialization suspend.

func yieldActivationFixable(node *ast.Node) bool {
	if !ast.IsYieldExpression(node) || node.AsYieldExpression().AsteriskToken == nil || node.Expression() == nil ||
		!parser.VibeLangYieldOutsideProducer(node) {
		return false
	}
	for n, child := node.Parent, node; n != nil; child, n = n, n.Parent {
		if n.Kind == ast.KindParameter {
			return false
		}
		if ast.IsFunctionLike(n) && child == n.Body() &&
			!(n.Kind == ast.KindArrowFunction && n.AsArrowFunction().EqualsGreaterThanToken.Flags&ast.NodeFlagsReparsed != 0 && n.Flags&ast.NodeFlagsVibeLangEffect == 0) {
			return n.Flags&ast.NodeFlagsVibeLangEffect != 0 && ast.GetFunctionFlags(n)&ast.FunctionFlagsGenerator == 0
		}
	}
	return false
}
