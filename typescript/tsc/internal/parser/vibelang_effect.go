package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// effect marks an Effect function (VIP-1) exactly where TypeScript allows
// async (VIP-39); before a block it builds an Effect from the block (VIP-2).
// Each form parses as the function TypeScript parses without effect, flagged
// NodeFlagsVibeLangEffect, its range widened to start at effect:
//
//	effect function load(id) { … }    function load(id) { … }, flagged
//	effect (id) => try find(id)       (id) => find(id), flagged
//	effect find(id) { … }             a method, in a class or an object literal
//	effect { … }                      () => { … }, flagged, its => on effect
//
// A declaration without function, effect load(id) { … } or async get(url)
// { … }, is not TypeScript, so it is not VibeLang either (VIP-39): it parses
// as the declaration it was meant to be, recorded VibeSyntaxShorthand, and
// the checker reports EK4618 there with the quick fix that writes function.
// Outside these positions effect is an identifier, so Layer.effect(…) and
// const effect = … keep their meaning. Every form needs its next token on
// the same line as effect, as async does.

// isVibeLangEffectWord reports whether the current token is the identifier
// effect in a .vibe file.
func (p *Parser) isVibeLangEffectWord() bool {
	return p.token == ast.KindIdentifier && p.isVibeLangFile() && p.scanner.TokenValue() == "effect"
}

// scanStartOfShorthandFunction reports whether the current token is a name
// followed by ( or <, the rest of a shorthand declaration, effect load(id) or
// async get(url). It moves the scanner; call it through lookAhead.
func (p *Parser) scanStartOfShorthandFunction() bool {
	if !p.isBindingIdentifier() || p.hasPrecedingLineBreak() {
		return false
	}
	p.nextToken()
	return p.token == ast.KindOpenParenToken || p.token == ast.KindLessThanToken
}

// scanStartOfEffectDeclaration reports whether the current token, effect,
// starts a function declaration: effect function name or effect name(. It
// moves the scanner.
func (p *Parser) scanStartOfEffectDeclaration() bool {
	p.nextToken()
	if p.hasPrecedingLineBreak() {
		return false
	}
	if p.token == ast.KindFunctionKeyword {
		return true
	}
	return p.scanStartOfShorthandFunction()
}

// isStartOfAsyncShorthand reports whether the current token, after an async
// modifier, starts the shorthand declaration async get(url).
func (p *Parser) isStartOfAsyncShorthand(modifiers *ast.ModifierList) bool {
	return modifierListHasAsync(modifiers) && p.isVibeLangFile() && p.lookAhead(func(p *Parser) bool {
		if !p.isBindingIdentifier() {
			return false
		}
		p.nextToken()
		return !p.hasPrecedingLineBreak() && (p.token == ast.KindOpenParenToken || p.token == ast.KindLessThanToken)
	})
}

// parseEffectDeclaration parses effect function name(…) { … } or effect
// name(…) { … } at the current token, effect.
func (p *Parser) parseEffectDeclaration(pos int, jsdoc jsdocScannerInfo, modifiers *ast.ModifierList) *ast.Node {
	word := p.tokenRange()
	p.nextToken() // effect
	var fn *ast.Node
	if p.token == ast.KindFunctionKeyword {
		fn = p.parseFunctionDeclaration(pos, jsdoc, modifiers)
	} else {
		fn = p.parseShorthandFunctionDeclaration(pos, jsdoc, modifiers)
	}
	return p.markEffect(fn, word)
}

// parseShorthandFunctionDeclaration parses name(…) { … }, a function
// declaration without its function keyword, after effect or async.
func (p *Parser) parseShorthandFunctionDeclaration(pos int, jsdoc jsdocScannerInfo, modifiers *ast.ModifierList) *ast.Node {
	p.recordVibeSyntax(VibeSyntax{Kind: VibeSyntaxShorthand, Word: p.tokenRange()})
	name := p.parseBindingIdentifier()
	signatureFlags := core.IfElse(modifierListHasAsync(modifiers), ParseFlagsAwait, ParseFlagsNone)
	typeParameters := p.parseTypeParameters()
	saveContextFlags := p.contextFlags
	if modifiers != nil && modifiers.ModifierFlags&ast.ModifierFlagsExport != 0 {
		p.setContextFlags(ast.NodeFlagsAwaitContext, true)
	}
	parameters := p.parseParameters(signatureFlags)
	returnType := p.parseReturnType(ast.KindColonToken, false /*isType*/)
	body := p.parseFunctionBlockOrSemicolon(signatureFlags, diagnostics.X_or_expected)
	p.contextFlags = saveContextFlags
	result := p.finishNode(p.factory.NewFunctionDeclaration(modifiers, nil /*asteriskToken*/, name, typeParameters, parameters, returnType, nil /*fullSignature*/, body), pos)
	p.withJSDoc(result, jsdoc)
	p.checkJSSyntax(result)
	return result
}

// markEffect flags fn, whose effect keyword is word, as an Effect function,
// and records the keyword.
func (p *Parser) markEffect(fn *ast.Node, word core.TextRange) *ast.Node {
	fn.Flags |= ast.NodeFlagsVibeLangEffect
	p.recordVibeSyntax(VibeSyntax{Kind: VibeSyntaxEffect, Word: word, Range: core.NewTextRange(word.Pos(), fn.End())})
	return fn
}

