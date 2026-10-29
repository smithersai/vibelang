package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// `try e` runs the Effect e where it stands and gives its success value
// (VIP-5). Before a call, `try f()` parses as the call f() itself, flagged
// NodeFlagsVibeLangTry, its range widened to start where try's leading
// trivia does, so the call keeps its leading comments and try is its first
// token; the checker, the analyzer, and the lowering see the call they see
// without try, and vibelang/try.go accepts the try where the call runs.
// Parentheses that hold only such a call before a member access, a call, a
// template, or !, as in (try f()).x, parse as f().x (triedChainOperand).
// Before any other operand, `try p` parses as $try(p), a call of the
// runtime's identity on Effects, which the lowering writes as yield* p.
//
//	const user = try fetchUser(id)    const user = fetchUser(id), flagged
//	const n = try program             const n = $try(program)
//
// Its operand binds as await's does: try f().name runs f().name, so a
// member of the result is (try f()).name. A try statement starts with a
// block, so try followed on the same line by anything else is the operator.

// isStartOfVibeLangTry reports whether the current token, try, starts a try
// expression: in a .vibe file, try followed on the same line by a token other
// than {.
func (p *Parser) isStartOfVibeLangTry() bool {
	return p.token == ast.KindTryKeyword && p.isVibeLangFile() && (p.isVibeLangTryOperation() || p.lookAhead((*Parser).nextTokenStartsTryOperand))
}

func (p *Parser) nextTokenStartsTryOperand() bool {
	p.nextToken()
	return !p.hasPrecedingLineBreak() && p.token != ast.KindOpenBraceToken && p.isStartOfExpression()
}

// parseVibeLangTry parses `try operand`.
func (p *Parser) parseVibeLangTry() *ast.Node {
	if p.isVibeLangTryOperation() {
		return p.parseVibeLangTryOperation()
	}
	pos := p.nodePos()
	anchor := p.tokenRange()
	p.nextToken() // try
	operand := p.parseSimpleUnaryExpression()
	p.recordVibeSyntax(VibeSyntax{Kind: VibeSyntaxPrefix, Word: anchor, Range: core.NewTextRange(anchor.Pos(), operand.End())})
	if inner := ast.SkipParentheses(operand); ast.IsCallExpression(inner) || ast.IsTaggedTemplateExpression(inner) {
		operand.Flags |= ast.NodeFlagsVibeLangTry
		operand.Loc = core.NewTextRange(pos, operand.End())
		return operand
	}
	callee := p.vibelangIntrinsic("$try", anchor)
	return p.finishNode(p.factory.NewCallExpression(callee, nil, nil, p.newNodeList(operand.Loc, []*ast.Node{operand}), ast.NodeFlagsNone), pos)
}

// triedChainOperand returns expression, or, when it is parentheses that hold
// only a call with try, as (try f()) does in (try f()).x, that call: the
// parentheses only end try's operand, so the chain parses as f().x does. An
// optional chain keeps its parentheses, which end it.
func triedChainOperand(expression *ast.Expression) *ast.Expression {
	if !ast.IsParenthesizedExpression(expression) {
		return expression
	}
	inner := expression.Expression()
	if inner.Flags&ast.NodeFlagsVibeLangTry == 0 || inner.Flags&ast.NodeFlagsOptionalChain != 0 || ast.IsParenthesizedExpression(inner) {
		return expression
	}
	return inner
}

// VIP-18 uses try precedence and accepts any array expression of Effects.
var tryOperations = map[string]string{
	"all": "$tryAll", "race": "$tryRace", "any": "$tryAny", "allSettled": "$tryAllSettled",
}

func (p *Parser) isVibeLangTryOperation() bool {
	return p.token == ast.KindTryKeyword && p.isVibeLangFile() && p.lookAhead(func(p *Parser) bool {
		p.nextToken()
		if p.token != ast.KindDotToken || p.hasPrecedingLineBreak() {
			return false
		}
		p.nextToken()
		_, ok := tryOperations[p.scanner.TokenValue()]
		return ok && !p.hasPrecedingLineBreak()
	})
}
func (p *Parser) parseVibeLangTryOperation() *ast.Node {
	pos := p.nodePos()
	anchor := p.tokenRange()
	p.nextToken() // try
	p.nextToken() // .
	helper := tryOperations[p.scanner.TokenValue()]
	p.nextToken()
	word := core.NewTextRange(anchor.Pos(), p.nodePos())
	operand := p.parseSimpleUnaryExpression()
	p.recordVibeSyntax(VibeSyntax{Kind: VibeSyntaxPrefix, Word: word, Range: core.NewTextRange(anchor.Pos(), operand.End())})
	callee := p.vibelangIntrinsic(helper, anchor)
	return p.finishNode(p.factory.NewCallExpression(callee, nil, nil, p.newNodeList(operand.Loc, []*ast.Node{operand}), ast.NodeFlagsNone), pos)
}
