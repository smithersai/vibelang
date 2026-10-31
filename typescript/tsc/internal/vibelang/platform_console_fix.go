package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// EK4402's quick fix for console in effect code (D6, Chapter 11). Effect's
// Console is a default service: it needs no layer, writes to the same
// console, and adds no failure or requirement to a contract, so in effect
// code
//
//	console.error("failed:", name)      try Console.error("failed:", name)
//
// prints what it printed, and the function's type, and so its declaration,
// stays as it was. The fix stands at a console call that is a statement of
// effect code. Elsewhere EK4402 says why there is none, in a note that starts
// "No quick fix:": in plain code try runs nothing, and the migrate flow moves
// such code to TypeScript. vibelang --fix applies it.

// consoleMethods are console's output methods that Console has under the
// same name and arguments.
var consoleMethods = map[string]bool{"log": true, "error": true, "warn": true, "info": true, "debug": true, "table": true, "trace": true}

func init() {
	tsFormFixCodes = append(tsFormFixCodes, EK4402.Code)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK4402.Code}, GetCodeActions: consoleServiceFix})
}

// consoleCall returns the call that use, console.method as EK4402 reports
// it, makes, and the method, when use is such a call of a method Console
// has; or nil.
func consoleCall(use *ast.Node) (*ast.Node, string) {
	if use == nil || !ast.IsPropertyAccessExpression(use) {
		return nil, ""
	}
	object, name := use.Expression(), use.AsPropertyAccessExpression().Name()
	if !ast.IsIdentifier(object) || object.Text() != "console" || !consoleMethods[name.Text()] {
		return nil, ""
	}
	call := use.Parent
	if call == nil || !ast.IsCallExpression(call) || call.Expression() != use {
		return nil, ""
	}
	return call, name.Text()
}

// consoleFixRefusal returns why the Console fix does not stand at call, a
// console call, or "" when it does.
func consoleFixRefusal(c *checker.Checker, call *ast.Node, method string) string {
	if call.Parent == nil || !ast.IsExpressionStatement(call.Parent) || !inLowerableBody(call.Parent) {
		return "the call's value is used here; write try Console." + method + "(…) as its own statement of effect code."
	}
	if !inEffectCode(analyzerFor(c), call) {
		return "this is plain code, where try runs nothing: call Console from effect code, or keep the call in TypeScript."
	}
	return ""
}

func consoleServiceFix(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	use := reportedNode(fix.SourceFile, fix.Span, ast.IsPropertyAccessExpression)
	call, method := consoleCall(use)
	if call == nil {
		return nil, nil
	}
	c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
	refused := consoleFixRefusal(c, call, method)
	done()
	if refused != "" {
		return nil, nil
	}
	return []*ls.CodeAction{{
		Description: "Write it with Effect's Console",
		Changes:     replaceRange(fix, nodeStart(fix.SourceFile, use), use.End(), "try Console."+method),
	}}, nil
}
