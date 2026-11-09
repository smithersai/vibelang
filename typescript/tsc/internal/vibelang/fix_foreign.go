package vibelang

import (
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// EK0403's (and legacy EK4401's) quick fix writes a call of a plain TypeScript function that nothing
// says the exceptions of, keeping what TypeScript meant by it. A migration
// meets one wherever a .vibe module calls a .ts one (VIP-4: a foreign callable
// throws unknown unless annotated).
//
// EK0403 uses the same planner for a written foreign throws contract. Its
// bridge preserves the former emitter's listed failures and other defects.
//
// In Effect TypeScript an exception such a call throws in a generator is a
// defect, with the value that was thrown, and adds nothing to E. So in effect
// code the call goes through Effect's own wrapper, which is what VIP-4 requires,
// and Effect.orDie keeps the exception a defect and the declaration as it was:
//
//	const kind = Dialect.integer(sql)
//	const kind = try Effect.orDie(Effect.try({ try: () => Dialect.integer(sql), catch: (e) => e }))
//
// Listing the function in trustedPackages or in trusted(impl, []) would say the
// same to the compiler, but on no evidence: trust is a claim about the code,
// for someone who read it, and its reach is every later call. An operand that
// runs an Effect moves to a const before the statement, when that keeps the
// order of what runs: the wrapper's function is plain.
//
// A function with no Effect operation is plain in TypeScript, and its calls are
// JavaScript calls, which VIP-4 allows when nothing says they throw. Without a
// return annotation it would compile to an Effect (D500), so it gets : infer _,
// which keeps its type. A call whose @throws says it may throw, a class this
// file can't reach included, can't stay in plain code (EK0401: synchronous
// VibeLang code never throws), so its function becomes effect code and the
// call goes through Effect.try like the others. A call that returns a Promise has no such fix: it is
// a value in the generator, and tryPromise would wait for it.
//
// The wrapper's function also loses what control flow proved about a property:
// in `o.p ? f(o.p) : 0`, o.p is a string outside the function and possibly
// undefined inside it. A guard in the same expression moves into the function
// with the call. A guard in an earlier statement keeps its proof in a const
// before the statement, when nothing runs before the read.

// branchStatement returns the statement that holds node when it is the
// unbraced branch of an if, as in if (o.p) f(o.p), or nil.
func branchStatement(node *ast.Node) *ast.Node {
	for n := node; n.Parent != nil && !ast.IsFunctionLike(n); n = n.Parent {
		if ast.IsStatement(n) {
			if ast.IsIfStatement(n.Parent) && n != n.Parent.Expression() && !ast.IsBlock(n) {
				return n
			}
			return nil
		}
	}
	return nil
}

// branchIndentUnit returns one more level of indent after outer: a tab where outer
// uses tabs, else two spaces.
func branchIndentUnit(outer string) string {
	if strings.Contains(outer, "\t") {
		return "\t"
	}
	return "  "
}

// outermostGuardedExpression returns the outermost conditional or logical
// expression around node in its statement, or nil.
func outermostGuardedExpression(node *ast.Node) *ast.Node {
	var guard *ast.Node
	for n := node.Parent; n != nil && !ast.IsStatement(n) && !ast.IsFunctionLike(n); n = n.Parent {
		if ast.IsConditionalExpression(n) || ast.IsBinaryExpression(n) && ast.IsLogicalOrCoalescingBinaryOperator(n.AsBinaryExpression().OperatorToken.Kind) {
			guard = n
		}
	}
	return guard
}

// readsNarrowedProperty reports whether node reads, outside the functions it
// defines, a property whose declared type is wider than its type there: what a
// function written around the read would not know.
func readsNarrowedProperty(c *checker.Checker, node *ast.Node) bool {
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isFunctionBoundary(n) {
			return false
		}
		if ast.IsPropertyAccessExpression(n) {
			if symbol := c.GetSymbolAtLocation(n.Name()); symbol != nil && symbol.Flags()&(ast.SymbolFlagsProperty|ast.SymbolFlagsAccessor) != 0 {
				if here, declared := c.GetTypeAtLocation(n), c.GetTypeOfSymbol(symbol); here != nil && declared != nil && !c.IsTypeAssignableTo(declared, here) {
					return true
				}
			}
		}
		return n.ForEachChild(visit)
	}
	return visit(node)
}

// runsBefore reports whether statement makes a call before it reaches node.
func runsBefore(statement, node *ast.Node) bool {
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if n.End() <= node.Pos() && isInvocation(n) {
			return true
		}
		if n.Pos() >= node.Pos() || isFunctionBoundary(n) {
			return false
		}
		return n.ForEachChild(visit)
	}
	return statement.ForEachChild(visit)
}

