package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// EffectArrowHeadDiagnosticCode and Text identify VIP-1/detail247's
// already-rejected typed/generic bare heads. The registry and parser share
// their identity; parser diagnostics remain errors with --noCheck.
const EffectArrowHeadDiagnosticCode int32 = 109
const EffectArrowHeadDiagnosticText = "An effect arrow with a typed bare parameter or type parameters needs parentheses around its parameters."

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
// the checker reports EK0101 there with the quick fix that writes function.
// Outside these positions effect is an identifier, so Layer.effect(…) and
// const effect = … keep their meaning. Every form needs its next token on
// the same line as effect, as async does.

// isVibeLangEffectWord reports whether the current token is the identifier
// effect in a .vibe file.
func (p *Parser) isVibeLangEffectWord() bool {
	return p.token == ast.KindIdentifier && p.isVibeLangFile() && p.scanner.TokenValue() == "effect"
}

// consumeVibeLangEffectWord consumes effect as a keyword, retaining the
// Unicode-escape restriction of TypeScript's contextual async keyword.
// Ordinary identifiers named effect do not use this path.
func (p *Parser) consumeVibeLangEffectWord() core.TextRange {
	word := p.tokenRange()
	if p.scanner.HasUnicodeEscape() || p.scanner.HasExtendedUnicodeEscape() {
		p.parseErrorAtCurrentToken(diagnostics.Keywords_cannot_contain_escape_characters)
	}
	p.nextToken()
	return word
}

// scanStartOfShorthandFunction reports whether the current token is a name
// followed by ( or <, the rest of a shorthand declaration, effect load(id) or
// async get(url). It moves the scanner; call it through lookAhead.
func (p *Parser) scanStartOfShorthandFunction() bool {
	// These operators continue an expression after the contextual name.
	if !p.isBindingIdentifier() || p.hasPrecedingLineBreak() || p.token == ast.KindAsKeyword || p.token == ast.KindSatisfiesKeyword || p.token == ast.KindIsKeyword {
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
		// These operators continue an expression after the contextual name.
		if !p.isBindingIdentifier() || p.token == ast.KindAsKeyword || p.token == ast.KindSatisfiesKeyword || p.token == ast.KindIsKeyword {
			return false
		}
		p.nextToken()
		return !p.hasPrecedingLineBreak() && (p.token == ast.KindOpenParenToken || p.token == ast.KindLessThanToken)
	})
}

// parseEffectDeclaration parses effect function name(…) { … } or effect
// name(…) { … } at the current token, effect.
func (p *Parser) parseEffectDeclaration(pos int, jsdoc jsdocScannerInfo, modifiers *ast.ModifierList) *ast.Node {
	word := p.consumeVibeLangEffectWord()
	var fn *ast.Node
	if p.token == ast.KindFunctionKeyword {
		fn = p.parseFunctionDeclaration(pos, jsdoc, modifiers, true /*effect*/)
	} else {
		fn = p.parseShorthandFunctionDeclaration(pos, jsdoc, modifiers, true /*effect*/)
	}
	return p.markEffect(fn, word)
}

// parseShorthandFunctionDeclaration parses name(…) { … }, a function
// declaration without its function keyword, after effect or async.
func (p *Parser) parseShorthandFunctionDeclaration(pos int, jsdoc jsdocScannerInfo, modifiers *ast.ModifierList, effect bool) *ast.Node {
	p.recordVibeSyntax(VibeSyntax{Kind: VibeSyntaxShorthand, Word: p.tokenRange()})
	name := p.parseBindingIdentifier() // a declaration's name takes the enclosing context (Appendix A)
	defer p.setVibeLangFiberContext(effect)()
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
	defer p.setVibeLangFiberContext(true)()
	pos := p.nodePos()
	word := p.consumeVibeLangEffectWord()
	if p.hasPrecedingLineBreak() {
		p.rewind(state)
		return nil
	}
	arrow := p.tryParseVibeLangBareEffectArrow(allowReturnTypeInArrowFunction)
	if arrow == nil {
		switch {
		case p.token == ast.KindOpenParenToken || p.token == ast.KindLessThanToken:
			switch p.isParenthesizedArrowFunctionExpression() {
			case core.TSTrue:
				arrow = p.parseParenthesizedArrowFunctionExpression(true /*allowAmbiguity*/, allowReturnTypeInArrowFunction, true /*effect*/)
			case core.TSUnknown:
				arrow = p.parseParenthesizedArrowFunctionExpression(false /*allowAmbiguity*/, allowReturnTypeInArrowFunction, true /*effect*/)
			}
		case p.isIdentifier() && p.lookAhead(func(p *Parser) bool {
			p.nextToken()
			return p.token == ast.KindEqualsGreaterThanToken && !p.hasPrecedingLineBreak()
		}):
			jsdoc := p.jsdocScannerInfo()
			parameter := p.parseIdentifier()
			arrow = p.parseSimpleArrowFunctionExpression(parameter.Pos(), parameter, allowReturnTypeInArrowFunction, jsdoc, nil /*asyncModifier*/, true /*effect*/)
		}
	}
	if arrow == nil || !ast.IsArrowFunction(arrow) {
		p.rewind(state)
		return nil
	}
	arrow.Loc = core.NewTextRange(pos, arrow.End())
	return p.markEffect(arrow, word)
}

