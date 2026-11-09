package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// A recognized effect modifier follows the diagnostic recovery positions of
// TypeScript's async (VIP-1, modifier placement). TypeScript reads async as
// a modifier wherever a modifier or a member name follows it on its line,
// and then says what is wrong with it: 'static' modifier must precede
// 'async' modifier, or 'async' modifier cannot be used here. effect written
// in those positions is read the same way, so the same diagnostics name it:
//
//	class C { effect static load() { … } }    TS1029: 'static' must precede 'effect'
//	effect export function load() { … }       TS1029: 'export' must precede 'effect'
//	class C { effect effect load() { … } }    TS1030: 'effect' already seen
//	class C { effect size = 1 }               TS1042: 'effect' cannot be used here
//	effect class C { }                        TS1042
//
// A function or method recovered this way stays an Effect callable, so its
// body is effect code and reports nothing more. A modifier that the checker
// rejects on the reordered declaration keeps that diagnostic: abstract and
// declare are EK0108, readonly is TS1024 and accessor is TS1275. Every one of
// these forms was a syntax error before; effect followed by a line break,
// =, :, ;, ( or < stays the identifier it was.

// The declaration homes whose modifiers parseVibeLangModifiers reads.
type misplacedEffectHome int

const (
	misplacedEffectStatement    misplacedEffectHome = iota // a statement-level declaration
	misplacedEffectClassMember                             // a class member
	misplacedEffectObjectMember                            // an object literal member
)

// parseVibeLangModifiers parses the modifiers of a statement-level
// declaration, a class member or an object literal member, together with an
// effect written before its place among them.
func (p *Parser) parseVibeLangModifiers(home misplacedEffectHome) *ast.ModifierList {
	p.misplacedEffect, p.hasMisplacedEffect = core.TextRange{}, false
	member := home != misplacedEffectStatement
	class := home == misplacedEffectClassMember
	modifiers := p.parseModifiersEx(true /*allowDecorators*/, class /*permitConstAsModifier*/, class /*stopOnStartOfClassStaticBlock*/)
	if !p.isStartOfMisplacedEffect(home) {
		return modifiers
	}
	pos := p.nodePos()
	var nodes []*ast.Node
	if modifiers != nil {
		pos = modifiers.Pos()
		nodes = append(nodes, modifiers.Nodes...)
	}
	var word core.TextRange
	var first *ast.Node
	seen, reported := false, false
	for p.isStartOfMisplacedEffect(home) {
		current := p.consumeVibeLangEffectWord()
		if seen {
			if !reported {
				p.parseErrorAtRange(current, diagnostics.X_0_modifier_already_seen, "effect")
				reported = true
			}
		} else {
			word, seen = current, true
		}
		rest := p.parseModifiersEx(true /*allowDecorators*/, class /*permitConstAsModifier*/, class /*stopOnStartOfClassStaticBlock*/)
		if rest == nil {
			continue
		}
		for _, m := range rest.Nodes {
			nodes = append(nodes, m)
			if m.Kind == ast.KindDecorator {
				continue
			}
			if first == nil {
				first = m
			}
			if !reported && effectFollowsModifier(m.Kind) {
				p.parseErrorAtRange(core.NewTextRange(scanner.SkipTrivia(p.sourceText, m.Pos()), m.End()), diagnostics.X_0_modifier_must_precede_1_modifier, scanner.TokenToString(m.Kind), "effect")
				reported = true
			}
		}
	}
	if len(nodes) != 0 {
		modifiers = p.newModifierList(core.NewTextRange(pos, p.nodePos()), p.nodeSliceArena.Clone(nodes))
	}
	switch {
	case p.isVibeLangEffectWord():
		// A second effect, in its place: the declaration's own parse reads it.
		if !reported {
			p.parseErrorAtCurrentToken(diagnostics.X_0_modifier_already_seen, "effect")
		}
	case !member && p.token == ast.KindFunctionKeyword || member && p.lookAhead(func(p *Parser) bool { return p.scanStartOfMethodMember(class) }):
		p.misplacedEffect, p.hasMisplacedEffect = word, true
		if !reported && (first == nil || !checkerRejectsModifier(first.Kind)) {
			p.parseErrorAtRange(word, diagnostics.X_0_modifier_cannot_be_used_here, "effect")
		}
	case reported:
	case member && p.lookAhead(func(p *Parser) bool { return p.scanStartOfRestrictedMember(class) }):
		p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, word, "EK", diagnostics.CategoryError, EffectRestrictedMemberDiagnosticCode, EffectRestrictedMemberDiagnosticText))
	case class && p.isIndexSignature():
		p.parseErrorAtRange(word, diagnostics.X_0_modifier_cannot_appear_on_an_index_signature, "effect")
	case class && p.token == ast.KindStaticKeyword && p.lookAhead((*Parser).nextTokenIsOpenBrace):
		p.parseErrorAtRange(word, diagnostics.Modifiers_cannot_appear_here)
	default:
		p.parseErrorAtRange(word, diagnostics.X_0_modifier_cannot_be_used_here, "effect")
	}
	return modifiers
}

