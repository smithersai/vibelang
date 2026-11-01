package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// JavaScript's own for...of keeps both failures (D404, D424). When a loop's
// body, or its head's destructuring or defaults, fails while the iterator is
// open and the iterator's return() then throws too, ECMAScript's
// IteratorClose keeps the first exception and drops the second, where
// Chapter 17's iterator rule adds the second to the first. So every native
// for...of the lowering emits, in plain code and in frames alike, catches a
// failure of its body and head inside the loop and leaves the loop by break,
// so that IteratorClose runs with a normal completion and a return() that
// throws reaches the runtime's combining form, $finallyFailure, as a failing
// finally block's exception does (D340):
//
//	for (const [a, b] of pairs) body
//
// becomes
//
//	let pending_1 = runtime.$normal;
//	try {
//	  for (const value_1 of pairs) {
//	    try { const [a, b] = value_1; body }
//	    catch (thrown_1) { pending_1 = thrown_1; break; }
//	  }
//	} catch (thrown_2) { throw runtime.$finallyFailure(pending_1, thrown_2) }
//	if (pending_1 !== runtime.$normal) throw pending_1;
//
// JavaScript itself looks the iterator's return method up when it closes the
// iterator, once per close, and never at the loop's entry; nothing here reads
// the iterator, and an array keeps its native iteration. A loop that only a
// jump leaves closes as before, and a return() that throws then is the
// loop's exception, as in JavaScript. Effect abandons a frame without
// resuming it, so a loop whose body can pause is also unwound by
// $iteratorFrame (iterators_lower.go), which this catch does not change: the
// return completion that unwinding resumes the frame with passes through it.

// closeLoops rewrites each native for...of of a .vibe function's body that
// the lowering emitted, as above. Every consecutive label stays on its loop,
// inside the block the rewrite makes, so continue still targets an iteration.
func (tx *lowering) closeLoops(node *ast.Node) *ast.Node {
	visitor := tx.EmitContext().NewNodeVisitor(nil)
	visitor.Visit = func(node *ast.Node) *ast.Node {
		var labels []*ast.Node
		loop := node
		for ast.IsLabeledStatement(loop) {
			labels = append(labels, loop)
			loop = loop.AsLabeledStatement().Statement
		}
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
// for...of that came from a for...of of a .vibe function's body: plain code,
// a frame, or a plain generator, outside hatches and module bodies.
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
	return inLowerableBody(original) || inPlainGeneratorBody(original)
}

// bindsOneName reports whether a for...of head, a declaration list or an
// assignment target, binds a single name, which cannot fail.
func bindsOneName(initializer *ast.Node) bool {
	if ast.IsVariableDeclarationList(initializer) {
		return ast.IsIdentifier(initializer.AsVariableDeclarationList().Declarations.Nodes[0].Name())
	}
	return ast.IsIdentifier(initializer)
}