// tryParseVibeLangBareEffectArrow recovers only a complete bare parameter
// with a type or type parameters. VIP-1/detail247 still rejects these heads;
// the checker owns EK0109 and its insertion-only parenthesizing repair.
// Without a complete same-line =>, restore every speculative parser record,
// so calls, comparisons and native arrow errors keep their ordinary reading.
func (p *Parser) tryParseVibeLangBareEffectArrow(allowReturnTypeInArrowFunction bool) *ast.Node {
	if p.token != ast.KindLessThanToken && !p.isIdentifier() {
		return nil
	}
	state := p.mark()
	pos := p.nodePos()
	jsdoc := p.jsdocScannerInfo()
	typeParameters := p.parseTypeParameters()
	if !p.isIdentifier() || p.hasPrecedingLineBreak() {
		p.rewind(state)
		return nil
	}
	name := p.parseIdentifier()
	question := p.parseOptionalToken(ast.KindQuestionToken)
	typeNode := p.parseTypeAnnotation()
	if typeParameters == nil && typeNode == nil ||
		p.token != ast.KindEqualsGreaterThanToken || p.hasPrecedingLineBreak() ||
		len(p.diagnostics) != state.diagnosticsLen {
		p.rewind(state)
		return nil
	}
	parameter := p.finishNode(p.factory.NewParameterDeclaration(nil, nil, name, question, typeNode, nil), name.Pos())
	parameters := p.newNodeList(parameter.Loc, p.nodeSliceArena.NewSlice1(parameter))
	equalsGreaterThan := p.parseExpectedToken(ast.KindEqualsGreaterThanToken)
	body := p.parseArrowFunctionExpressionBody(false /*isAsync*/, allowReturnTypeInArrowFunction, true /*effect*/)
	result := p.finishNode(p.factory.NewArrowFunction(nil, typeParameters, parameters, nil, nil, equalsGreaterThan, body), pos)
	p.withJSDoc(result, jsdoc)
	// The recovered tree is complete. Retain its parameter/body type checks
	// while rejecting the original head independently of semantic checking.
	p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, p.sourceRange(parameter), "EK", diagnostics.CategoryError, EffectArrowHeadDiagnosticCode, EffectArrowHeadDiagnosticText))
	return result
}

// isStartOfVibeLangEffectExpression reports whether the current token, effect,
// starts an effect function expression: effect followed by function on
// the same line. Blocks have their own entry point below.
func (p *Parser) isStartOfVibeLangEffectExpression() bool {
	return p.isVibeLangEffectWord() && p.lookAhead(func(p *Parser) bool {
		p.nextToken()
		return !p.hasPrecedingLineBreak() && p.token == ast.KindFunctionKeyword
	})
}

// parseVibeLangEffectExpression parses effect function expressions (VIP-1).
func (p *Parser) parseVibeLangEffectExpression() *ast.Node {
	pos := p.nodePos()
	word := p.consumeVibeLangEffectWord()
	fn := p.parseFunctionExpression(true /*effect*/)
	fn.Loc = core.NewTextRange(pos, fn.End())
	return p.markEffect(fn, word)
}

// isStartOfVibeLangEffectBlock is separate from VIP-1's function entry point.
func (p *Parser) isStartOfVibeLangEffectBlock() bool {
	return p.isVibeLangEffectWord() && p.lookAhead(func(p *Parser) bool {
		p.nextToken()
		return !p.hasPrecedingLineBreak() && p.token == ast.KindOpenBraceToken
	})
}

