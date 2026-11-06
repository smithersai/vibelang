package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// EK1705 is reported by the parser (parser.ForkOwnerMessage, VIP-17).
var EK1705 = message(1705, errorCategory, parser.ForkOwnerMessage)

// EK1706: a fork.in scope operand that is not a Scope. {0} is the operand, {1} its type.
var EK1706 = message(1706, errorCategory, "fork.in takes the Scope that owns the fiber, but {0} is {1}.")

func init() {
	registry[EK1705.Code] = EK1705
	registry[EK1706.Code] = EK1706
}

// isForkOwner reports whether call is fork.in(scope) e, fork.scoped e or
// fork.detached e, which the parser writes as calls of the runtime's helpers.
func isForkOwner(call *ast.Node) bool {
	switch fiberHelper(call) {
	case "$forkIn", "$forkScoped", "$forkDetach":
		return true
	}
	return false
}

// forkScopeRejected reports whether scope is not assignable to fork.in's
// Scope parameter, as Effect.forkIn requires (VIP-17, EK1706).
func forkScopeRejected(c *checker.Checker, call, scope *ast.Node) bool {
	signature := c.GetResolvedSignature(call)
	if signature == nil || len(signature.Parameters()) != 2 {
		return false
	}
	t := c.GetTypeAtLocation(scope)
	return t != nil && !c.IsTypeAssignableTo(t, c.GetTypeOfSymbol(signature.Parameters()[0]))
}

// forkOwnerRejected reports whether EK1703 or EK1706 owns a generated call's
// argument error.
func forkOwnerRejected(c *checker.Checker, call *ast.Node) bool {
	arguments := call.Arguments()
	if forkOperandRejected(c, arguments[len(arguments)-1]) {
		return true
	}
	return len(arguments) == 2 && forkScopeRejected(c, call, arguments[0])
}

// checkForkOwner reports EK1703 at an owner form's operand and EK1706 at
// fork.in's scope.
func checkForkOwner(c *checker.Checker, file *ast.SourceFile, call *ast.Node) {
	arguments := call.Arguments()
	checkForkOperand(c, file, arguments[len(arguments)-1])
	if len(arguments) == 2 && forkScopeRejected(c, call, arguments[0]) {
		scope := arguments[0]
		text := shortText(nodeText(file, ast.SkipParentheses(scope)), "this operand")
		reportAt(c, file, core.NewTextRange(nodeStart(file, scope), scope.End()), EK1706, text, c.TypeToString(c.GetTypeAtLocation(scope)))
	}
}

// forkOwnerCall writes Effect's own operation, so the new fiber's allocator is
// the project's. Effect.forkIn's data-last form evaluates the scope first, in
// source order.
func (tx *lowering) forkOwnerCall(node *ast.Node) *ast.Node {
	f := tx.Factory()
	arguments := tx.Visitor().VisitNodes(node.ArgumentList()).Nodes
	name := map[string]string{"$forkIn": "forkIn", "$forkScoped": "forkScoped", "$forkDetach": "forkDetach"}[fiberHelper(node)]
	callee := f.NewPropertyAccessExpression(tx.effectName(), nil, f.NewIdentifier(name), ast.NodeFlagsNone)
	if len(arguments) == 2 {
		owner := f.NewCallExpression(callee, nil, nil, f.NewNodeList(arguments[:1]), ast.NodeFlagsNone)
		return f.NewCallExpression(owner, nil, nil, f.NewNodeList(arguments[1:]), ast.NodeFlagsNone)
	}
	return f.NewCallExpression(callee, nil, nil, f.NewNodeList(arguments), ast.NodeFlagsNone)
}
