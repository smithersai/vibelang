package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// A catch expression (D236-D239), borrowed from Zig's inline catch, parses
// into a call of the runtime's $catchExpression, so the checker, the analyzer,
// and the lowering treat it as the call it abbreviates:
//
//	getUser(id) catch guest               $catchExpression(() => getUser(id), () => guest)
//	getUser(id) catch (e) => describe(e)  $catchExpression(() => getUser(id), (e) => describe(e))
//
// The left side is passed as a function, so it runs inside the catch, and a
// fallback runs only after an expected failure. vibelang/catch_expressions.go
// knows the call by its synthesized callee, anchored on the keyword.

// isVibeLangCatchExpression reports whether the current token, which follows an
// expression, is catch in a .vibe file. In TypeScript catch follows only
// the } of a try block, never an expression, so the form takes no code that
// parses today.
func (p *Parser) isVibeLangCatchExpression() bool {
	return p.token == ast.KindCatchKeyword && p.isVibeLangFile()
}

// parseVibeLangCatchRest parses the catch operators after left, which starts at
// pos. catch binds looser than every binary operator, ?? and || included, and
// tighter than ? : and assignment; it associates to the left, so
// a() catch b() catch c tries b() after a() fails and c after b() fails. A
// handler is an arrow function, whose body extends as far as an arrow
// function's does, so a catch after a handler belongs to its body.
func (p *Parser) parseVibeLangCatchRest(left *ast.Expression, pos int) *ast.Expression {
	for p.isVibeLangCatchExpression() {
		keyword := p.tokenRange()
		p.nextToken() // catch
		handler := p.parseVibeLangCatchHandler()
		if handler == nil {
			fallback := p.parseBinaryExpressionOrHigher(ast.OperatorPrecedenceLowest)
			p.recordVibeSyntax(VibeSyntax{Kind: VibeSyntaxCatch, Word: keyword, Left: p.sourceRange(left), Right: p.sourceRange(fallback), Range: core.NewTextRange(p.sourceRange(left).Pos(), fallback.End())})
			handler = p.vibelangProgramArrow(nil, fallback, core.NewTextRange(fallback.Pos(), fallback.Pos()))
		} else {
			p.recordVibeSyntax(VibeSyntax{Kind: VibeSyntaxCatch, Word: keyword, Left: p.sourceRange(left), Right: p.sourceRange(handler), Range: core.NewTextRange(p.sourceRange(left).Pos(), handler.End())})
		}
		self := p.vibelangProgramArrow(nil, left, core.NewTextRange(left.Pos(), left.Pos()))
		callee := p.vibelangIntrinsic("$catchExpression", keyword)
		arguments := p.newNodeList(core.NewTextRange(self.Pos(), handler.End()), []*ast.Node{self, handler})
		left = p.finishNode(p.factory.NewCallExpression(callee, nil /*questionDotToken*/, nil /*typeArguments*/, arguments, ast.NodeFlagsNone), pos)
	}
	return left
}

// parseVibeLangCatchHandler parses the handler of `catch (e) => …`,
// `catch e => …`, or `catch effect (e) => …`, or returns nil when what follows catch is a fallback.
func (p *Parser) parseVibeLangCatchHandler() *ast.Node {
	if arrow := p.tryParseVibeLangEffectArrow(true /*allowReturnTypeInArrowFunction*/); arrow != nil {
		return arrow // catch effect (e) => … (VIP-5)
	}
	if p.token == ast.KindIdentifier && p.lookAhead((*Parser).nextTokenIsEqualsGreaterThanToken) {
		return p.parseAssignmentExpressionOrHigher()
	}
	if p.token == ast.KindOpenParenToken {
		return p.tryParseParenthesizedArrowFunctionExpression(true /*allowReturnTypeInArrowFunction*/)
	}
	return nil
}

func (p *Parser) nextTokenIsEqualsGreaterThanToken() bool {
	p.nextToken()
	return p.token == ast.KindEqualsGreaterThanToken
}