// tryParseVibeLangEffectArrow parses effect (…) => … or effect x => …, or
// returns nil, the scanner where it was, when the current token starts
// neither: effect(x) without => is a call of a function named effect.
func (p *Parser) tryParseVibeLangEffectArrow(allowReturnTypeInArrowFunction bool) *ast.Node {
	if !p.isVibeLangEffectWord() {
		return nil
	}
	state := p.mark()
	pos := p.nodePos()
	word := p.tokenRange()
	p.nextToken() // effect
	if p.hasPrecedingLineBreak() {
		p.rewind(state)
		return nil
	}
	var arrow *ast.Node
	switch {
	case p.token == ast.KindOpenParenToken || p.token == ast.KindLessThanToken:
		switch p.isParenthesizedArrowFunctionExpression() {
		case core.TSTrue:
			arrow = p.parseParenthesizedArrowFunctionExpression(true /*allowAmbiguity*/, allowReturnTypeInArrowFunction)
		case core.TSUnknown:
			arrow = p.parseParenthesizedArrowFunctionExpression(false /*allowAmbiguity*/, allowReturnTypeInArrowFunction)
		}
	case p.isIdentifier() && p.lookAhead(func(p *Parser) bool {
		p.nextToken()
		return p.token == ast.KindEqualsGreaterThanToken && !p.hasPrecedingLineBreak()
	}):
		jsdoc := p.jsdocScannerInfo()
		parameter := p.parseIdentifier()
		arrow = p.parseSimpleArrowFunctionExpression(parameter.Pos(), parameter, allowReturnTypeInArrowFunction, jsdoc, nil /*asyncModifier*/)
	}
	if arrow == nil || !ast.IsArrowFunction(arrow) {
		p.rewind(state)
		return nil
	}
	arrow.Loc = core.NewTextRange(pos, arrow.End())
	return p.markEffect(arrow, word)
}

// isStartOfVibeLangEffectExpression reports whether the current token, effect,
// starts an effect function expression or an effect block: effect followed
// on the same line by function or {.
func (p *Parser) isStartOfVibeLangEffectExpression() bool {
	return p.isVibeLangEffectWord() && p.lookAhead(func(p *Parser) bool {
		p.nextToken()
		return !p.hasPrecedingLineBreak() && (p.token == ast.KindFunctionKeyword || p.token == ast.KindOpenBraceToken)
	})
}

// parseVibeLangEffectExpression parses effect function (…) { … } or
// effect { … }. The block is the body of an arrow with no parameters whose
// => stands on effect, as do's does on do (vibelangProgramArrow).
func (p *Parser) parseVibeLangEffectExpression() *ast.Node {
	pos := p.nodePos()
	word := p.tokenRange()
	p.nextToken() // effect
	if p.token == ast.KindFunctionKeyword {
		fn := p.parseFunctionExpression()
		fn.Loc = core.NewTextRange(pos, fn.End())
		return p.markEffect(fn, word)
	}
	saveContextFlags := p.contextFlags
	p.setContextFlags(ast.NodeFlagsAwaitContext|ast.NodeFlagsYieldContext, false)
	open := p.tokenRange()
	body := p.parseFunctionBlock(ParseFlagsNone, nil /*diagnosticMessage*/)
	p.contextFlags = saveContextFlags
	arrow := p.vibelangProgramArrow(nil, body, word)
	arrow.Loc = core.NewTextRange(pos, body.End())
	arrow.Flags |= ast.NodeFlagsVibeLangEffect
	closing := core.NewTextRange(body.End()-1, body.End())
	p.recordVibeSyntax(VibeSyntax{Kind: VibeSyntaxEffect, Word: word, Range: core.NewTextRange(word.Pos(), body.End()), Open: open, Close: closing})
	return arrow
}

// isStartOfVibeLangEffectMember reports whether the current token, effect,
// starts an effect method of a class or an object literal: effect followed
// on the same line by * or by a member name and ( or <.
func (p *Parser) isStartOfVibeLangEffectMember() bool {
	return p.isVibeLangEffectWord() && p.lookAhead(func(p *Parser) bool {
		p.nextToken()
		if p.hasPrecedingLineBreak() {
			return false
		}
		if p.token == ast.KindAsteriskToken {
			return true
		}
		if !tokenIsIdentifierOrKeyword(p.token) && p.token != ast.KindStringLiteral && p.token != ast.KindNumericLiteral && p.token != ast.KindPrivateIdentifier {
			return false
		}
		p.nextToken()
		return p.token == ast.KindOpenParenToken || p.token == ast.KindLessThanToken
	})
}

// parseVibeLangEffectMember consumes effect before a method and returns its
// range; vibelangEffectMember marks the method parsed after it.
func (p *Parser) parseVibeLangEffectMember() core.TextRange {
	word := p.tokenRange()
	p.nextToken() // effect
	return word
}

func (p *Parser) vibelangEffectMember(member *ast.Node, word core.TextRange) *ast.Node {
	if member.Kind != ast.KindMethodDeclaration {
		p.parseErrorAtRange(word, diagnostics.X_0_expected, "(")
		return member
	}
	return p.markEffect(member, word)
}
