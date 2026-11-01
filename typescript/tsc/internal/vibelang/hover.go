package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// The language server's hooks register here rather than in vibelang.go,
// so editor features stay in this file and completions.go.
func init() {
	ls.RegisterQuickInfoHook(factoryQuickInfo)
	ls.RegisterQuickInfoHook(runningCallQuickInfo)
	ls.RegisterCompletionScopeHook(preludeCompletions)
	ls.RegisterMemberCompletionHook(serviceMemberCompletions)
}

const hoverTypeFlags = checker.TypeFormatFlagsUseAliasDefinedOutsideCurrentScope

// runningCallQuickInfo tells a hover on the callee of a call that runs what
// the call evaluates to: the success value of the Effect it runs. Hovering
// lookup in `const name = lookup(1)` shows lookup's contract, then
// "Runs here and returns `string`." A call that does not run, such as one
// in a .ts file, gets nothing.
func runningCallQuickInfo(c *checker.Checker, node *ast.Node) (string, string) {
	call := callOfCallee(node)
	if call == nil || !runsInLoweredBody(c, call) {
		return "", ""
	}
	signature := c.GetResolvedSignature(call)
	if signature == nil {
		return "", ""
	}
	success := successType(c, c.GetReturnTypeOfSignature(signature))
	if success == nil {
		return "", ""
	}
	returns := "`" + c.TypeToStringEx(success, call, hoverTypeFlags, nil) + "`"
	return "", "Runs here and returns " + returns + "."
}

// calleeText returns the source text of call's callee, such as fork or
// Effect.timeout, for a hover to name it.
func calleeText(call *ast.Node) string {
	callee := call.Expression()
	file := ast.GetSourceFileOfNode(callee)
	if file == nil {
		return "the callee"
	}
	return scanner.GetSourceTextOfNodeFromSourceFile(file, callee, false /*includeJsDoc*/)
}

// callOfCallee returns the call that node names the callee of: the call
// f(x) for f, and Console.log(x) for log. It returns nil for any other node.
func callOfCallee(node *ast.Node) *ast.Node {
	callee := node
	if parent := node.Parent; parent != nil && ast.IsPropertyAccessExpression(parent) && parent.Name() == node {
		callee = parent
	}
	if parent := callee.Parent; parent != nil && ast.IsCallExpression(parent) && parent.Expression() == callee {
		return parent
	}
	return nil
}

// runsInLoweredBody reports whether the lowering emits call as yield*: the
// function whose own body evaluates call is an Effect, and call runs an
// Effect. It asks the same questions as planFile.
func runsInLoweredBody(c *checker.Checker, call *ast.Node) bool {
	for n := call; n.Parent != nil; n = n.Parent {
		if fn := n.Parent; isFunctionBoundary(fn) {
			if n != fn.Body() || !isLowerable(fn) {
				return false
			}
			a := analyzerFor(c)
			return a.isEffect(fn) && a.runs(call)
		}
	}
	return false
}

// factoryQuickInfo describes D269's two distinct evaluation phases.
func factoryQuickInfo(c *checker.Checker, node *ast.Node) (string, string) {
	if !isVibeLangFile(ast.GetSourceFileOfNode(node)) {
		return "", ""
	}
	if call := callOfCallee(node); call != nil && holdsProgram(c, call) {
		return "", "Holds `" + calleeText(call) + "`'s program: called here, not run."
	}
	if ast.IsIdentifier(node) {
		if symbol := c.GetSymbolAtLocation(node); symbol != nil {
			if decl := symbol.ValueDeclaration(); decl != nil && ast.IsVariableDeclaration(decl) && decl.Initializer() != nil {
				init := ast.SkipOuterExpressions(decl.Initializer(), ast.OEKParentheses|ast.OEKAssertions)
				if ast.IsCallExpression(init) && holdsProgram(c, init) {
					return "", "Holds `" + calleeText(init) + "`'s program: called here, not run."
				}
			}
		}
	}
	return "", ""
}
