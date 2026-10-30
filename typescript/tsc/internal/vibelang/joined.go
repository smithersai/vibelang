package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// Two failures that leave plain code (D340). In a function that compiles to
// plain JavaScript, a for...of whose iterator's return() fails while a
// failure is in flight joins the two ($finallyFailure, closing.go), where a
// finally block keeps JavaScript's meaning and replaces it. A plain function
// never fails, so only defects leave it, and when the joined cause holds a
// defect the exception that leaves is a SuppressedError whose error is the
// cleanup's exception and whose suppressed is the pending one, as ECMA-262's
// DisposeResources reports two failures. The runtime records the cause it
// stands for and turns it back into that cause where it reaches an Effect
// frame, so the Exit is the frame lowering's (D341):
//
//	function both(...args) { return runtime.$plainSync(both$direct, this, args) }
//	function main() { return Effect.fnUntraced(runtime.$joinedFrame(function* main() { … both$direct() … })) }
//
// The Effect form of every plain function runs its plain form under
// $plainSync, and a generated frame that calls one that can throw it, or holds a
// plain for...of, is wrapped in $joinedFrame (joinFrames). A
// TypeScript caller of a plain function sees the SuppressedError itself.

// joinsFailures reports whether a call of fn, a .vibe function that compiles
// to plain JavaScript, can throw a SuppressedError the runtime made: fn, or a
// .vibe function that compiles to plain JavaScript and that fn calls,
// directly or through others, has a for...of, whose iterator close joins
// failures (closing.go).
// Nested functions count, since a plain callback's exception passes through
// whatever calls it.
func (a *analyzer) joinsFailures(fn *ast.Node) bool {
	memo := a.checker.ExtensionState(joinsKey{}, func() any { return map[*ast.Node]bool{} }).(map[*ast.Node]bool)
	if joins, ok := memo[fn]; ok {
		return joins
	}
	seen := map[*ast.Node]bool{}
	stack := []*ast.Node{fn}
	joins := false
	for len(stack) > 0 && !joins {
		next := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if next == nil || seen[next] || !a.compilesToPlain(next) {
			continue
		}
		seen[next] = true
		var visit func(n *ast.Node) bool
		visit = func(n *ast.Node) bool {
			switch {
			case n.Kind == ast.KindForOfStatement:
				joins = true
				return true
			case ast.IsCallExpression(n):
				stack = append(stack, esFunctionOf(a.checker, ast.GetInvokedExpression(n)))
			}
			return n.ForEachChild(visit)
		}
		visit(next.Body())
	}
	memo[fn] = joins
	return joins
}

// joinsKey keys the checker's memo of joinsFailures.
type joinsKey struct{}

// joinPlan records the calls of one file whose SuppressedError an Effect
// frame turns back into a cause.
type joinPlan struct {
	joinedCalls map[*ast.Node]bool // calls of .vibe functions that compile to plain JavaScript and can throw one
}

// planJoins records node in p when it is a call that joinsFailures says can
// throw a SuppressedError the runtime made.
func (p *joinPlan) planJoins(a *analyzer, node *ast.Node) {
	if p.joinedCalls == nil {
		p.joinedCalls = map[*ast.Node]bool{}
	}
	if a.callJoinsFailures(node) {
		p.joinedCalls[node] = true
	}
}

// compilesToPlain reports whether fn, a function, is a .vibe function that
// compiles to plain JavaScript: a plain function, or an Effect function with
// a plain variant (D421).
func (a *analyzer) compilesToPlain(fn *ast.Node) bool {
	return isLowerable(fn) && (!a.isEffect(fn) || a.isSplittable(fn) && a.isPlainFunction(fn))
}

// callJoinsFailures reports whether call calls a .vibe function that
// compiles to plain JavaScript and whose call can throw a SuppressedError the
// runtime made.
func (a *analyzer) callJoinsFailures(call *ast.Node) bool {
	if !ast.IsCallExpression(call) || !isVibeLangFile(ast.GetSourceFileOfNode(call)) {
		return false
	}
	fn := esFunctionOf(a.checker, ast.GetInvokedExpression(call))
	return fn != nil && a.joinsFailures(fn)
}

// joinFrames wraps in runtime.$joinedFrame each generated frame, the
// generator an Effect.gen, Effect.fnUntraced or Effect.fn call runs, whose
// body can receive a SuppressedError the runtime made: one that calls a .vibe
// function that can throw it, or that holds a plain for...of, whose
// $finallyFailure makes it. A nested generator is a frame of its own;
// a nested plain function is not, since its exception passes through the
// frame that calls it.
func (tx *lowering) joinFrames(node *ast.Node) *ast.Node {
	if len(tx.plan.joinedCalls) == 0 && tx.runtime == nil {
		return node
	}
	ec := tx.EmitContext()
	var receives func(n *ast.Node) bool
	receives = func(n *ast.Node) bool {
		if (ast.IsFunctionExpression(n) || ast.IsFunctionDeclaration(n) || ast.IsMethodDeclaration(n)) && ast.GetFunctionFlags(n)&ast.FunctionFlagsGenerator != 0 {
			return false
		}
		if ast.IsCallExpression(n) {
			callee := n.Expression()
			if ast.IsPropertyAccessExpression(callee) && callee.Expression() == tx.runtime && callee.Name().Text() == "$finallyFailure" {
				return true
			}
			// A by-name program's Effect.gen stands for the call it runs,
			// which the program's own frame makes.
			if !tx.isFrameCall(n) && tx.plan.joinedCalls[ec.MostOriginal(n)] {
				return true
			}
		}
		return n.ForEachChild(receives)
	}
	visitor := ec.NewNodeVisitor(nil)
	visitor.Visit = func(node *ast.Node) *ast.Node {
		node = visitor.VisitEachChild(node)
		if !tx.isFrameCall(node) {
			return node
		}
		call := node.AsCallExpression()
		arguments := append([]*ast.Node(nil), call.Arguments.Nodes...)
		changed := false
		for i, argument := range arguments {
			if body := iteratorGeneratorBody(argument); body != nil && body.ForEachChild(receives) {
				arguments[i] = tx.runtimeCall("$joinedFrame", argument)
				changed = true
			}
		}
		if !changed {
			return node
		}
		return tx.Factory().UpdateCallExpression(call, call.Expression, call.QuestionDotToken, call.TypeArguments, tx.Factory().NewNodeList(arguments), node.Flags)
	}
	return visitor.VisitNode(node)
}

// isFrameCall reports whether node is a call that makes a generated frame:
// Effect.gen, Effect.fnUntraced, or Effect.fn, whose traced form is
// Effect.fn("span")(generator).
func (tx *lowering) isFrameCall(node *ast.Node) bool {
	if !ast.IsCallExpression(node) || tx.effect == nil {
		return false
	}
	callee := node.Expression()
	if ast.IsCallExpression(callee) {
		callee = callee.Expression()
	}
	if !ast.IsPropertyAccessExpression(callee) || callee.Expression() != tx.effect {
		return false
	}
	switch callee.Name().Text() {
	case "gen", "fnUntraced", "fn":
		return true
	}
	return false
}
