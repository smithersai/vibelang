package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// Optional chains in Effect code (chapter 13). A ?. skips the rest of its
// chain, the accesses, calls and arguments after it, when the value before it
// is null or undefined. A call in the chain that runs an Effect becomes a
// yield*, which ends the native chain there, so the lowering tests that value
// itself and evaluates the rest of the chain, without that ?., only when the
// value is present:
//
//	box?.read().value          ((base_1 = box) == null ? void 0 : (yield* base_1.read()).value)
//	codec.parse?.(input())     ((base_1 = (receiver_1 = codec).parse) == null ? void 0 : yield* runtime.$trusted(...))
//
// A ?.( call keeps the function its callee read and calls it with the
// receiver it read it from. A running call that ends its chain keeps the
// native chain, which skips its arguments (visitRunningCall). A trusted call
// (trust_lower.go) is guarded when it doesn't end its chain or its operands
// run Effects, which its thunk cannot hold.

// chainGuard is a ?. link the lowering tests before the rest of its chain:
// base holds the value before the ?., or, for a ?.( call, the function its
// callee read; receiver holds the object that function was read from, or is
// nil.
type chainGuard struct {
	base, receiver *ast.Node
}

// optionalLink reports whether node is a link of a chain written with ?.
func optionalLink(node *ast.Node) bool {
	switch node.Kind {
	case ast.KindPropertyAccessExpression, ast.KindElementAccessExpression, ast.KindCallExpression:
		return node.QuestionDotToken() != nil
	}
	return false
}

// guardedLink returns the ?. link of the optional chain that node ends to
// test first: the innermost one that is not yet tested at or under a link
// that yields, a running call before the chain's end or a trusted call. It
// returns nil when the chain needs no test.
func (tx *lowering) guardedLink(node *ast.Node) *ast.Node {
	if !tx.inEffect || !ast.IsOptionalChain(node) || !ast.IsOutermostOptionalChain(node) {
		return nil
	}
	var link *ast.Node
	yields := false
	for n := node; ast.IsOptionalChain(n); n = n.Expression() {
		if !yields && isInvocation(n) {
			switch {
			case tx.plan.trusted[n] != nil:
				yields = n != node || tx.mayYield(n)
			case tx.plan.runsCall(n):
				yields = n != node
			}
		}
		if yields && optionalLink(n) && tx.chainGuards[n] == nil {
			link = n
		}
	}
	return link
}

// writesQuestionDot reports whether node, a lowered link of a chain, or a
// link under it in its chain, is written with ?.
func writesQuestionDot(node *ast.Node) bool {
	for n := node; ast.IsOptionalChain(n); n = n.Expression() {
		if optionalLink(n) {
			return true
		}
	}
	return false
}

// mayYield reports whether lowering node may write a yield inside it, outside
// its nested functions: a call there that runs an Effect or is trusted.
func (tx *lowering) mayYield(node *ast.Node) bool {
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		switch {
		case isFunctionBoundary(n):
			return false
		case n.Kind == ast.KindYieldExpression:
			return true
		case n != node && isInvocation(n) && (tx.plan.runsCall(n) || tx.plan.trusted[n] != nil):
			return true
		}
		return n.ForEachChild(visit)
	}
	return visit(node)
}

// visitGuardedChain lowers node, the outermost link of an optional chain,
// as a test of the value before link, its ?. link, and the rest of the chain
// when that value is present.
func (tx *lowering) visitGuardedChain(node, link *ast.Node) *ast.Node {
	f := tx.Factory()
	ec := tx.EmitContext()
	guard := &chainGuard{base: f.NewUniqueName("base")}
	ec.AddVariableDeclaration(guard.base)
	var value *ast.Node
	callee := link.Expression()
	if ast.IsCallExpression(link) && (ast.IsPropertyAccessExpression(callee) || ast.IsElementAccessExpression(callee)) && callee.Expression().Kind != ast.KindSuperKeyword {
		// Read the function once, before the arguments, and keep its receiver.
		var object *ast.Node
		if outer := tx.chainGuards[callee]; outer != nil {
			object = outer.base // tested by an enclosing guard
		} else {
			object = tx.Visitor().VisitNode(callee.Expression())
		}
		guard.receiver = f.NewUniqueName("receiver")
		ec.AddVariableDeclaration(guard.receiver)
		object = f.NewParenthesizedExpression(f.NewAssignmentExpression(guard.receiver, tx.captureValue(object)))
		if ast.IsPropertyAccessExpression(callee) {
			value = f.NewPropertyAccessExpression(object, nil /*questionDotToken*/, callee.Name(), ast.NodeFlagsNone)
		} else {
			value = f.NewElementAccessExpression(object, nil /*questionDotToken*/, tx.Visitor().VisitNode(callee.AsElementAccessExpression().ArgumentExpression), ast.NodeFlagsNone)
		}
	} else {
		value = tx.Visitor().VisitNode(callee)
	}
	test := f.NewBinaryExpression(nil /*modifiers*/, f.NewParenthesizedExpression(f.NewAssignmentExpression(guard.base, tx.captureValue(value))), nil /*typeNode*/, f.NewToken(ast.KindEqualsEqualsToken), f.NewKeywordExpression(ast.KindNullKeyword))
	if tx.chainGuards == nil {
		tx.chainGuards = map[*ast.Node]*chainGuard{}
	}
	tx.chainGuards[link] = guard
	present := tx.visit(node)
	delete(tx.chainGuards, link)
	lowered := f.NewParenthesizedExpression(f.NewConditionalExpression(test, f.NewToken(ast.KindQuestionToken), f.NewVoidZeroExpression(), f.NewToken(ast.KindColonToken), present))
	ec.SetOriginal(lowered, node)
	return lowered
}