// takeMisplacedEffect returns the misplaced effect that modifies the function
// or method about to be parsed, once.
func (p *Parser) takeMisplacedEffect() (core.TextRange, bool) {
	word, ok := p.misplacedEffect, p.hasMisplacedEffect
	p.misplacedEffect, p.hasMisplacedEffect = core.TextRange{}, false
	return word, ok
}

// effectFollowsModifier reports whether TypeScript requires the modifier to
// precede async, and so effect: its TS1029 set.
func effectFollowsModifier(kind ast.Kind) bool {
	switch kind {
	case ast.KindExportKeyword, ast.KindDefaultKeyword, ast.KindPublicKeyword, ast.KindPrivateKeyword, ast.KindProtectedKeyword, ast.KindStaticKeyword, ast.KindOverrideKeyword:
		return true
	}
	return false
}

// checkerRejectsModifier reports whether the checker rejects the modifier on
// an Effect function or method wherever it is written, so the reordered
// declaration needs no second diagnostic.
func checkerRejectsModifier(kind ast.Kind) bool {
	switch kind {
	case ast.KindAbstractKeyword, ast.KindDeclareKeyword, ast.KindReadonlyKeyword, ast.KindAccessorKeyword:
		return true
	}
	return false
}

// isStartOfMisplacedEffect reports whether the current token is an effect
// that TypeScript would read as a modifier were it async, and that starts no
// Effect form of its own.
func (p *Parser) isStartOfMisplacedEffect(home misplacedEffectHome) bool {
	if !p.isVibeLangEffectWord() {
		return false
	}
	if home == misplacedEffectStatement {
		return !p.lookAhead((*Parser).scanStartOfEffectDeclaration) && p.lookAhead((*Parser).scanStartOfMisplacedEffectDeclaration)
	}
	class := home == misplacedEffectClassMember
	// Declaration bodies with their own member separators keep their rules.
	if class && (p.vibelangFieldBody || p.vibelangServiceShapeBody || p.vibelangAbstractMembers || p.vibelangControlMembers) {
		return false
	}
	if p.isStartOfVibeLangEffectMember() || p.isStartOfMixedEffectAccessor(nil) {
		return false
	}
	return p.lookAhead(func(p *Parser) bool {
		p.nextToken()
		// effect async and async effect keep their own recovery (EK0105).
		if p.hasPrecedingLineBreak() || p.token == ast.KindAsyncKeyword || p.scanStartOfRestrictedMemberHere(class) {
			return false
		}
		return tokenIsIdentifierOrKeyword(p.token) || p.token == ast.KindStringLiteral || p.token == ast.KindNumericLiteral || p.token == ast.KindBigIntLiteral || p.token == ast.KindPrivateIdentifier || p.token == ast.KindOpenBracketToken
	})
}

// scanStartOfMisplacedEffectDeclaration reports whether the current token,
// effect, is followed on its line by a modifier or a declaration keyword
// that starts a declaration. It moves the scanner.
func (p *Parser) scanStartOfMisplacedEffectDeclaration() bool {
	p.nextToken()
	if p.hasPrecedingLineBreak() {
		return false
	}
	switch p.token {
	case ast.KindExportKeyword, ast.KindDeclareKeyword, ast.KindAbstractKeyword, ast.KindClassKeyword, ast.KindConstKeyword, ast.KindLetKeyword,
		ast.KindVarKeyword, ast.KindEnumKeyword, ast.KindInterfaceKeyword, ast.KindTypeKeyword, ast.KindNamespaceKeyword:
		return p.scanStartOfDeclaration()
	case ast.KindIdentifier:
		// effect effect function f() { }: the second effect is in its place.
		return p.isVibeLangEffectWord() && (p.lookAhead((*Parser).scanStartOfEffectDeclaration) || p.lookAhead((*Parser).scanStartOfMisplacedEffectDeclaration))
	}
	return false
}

// scanStartOfMethodMember reports whether the current token starts a method:
// * or a member name, then ( or <. It moves the scanner.
func (p *Parser) scanStartOfMethodMember(class bool) bool {
	if p.token == ast.KindAsteriskToken {
		return true
	}
	if p.scanStartOfRestrictedMemberHere(class) {
		return false
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
}

// scanStartOfRestrictedMemberHere is scanStartOfRestrictedMember without
// moving the scanner.
func (p *Parser) scanStartOfRestrictedMemberHere(class bool) bool {
	return p.lookAhead(func(p *Parser) bool { return p.scanStartOfRestrictedMember(class) })
}

// skipMisplacedEffectParameter reads an effect written before a parameter
// name, as TypeScript reads async there, and reports TS1090: 'effect'
// modifier cannot appear on a parameter. A parameter named effect, followed
// by :, ?, =, , or ), is untouched.
func (p *Parser) skipMisplacedEffectParameter() {
	if !p.isVibeLangEffectWord() || !p.lookAhead(func(p *Parser) bool {
		p.nextToken()
		return !p.hasPrecedingLineBreak() && (p.isBindingIdentifier() || p.token == ast.KindThisKeyword || p.token == ast.KindOpenBracketToken || p.token == ast.KindOpenBraceToken || p.token == ast.KindDotDotDotToken)
	}) {
		return
	}
	word := p.consumeVibeLangEffectWord()
	p.parseErrorAtRange(word, diagnostics.X_0_modifier_cannot_appear_on_a_parameter, "effect")
}