// parseVibeLangEffectBlock builds an Effect inheriting the lexical scope.
func (p *Parser) parseVibeLangEffectBlock() *ast.Node {
	pos := p.nodePos()
	word := p.consumeVibeLangEffectWord()
	defer p.setVibeLangFiberContext(true)()
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
		if p.token == ast.KindOpenBracketToken {
			p.parseComputedPropertyName()
		} else {
			if !tokenIsIdentifierOrKeyword(p.token) && p.token != ast.KindStringLiteral && p.token != ast.KindNumericLiteral && p.token != ast.KindBigIntLiteral && p.token != ast.KindPrivateIdentifier {
				return false
			}
			p.nextToken()
		}
		p.parseOptionalToken(ast.KindQuestionToken)
		return p.token == ast.KindOpenParenToken || p.token == ast.KindLessThanToken
	})
}

// parseVibeLangEffectMember consumes effect before a method and returns its
// range; vibelangEffectMember marks the method parsed after it.
func (p *Parser) parseVibeLangEffectMember() core.TextRange {
	return p.consumeVibeLangEffectWord()
}

func (p *Parser) vibelangEffectMember(member *ast.Node, word core.TextRange) *ast.Node {
	if member.Kind != ast.KindMethodDeclaration {
		p.parseErrorAtRange(word, diagnostics.X_0_expected, "(")
		return member
	}
	return p.markEffect(member, word)
}

// EffectRestrictedMemberDiagnosticCode and Text are VIP-1's diagnostic for
// a recognized but forbidden accessor/constructor prefix. Keep its registry
// identity shared with syntactic diagnostics, including --noCheck.
const EffectRestrictedMemberDiagnosticCode int32 = 104
const EffectRestrictedMemberDiagnosticText = "Effect on a getter, setter or constructor. Use the matching effect or async function form; move legacy JavaScript to a .ts file."

const EffectAsyncMemberDiagnosticCode int32 = 105
const EffectAsyncMemberDiagnosticText = "Effect and async on one function. Use the matching effect or async function form; move legacy JavaScript to a .ts file."

// Recover the native member as one node, rather than treating effect as a
// field or a constructor as an ordinary Effect method. Native contextual
// modifier lookahead preserves methods named get/set and line boundaries.
func (p *Parser) tryParseVibeLangRestrictedEffectMember(pos int, jsdoc jsdocScannerInfo, modifiers *ast.ModifierList, class bool) *ast.Node {
	if !p.isVibeLangEffectWord() || !p.lookAhead(func(p *Parser) bool {
		p.nextToken()
		if p.hasPrecedingLineBreak() {
			return false
		}
		if p.parseContextualModifier(ast.KindGetKeyword) || p.parseContextualModifier(ast.KindSetKeyword) {
			return true
		}
		return class && (p.token == ast.KindConstructorKeyword || p.token == ast.KindStringLiteral && p.scanner.TokenValue() == "constructor") &&
			p.lookAhead(func(p *Parser) bool {
				unquoted := p.token == ast.KindConstructorKeyword
				p.nextToken()
				return p.token == ast.KindOpenParenToken || unquoted && p.token == ast.KindLessThanToken
			})
	}) {
		return nil
	}
	word := p.parseVibeLangEffectMember()
	var member *ast.Node
	if p.parseContextualModifier(ast.KindGetKeyword) {
		member = p.parseAccessorDeclaration(pos, jsdoc, modifiers, ast.KindGetAccessor, ParseFlagsNone)
	} else if p.parseContextualModifier(ast.KindSetKeyword) {
		member = p.parseAccessorDeclaration(pos, jsdoc, modifiers, ast.KindSetAccessor, ParseFlagsNone)
	} else {
		member = p.tryParseConstructorDeclaration(pos, jsdoc, modifiers)
	}
	p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, word, "EK", diagnostics.CategoryError, EffectRestrictedMemberDiagnosticCode, EffectRestrictedMemberDiagnosticText))
	if modifierListHasAsync(modifiers) {
		p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, word, "EK", diagnostics.CategoryError, EffectAsyncMemberDiagnosticCode, EffectAsyncMemberDiagnosticText))
	}
	return member
}