// needsBoundary reports synchronous foreign calls needing a bridge, including
// written non-never throws contracts and unannotated calls.
func needsBoundary(c *checker.Checker, file *ast.SourceFile, call *ast.Node) bool {
	t := callTrust(c, call)
	if bound, written := foreignThrowsContract(c, call); written && bound != "" && !t.value && !t.promise && !returnsEffectful(c, call) {
		return true
	}
	if t.kind == trustBuiltin && len(t.failures) > 0 {
		return true
	}
	if !t.promise && !returnsEffectful(c, call) && len(knownRethrownTypes(c, call)) > 0 {
		return true
	}
	switch {
	case t.promise, returnsEffectful(c, call):
		return false
	case t.kind == trustForeign || t.kind == trustUnknown:
		return true
	case t.kind != trustTagged:
		return false
	case t.unreachable != "":
		return true
	}
	return slices.ContainsFunc(t.failures, func(f failure) bool {
		_, _, ok := reachClass(c, file, f)
		return !ok
	})
}

// returnTypePosition is where fn's return annotation goes: after the
// parenthesis that closes its parameters, or -1 for an arrow with a bare
// parameter, which has none.
func returnTypePosition(file *ast.SourceFile, fn *ast.Node) int {
	text := file.Text()
	end := nodeStart(file, fn)
	if parameters := fn.Parameters(); len(parameters) > 0 {
		end = parameters[len(parameters)-1].End()
	} else if tp := fn.TypeParameters(); tp != nil && len(tp) > 0 {
		end = tp[len(tp)-1].End()
	}
	at := strings.IndexByte(text[end:], ')')
	if at < 0 || at >= nodeStart(file, fn.Body())-end {
		return -1
	}
	return end + at + 1
}

// enclosingStatement returns the statement of a block that holds node, within
// node's function, or nil.
func enclosingStatement(node *ast.Node) *ast.Node {
	for n := node; n.Parent != nil; n = n.Parent {
		if ast.IsFunctionLike(n) {
			return nil
		}
		if ast.IsStatement(n) && ast.IsBlock(n.Parent) {
			return n
		}
	}
	return nil
}

// runsOutOfOrder reports whether moving inputs of call before statement would
// change what runs: call stands in a branch or a callback, or something that
// runs comes first in statement.
func (a *analyzer) runsOutOfOrder(statement, call *ast.Node, inputs []boundaryInput) bool {
	switch {
	case ast.IsIfStatement(statement), ast.IsSwitchStatement(statement):
		if !ast.IsNodeDescendantOf(call, statement.Expression()) {
			return true // a branch runs only sometimes
		}
	case !ast.IsVariableStatement(statement) && !ast.IsExpressionStatement(statement) && !ast.IsReturnStatement(statement) && !ast.IsThrowStatement(statement):
		return true // a loop runs its head each time; the const would run once
	}
	for n := call.Parent; n != statement; n = n.Parent {
		switch {
		case ast.IsConditionalExpression(n), ast.IsFunctionLike(n):
			return true
		case ast.IsBinaryExpression(n) && ast.IsLogicalOrCoalescingBinaryOperator(n.AsBinaryExpression().OperatorToken.Kind):
			return true
		}
	}
	first := inputs[0].node.Pos()
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if n.Pos() >= first || isFunctionBoundary(n) {
			return false
		}
		if n.End() <= first && a.runsVibeLang(n) {
			return true
		}
		return n.ForEachChild(visit)
	}
	return statement.ForEachChild(visit)
}

// standsAlone reports whether a try can replace node with no parentheses:
// not as an operand or a receiver.
func standsAlone(node *ast.Node) bool {
	parent := node.Parent
	switch {
	case ast.IsExpressionWithTypeArguments(parent):
		return false // a class heritage expression needs a parenthesized try
	case ast.IsPropertyAccessExpression(parent), ast.IsElementAccessExpression(parent), ast.IsCallExpression(parent), ast.IsNonNullExpression(parent):
		return parent.Expression() != node
	case ast.IsConditionalExpression(parent):
		return parent.AsConditionalExpression().Condition != node
	case ast.IsBinaryExpression(parent), ast.IsPrefixUnaryExpression(parent), ast.IsPostfixUnaryExpression(parent), ast.IsAsExpression(parent), ast.IsSatisfiesExpression(parent),
		ast.IsAwaitExpression(parent), ast.IsTypeOfExpression(parent), ast.IsVoidExpression(parent), ast.IsDeleteExpression(parent), ast.IsTaggedTemplateExpression(parent):
		return false
	}
	return true
}
