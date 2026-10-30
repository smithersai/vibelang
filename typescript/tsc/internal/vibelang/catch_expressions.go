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
			if inLowerableBody(call) && c.GetUnionType(analyzerFor(c).flowOf(left).errors).Flags()&checker.TypeFlagsNever != 0 {
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
	left, fallback := catchParts(call)
	caught := c.GetUnionType(analyzerFor(c).flowOf(left).errors)
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