// visitGuardedLink lowers node, a ?. link that its chain's guard tested, as
// the same link without ?. on the value the guard holds.
func (tx *lowering) visitGuardedLink(node *ast.Node) *ast.Node {
	f := tx.Factory()
	guard := tx.chainGuards[node]
	flags := node.Flags &^ ast.NodeFlagsOptionalChain
	var lowered *ast.Node
	switch node.Kind {
	case ast.KindPropertyAccessExpression:
		lowered = f.NewPropertyAccessExpression(guard.base, nil /*questionDotToken*/, node.Name(), flags)
	case ast.KindElementAccessExpression:
		lowered = f.NewElementAccessExpression(guard.base, nil /*questionDotToken*/, tx.Visitor().VisitNode(node.AsElementAccessExpression().ArgumentExpression), flags)
	default:
		arguments := tx.Visitor().VisitNodes(node.ArgumentList()).Nodes
		switch {
		case tx.inEffect && tx.plan.trusted[node] != nil:
			run := f.NewYieldExpression(f.NewToken(ast.KindAsteriskToken), tx.runtimeCall("$trusted", tx.boundThunk(guard, arguments), tx.classArray(node)))
			tx.EmitContext().SetOriginal(run, node)
			return run
		case tx.inEffect && tx.plan.runsCall(node):
			lowered = f.NewYieldExpression(f.NewToken(ast.KindAsteriskToken), tx.invokeGuarded(guard.base, guard.receiver, arguments))
		default:
			lowered = tx.invokeGuarded(guard.base, guard.receiver, arguments)
		}
	}
	tx.EmitContext().SetOriginal(lowered, node)
	lowered.Loc = node.Loc
	return lowered
}

// invokeGuarded calls function with arguments: function.call(receiver, ...)
// keeps the receiver it was read from.
func (tx *lowering) invokeGuarded(function, receiver *ast.Node, arguments []*ast.Node) *ast.Node {
	f := tx.Factory()
	if receiver == nil {
		return f.NewCallExpression(function, nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList(arguments), ast.NodeFlagsNone)
	}
	call := f.NewPropertyAccessExpression(function, nil /*questionDotToken*/, f.NewIdentifier("call"), ast.NodeFlagsNone)
	return f.NewCallExpression(call, nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList(append([]*ast.Node{receiver}, arguments...)), ast.NodeFlagsNone)
}

// boundThunk returns the thunk of a guarded trusted call: it calls the
// function the guard read with its receiver. The guard's variables are
// passed in, so the thunk keeps their values; arguments that yield are
// evaluated before the thunk is made, as trustedThunk does.
func (tx *lowering) boundThunk(guard *chainGuard, arguments []*ast.Node) *ast.Node {
	f := tx.Factory()
	var parameters, values []*ast.Node
	pass := func(name string, value *ast.Node) *ast.Node {
		parameter := f.NewUniqueName(name)
		parameters = append(parameters, f.NewParameterDeclaration(nil /*modifiers*/, nil /*dotDotDotToken*/, parameter, nil /*questionToken*/, nil /*typeNode*/, nil /*initializer*/))
		values = append(values, value)
		return parameter
	}
	var receiver *ast.Node
	if guard.receiver != nil {
		receiver = pass("receiver", guard.receiver)
	}
	function := pass("method", guard.base)
	if slices.ContainsFunc(arguments, containsYield) {
		arguments = []*ast.Node{f.NewSpreadElement(pass("args", f.NewArrayLiteralExpression(f.NewNodeList(arguments), false /*multiLine*/)))}
	}
	thunk := tx.generated(tx.arrow(nil, tx.invokeGuarded(function, receiver, arguments)))
	outer := f.NewParenthesizedExpression(tx.generated(tx.arrow(parameters, thunk)))
	return f.NewCallExpression(outer, nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList(values), ast.NodeFlagsNone)
}
