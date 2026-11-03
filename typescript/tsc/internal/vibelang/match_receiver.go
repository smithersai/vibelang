package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// VIP-7 retains a member pattern's reference receiver. Capture its base once:
// a getter along holder.matcher.test must not run again to recover this.
// The checker still sees the original $is/$extract call for narrowing.
func (tx *lowering) visitPatternReceiver(node *ast.Node) *ast.Node {
	matcher := ast.SkipParentheses(node.Arguments()[0])
	if !ast.IsPropertyAccessExpression(matcher) && !ast.IsElementAccessExpression(matcher) {
		return tx.Visitor().VisitEachChild(node)
	}
	f := tx.Factory()
	receiver := f.NewUniqueName("receiver")
	parameters := []*ast.Node{f.NewParameterDeclaration(nil, nil, receiver, nil, nil, nil)}
	arguments := []*ast.Node{tx.visit(matcher.Expression())}
	var member *ast.Node
	if ast.IsPropertyAccessExpression(matcher) {
		member = f.NewPropertyAccessExpression(receiver, nil, f.DeepCloneNode(matcher.Name()), ast.NodeFlagsNone)
	} else {
		// Evaluate computed keys outside the arrow, retaining enclosing jumps
		// and effect operations in their original context.
		key := f.NewUniqueName("key")
		parameters = append(parameters, f.NewParameterDeclaration(nil, nil, key, nil, nil, nil))
		arguments = append(arguments, tx.visit(matcher.AsElementAccessExpression().ArgumentExpression))
		member = f.NewElementAccessExpression(receiver, nil, key, ast.NodeFlagsNone)
	}
	body := tx.runtimeCall(node.Expression().Text(), member, tx.visit(node.Arguments()[1]), receiver)
	arrow := tx.arrow(parameters, body)
	result := f.NewCallExpression(f.NewParenthesizedExpression(arrow), nil, nil, f.NewNodeList(arguments), ast.NodeFlagsNone)
	tx.EmitContext().SetOriginal(result, node)
	result.Loc = node.Loc
	return result
}
