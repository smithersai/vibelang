package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// The thunk retains the original constructor/tag expression, including its
// receiver, operands, and template-site identity. Unsupported operand movement
// and named failure contracts remain manual boundaries.
func planForeignInvocation(c *checker.Checker, file *ast.SourceFile, call *ast.Node) *formRewrite {
	fn := enclosingFunction(call)
	if fn == nil || !isMarkedEffect(fn) || inParameterListOf(call, fn) ||
		!needsBoundary(c, file, call) || readsNarrowedProperty(c, call) ||
		len(legacyForeignCallFailures(c, call)) != 0 {
		return nil
	}
	a := analyzerFor(c)
	if a.runsVibeLang(call) || holdsYield(call) {
		return nil
	}
	if foreignInvocationHasDirectEval(call) {
		return nil
	}
	return &formRewrite{
		edits:       keepThrowDefect(file, call),
		description: "the invocation through Effect.try, preserving native defects",
	}
}

// The thunk adds a function scope, which direct eval can observe.
func foreignInvocationHasDirectEval(call *ast.Node) bool {
	directEval := false
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isFunctionBoundary(node) {
			return false
		}
		if ast.IsCallExpression(node) {
			callee := ast.SkipParentheses(node.Expression())
			if ast.IsIdentifier(callee) && callee.Text() == "eval" {
				directEval = true
				return true
			}
		}
		return node.ForEachChild(visit)
	}
	visit(call)
	return directEval
}
