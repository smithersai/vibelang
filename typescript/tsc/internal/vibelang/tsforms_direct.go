package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// EK4834 (D288): Effect.succeed and Effect.fail where the call runs. In a
// VibeLang function a call runs where it stands (D147), so running
// Effect.succeed(x) produces x, and running Effect.fail(e) fails as
// throw e does (D46):
//
//	return Effect.succeed(user)      return user
//	return Effect.fail(new Gone())   throw new Gone()
//	() => Effect.fail(error)         () => throw error
//
// Only a call that runs in a VibeLang function body counts: a call passed by
// name, held by a declared Effect type, or in a hatch builds a program, which
// the value would not. The fix of Effect.succeed(x) writes x where a value
// stands: a return, an initializer, an argument, an element or a field, an
// arrow function's body, a branch of ?:, and the right side of ??, ||, or &&;
// it refuses x that is itself an Effect, because the value would then be a
// program the function returns rather than one it holds as data. The fix of
// Effect.fail(e) writes a throw statement for a statement or a return, and a
// throw expression (D186) for an arrow function's body, a branch of ?:, and
// the right side of ??, ||, or &&. Calls with type arguments are
// refused: the value alone would not carry them.

// directFailMessage is EK4834's text for Effect.fail.
var directFailMessage = EK4834.With("{0} runs here, so it fails the function as a throw does: {1}.")

func init() {
	tsFormRules[EK4834.Code] = &tsFormRule{
		message:   EK4834,
		find:      findDirectForms,
		plan:      directFormRewrite,
		diagnosed: ast.IsCallExpression,
	}
}

// directFormCall reports whether call is Effect.succeed or Effect.fail of
// one argument that runs in a VibeLang function body, and returns which.
func directFormCall(c *checker.Checker, call *ast.Node) string {
	if !ast.IsCallExpression(call) || call.TypeArguments() != nil || len(call.Arguments()) != 1 || ast.IsSpreadElement(call.Arguments()[0]) || ast.IsOptionalChain(call) {
		return ""
	}
	if !isEffectFunction(c, call.Expression(), "Effect", "succeed", "fail") || !inLowerableBody(call) || inHatch(call) {
		return ""
	}
	_, name := effectMember(c, call.Expression())
	if a := analyzerFor(c); !a.runs(call) || a.isByName(call) {
		return "" // a program passed by name stays a program (D147)
	}
	return name
}

