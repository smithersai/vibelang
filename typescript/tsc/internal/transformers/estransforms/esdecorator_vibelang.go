package estransforms

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// VibeLang: a .vibe file runs an Effect with yield* in effect code and keeps
// native await in async code, and both may stand where a decorated class
// evaluates its decorators, its heritage and its computed member names
// (chapter 2: try e is allowed where await e is). This transformer moves those
// expressions into the class's IIFE, so for a .vibe file the IIFE suspends its
// caller: a generator delegated with yield*, called with the caller's this, or
// an async arrow that is awaited. Upstream writes a plain arrow IIFE, in which
// the yield or await is a SyntaxError; TypeScript files keep that output.

// classEvaluationSuspension reports what the IIFE's own code suspends with:
// ast.KindYieldExpression, ast.KindAwaitExpression, or ast.KindUnknown for
// neither.
func classEvaluationSuspension(statements []*ast.Statement) ast.Kind {
	found := ast.KindUnknown
	for _, statement := range statements {
		if found = suspensionIn(statement, found); found == ast.KindYieldExpression {
			break
		}
	}
	return found
}

// suspensionIn adds what node's own code suspends with to found. Nested
// functions, static blocks and field initializers run later, in activations of
// their own; a member's computed name runs where its class is defined.
func suspensionIn(node *ast.Node, found ast.Kind) ast.Kind {
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		switch {
		case n.Kind == ast.KindYieldExpression:
			found = ast.KindYieldExpression
			return true
		case n.Kind == ast.KindAwaitExpression:
			found = ast.KindAwaitExpression
		case ast.IsFunctionLike(n) || ast.IsClassStaticBlockDeclaration(n) || n.Kind == ast.KindPropertyDeclaration:
			if name := n.Name(); name != nil && ast.IsComputedPropertyName(name) {
				return visit(name)
			}
			return false
		}
		return n.ForEachChild(visit)
	}
	visit(node)
	return found
}

// carryPendingSuspension keeps a .vibe member's pending decorator evaluations
// in class definition order when they suspend. Upstream evaluates pending
// expressions in the next computed member name, or after the last one in the
// class's leading static block, which cannot suspend its caller. A member whose
// name is an identifier or a literal takes them in the equivalent computed
// literal name instead, so @(try d) load() { } is written as
// [(_load_decorators = [yield* d], "load")]() { }. A private name can't be
// computed and keeps upstream's placement.
func (tx *esDecoratorTransformer) carryPendingSuspension(name *ast.Node) *ast.Node {
	if !tx.vibeLang || name == nil || len(tx.pendingExpressions) == 0 ||
		!(ast.IsIdentifier(name) || ast.IsStringLiteral(name) || ast.IsNumericLiteral(name) || ast.IsBigIntLiteral(name)) {
		return name
	}
	found := ast.KindUnknown
	for _, expression := range tx.pendingExpressions {
		found = suspensionIn(expression, found)
	}
	if found == ast.KindUnknown {
		return name
	}
	f := tx.Factory()
	key := name
	if ast.IsIdentifier(name) {
		key = f.NewStringLiteralFromNode(name)
	}
	expressions := append(tx.pendingExpressions[:len(tx.pendingExpressions):len(tx.pendingExpressions)], key)
	tx.pendingExpressions = nil
	return f.NewComputedPropertyName(f.InlineExpressions(expressions))
}

// newSuspendingClassIIFE writes the class's IIFE for a .vibe file whose
// class evaluation suspends: (yield* (function* () { … }).call(this)), or
// (await (async () => { … })()).
func (tx *esDecoratorTransformer) newSuspendingClassIIFE(statements []*ast.Statement, suspension ast.Kind) *ast.Expression {
	f := tx.Factory()
	body := f.NewBlock(f.NewNodeList(statements), true)
	if suspension == ast.KindAwaitExpression {
		arrow := f.NewArrowFunction(f.NewModifierList([]*ast.Node{f.NewToken(ast.KindAsyncKeyword)}), nil, f.NewNodeList([]*ast.Node{}), nil, nil, f.NewToken(ast.KindEqualsGreaterThanToken), body)
		call := f.NewCallExpression(f.NewParenthesizedExpression(arrow), nil, nil, f.NewNodeList([]*ast.Node{}), ast.NodeFlagsNone)
		return f.NewParenthesizedExpression(f.NewAwaitExpression(call))
	}
	generator := f.NewFunctionExpression(nil, f.NewToken(ast.KindAsteriskToken), nil, nil, f.NewNodeList([]*ast.Node{}), nil, nil, body)
	callee := f.NewPropertyAccessExpression(f.NewParenthesizedExpression(generator), nil, f.NewIdentifier("call"), ast.NodeFlagsNone)
	call := f.NewCallExpression(callee, nil, nil, f.NewNodeList([]*ast.Node{f.NewThisExpression()}), ast.NodeFlagsNone)
	return f.NewParenthesizedExpression(f.NewYieldExpression(f.NewToken(ast.KindAsteriskToken), call))
}
