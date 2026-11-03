package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
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
// pos. catch binds like ??, rejecting unparenthesized logical mixing, and
// tighter than ? : and assignment; it associates to the left, so
// a() catch b() catch c tries b() after a() fails and c after b() fails. A
// handler is an arrow function, whose body extends as far as an arrow
// function's does, so a catch after a handler belongs to its body.
func (p *Parser) parseVibeLangCatchRest(left *ast.Expression, pos int) *ast.Expression {
	for p.isVibeLangCatchExpression() {
		keyword := p.tokenRange()
		if vibeLangCatchMixedHead(left) {
			p.reportVibeLangCatchPrecedence(p.sourceRange(left))
		}
		p.nextToken() // catch
		handlerStart := p.nodePos()
		handler := p.parseVibeLangCatchHandler()
		// A closed handler cannot take binary or postfix continuations. Keep
		// the old fallback tree for recovery, so --fix can preserve it.
		if handler != nil {
			rest := p.parseCallExpressionRest(handlerStart, handler)
			rest = p.parseBinaryExpressionRest(ast.OperatorPrecedenceLowest, rest, handlerStart)
			if rest != handler {
				p.reportVibeLangCatchPrecedence(p.sourceRange(rest))
				handler = p.vibelangProgramArrow(nil, rest, core.NewTextRange(rest.Pos(), rest.Pos()))
			}
		}
		if handler == nil {
			fallback := p.parseBinaryExpressionOrHigher(ast.OperatorPrecedenceLowest)
			if IsVibeLangCatchHandlerContinuation(fallback) {
				p.reportVibeLangCatchPrecedence(p.sourceRange(fallback))
			}
			p.recordVibeSyntax(VibeSyntax{Kind: VibeSyntaxCatch, Word: keyword, Left: p.sourceRange(left), Right: p.sourceRange(fallback), Range: core.NewTextRange(p.sourceRange(left).Pos(), fallback.End())})
			handler = p.vibelangProgramArrow(nil, fallback, core.NewTextRange(fallback.Pos(), fallback.Pos()))
		} else {
			p.recordVibeSyntax(VibeSyntax{Kind: VibeSyntaxCatch, Word: keyword, Left: p.sourceRange(left), Right: core.NewTextRange(scanner.SkipTrivia(p.sourceText, handlerStart), p.nodePos()), Range: core.NewTextRange(p.sourceRange(left).Pos(), p.nodePos())})
		}
		self := p.vibelangProgramArrow(nil, left, core.NewTextRange(left.Pos(), left.Pos()))
		callee := p.vibelangIntrinsic("$catchExpression", keyword)
		arguments := p.newNodeList(core.NewTextRange(self.Pos(), handler.End()), []*ast.Node{self, handler})
		left = p.finishNode(p.factory.NewCallExpression(callee, nil /*questionDotToken*/, nil /*typeArguments*/, arguments, ast.NodeFlagsNone), pos)
	}
	return left
}

// parseVibeLangCatchHandler parses function expressions and the handler of `catch (e) => …`,
// `catch e => …`, `catch effect (e) => …` or `catch async (e) => …`,
// parenthesized or not, or returns nil when what follows catch is a fallback,
// which the checker reports as EK0509 unless it is a parenthesized function
// literal or a function expression.
func (p *Parser) parseVibeLangCatchHandler() *ast.Node {
	if p.token == ast.KindFunctionKeyword {
		if p.lookAhead(func(p *Parser) bool { p.nextToken(); return p.token == ast.KindAsteriskToken }) {
			return nil // Invalid generators keep value recovery without a synthetic callback type error.
		}
		return p.parseFunctionExpression(false /*effect*/)
	}
	if p.isStartOfVibeLangEffectExpression() {
		if p.lookAhead(func(p *Parser) bool { p.nextToken(); p.nextToken(); return p.token == ast.KindAsteriskToken }) {
			return nil
		}
		return p.parseVibeLangEffectExpression()
	}
	if arrow := p.tryParseVibeLangEffectArrow(true /*allowReturnTypeInArrowFunction*/); arrow != nil {
		return arrow // catch effect (e) => … (VIP-5)
	}
	if p.isIdentifier() && p.lookAhead((*Parser).nextTokenIsEqualsGreaterThanToken) {
		return p.parseAssignmentExpressionOrHigher()
	}
	if p.token == ast.KindOpenParenToken || p.token == ast.KindLessThanToken {
		if arrow := p.tryParseParenthesizedArrowFunctionExpression(true /*allowReturnTypeInArrowFunction*/); arrow != nil {
			return arrow
		}
		// Parentheses keep an arrow's handler kind (VIP-5). Keep its
		// original outer range in the recorded catch syntax, while the
		// checker and lowering receive the arrow itself.
		state := p.mark()
		p.nextToken() // (
		if handler := p.parseVibeLangCatchHandler(); handler != nil && p.token == ast.KindCloseParenToken {
			p.nextToken() // )
			return handler
		}
		p.rewind(state)
	}
	if p.token == ast.KindAsyncKeyword {
		// catch async (e) => … and catch async e => … parse as the arrows
		// they are, so the checker reports EK0509 and its fix removes async,
		// rather than a call of async followed by a stray =>.
		if arrow := p.tryParseParenthesizedArrowFunctionExpression(true /*allowReturnTypeInArrowFunction*/); arrow != nil {
			return arrow
		}
		return p.tryParseAsyncSimpleArrowFunctionExpression(true /*allowReturnTypeInArrowFunction*/)
	}
	return nil
}

func (p *Parser) nextTokenIsEqualsGreaterThanToken() bool {
	p.nextToken()
	return p.token == ast.KindEqualsGreaterThanToken
}
