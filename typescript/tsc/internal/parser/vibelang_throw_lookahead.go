package parser

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// VIP-41 adopts the TC39 throw-expressions proposal, pinned in
// docs/design/vips/tc39-throw-expressions/, exactly:
//
//	UnaryExpression : `throw` UnaryExpression [lookahead ∉ ThrowExpressionInvalidPunctuator]
//
// A token from that list right after a throw expression is EK1010. Where a
// line break precedes the token and the token can start a statement, the
// grammar's automatic semicolon insertion applies (ECMA-262, Rules of
// Automatic Semicolon Insertion): the expression ends before the token. Only
// if no semicolon is allowed there is it EK1010.

// These constants share the existing EK registry entry in package vibelang. {0} is
// the throw's operand and {1} the token that follows it.
const VibeLangThrowLookaheadCode int32 = 1010
const VibeLangThrowLookaheadMessage = "A throw expression can't be followed by {1}: write throw (…) to throw the whole expression, or (throw {0}) to throw only {0}."

// ThrowLookaheadMessage formats VibeLangThrowLookaheadMessage.
func ThrowLookaheadMessage(operand, token string) string {
	return strings.NewReplacer("{0}", operand, "{1}", token).Replace(VibeLangThrowLookaheadMessage)
}

// isThrowExpressionInvalidPunctuator reports whether kind starts a
// ThrowExpressionInvalidPunctuator. The scanner gives > alone, and every
// punctuator that starts with > is in the list. VibeLang's |> starts with |,
// which is in the list too.
func isThrowExpressionInvalidPunctuator(kind ast.Kind) bool {
	switch kind {
	case ast.KindCommaToken,
		ast.KindLessThanToken, ast.KindGreaterThanToken, ast.KindLessThanEqualsToken, ast.KindGreaterThanEqualsToken,
		ast.KindEqualsEqualsToken, ast.KindExclamationEqualsToken, ast.KindEqualsEqualsEqualsToken, ast.KindExclamationEqualsEqualsToken,
		ast.KindPlusToken, ast.KindMinusToken, ast.KindAsteriskToken, ast.KindSlashToken, ast.KindPercentToken, ast.KindAsteriskAsteriskToken,
		ast.KindLessThanLessThanToken, ast.KindGreaterThanGreaterThanToken, ast.KindGreaterThanGreaterThanGreaterThanToken,
		ast.KindAmpersandToken, ast.KindBarToken, ast.KindCaretToken,
		ast.KindAmpersandAmpersandToken, ast.KindBarBarToken, ast.KindQuestionQuestionToken,
		ast.KindEqualsToken, ast.KindPlusEqualsToken, ast.KindMinusEqualsToken, ast.KindAsteriskEqualsToken, ast.KindSlashEqualsToken,
		ast.KindPercentEqualsToken, ast.KindAsteriskAsteriskEqualsToken, ast.KindLessThanLessThanEqualsToken,
		ast.KindGreaterThanGreaterThanEqualsToken, ast.KindGreaterThanGreaterThanGreaterThanEqualsToken,
		ast.KindAmpersandEqualsToken, ast.KindBarEqualsToken, ast.KindCaretEqualsToken,
		ast.KindAmpersandAmpersandEqualsToken, ast.KindBarBarEqualsToken, ast.KindQuestionQuestionEqualsToken,
		ast.KindQuestionToken:
		return true
	}
	return false
}

// throwInvalidPunctuatorCanFollowASI reports whether kind can start a
// statement or class member after semicolon insertion: + and - are unary
// operators, / and /= start a regular expression, < starts a type assertion
// or JSX, and * starts a generator method after a class field.
func throwInvalidPunctuatorCanFollowASI(kind ast.Kind) bool {
	switch kind {
	case ast.KindPlusToken, ast.KindMinusToken, ast.KindSlashToken, ast.KindSlashEqualsToken, ast.KindLessThanToken, ast.KindAsteriskToken:
		return true
	}
	return false
}

// throwStop is a token at which automatic semicolon insertion may end a
// throw expression: binary operators don't continue past it, and a parse
// error there means no semicolon was allowed, which is EK1010.
type throwStop struct {
	pos      int
	span     core.TextRange
	operand  string
	token    string
	reported bool
}

// checkVibeLangThrowLookahead runs after a throw expression's operand, with
// the lookahead token current. Report a forbidden token immediately unless a
// line break may instead insert a semicolon.
func (p *Parser) checkVibeLangThrowLookahead(span core.TextRange, operand *ast.Node) {
	// Form the full punctuator so diagnostics name >=, >>, >>> and their assignments.
	p.reScanGreaterThanToken()
	if !isThrowExpressionInvalidPunctuator(p.token) {
		return
	}
	if !p.hasPrecedingLineBreak() || !throwInvalidPunctuatorCanFollowASI(p.token) {
		text := strings.TrimSpace(p.sourceText[scanner.SkipTrivia(p.sourceText, operand.Pos()):operand.End()])
		p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, span, "EK", diagnostics.CategoryError, VibeLangThrowLookaheadCode, ThrowLookaheadMessage(text, p.scanner.TokenText())))
		p.hasParseError = true
		return
	}
	p.vibelangThrowStop = &throwStop{
		pos:     p.scanner.TokenStart(),
		span:    span,
		operand: strings.TrimSpace(p.sourceText[scanner.SkipTrivia(p.sourceText, operand.Pos()):operand.End()]),
		token:   p.scanner.TokenText(),
	}
}

// atVibeLangThrowStop reports whether the current token is a throw stop.
func (p *Parser) atVibeLangThrowStop() bool {
	return p.vibelangThrowStop != nil && p.vibelangThrowStop.pos == p.scanner.TokenStart()
}

// reportVibeLangThrowStop turns a parse error at a throw stop into EK1010 at
// the throw expression. It reports whether it did.
func (p *Parser) reportVibeLangThrowStop(pos int) bool {
	stop := p.vibelangThrowStop
	if stop == nil || stop.pos != pos {
		return false
	}
	if !stop.reported {
		p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, stop.span, "EK", diagnostics.CategoryError, VibeLangThrowLookaheadCode, ThrowLookaheadMessage(stop.operand, stop.token)))
		p.vibelangThrowStop = &throwStop{pos: stop.pos, reported: true} // later errors at the same token stay quiet
	}
	p.hasParseError = true
	return true
}
