package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const VibeLangCatchPrecedenceCode int32 = 512
const VibeLangCatchPrecedenceMessage = "A catch expression cannot mix with ??, || or && without parentheses, or attach an operator, member access or call to a closed handler. Parenthesize the intended expression."

func (p *Parser) reportVibeLangCatchPrecedence(span core.TextRange) {
	p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, span, "EK", diagnostics.CategoryError, VibeLangCatchPrecedenceCode, VibeLangCatchPrecedenceMessage))
	p.hasParseError = true
}

// CatchHead is BitwiseORExpression or another closed catch (VIP-5). Stop
// at parentheses and expression boundaries; a logical expression in an
// argument, computed property, or handler body is not part of the head.
func vibeLangCatchMixedHead(node *ast.Node) bool {
	if ast.IsBinaryExpression(node) {
		binary := node.AsBinaryExpression()
		switch binary.OperatorToken.Kind {
		case ast.KindQuestionQuestionToken, ast.KindBarBarToken, ast.KindAmpersandAmpersandToken:
			return true
		}
		return vibeLangCatchMixedHead(binary.Left) || vibeLangCatchMixedHead(binary.Right)
	}
	if ast.IsAsExpression(node) || ast.IsSatisfiesExpression(node) {
		return vibeLangCatchMixedHead(node.Expression())
	}
	return false
}

// IsVibeLangCatchHandlerContinuation identifies the legacy recovery tree for
// a continuation attached to a function-expression handler. It also lets the
// checker avoid a second, less specific EK0509 for the same grammar error.
// Parentheses around the whole value do not make it a function literal;
// parentheses around just the function still leave its suffix forbidden.
func IsVibeLangCatchHandlerContinuation(node *ast.Node) bool {
	if node == nil || ast.IsFunctionExpression(node) || ast.IsParenthesizedExpression(node) {
		return false
	}
	var startsInHandler func(*ast.Node) bool
	startsInHandler = func(n *ast.Node) bool {
		switch {
		case ast.IsFunctionExpression(n), ast.IsArrowFunction(n):
			return !isSynthesizedArrow(n) && ast.GetFunctionFlags(n)&(ast.FunctionFlagsAsync|ast.FunctionFlagsGenerator) == 0
		case ast.IsParenthesizedExpression(n):
			inner := ast.SkipParentheses(n)
			return (ast.IsFunctionExpression(inner) || ast.IsArrowFunction(inner)) &&
				startsInHandler(inner)
		case ast.IsBinaryExpression(n):
			return startsInHandler(n.AsBinaryExpression().Left)
		case n.Kind == ast.KindTaggedTemplateExpression:
			return startsInHandler(n.AsTaggedTemplateExpression().Tag)
		case ast.IsCallExpression(n), ast.IsPropertyAccessExpression(n), ast.IsElementAccessExpression(n),
			ast.IsNonNullExpression(n), ast.IsAsExpression(n), ast.IsSatisfiesExpression(n),
			n.Kind == ast.KindExpressionWithTypeArguments:
			return startsInHandler(n.Expression())
		}
		return false
	}
	return startsInHandler(node)
}