// findDirectForms reports EK4834 at each such call of file that has a direct
// form.
func findDirectForms(c *checker.Checker, file *ast.SourceFile, report func(at *ast.Node, rewrite *formRewrite, args ...any)) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsCallExpression(node) && directFormCall(c, node) != "" {
			if rewrite := directFormRewrite(c, file, node); rewrite.fixable() {
				report(node, rewrite, expressionText(file, node.Expression())+"(…)", rewrite.description)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// directPosition is where a call stands, for its direct form.
type directPosition uint8

const (
	positionOther      directPosition = iota
	positionStatement                 // an expression statement
	positionReturn                    // a return statement's expression
	positionArrowBody                 // an arrow function's expression body
	positionRightValue                // a branch of ?:, or the right side of ??, ||, or &&
	positionValue                     // an initializer, an argument, an element, a field, or a template's span
)

// directPositionOf returns where call stands. A position in a form the
// parser wrote, such as the left side of a catch expression, is no position
// a value or a throw can be written in.
func directPositionOf(call *ast.Node) directPosition {
	parent := call.Parent
	if isSynthesizedPosition(parent) {
		return positionOther
	}
	switch {
	case ast.IsExpressionStatement(parent):
		return positionStatement
	case ast.IsReturnStatement(parent):
		return positionReturn
	case ast.IsArrowFunction(parent) && parent.Body() == call:
		return positionArrowBody
	case ast.IsConditionalExpression(parent) && parent.AsConditionalExpression().Condition != call:
		return positionRightValue
	case ast.IsBinaryExpression(parent) && parent.AsBinaryExpression().Right == call:
		switch parent.AsBinaryExpression().OperatorToken.Kind {
		case ast.KindQuestionQuestionToken, ast.KindBarBarToken, ast.KindAmpersandAmpersandToken:
			return positionRightValue
		}
	case ast.IsVariableDeclaration(parent) && parent.Initializer() == call,
		ast.IsPropertyAssignment(parent) && parent.Initializer() == call,
		ast.IsCallExpression(parent) && parent.Expression() != call,
		ast.IsArrayLiteralExpression(parent), ast.IsTemplateSpan(parent), ast.IsParenthesizedExpression(parent):
		return positionValue
	}
	return positionOther
}

// directFormRewrite plans EK4834's fix for call.
func directFormRewrite(c *checker.Checker, file *ast.SourceFile, call *ast.Node) *formRewrite {
	name := directFormCall(c, call)
	if name == "" {
		return nil
	}
	argument := call.Arguments()[0]
	argumentText := expressionText(file, argument)
	if argument.Pos() >= 0 && argument.Pos() <= nodeStart(file, argument) && strings.TrimSpace(file.Text()[argument.Pos():nodeStart(file, argument)]) != "" {
		// Parentheses retain leading line comments without introducing an
		// automatic-semicolon boundary after return or throw.
		argumentText = "(" + file.Text()[argument.Pos():argument.End()] + ")"
	}
	position := directPositionOf(call)
	start, end := nodeStart(file, call), call.End()
	var text string
	switch name {
	case "succeed":
		t := c.GetTypeAtLocation(argument)
		if isEffectType(c, t) || isEffectValueType(c, t) || !keepsEffectForm(c, call) {
			return nil
		}
		text = argumentText
		switch position {
		case positionStatement, positionOther:
			return nil
		case positionArrowBody:
			if strings.HasPrefix(text, "{") || isCommaExpression(argument) {
				text = "(" + text + ")" // a { would start the arrow function's block
			}
		case positionRightValue:
			if isLowPrecedence(argument) {
				text = "(" + text + ")"
			}
		case positionValue, positionReturn:
			if isCommaExpression(argument) {
				text = "(" + text + ")"
			}
		}
	case "fail":
		operand := argumentText
		switch position {
		case positionStatement:
			text = "throw " + operand
		case positionReturn:
			start = nodeStart(file, call.Parent)
			text = "throw " + operand
			end = call.End()
		case positionArrowBody, positionRightValue:
			if needsOperandParentheses(argument) {
				operand = "(" + operand + ")"
			}
			text = "throw " + operand
		default:
			return nil
		}
	}
	rewrite := withImportRemovals(c, file, &formRewrite{edits: []sourceEdit{{start, end, text}}, description: shortText(text, core.IfElse(name == "fail", "a throw", "its argument alone"))})
	if name == "fail" {
		rewrite.message = directFailMessage
	}
	return rewrite
}

// keepsEffectForm reports whether the function around call stays an Effect
// function without call, which running Effect.succeed makes one: its form
// does not depend on its body, as for a function with an Effect contract, a
// declaration that D10 compiles with its Effect form beside it, or a lambda
// or method whose expected type asks for an Effect function or a program; or
// its body performs another Effect operation that the fixes keep. Otherwise
// removing the call could turn a lambda that returns an Effect into a plain
// function that returns the value, which its callers would see.
func keepsEffectForm(c *checker.Checker, call *ast.Node) bool {
	fn := ast.GetContainingFunction(call)
	if fn == nil || !isLowerable(fn) {
		return false
	}
	a := analyzerFor(c)
	if a.hasContract(fn) || a.isSplittable(fn) {
		return true
	}
	if ast.IsMethodDeclaration(fn) && a.expectsEffect(fn) {
		return true
	}
	if isLambda(fn) {
		if e := a.classify(a.contextualTypes(fn)); e.effectFn && !e.plainFn || e.program && !e.plainFn && !e.effectFn {
			return true
		}
	}
	if hasEscapingThrow(fn) || declaresUsing(fn) || hasVibeLangStatement(fn) {
		return true
	}
	return a.forEachRunningCallInBody(fn, func(other *ast.Node) bool {
		return other != call && a.performs(other) && directFormCall(c, other) != "succeed"
	})
}

// isLowPrecedence reports whether expression binds more loosely than the
// operands of a binary or conditional expression: a conditional, an arrow
// function, an assignment, a comma, a yield, or a binary expression.
func isLowPrecedence(expression *ast.Node) bool {
	switch ast.SkipParentheses(expression).Kind {
	case ast.KindConditionalExpression, ast.KindArrowFunction, ast.KindYieldExpression, ast.KindBinaryExpression:
		return expression.Kind != ast.KindParenthesizedExpression
	}
	return false
}

// isCommaExpression reports whether expression is a comma expression, which
// needs parentheses wherever one expression stands.
func isCommaExpression(expression *ast.Node) bool {
	return ast.IsBinaryExpression(expression) && expression.AsBinaryExpression().OperatorToken.Kind == ast.KindCommaToken
}
