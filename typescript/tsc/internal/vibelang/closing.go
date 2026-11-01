package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// Plain-function for...of keeps native IteratorClose behavior (effectscript-75,
// RC-23): an incoming body or binding throw wins unchanged over a close
// failure. A close failure replaces a normal break or return. Leaving these
// loops native also preserves that precedence after expression lowering,
// including nested loops and every consecutive label.
//
// Effect-code loops retain their existing failure-combining policy here:
// catch a body or binding failure, break to close with a normal completion,
// then combine a failing close with the pending failure via $finallyFailure.
// $iteratorFrame separately handles frames whose bodies can pause
// (iterators_lower.go); plain-loop closing does not change that path.

// closeLoops rewrites native for...of loops emitted from Effect code. Every
// consecutive label stays on its loop,
// inside the block the rewrite makes, so continue still targets an iteration.
func (tx *lowering) closeLoops(node *ast.Node) *ast.Node {
	visitor := tx.EmitContext().NewNodeVisitor(nil)
	visitor.Visit = func(node *ast.Node) *ast.Node {
		labels, loop := ast.CollectLabelChain(node)
		if !tx.isClosedLoop(loop) {
			return visitor.VisitEachChild(node)
		}
		return tx.closeLoop(labels, visitor.VisitEachChild(loop))
	}
	return visitor.VisitNode(node)
}

// closeLoop rewrites loop, a native for...of whose nested loops are already
// rewritten, keeping the complete label chain on the loop in source order.
func (tx *lowering) closeLoop(labels []*ast.Node, loop *ast.Node) *ast.Node {
	ec := tx.EmitContext()
	f := tx.Factory()
	statement := loop.AsForInOrOfStatement()
	pending := f.NewUniqueName("pending")
	value := f.NewUniqueName("value")
	inner := f.NewUniqueName("thrown")
	outer := f.NewUniqueName("thrown")
	// The head's binding moves into the body's try, unless it is one name.
	initializer := statement.Initializer
	var body []*ast.Node
	if !bindsOneName(initializer) {
		if ast.IsVariableDeclarationList(initializer) {
			declaration := initializer.AsVariableDeclarationList().Declarations.Nodes[0]
			body = append(body, f.NewVariableStatement(nil, f.NewVariableDeclarationList(f.NewNodeList([]*ast.Node{
				f.NewVariableDeclaration(declaration.Name(), nil, nil, value),
			}), initializer.Flags&ast.NodeFlagsBlockScoped)))
		} else {
			body = append(body, f.NewExpressionStatement(f.NewAssignmentExpression(initializer, value)))
		}
		initializer = f.NewVariableDeclarationList(f.NewNodeList([]*ast.Node{f.NewVariableDeclaration(value, nil, nil, nil)}), ast.NodeFlagsConst)
	}
	body = append(body, statement.Statement)
	catchInner := f.NewCatchClause(f.NewVariableDeclaration(inner, nil, nil, nil), f.NewBlock(f.NewNodeList([]*ast.Node{
		f.NewExpressionStatement(f.NewAssignmentExpression(pending, inner)),
		f.NewBreakStatement(nil),
	}), true))
	guarded := f.NewBlock(f.NewNodeList([]*ast.Node{f.NewTryStatement(f.NewBlock(f.NewNodeList(body), true), catchInner, nil)}), true)
	rewritten := f.UpdateForInOrOfStatement(statement, statement.AwaitModifier, initializer, statement.Expression, guarded)
	for i := len(labels) - 1; i >= 0; i-- {
		label := labels[i].AsLabeledStatement()
		rewritten = f.UpdateLabeledStatement(label, label.Label, rewritten)
	}
	catchOuter := f.NewCatchClause(f.NewVariableDeclaration(outer, nil, nil, nil), f.NewBlock(f.NewNodeList([]*ast.Node{
		f.NewThrowStatement(tx.runtimeCall("$finallyFailure", pending, outer)),
	}), true))
	declare := f.NewVariableStatement(nil, f.NewVariableDeclarationList(f.NewNodeList([]*ast.Node{
		f.NewVariableDeclaration(pending, nil, nil, tx.runtimeMember("$normal")),
	}), ast.NodeFlagsLet))
	try := f.NewTryStatement(f.NewBlock(f.NewNodeList([]*ast.Node{rewritten}), true), catchOuter, nil)
	rethrow := f.NewIfStatement(f.NewBinaryExpression(nil, pending, nil, f.NewToken(ast.KindExclamationEqualsEqualsToken), tx.runtimeMember("$normal")), f.NewThrowStatement(pending), nil)
	block := f.NewBlock(f.NewNodeList([]*ast.Node{declare, try, rethrow}), true)
	original := loop
	if len(labels) > 0 {
		original = labels[0]
	}
	ec.SetOriginal(block, original)
	block.Loc = original.Loc
	return block
}

// isClosedLoop reports whether node, an emitted statement, is a native
// for...of that came from Effect code, outside hatches and module bodies.
// Plain functions and plain generators keep JavaScript's native closing.
func (tx *lowering) isClosedLoop(node *ast.Node) bool {
	if node == nil || node.Kind != ast.KindForOfStatement || node.AsForInOrOfStatement().AwaitModifier != nil {
		return false
	}
	original := tx.EmitContext().MostOriginal(node)
	if original == nil || original.Kind != ast.KindForOfStatement || original.Parent == nil || !isVibeLangFile(ast.GetSourceFileOfNode(original)) {
		return false
	}
	if initializer := original.AsForInOrOfStatement().Initializer; ast.IsVariableDeclarationList(initializer) && (isUsingList(initializer) || len(initializer.AsVariableDeclarationList().Declarations.Nodes) != 1) {
		return false // for (using r of rs) is a Scope region's (scopes_lower.go)
	}
	return inLowerableBody(original) && inEffectCode(original)
}

// bindsOneName reports whether a for...of head, a declaration list or an
// assignment target, binds a single name, which cannot fail.
func bindsOneName(initializer *ast.Node) bool {
	if ast.IsVariableDeclarationList(initializer) {
		return ast.IsIdentifier(initializer.AsVariableDeclarationList().Declarations.Nodes[0].Name())
	}
	return ast.IsIdentifier(initializer)
}
