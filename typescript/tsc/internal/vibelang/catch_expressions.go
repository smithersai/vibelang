package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// A catch expression (D236-D239) is a call of the runtime's $catchExpression,
// which the parser writes with its callee anchored on the keyword:
//
//	getUser(id) catch guest               $catchExpression(() => getUser(id), () => guest)
//	getUser(id) catch (e) => describe(e)  $catchExpression(() => getUser(id), (e) => describe(e))
//
// The checker types it as that call, so its value is A | B and its failures
// are what the fallback or handler lets escape. This file reports one inside
// a hatch body (EK2114) and one whose left side cannot fail (EK9204), and
// tells a hover on the keyword what the expression does.

var (
	// EK2114: a catch expression inside a hatch body, which is plain TypeScript.
	EK2114 = message(2114, errorCategory, "A catch expression is VibeLang syntax, but a hatch body is plain TypeScript.")
	// deadCatchExpression is EK9204's text for a catch expression whose left
	// side cannot fail. {0} is the left side.
	deadCatchExpression = EK9204.With("{0} has no expected errors; defects pass through this catch.")
)

func init() {
	registry[EK2114.Code] = EK2114
	fileChecks = append(fileChecks, checkCatchExpressions)
	ls.RegisterQuickInfoHook(catchExpressionQuickInfo)
}

// catchExpressionOf returns call when it is a catch expression the parser
// wrote, or nil.
func catchExpressionOf(call *ast.Node) *ast.Node {
	if call == nil || !ast.IsCallExpression(call) || len(call.Arguments()) != 2 {
		return nil
	}
	callee := call.Expression()
	if callee.Kind != ast.KindIdentifier || callee.Flags&ast.NodeFlagsReparsed == 0 || callee.Text() != "$catchExpression" {
		return nil
	}
	return call
}

// catchParts returns a catch expression's left side and its fallback, or nil
// for the fallback when the expression has a handler, an arrow function the
// source wrote.
func catchParts(call *ast.Node) (left *ast.Node, fallback *ast.Node) {
	args := call.Arguments()
	left = args[0].Body()
	if args[1].Kind == ast.KindArrowFunction {
		if arrow := args[1].AsArrowFunction(); arrow.EqualsGreaterThanToken.Flags&ast.NodeFlagsReparsed != 0 {
			fallback = arrow.Body
		}
	}
	return left, fallback
}

// isCatchOperandProgram reports whether fn is the function the parser writes
// around a catch expression's left side, and that side is a program, not code
// that runs: a name or property that holds an Effect, a yieldable value such as
// an error included, or an effect block.
// e catch h runs e (VIP-5), so fn gives the program itself, which
// $catchExpression runs, where an Effect function would succeed with it. A
// call runs where it stands, so it stays code.
func (a *analyzer) isCatchOperandProgram(fn *ast.Node) bool {
	if !isProgramArrow(fn) {
		return false
	}
	call := catchExpressionOf(fn.Parent)
	if call == nil || call.Arguments()[0] != fn {
		return false
	}
	left := ast.SkipParentheses(fn.Body())
	if !ast.IsIdentifier(left) && !ast.IsPropertyAccessExpression(left) && !isEffectBlock(left) {
		return false
	}
	return effectOfValue(a.checker, a.checker.GetTypeAtLocation(left)) != nil
}

// caughtErrors returns what a catch expression's handler can receive: the
// failures of a program on its left side, or of the code that runs there.
func (a *analyzer) caughtErrors(call *ast.Node) *checker.Type {
	left, _ := catchParts(call)
	if a.isCatchOperandProgram(call.Arguments()[0]) {
		if program := effectOfValue(a.checker, a.checker.GetTypeAtLocation(ast.SkipParentheses(left))); program != nil {
			if errors := channelType(a.checker, program, "_E"); errors != nil {
				return errors
			}
		}
	}
	return a.checker.GetUnionType(a.flowOf(left).errors)
}

func checkCatchExpressions(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if call := catchExpressionOf(node); call != nil {
			keyword := scanner.GetRangeOfTokenAtPosition(file, call.Expression().Pos())
			if inHatch(call) {
				note(reportAt(c, file, keyword, EK2114), "Move the catch out of the hatch, or catch the error inside it with a try statement.")
				cover(c, call)
				return false
			}
			left, fallback := catchParts(call)
			if ast.NodeIsMissing(left) || fallback != nil && ast.NodeIsMissing(fallback) {
				return false // the parser already reports the missing operand
			}
			if inLowerableBody(call) && analyzerFor(c).caughtErrors(call).Flags()&checker.TypeFlagsNever != 0 {
				d := reportAt(c, file, keyword, deadCatchExpression, nodeText(file, left))
				note(d, "Use a form that can fail, such as Option.getOrElse or Schema.decodeUnknownEffect, or remove the catch.")
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// catchExpressionQuickInfo tells a hover on the catch keyword of a catch
// expression what it does: the Effect function it stands for, its value, and
// the failures that escape it. The keyword is a token of the call.
func catchExpressionQuickInfo(c *checker.Checker, node *ast.Node) (string, string) {
	if node == nil || node.Kind != ast.KindCatchKeyword {
		return "", ""
	}
	call := catchExpressionOf(node.Parent)
	if call == nil {
		return "", ""
	}
	_, fallback := catchParts(call)
	caught := analyzerFor(c).caughtErrors(call)
	paragraph := "Runs the left side and passes an expected failure, `" + c.TypeToStringEx(caught, call, hoverTypeFlags, nil) + "`, to the handler (Effect.catch)."
	if fallback != nil {
		paragraph = "Runs the left side and, after an expected failure (`" + c.TypeToStringEx(caught, call, hoverTypeFlags, nil) + "`), the fallback instead (Effect.orElseSucceed)."
	}
	paragraph += " Returns `" + c.TypeToStringEx(c.GetTypeAtLocation(call), call, hoverTypeFlags, nil) + "`. Defects and interrupts pass through."
	if signature := c.GetResolvedSignature(call); signature != nil {
		if errors := channelType(c, c.GetReturnTypeOfSignature(signature), "_E"); errors != nil && errors.Flags()&checker.TypeFlagsNever == 0 {
			paragraph += " Its failures propagate: `" + c.TypeToStringEx(errors, call, hoverTypeFlags, nil) + "`."
		}
	}
	return "catch", paragraph
}
