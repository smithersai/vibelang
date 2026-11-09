package parser

import (
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Pattern matching (D206-D225) adopts the match expression and the is
// operator of the TC39 pattern matching proposal (stage 1). The parser writes
// them as TypeScript that the checker already narrows: typeof, in, ===,
// Array.isArray, and the runtime's $is, with each binding a const. A
// built-in matcher, String or Option.Some, is a $is call too, which the
// checker narrows and the lowering writes as typeof or the module's guard
// when the matcher resolves to the built-in (BuiltinMatchers). A match reads
// its subject once, into a const that its tests read (subjectPath):
//
//	match (e) {                              (() => {
//	  when NotFound and { let id }:            const $match1 = e
//	    `no user ${id}`;                       { if ($is(NotFound, $match1) && (typeof $match1 === "function" || typeof $match1 === "object") && $match1 !== null && "id" in $match1) { const id = $match1.id; return `no user ${id}` } }
//	  when Timeout: "retry";                   { if ($is(Timeout, $match1)) { return "retry" } }
//	}                                          return $noMatch($match1)
//	                                         })()
//
// A match that a return statement returns, or that stands as a statement,
// is written without the function: return match (...) { ... } becomes a
// block whose arms return, and a match statement becomes a labeled block
// whose arms break out of it. Without a default arm, the arms end in a call of
// $noMatch, whose argument's narrowed type tells the checker which cases no
// arm handles (EK4701, match.go in package vibelang).
//
// A data variant's pattern (D307) tests the variant with $is, which the
// checker narrows and the lowering writes as the data type's own $is guard
// (data.go in package vibelang), then reads the fields it lists:
//
//	when Delivery.Sent { let tracking }:     if ($is(Delivery.Sent, d)) { const tracking = d.tracking; ... }
//
// The variant fixes the fields, so a field the pattern binds needs no in
// test, and an optional one the value leaves out binds undefined.
//
// x is P is a boolean expression. When P binds names, the if or while
// statement whose condition joins it with && is rewritten so the bindings are
// in scope in its body:
//
//	if (exit is Exit.Failure(let cause)) log(cause)
//	                                         { const $is1 = exit; if (Exit.isFailure($is1)) { const cause = $is1.cause; log(cause) } }
//
// A pattern form VibeLang does not support yet becomes a call of
// $patternError, which the checker reports (EK4703-EK4705).

// patternKind is the kind of a pattern as written.
type patternKind int

const (
	patternLiteral   patternKind = iota // a string, numeric, bigint, boolean, null, or template literal
	patternValue                        // a variable pattern: an identifier expression
	patternBinding                      // let, const, or var and a name
	patternArray                        // [items, ...rest]
	patternObject                       // { clauses, ...rest }
	patternExtractor                    // a variable pattern with an argument list: expr(items, ...rest)
	patternVariant                      // a variant and its fields: expr { clauses, ...rest } (D307)
	patternAnd                          // items joined by and
	patternOr                           // items joined by or
	patternNot                          // not items[0]
	patternGuard                        // if (expr)
	patternRelation                     // a relational pattern: operator and expr, < 10 or instanceof Map
	patternInvalid                      // a form VibeLang does not support yet: code, detail
	patternElision                      // a comma that skips one position of a list
)

// objectClause is one clause of an object pattern.
type objectClause struct {
	key      *ast.Node // an identifier name, a string or numeric literal, or a computed key's expression
	computed bool
	optional bool     // written key?: an absent property passes and runs no sub-pattern
	pattern  *pattern // nil when the clause only tests that the property exists
}

// pattern is a pattern as written.
type pattern struct {
	kind          patternKind
	anchor        core.TextRange // the pattern's first token, for the tokens written in its place
	expr          *ast.Node      // a literal, a variable pattern, a guard's expression, or an extractor's matcher
	bindFlags     ast.NodeFlags  // a binding's ast.NodeFlagsConst, ast.NodeFlagsLet, or ast.NodeFlagsNone for var
	name          *ast.Node      // a binding's name
	items         []*pattern
	hasRest       bool     // an array or extractor pattern ends in ...
	optional      bool     // a list element written P?: an absent value consumes nothing
	rest          *pattern // the pattern after ..., or nil
	clauses       []objectClause
	parenthesized bool
	operator      ast.Kind // a relational pattern's operator
	code          int      // a $patternError code: the form, or 4705 for combinators sharing a level
	detail        string   // the $patternError detail
}

// matchArm is one arm of a match expression; pattern is nil for the default arm.
type matchArm struct {
	anchor  core.TextRange
	pattern *pattern
	value   *ast.Node
	end     int
	hoisted bool        // the bindings of an is in value or in a guard were hoisted (matchStatements)
	hoists  []*ast.Node // their let statements, the arm block's first statements in every lowering of the match
}

// matchInfo is a match expression as written, kept so a return statement or
// an expression statement can write it without the function.
type matchInfo struct {
	anchor  core.TextRange // the match keyword
	subject *ast.Node
	arms    []matchArm
	pos     int
	async   *ast.Node    // the async modifier, or nil for a synchronous match
	errors  []matchError // arm separators and arm grammar, in source order
}

// matchError is a mistake in the arms of a match, which holds no pattern to
// carry it: EK0701 for an arm's separator, EK0707 for the rest of the arm
// grammar. matchStatements writes each as a $patternError statement.
type matchError struct {
	code   int
	detail string
	at     core.TextRange
}

// isInfo is an is expression whose pattern binds names, kept so the if or
// while statement whose condition holds it can bring the bindings into scope.
type isInfo struct {
	anchor  core.TextRange // the is keyword
	subject *ast.Node
	pattern *pattern
}

// matchStep is one step of a compiled pattern: a test or a declaration.
type matchStep struct {
	test *ast.Node
	decl *ast.Node
}

// matchPath writes one subject or part of a subject, as a new node each time.
type matchPath func() *ast.Node

// isPropertyChain reports a name or a property path from one. An inline pattern
// reads such a path where each test stands, so TypeScript narrows the written
// reference; a capture would narrow only its own temporary.
func isPropertyChain(node *ast.Node) bool {
	node = ast.SkipParentheses(node)
	for ast.IsPropertyAccessExpression(node) {
		node = ast.SkipParentheses(node.Expression())
	}
	return ast.IsIdentifier(node)
}

// matchCompile carries the state of compiling one top-level pattern.
type matchCompile struct {
	coverage     bool   // mark refutable combinators in finite coverage queries
	cache        string // the private per-evaluation Iterator Record cache
	anchor       core.TextRange
	inline       bool         // inside or, not, or an is without an if or while: no declarations
	inlineLocals *[]*ast.Node // captures local to a binding-free is wrapper
	// uncovered marks refutable and/not tests, which cover nothing, in a match
	// with no default arm, for EK4701 (chapter 004, Coverage). With a default arm
	// no coverage is checked, and the arms narrow as TypeScript does.
	uncovered bool
	bound     map[string]bool // the names an alternative has hoisted, with their keyword
	// checked maps the key of each name two binding patterns of this
	// top-level pattern can both initialize to its flag (vibelang_match_repeated.go);
	// nil until the top-level pattern's first compilePattern.
	checked      map[string]string
	checkedOrder []string
	orNumbers    *int  // the last number given to an or that binds a checked name
	laterIn      []int // the numbers of the ors this pattern stands in a later alternative of
}

// ---------------------------------------------------------------- parsing

// isStartOfVibeLangMatch reports whether the current token starts a match
// expression: in a .vibe file, match ( subject ) { on one line, then when,
// default, or }. The sequence is a TypeScript syntax error today.
func (p *Parser) isStartOfVibeLangMatch() bool {
	return p.token == ast.KindIdentifier && p.scanner.TokenValue() == "match" && p.isVibeLangFile() && p.lookAhead((*Parser).scanStartOfVibeLangMatch)
}

func (p *Parser) scanStartOfVibeLangMatch() bool {
	p.nextToken()
	if p.token != ast.KindOpenParenToken || p.hasPrecedingLineBreak() {
		return false
	}
	p.nextToken()
	p.parseExpressionAllowIn()
	if p.token != ast.KindCloseParenToken {
		return false
	}
	p.nextToken()
	if p.token != ast.KindOpenBraceToken || p.hasPrecedingLineBreak() {
		return false
	}
	p.nextToken()
	return p.isMatchWord("when") || p.token == ast.KindDefaultKeyword || p.token == ast.KindCloseBraceToken
}

// isStartOfVibeLangAsyncMatch reports whether the current token starts an
// async match (chapter 004, Appendix A AsyncMatchExpression): in a .vibe
// file, async and match on one line, then what starts a match.
func (p *Parser) isStartOfVibeLangAsyncMatch() bool {
	return p.token == ast.KindAsyncKeyword && p.isVibeLangFile() && p.lookAhead((*Parser).scanStartOfVibeLangAsyncMatch)
}

func (p *Parser) scanStartOfVibeLangAsyncMatch() bool {
	p.nextToken()
	if p.hasPrecedingLineBreak() || !p.isMatchWord("match") {
		return false
	}
	defer p.setVibeLangFiberContext(false)()
	saved := p.contextFlags
	defer func() { p.contextFlags = saved }()
	p.setContextFlags(ast.NodeFlagsAwaitContext, true)
	p.setContextFlags(ast.NodeFlagsYieldContext, false)
	return p.scanStartOfVibeLangMatch()
}

// parseVibeLangAsyncMatch parses async match (subject) { … } in the
// independent context [~Yield, +Await, ~Effect] (chapter 004, async match).
// It has the behavior of (async () => match (subject) { … })(): the subject,
// tests and the selected arm run in that async function, await is
// JavaScript's there, and a thrown exception, the no-match TypeError
// included, rejects the Promise. The arrow is no effect function, so try in
// it is EK0501, and in effect code the call is a Promise-producing call
// (EK0404) that an explicit bridge such as try promise(() => …) runs.
func (p *Parser) parseVibeLangAsyncMatch() *ast.Node {
	pos := p.nodePos()
	p.nextToken() // async
	modifier := p.finishNode(p.factory.NewModifier(ast.KindAsyncKeyword), pos)
	defer p.setVibeLangFiberContext(false)()
	saved := p.contextFlags
	p.setContextFlags(ast.NodeFlagsAwaitContext, true)
	p.setContextFlags(ast.NodeFlagsYieldContext, false)
	node := p.parseVibeLangMatchWith(modifier, pos)
	p.contextFlags = saved
	return node
}

// isMatchWord reports whether the current token is the identifier word.
func (p *Parser) isMatchWord(word string) bool {
	return p.token == ast.KindIdentifier && p.scanner.TokenValue() == word
}

// parseVibeLangMatch parses match (subject) { when pattern: value; ... default: value; }.
func (p *Parser) parseVibeLangMatch() *ast.Node {
	return p.parseVibeLangMatchWith(nil, p.nodePos())
}

// parseVibeLangMatchWith parses a match whose async modifier, if any, the
// caller has read; pos is where the expression starts.
func (p *Parser) parseVibeLangMatchWith(async *ast.Node, pos int) *ast.Node {
	info := &matchInfo{pos: pos, anchor: p.tokenRange(), async: async}
	p.nextToken() // match
	p.parseExpected(ast.KindOpenParenToken)
	info.subject = p.parseExpressionAllowIn()
	p.parseExpected(ast.KindCloseParenToken)
	form := VibeSyntax{Kind: VibeSyntaxMatch, Word: info.anchor, Left: p.sourceRange(info.subject)}
	if async != nil {
		form.Head = p.sourceRange(async)
	}
	if p.token == ast.KindOpenBraceToken {
		form.Open = p.tokenRange()
	}
	p.parseExpected(ast.KindOpenBraceToken)
	sawDefault := false
	armError := func(detail string) {
		info.errors = append(info.errors, matchError{707, detail, p.tokenRange()})
	}
	for p.token != ast.KindCloseBraceToken && p.token != ast.KindEndOfFile {
		arm := matchArm{anchor: p.tokenRange()}
		armForm := VibeSyntaxArm{}
		switch {
		case p.token == ast.KindDefaultKeyword:
			if sawDefault {
				armError("A match has one default arm. Remove this one.")
			}
			sawDefault = true
			p.nextToken()
		case p.isMatchWord("when"):
			if sawDefault {
				armError("The default arm comes last. Move this arm before it.")
			}
			p.nextToken()
			arm.pattern = p.parseMatchPattern()
		default:
			armError("An arm starts with when or default.")
			p.nextToken()
			continue
		}
		armForm.Head = core.NewTextRange(arm.anchor.Pos(), p.nodePos())
		if p.token == ast.KindColonToken {
			p.nextToken()
		} else {
			armError("Write : after the pattern, when P: value;.")
		}
		if p.token == ast.KindThrowKeyword {
			arm.value = p.parseVibeLangThrow(true) // VIP-7's direct throw arm
		} else {
			arm.value = p.parseAssignmentExpressionOrHigher()
		}
		arm.end = p.nodePos()
		armForm.Value = p.sourceRange(arm.value)
		switch p.token {
		case ast.KindSemicolonToken:
			armForm.Semicolon = p.tokenRange()
			p.nextToken()
		case ast.KindCommaToken:
			info.errors = append(info.errors, matchError{701, "", p.tokenRange()})
			p.nextToken()
		default:
			info.errors = append(info.errors, matchError{701, "", core.NewTextRange(arm.end, arm.end)})
		}
		info.arms = append(info.arms, arm)
		form.Arms = append(form.Arms, armForm)
	}
	if p.token == ast.KindCloseBraceToken {
		if len(info.arms) == 0 {
			info.errors = append(info.errors, matchError{707, "A match has at least one arm. Add a when or default arm.", info.anchor})
		}
		form.Close = p.tokenRange()
	}
	p.parseExpected(ast.KindCloseBraceToken)
	form.Range = core.NewTextRange(info.anchor.Pos(), p.nodePos())
	p.recordVibeSyntax(form)
	node := p.matchFunctionCall(info)
	if async != nil {
		// Always the async function's call: a return or statement position
		// does not unwrap it, as it unwraps a synchronous match.
		return node
	}
	if p.vibelangMatches == nil {
		p.vibelangMatches = map[*ast.Node]*matchInfo{}
	}
	p.vibelangMatches[node] = info
	return node
}

// combinatorWord returns "and" or "or" when the current token is that word.
func (p *Parser) combinatorWord() string {
	if p.isMatchWord("and") {
		return "and"
	}
	if p.isMatchWord("or") {
		return "or"
	}
	return ""
}

// parseMatchPattern parses a pattern: unary patterns joined by and, or by or.
// Combinators of different kinds cannot share a level (the proposal requires
// parentheses), which is EK4705.
func (p *Parser) parseMatchPattern() *pattern {
	first := p.parseMatchUnaryPattern()
	word := p.combinatorWord()
	if word == "" {
		return first
	}
	result := &pattern{kind: patternAnd, anchor: first.anchor, items: []*pattern{first}}
	if word == "or" {
		result.kind = patternOr
	}
	mixed := first.kind == patternNot && !first.parenthesized
	for w := p.combinatorWord(); w != ""; w = p.combinatorWord() {
		if w != word {
			mixed = true
		}
		p.nextToken()
		item := p.parseMatchUnaryPattern()
		if item.kind == patternNot && !item.parenthesized {
			mixed = true
		}
		result.items = append(result.items, item)
	}
	if mixed {
		result.code = 4705
	}
	return result
}

// parseMatchUnaryPattern parses not pattern, or a primary pattern.
func (p *Parser) parseMatchUnaryPattern() *pattern {
	if p.isMatchWord("not") && p.lookAhead((*Parser).nextTokenStartsPattern) {
		anchor := p.tokenRange()
		p.nextToken()
		return &pattern{kind: patternNot, anchor: anchor, items: []*pattern{p.parseMatchUnaryPattern()}}
	}
	return p.parseMatchPrimaryPattern()
}

// nextTokenStartsPattern reports whether the token after the current one, on
// the same line, can start a pattern.
func (p *Parser) nextTokenStartsPattern() bool {
	p.nextToken()
	return !p.hasPrecedingLineBreak() && p.tokenStartsPattern()
}

func (p *Parser) tokenStartsPattern() bool {
	switch p.token {
	case ast.KindIdentifier, ast.KindThisKeyword, ast.KindSuperKeyword, ast.KindLetKeyword, ast.KindConstKeyword, ast.KindVarKeyword,
		ast.KindOpenBracketToken, ast.KindOpenBraceToken, ast.KindOpenParenToken, ast.KindIfKeyword,
		ast.KindStringLiteral, ast.KindNumericLiteral, ast.KindBigIntLiteral, ast.KindNoSubstitutionTemplateLiteral, ast.KindTemplateHead,
		ast.KindTrueKeyword, ast.KindFalseKeyword, ast.KindNullKeyword, ast.KindMinusToken, ast.KindPlusToken,
		ast.KindSlashToken, ast.KindSlashEqualsToken, ast.KindLessThanToken, ast.KindGreaterThanToken,
		ast.KindLessThanEqualsToken, ast.KindGreaterThanEqualsToken, ast.KindEqualsEqualsToken,
		ast.KindExclamationEqualsToken, ast.KindEqualsEqualsEqualsToken, ast.KindExclamationEqualsEqualsToken,
		ast.KindInstanceOfKeyword, ast.KindInKeyword:
		return true
	case ast.KindImportKeyword, ast.KindNewKeyword:
		return p.isMatchMetaProperty() // import.meta or new.target
	}
	return p.isIdentifier() // a contextual keyword, such as undefined or of
}

// parseMatchPrimaryPattern parses a parenthesized pattern, a binding, an
// array or object pattern, a guard, a literal, or a variable or extractor
// pattern.
func (p *Parser) parseMatchPrimaryPattern() *pattern {
	anchor := p.tokenRange()
	switch p.token {
	case ast.KindOpenParenToken:
		p.nextToken()
		inner := p.parseMatchPattern()
		p.parseExpected(ast.KindCloseParenToken)
		inner.parenthesized = true
		return inner
	case ast.KindLetKeyword, ast.KindConstKeyword, ast.KindVarKeyword:
		flags := ast.NodeFlagsNone
		switch p.token {
		case ast.KindLetKeyword:
			flags = ast.NodeFlagsLet
		case ast.KindConstKeyword:
			flags = ast.NodeFlagsConst
		}
		p.nextToken()
		return &pattern{kind: patternBinding, anchor: anchor, bindFlags: flags, name: p.parseBindingIdentifier()}
	case ast.KindOpenBracketToken:
		result := &pattern{kind: patternArray, anchor: anchor}
		p.parseMatchListPattern(result, ast.KindCloseBracketToken)
		return result
	case ast.KindOpenBraceToken:
		return p.parseMatchObjectPattern(anchor)
	case ast.KindIfKeyword:
		p.nextToken()
		p.parseExpected(ast.KindOpenParenToken)
		expr := p.parseExpressionAllowIn()
		p.parseExpected(ast.KindCloseParenToken)
		return &pattern{kind: patternGuard, anchor: anchor, expr: expr}
	case ast.KindNoSubstitutionTemplateLiteral:
		if p.scanner.TokenFlags()&ast.TokenFlagsIsInvalid != 0 {
			p.reScanTemplateToken(false /*isTaggedTemplate*/)
		}
		return &pattern{kind: patternLiteral, anchor: anchor, expr: p.parseLiteralExpression()}
	case ast.KindTemplateHead:
		p.parseTemplateExpression(false /*isTaggedTemplate*/)
		return &pattern{kind: patternInvalid, anchor: anchor, code: 707, detail: "A template pattern cannot interpolate. Bind the value and compare it in a guard: when let v and if (v === `…`): …."}
	case ast.KindStringLiteral, ast.KindNumericLiteral, ast.KindBigIntLiteral:
		return &pattern{kind: patternLiteral, anchor: anchor, expr: p.parseLiteralExpression()}
	case ast.KindTrueKeyword, ast.KindFalseKeyword, ast.KindNullKeyword:
		return &pattern{kind: patternLiteral, anchor: anchor, expr: p.parseKeywordExpression()}
	case ast.KindMinusToken, ast.KindPlusToken:
		pos := p.nodePos()
		operator := p.token
		p.nextToken()
		if p.token == ast.KindNumericLiteral || p.token == ast.KindBigIntLiteral {
			literal := p.parseLiteralExpression()
			return &pattern{kind: patternLiteral, anchor: anchor, expr: p.finishNode(p.factory.NewPrefixUnaryExpression(operator, literal), pos)}
		}
		value := p.parseMatchValueExpression()
		return &pattern{kind: patternValue, anchor: anchor, expr: p.finishNode(p.factory.NewPrefixUnaryExpression(operator, value), pos)}
	case ast.KindSlashToken, ast.KindSlashEqualsToken:
		// A regular expression literal is a variable pattern whose matcher
		// is the expression, and with an argument list an extractor
		// (RegExp.prototype[Symbol.customMatcher]).
		p.reScanSlashToken()
		regexp := p.parseLiteralExpression()
		if p.token == ast.KindOpenParenToken && !p.hasPrecedingLineBreak() {
			result := &pattern{kind: patternExtractor, anchor: anchor, expr: regexp}
			p.parseMatchListPattern(result, ast.KindCloseParenToken)
			return result
		}
		return &pattern{kind: patternValue, anchor: anchor, expr: regexp}
	case ast.KindLessThanToken, ast.KindGreaterThanToken, ast.KindLessThanEqualsToken, ast.KindGreaterThanEqualsToken,
		ast.KindEqualsEqualsToken, ast.KindExclamationEqualsToken, ast.KindEqualsEqualsEqualsToken, ast.KindExclamationEqualsEqualsToken,
		ast.KindInstanceOfKeyword, ast.KindInKeyword:
		if p.token == ast.KindGreaterThanToken {
			p.reScanGreaterThanToken()
		}
		operator := p.token
		p.nextToken()
		expr := p.parseMatchRelationOperand(operator)
		if p.token == ast.KindOpenParenToken && !p.hasPrecedingLineBreak() {
			// The pinned operand is a literal, a member expression or its
			// signed form, never a call. Read the arguments, so the arm
			// goes on at its colon instead of reading an arrow head there.
			p.parseArgumentList()
			return &pattern{kind: patternInvalid, anchor: anchor, code: 707, detail: "A relational pattern compares with a literal or a property, not a call. Bind the value and compare it in a guard: when let v and if (v <= limit()): …."}
		}
		return &pattern{kind: patternRelation, anchor: anchor, operator: operator, expr: expr}
	}
	// A contextual keyword is a name here too, undefined and of among them.
	if p.token == ast.KindThisKeyword || p.token == ast.KindSuperKeyword || p.isIdentifier() || p.isMatchMetaProperty() {
		expr := p.parseMatchValueExpression()
		if p.token == ast.KindOpenParenToken && !p.hasPrecedingLineBreak() {
			result := &pattern{kind: patternExtractor, anchor: anchor, expr: expr}
			p.parseMatchListPattern(result, ast.KindCloseParenToken)
			return result
		}
		if p.token == ast.KindOpenBraceToken && !p.hasPrecedingLineBreak() {
			// Delivery.Sent { let tracking }: a variant and its fields (D307).
			// After any other matcher, a syntax error before, the checker
			// reports the field list (EK4706).
			result := p.parseMatchObjectPattern(p.tokenRange())
			result.kind, result.anchor, result.expr = patternVariant, anchor, expr
			return result
		}
		return &pattern{kind: patternValue, anchor: anchor, expr: expr}
	}
	return &pattern{kind: patternInvalid, anchor: anchor, code: 707, detail: "A pattern goes here: a literal, a binding, a name, or an array or object pattern."}
}

// parseMatchRelationOperand parses the operand of a relational pattern: a
// literal, a signed number, or an identifier expression, which is all that
// instanceof and in take.
func (p *Parser) parseMatchRelationOperand(operator ast.Kind) *ast.Node {
	if operator != ast.KindInstanceOfKeyword && operator != ast.KindInKeyword {
		switch p.token {
		case ast.KindNoSubstitutionTemplateLiteral:
			if p.scanner.TokenFlags()&ast.TokenFlagsIsInvalid != 0 {
				p.reScanTemplateToken(false /*isTaggedTemplate*/)
			}
			return p.parseLiteralExpression()
		case ast.KindStringLiteral, ast.KindNumericLiteral, ast.KindBigIntLiteral:
			return p.parseLiteralExpression()
		case ast.KindTrueKeyword, ast.KindFalseKeyword, ast.KindNullKeyword:
			return p.parseKeywordExpression()
		case ast.KindMinusToken, ast.KindPlusToken:
			pos := p.nodePos()
			sign := p.token
			p.nextToken()
			var operand *ast.Node
			if p.token == ast.KindNumericLiteral || p.token == ast.KindBigIntLiteral {
				operand = p.parseLiteralExpression()
			} else {
				operand = p.parseMatchValueExpression()
			}
			return p.finishNode(p.factory.NewPrefixUnaryExpression(sign, operand), pos)
		}
	}
	return p.parseMatchValueExpression()
}

// parseMatchValueExpression parses the identifier expression of a variable
// or extractor pattern: a name, then .name and [expression] accesses.
func (p *Parser) parseMatchValueExpression() *ast.Node {
	pos := p.nodePos()
	// Pattern heads and relational operands read an IdentifierReference,
	// including after a sign. Property names after the head stay unrestricted.
	if p.isReservedFiberName() {
		p.rejectReservedFiberName(p.tokenRange())
	}
	var expr *ast.Node
	switch {
	case p.token == ast.KindThisKeyword || p.token == ast.KindSuperKeyword:
		expr = p.parseKeywordExpression()
	case p.isMatchMetaProperty():
		expr = p.parseMatchMetaProperty()
	default:
		expr = p.parseIdentifier()
	}
	for {
		switch {
		case p.token == ast.KindDotToken:
			p.nextToken()
			name := p.parseRightSideOfDot(true /*allowIdentifierNames*/, true /*allowPrivateIdentifiers*/, true /*allowUnicodeEscapeSequenceInIdentifierName*/)
			expr = p.finishNode(p.factory.NewPropertyAccessExpression(expr, nil, name, ast.NodeFlagsNone), pos)
		case p.token == ast.KindOpenBracketToken && !p.hasPrecedingLineBreak():
			p.nextToken()
			argument := p.parseExpressionAllowIn()
			p.parseExpected(ast.KindCloseBracketToken)
			expr = p.finishNode(p.factory.NewElementAccessExpression(expr, nil, argument, ast.NodeFlagsNone), pos)
		default:
			return expr
		}
	}
}

// isMatchMetaProperty reports whether import.meta or new.target starts here:
// the pinned PatternMatchingMemberExpression begins with a MetaProperty too.
func (p *Parser) isMatchMetaProperty() bool {
	return (p.token == ast.KindImportKeyword || p.token == ast.KindNewKeyword) && p.lookAhead((*Parser).nextTokenIsDot)
}

// parseMatchMetaProperty parses that MetaProperty as an expression would, so
// the checker reports an unknown name or a new.target outside a function.
func (p *Parser) parseMatchMetaProperty() *ast.Node {
	pos := p.nodePos()
	keyword := p.token
	p.nextToken() // import or new
	p.nextToken() // .
	if keyword == ast.KindImportKeyword {
		p.sourceFlags |= ast.NodeFlagsPossiblyContainsImportMeta
		return p.finishNode(p.factory.NewMetaProperty(ast.KindImportKeyword, p.parseImportMetaPropertyName()), pos)
	}
	return p.finishNode(p.factory.NewMetaProperty(ast.KindNewKeyword, p.parseIdentifierName()), pos)
}

// parseMatchListPattern parses the items of an array pattern or of an
// extractor's argument list, between open and close, into result.
func (p *Parser) parseMatchListPattern(result *pattern, close ast.Kind) {
	p.nextToken() // [ or (
	for p.token != close && p.token != ast.KindEndOfFile {
		if p.token == ast.KindCommaToken {
			// An Elision: a comma where an element would start skips one
			// position, which the list must have; the comma after an element
			// separates and skips none, as in an array literal.
			result.items = append(result.items, &pattern{kind: patternElision, anchor: p.tokenRange()})
			p.nextToken()
			continue
		}
		if p.token == ast.KindDotDotDotToken {
			p.nextToken()
			result.hasRest = true
			if p.token != close && p.token != ast.KindCommaToken {
				result.rest = p.parseMatchPattern()
			}
			if p.token != close {
				// The rest element comes last, with no comma after it. Read what
				// follows as patterns, so one mistake reports once.
				misplaced := p.tokenRange()
				for p.token != close && p.token != ast.KindEndOfFile {
					if !p.parseOptional(ast.KindCommaToken) {
						if p.token == close {
							break
						}
						start := p.nodePos()
						p.parseMatchPattern()
						// A token that starts no pattern, such as `*`, is reported
						// as an invalid pattern without being read: skip it.
						if p.nodePos() == start {
							p.nextToken()
						}
					}
				}
				result.items = append(result.items, misplacedRest(misplaced))
			}
			break
		}
		item := p.parseMatchPattern()
		if p.parseOptional(ast.KindQuestionToken) {
			item.optional = true
		}
		result.items = append(result.items, item)
		if !p.parseOptional(ast.KindCommaToken) {
			break
		}
	}
	p.parseExpected(close)
}

// misplacedRest is the invalid pattern for what follows a rest pattern.
func misplacedRest(at core.TextRange) *pattern {
	return &pattern{kind: patternInvalid, anchor: at, code: 707, detail: "A rest pattern comes last, with nothing after it."}
}

// parseMatchObjectPattern parses { key, let name, key: pattern, [key]: pattern, ...pattern },
// where a key or a binding may be written key? to pass when the property is absent.
func (p *Parser) parseMatchObjectPattern(anchor core.TextRange) *pattern {
	result := &pattern{kind: patternObject, anchor: anchor}
	p.nextToken() // {
	for p.token != ast.KindCloseBraceToken && p.token != ast.KindEndOfFile {
		switch {
		case p.token == ast.KindDotDotDotToken:
			p.nextToken()
			result.hasRest = true
			result.rest = p.parseMatchPattern()
			if p.token != ast.KindCloseBraceToken {
				result.items = append(result.items, misplacedRest(p.tokenRange()))
			}
		case p.token == ast.KindLetKeyword || p.token == ast.KindConstKeyword || p.token == ast.KindVarKeyword:
			binding := p.parseMatchPrimaryPattern()
			binding.name.Flags |= ast.NodeFlagsVibeLangShorthandBinding
			key := p.vibelangSynthesized(p.factory.NewIdentifier(binding.name.Text()), binding.name.Loc)
			clause := objectClause{key: key, pattern: binding}
			clause.optional = p.parseOptional(ast.KindQuestionToken)
			if p.parseOptional(ast.KindColonToken) {
				and := &pattern{kind: patternAnd, anchor: binding.anchor, items: []*pattern{binding, p.parseMatchPattern()}}
				clause.pattern = and
			}
			result.clauses = append(result.clauses, clause)
		case p.token == ast.KindOpenBracketToken:
			p.nextToken()
			key := p.parseAssignmentExpressionOrHigher()
			p.parseExpected(ast.KindCloseBracketToken)
			optional := p.parseOptional(ast.KindQuestionToken)
			var sub *pattern
			if p.parseOptional(ast.KindColonToken) {
				sub = p.parseMatchPattern()
			}
			// A literal key reads the same as a written one, ["a"] as "a".
			result.clauses = append(result.clauses, objectClause{key: key, computed: !isLiteralKey(key), optional: optional, pattern: sub})
		default:
			key := p.parsePropertyName()
			clause := objectClause{key: key}
			if ast.IsPrivateIdentifier(key) {
				// MatchProperty takes a PropertyName, which has no private name.
				// The string key keeps the clause lowerable, so its pattern still binds.
				result.items = append(result.items, &pattern{kind: patternInvalid, anchor: key.Loc, code: 707, detail: "A pattern key cannot be a private name. Test it in a guard: when let v and if (" + key.Text() + " in v)."})
				clause.key = p.mString(key.Text(), key.Loc)
			} else if key.Kind == ast.KindComputedPropertyName {
				clause.key = key.Expression()
				clause.computed = !isLiteralKey(clause.key)
			} else if (ast.IsIdentifier(key) || ast.IsStringLiteral(key)) && key.Text() == "__proto__" {
				// The pinned draft: "It is a Syntax Error if PropertyName is a
				// LiteralPropertyName and PropName of PropertyName is "__proto__"".
				result.items = append(result.items, &pattern{kind: patternInvalid, anchor: key.Loc, code: 707, detail: "A pattern cannot name __proto__ as a key. Write the computed key [\"__proto__\"]:."})
			}
			clause.optional = p.parseOptional(ast.KindQuestionToken)
			if p.parseOptional(ast.KindColonToken) {
				clause.pattern = p.parseMatchPattern()
			}
			result.clauses = append(result.clauses, clause)
		}
		if !p.parseOptional(ast.KindCommaToken) {
			break
		}
	}
	p.parseExpected(ast.KindCloseBraceToken)
	return result
}

// isVibeLangIs reports whether the current token is the is operator: in an
// .vibe file, the identifier is on the line of its subject, followed on the
// same line by a pattern. An expression followed by an identifier is a
// TypeScript syntax error today.
func (p *Parser) isVibeLangIs() bool {
	return p.token == ast.KindIsKeyword && !p.hasPrecedingLineBreak() && p.isVibeLangFile() && p.lookAhead((*Parser).nextTokenStartsPattern)
}

// parseVibeLangIs parses subject is pattern, after subject. Without bindings
// it is a boolean expression; with bindings it is a marker claimed by its
// lexical home. A marker left without an implemented home reports EK4703.
func (p *Parser) parseVibeLangIs(subject *ast.Node, pos int) *ast.Node {
	info := &isInfo{anchor: p.tokenRange(), subject: subject}
	p.nextToken() // is
	patternStart := p.scanner.TokenStart()
	info.pattern = p.parseMatchPattern()
	p.recordVibeSyntax(VibeSyntax{Kind: VibeSyntaxIs, Word: info.anchor, Right: core.NewTextRange(patternStart, p.nodePos()), Range: core.NewTextRange(info.anchor.Pos(), p.nodePos())})
	if !patternHasBindings(info.pattern) {
		return p.isExpression(info, pos)
	}
	marker := p.patternErrorCall(4703, "", info.anchor)
	marker = p.vibelangSpanning(marker, core.NewTextRange(pos, p.nodePos()))
	if p.vibelangIsBindings == nil {
		p.vibelangIsBindings = map[*ast.Node]*isInfo{}
		p.vibelangIsHolders = map[*ast.Node]*ast.Node{}
	}
	p.vibelangIsBindings[marker] = info
	// The parentheses hold the marker until a statement claims the bindings
	// (hoistVibeLangIs); a while condition reads the marker through them.
	holder := p.mParens(marker, marker.Loc)
	p.vibelangIsHolders[marker] = holder
	return holder
}

// hoistVibeLangIs rewrites every is in expression whose pattern binds names,
// for a statement whose bindings live in the home that holds the statement
// (chapter 004, decided details 240 and 245): each binding and each subject
// or extraction the pattern holds becomes a let statement before the
// statement (through reparseList, which parseListIndex places there, or the
// recovery block for an invalid unbraced body, parseEmbeddedStatement), and the is
// becomes one boolean expression whose tests run in order and assign the
// names as they succeed: `x is { id: let id }` is
//
//	($is1 = x, true) && typeof $is1 === "object" && $is1 !== null && "id" in $is1 && (id = $is1.id, true)
//
// A binding is assigned only when its pattern has matched, so after
// `if (!(x is { id: let id })) return` the name is initialized, and a binding
// the condition skipped stays uninitialized (the emitter guards its runtime
// TDZ). Two patterns binding one name in
// one home declare it twice, which TypeScript reports (TS2451), as for two
// let statements. It returns expression itself when no is in it binds names.
func (p *Parser) hoistVibeLangIs(expression *ast.Node) *ast.Node {
	if expression == nil || len(p.vibelangIsBindings) == 0 {
		return expression
	}
	var markers []*ast.Node
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if p.vibelangIsBindings[node] != nil {
			markers = append(markers, node)
			return false
		}
		if ast.IsFunctionLike(node) || ast.IsClassLike(node) {
			// A function body, a concise arrow body and a class member are
			// homes of their own: their statements, hoistConciseBody and
			// hoistInitializerBody have claimed their bindings.
			return false
		}
		return node.ForEachChild(visit)
	}
	visit(expression)
	for _, marker := range markers {
		info := p.vibelangIsBindings[marker]
		holder := p.vibelangIsHolders[marker]
		if holder == nil {
			continue
		}
		var steps []matchStep
		path, decl := p.subjectPath(info.subject, info.anchor, "$is")
		steps = append(steps, matchStep{decl: decl})
		cache := ""
		if patternUsesCache(info.pattern) {
			cache = p.newMatchCacheName()
		}
		p.compilePattern(info.pattern, path, &steps, &matchCompile{anchor: info.anchor, cache: cache})
		var tests []*ast.Node
		for _, step := range steps {
			if step.decl != nil {
				tests = append(tests, p.hoistDeclaration(step.decl, info.anchor))
			} else {
				tests = append(tests, step.test)
			}
		}
		result := p.joinTests(tests, ast.KindAmpersandAmpersandToken, info.anchor)
		if cache != "" {
			declaration := p.matchCacheStatements(nil, cache, info.anchor)[0]
			if p.vibelangHoists == nil {
				p.vibelangHoists = map[*ast.Node]bool{}
			}
			p.vibelangHoists[declaration] = true
			p.reparseList = append(p.reparseList, declaration)
			start := p.matchCacheCall(&matchCompile{cache: cache}, "start", info.anchor)
			finish := func(value ast.Kind) *ast.Node {
				return p.mParens(p.mBinary(p.matchCacheCall(&matchCompile{cache: cache}, "finish", info.anchor), ast.KindCommaToken, p.mKeyword(value, info.anchor), info.anchor), info.anchor)
			}
			// Keep every source-bearing test inside its cache wrappers. The
			// subject assignment can precede the is token; bindings follow it.
			span := testsSpan(info.anchor, result)
			result = p.mParens(p.mBinary(
				p.mParens(p.mBinary(start, ast.KindAmpersandAmpersandToken, result, span), span),
				ast.KindAmpersandAmpersandToken, finish(ast.KindTrueKeyword), span), span)
		}
		holder.AsParenthesizedExpression().Expression = result
		p.overrideParentInImmediateChildren(holder)
		delete(p.vibelangIsBindings, marker)
		delete(p.vibelangIsHolders, marker)
	}
	return expression
}

// hoistDeclaration turns decl, the const statement a compiled pattern wrote
// for a binding or a captured subject, into a let statement without an
// initializer on reparseList, and returns the test that assigns it,
// `(name = value, true)`. The declaration keeps the name node, so the
// language service finds the binding where the pattern wrote it.
func (p *Parser) hoistDeclaration(decl *ast.Node, at core.TextRange) *ast.Node {
	declaration := decl.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0]
	name, value := declaration.Name(), declaration.Initializer()
	// A nested not has already separated this declaration from the
	// conditional initialization in its test. Move only its lexical home.
	if value == nil {
		p.reparseList = append(p.reparseList, decl)
		return p.mKeyword(ast.KindTrueKeyword, at)
	}
	hoisted := p.mConst(name, ast.NodeFlagsLet, nil, name.Loc)
	// Captured computed keys carry an explicit literal or unique-symbol type.
	// Keep it when an if/while is turns their declarations into assignments.
	hoistedDeclaration := hoisted.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0]
	hoistedDeclaration.AsVariableDeclaration().Type = declaration.Type()
	if source := p.vibelangMatchKeyTypes[declaration]; source != nil {
		// An is test can hoist an already-captured key again into its home.
		// Keep the source type attached to the declaration that binding sees.
		delete(p.vibelangMatchKeyTypes, declaration)
		p.recordMatchKeyType(hoistedDeclaration, source)
	}
	p.overrideParentInImmediateChildren(hoistedDeclaration)
	hoisted.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0].Flags |= ast.NodeFlagsVibeLangPatternHoist
	if name.Flags&ast.NodeFlagsReparsed == 0 {
		// A named binding: when another declaration of its home already
		// declares the name, the rename quick fix finds it by this mark
		// (vibelang/fix_binding_rename.go).
		hoisted.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0].Flags |= ast.NodeFlagsVibeLangIsBinding
	}
	if decl.AsVariableStatement().DeclarationList.Flags&ast.NodeFlagsConst != 0 {
		// A binding written const keeps its immutability: the hoisted let
		// carries the mark the checker reads to report an assignment to the
		// name (TS2588, vibelang/match_const.go).
		hoisted.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0].Flags |= ast.NodeFlagsVibeLangConst
	}
	if p.vibelangHoists == nil {
		p.vibelangHoists = map[*ast.Node]bool{}
	}
	p.vibelangHoists[hoisted] = true
	p.reparseList = append(p.reparseList, hoisted)
	var target *ast.Node
	if name.Flags&ast.NodeFlagsReparsed != 0 {
		target = p.mTemp(name.Text(), name.Loc)
	} else {
		target = p.mIdent(name.Text(), name.Loc)
	}
	// The assignment spans the value the source wrote, a subject before the
	// is keyword: the language service descends only into nodes whose range
	// holds a position (astnav.GetTouchingToken), so the references and the
	// definition of the subject find it where the pattern tests it.
	span := at
	if value.Flags&ast.NodeFlagsReparsed == 0 && value.Pos() >= 0 {
		span = core.NewTextRange(min(at.Pos(), value.Pos()), max(at.End(), value.End()))
	}
	assign := p.mParens(p.mBinary(target, ast.KindEqualsToken, value, span), span)
	return p.mParens(p.mBinary(assign, ast.KindCommaToken, p.mKeyword(ast.KindTrueKeyword, at), span), span)
}

// hoistStatementIs gives the bindings of an is in an expression statement, a
// variable statement, a return or a throw the home that holds the statement
// (chapter 004: the names of an is in an ordinary block expression belong to
// the nearest enclosing block), as hoistVibeLangIs does for an if head. Other
// statements claim their own bindings: an if or while condition and a for
// concurrent limit, and a for head's let list (hoistForHead).
func (p *Parser) hoistStatementIs(statement *ast.Statement) *ast.Statement {
	if statement == nil || len(p.vibelangIsBindings) == 0 {
		return statement
	}
	switch statement.Kind {
	case ast.KindExpressionStatement, ast.KindVariableStatement, ast.KindReturnStatement, ast.KindThrowStatement:
		p.hoistVibeLangIs(statement)
	}
	return statement
}

// hoistConciseBody gives the bindings of an is in a concise arrow body the
// body's own scope (chapter 004): the body becomes a block that declares them
// and returns the expression, where the block-body form would declare them.
func (p *Parser) hoistConciseBody(body *ast.Node) *ast.Node {
	if body == nil || len(p.vibelangIsBindings) == 0 {
		return body
	}
	mark := len(p.reparseList)
	p.hoistVibeLangIs(body)
	hoists := p.takeHoists(mark)
	if len(hoists) == 0 {
		return body
	}
	returned := p.vibelangSpanning(p.factory.NewReturnStatement(body), body.Loc)
	return p.mBlock(append(hoists, returned), body.Loc)
}

// hoistInitializerBody gives the bindings of an is in a class field or static
// field initializer the initializer's own scope (chapter 004: ECMAScript
// evaluates each initializer as a separate method-like body): the initializer
// becomes a function called where it stands, (() => { let …; return expr })(),
// whose arrow keeps this and super as the initializer has them.
func (p *Parser) hoistInitializerBody(initializer *ast.Node) *ast.Node {
	if initializer == nil || len(p.vibelangIsBindings) == 0 {
		return initializer
	}
	mark := len(p.reparseList)
	p.hoistVibeLangIs(initializer)
	hoists := p.takeHoists(mark)
	if len(hoists) == 0 {
		return initializer
	}
	loc := initializer.Loc
	end := core.NewTextRange(loc.End(), loc.End())
	returned := p.vibelangSpanning(p.factory.NewReturnStatement(initializer), loc)
	arrow := p.vibelangProgramArrow(nil, p.mBlock(append(hoists, returned), loc), end)
	return p.mCall(p.mParens(arrow, loc), nil, loc)
}

// hoistForHead gives the bindings of an is in a for (init; test; update) head
// their homes (chapter 004, decided detail 240): a binding from init is a let
// declared in init, which CreatePerIterationEnvironment copies into each
// iteration; a binding from test or update is a cell that an iteration's
// update, test and body share, declared in init too and marked
// NodeFlagsVibeLangIterationCell, so the checker reports a read of it in
// update as uninitialized (vibelang/match_for.go), which the copied let would
// otherwise hide. Every binding and capture becomes a declarator of init's let
// list: no init or an expression init becomes `let …, $forN = expr`; a const
// list becomes a let list whose own declarators keep const immutability
// through NodeFlagsVibeLangConst (vibelang/match_const.go); a var or using list
// has no let list to join and keeps EK4703. An init binding's declaration
// asserts definite assignment (let n!), so a read of it in the head or the
// body is not TS2454 when TypeScript cannot see that the pattern always
// matches; a skipped init binding then reads undefined where chapter 004
// has TS2454, a gap a refutability analysis closes later.
func (p *Parser) hoistForHead(initializer, condition, incrementor *ast.Node, at core.TextRange) *ast.Node {
	if len(p.vibelangIsBindings) == 0 {
		return initializer
	}
	if initializer != nil && ast.IsVariableDeclarationList(initializer) && (initializer.Flags&ast.NodeFlagsUsing != 0 || initializer.Flags&(ast.NodeFlagsLet|ast.NodeFlagsConst) == 0) {
		return initializer
	}
	mark := len(p.reparseList)
	p.hoistVibeLangIs(initializer)
	initHoists := p.takeHoists(mark)
	p.hoistVibeLangIs(condition)
	p.hoistVibeLangIs(incrementor)
	cellHoists := p.takeHoists(mark)
	if len(initHoists)+len(cellHoists) == 0 {
		return initializer
	}
	var declarators []*ast.Node
	for _, hoist := range initHoists {
		declarator := hoistedDeclarator(hoist)
		if initializer != nil && !strings.HasPrefix(declarator.Name().Text(), "$") {
			// An init binding is read by the test, the update and the body
			// of every iteration, as the detail's countdown example does.
			// TypeScript's definite-assignment check sees the pattern's
			// assignment inside the init's && chain as conditional, so the
			// declaration carries a definite-assignment assertion, let n!,
			// until a refutability analysis can tell a pattern the subject's
			// type guarantees from one it does not.
			token := p.vibelangSynthesized(p.factory.NewToken(ast.KindExclamationToken), declarator.Name().Loc)
			declarator.AsVariableDeclaration().ExclamationToken = token
			token.Parent = declarator
		}
		declarators = append(declarators, declarator)
	}
	for _, hoist := range cellHoists {
		declarator := hoistedDeclarator(hoist)
		declarator.Flags |= ast.NodeFlagsVibeLangIterationCell
		declarators = append(declarators, declarator)
	}
	switch {
	case initializer == nil:
		return p.mLetList(declarators, at)
	case ast.IsVariableDeclarationList(initializer):
		list := initializer.AsVariableDeclarationList()
		if initializer.Flags&ast.NodeFlagsConst != 0 {
			initializer.Flags = initializer.Flags&^ast.NodeFlagsConst | ast.NodeFlagsLet
			for _, declaration := range list.Declarations.Nodes {
				declaration.Flags |= ast.NodeFlagsVibeLangConst
			}
		}
		for _, declarator := range declarators {
			declarator.Parent = initializer
		}
		list.Declarations.Nodes = append(declarators, list.Declarations.Nodes...)
		// Condition and update bindings keep their written name positions,
		// which can follow the source initializer.
		initializer.Loc = testsSpan(initializer.Loc, declarators...)
		return initializer
	default:
		p.vibelangMatchTemps++
		temp := p.mTemp("$for"+strconv.Itoa(p.vibelangMatchTemps), at)
		declaration := p.vibelangSpanning(p.factory.NewVariableDeclaration(temp, nil, nil, p.valueOnly(initializer)), initializer.Loc)
		return p.mLetList(append(declarators, declaration), at)
	}
}

// forEachIsHome retains the two homes until statement lowering can keep
// source labels on the loop and the RHS's lexical ForDeclaration in TDZ.
// VIP-7 chapter 004 copies RHS bindings to each item; defaults declare fresh
// bindings in that item's environment before the source body.
type forEachIsHome struct {
	head, defaults []*ast.Node
}

func (p *Parser) recordForEachIsHome(loop *ast.Node) {
	if (loop.Kind != ast.KindForInStatement && loop.Kind != ast.KindForOfStatement) || len(p.vibelangIsBindings) == 0 {
		return
	}
	f := loop.AsForInOrOfStatement()
	if f.Initializer == nil {
		return
	}
	// Keep native head-grammar diagnostics on malformed declarations rather
	// than making them valid by moving them into an ordinary statement.
	if ast.IsVariableDeclarationList(f.Initializer) {
		declarations := f.Initializer.AsVariableDeclarationList().Declarations.Nodes
		if len(declarations) != 1 {
			return
		}
		declaration := declarations[0]
		if declaration.Initializer() != nil || declaration.Type() != nil ||
			loop.Kind == ast.KindForInStatement && ast.IsBindingPattern(declaration.Name()) {
			return
		}
	}
	mark := len(p.reparseList)
	p.hoistVibeLangIs(f.Expression)
	head := p.takeHoists(mark)
	p.hoistVibeLangIs(f.Initializer)
	defaults := p.takeHoists(mark)
	if len(head)+len(defaults) == 0 {
		return
	}
	if p.vibelangForEachHomes == nil {
		p.vibelangForEachHomes = map[*ast.Node]*forEachIsHome{}
	}
	p.vibelangForEachHomes[loop] = &forEachIsHome{head: head, defaults: defaults}
}

// hoistedDeclarator returns the declaration of the let statement hoistDeclaration wrote.
func hoistedDeclarator(statement *ast.Node) *ast.Node {
	return statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0]
}

// mLetList writes let d1, d2, … at at.
func (p *Parser) mLetList(declarators []*ast.Node, at core.TextRange) *ast.Node {
	// Hoisted loop cells retain source names in their condition or update.
	// Navigation must be able to descend through the list to those names.
	// Keep the array's original end: native trailing-comma checks read it.
	list := p.newNodeList(at, declarators)
	at = testsSpan(at, declarators...)
	return p.vibelangSpanning(p.factory.NewVariableDeclarationList(list, ast.NodeFlagsLet), at)
}

// takeHoists removes and returns the let statements hoistVibeLangIs put on
// reparseList since mark, for a home that is not the statement list.
func (p *Parser) takeHoists(mark int) []*ast.Node {
	if len(p.reparseList) == mark {
		return nil
	}
	var hoists, rest []*ast.Node
	rest = append(rest, p.reparseList[:mark]...)
	for _, e := range p.reparseList[mark:] {
		if p.vibelangHoists[e] {
			hoists = append(hoists, e)
		} else {
			rest = append(rest, e)
		}
	}
	p.reparseList = rest
	return hoists
}

// parseEmbeddedStatement parses the statement body of an if, else, loop or
// labeled statement. A lexical declaration cannot live in an unbraced body
// (TypeScript TS1156). Keep the recovery block for checking and the brace
// repair, but report EK0705 instead of silently inventing a source home.
func (p *Parser) parseEmbeddedStatement() *ast.Statement {
	mark := len(p.reparseList)
	statement := p.parseStatement()
	if statement == nil || statement.Kind == ast.KindBlock {
		return statement
	}
	hoists := p.takeHoists(mark)
	if len(hoists) == 0 {
		return statement
	}
	// One report per body, even when its pattern binds several names.
	at := statement.Loc
	for _, hoist := range hoists {
		declaration := hoistedDeclarator(hoist)
		if declaration.Flags&ast.NodeFlagsVibeLangIsBinding != 0 {
			at = declaration.Name().Loc
			break
		}
	}
	marker := p.vibelangSpanning(p.factory.NewExpressionStatement(p.patternErrorCall(705, "", at)), at)
	return p.mBlock(append(append(hoists, marker), statement), statement.Loc)
}

// patternHasBindings reports whether pat binds a name.
func patternHasBindings(pat *pattern) bool {
	if pat == nil {
		return false
	}
	switch pat.kind {
	case patternBinding:
		return true
	case patternObject, patternVariant:
		for _, clause := range pat.clauses {
			if patternHasBindings(clause.pattern) {
				return true
			}
		}
	}
	for _, item := range pat.items {
		if patternHasBindings(item) {
			return true
		}
	}
	return patternHasBindings(pat.rest)
}

// isInitializerKey identifies a hoisted declaration by its written name site.
// A duplicate gets its own binder recovery symbol; the generated initialization
// must use that symbol rather than assigning to the earlier declaration.
type isInitializerKey struct {
	name string
	loc  core.TextRange
}

var isInitializerDeclarationsKey = ast.NewSourceFileDataKey[map[isInitializerKey]*ast.Node]()

// VibeLangIsRecoveryBindingDeclaration identifies a rejected is declaration.
// The native binder keeps the original symbol in its home's locals and gives
// a duplicate its own recovery symbol. Legal homes keep ordinary inference.
func VibeLangIsRecoveryBindingDeclaration(declaration *ast.Node) bool {
	if declaration == nil || declaration.Flags&ast.NodeFlagsVibeLangPatternHoist == 0 ||
		declaration.Name() == nil || !ast.IsIdentifier(declaration.Name()) || declaration.Symbol() == nil {
		return false
	}
	name := declaration.Name().Text()
	for scope := declaration.Parent; scope != nil; scope = scope.Parent {
		if symbol := scope.Locals()[name]; symbol != nil {
			return symbol != declaration.Symbol()
		}
	}
	return false
}

// VibeLangIsInitializerDeclaration returns the recovery declaration initialized by a
// generated is-pattern assignment. Source references and source assignments
// still resolve through the ordinary lexical symbol table.
func VibeLangIsInitializerDeclaration(target *ast.Node) *ast.Node {
	if !ast.IsIdentifier(target) || target.Flags&ast.NodeFlagsReparsed == 0 ||
		target.Parent == nil || !ast.IsBinaryExpression(target.Parent) {
		return nil
	}
	binary := target.Parent.AsBinaryExpression()
	if binary.Left != target || binary.OperatorToken.Kind != ast.KindEqualsToken {
		return nil
	}
	file := ast.GetSourceFileOfNode(target)
	if file == nil || !file.IsVibeLang() {
		return nil
	}
	declarations := file.GetOrComputeData(isInitializerDeclarationsKey, func(file *ast.SourceFile) map[isInitializerKey]*ast.Node {
		declarations := map[isInitializerKey]*ast.Node{}
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if ast.IsVariableDeclaration(node) && node.Flags&ast.NodeFlagsVibeLangPatternHoist != 0 &&
				node.Name() != nil && ast.IsIdentifier(node.Name()) {
				name := node.Name()
				declarations[isInitializerKey{name.Text(), name.Loc}] = node
			}
			return node.ForEachChild(visit)
		}
		file.AsNode().ForEachChild(visit)
		return declarations
	})
	declaration := declarations[isInitializerKey{target.Text(), target.Loc}]
	if !VibeLangIsRecoveryBindingDeclaration(declaration) {
		return nil
	}
	return declaration
}

// ---------------------------------------------------------------- writing

func (p *Parser) mIdent(name string, at core.TextRange) *ast.Node {
	return p.vibelangSynthesized(p.factory.NewIdentifier(name), at)
}

// mTemp writes a reference to name, a const, parameter or label that the
// parser introduces for a match or is, such as $match1, at at, and records
// it, so that freshenVibeLangTemps can rename every reference to it.
func (p *Parser) mTemp(name string, at core.TextRange) *ast.Node {
	id := p.mIdent(name, at)
	id.Flags |= ast.NodeFlagsVibeLangTemporary
	p.vibelangTemps = append(p.vibelangTemps, id)
	return id
}

// freshenVibeLangTemps keeps the names the parser introduces for match and
// is hygienic. A subject's const ($match1), an is function's parameter
// ($is2), an extractor's values ($extracted3) and a statement's label are
// numbered per file, but the source may spell the same name: the generated
// binding would then capture the source's references in the arms, or the
// source's binding would shadow it. Once the whole file is parsed and every
// identifier it spells is known, each such name that the file spells takes
// the next free number, in every reference.
func (p *Parser) freshenVibeLangTemps(file *ast.SourceFile) {
	if len(p.vibelangTemps) == 0 {
		return
	}
	temps := make(map[*ast.Node]bool, len(p.vibelangTemps))
	names := map[string]bool{}
	for _, id := range p.vibelangTemps {
		temps[id] = true
		names[id.Text()] = true
	}
	spelled := map[string]bool{}
	helperSpelled := map[string]bool{}
	propertyCaches := map[*ast.Node]*ast.Node{}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if cache := p.vibelangPropertyCaches[node]; cache != nil {
			propertyCaches[node] = cache
		}
		if ast.IsIdentifier(node) && !temps[node] {
			spelled[node.Text()] = true
			// Data helpers occupy a lexical name. Noncomputed member names
			// and destructuring property selectors do not occupy that scope.
			memberName := false
			if node.Parent != nil {
				switch node.Parent.Kind {
				case ast.KindPropertyDeclaration, ast.KindPropertySignature,
					ast.KindMethodDeclaration, ast.KindMethodSignature,
					ast.KindGetAccessor, ast.KindSetAccessor, ast.KindEnumMember,
					ast.KindPropertyAssignment, ast.KindPropertyAccessExpression,
					ast.KindQualifiedName, ast.KindBindingElement, ast.KindImportSpecifier:
					memberName = ast.IsIdentifierName(node)
				}
			}
			if !memberName {
				helperSpelled[node.Text()] = true
			}
		}
		node.ForEachChild(visit)
		return false
	}
	file.AsNode().ForEachChild(visit)
	p.vibelangPropertyCaches = propertyCaches
	renamed := map[string]string{}
	for _, id := range p.vibelangTemps {
		name := id.Text()
		fresh, ok := renamed[name]
		if !ok {
			if !spelled[name] {
				continue
			}
			if strings.HasPrefix(name, "$") && strings.HasSuffix(name, "$Definition") {
				if !helperSpelled[name] {
					continue
				}
				// Detail83: data helpers use their own first-free suffix, not
				// the counter shared by match bindings and labels.
				for suffix := 2; ; suffix++ {
					fresh = name + "$" + strconv.Itoa(suffix)
					if !helperSpelled[fresh] && !names[fresh] {
						break
					}
				}
			} else {
				prefix := strings.TrimRight(name, "0123456789")
				for {
					p.vibelangMatchTemps++
					fresh = prefix + strconv.Itoa(p.vibelangMatchTemps)
					if !spelled[fresh] && !names[fresh] {
						break
					}
				}
			}
			names[fresh] = true
			renamed[name] = fresh
		}
		id.AsIdentifier().Text = fresh
	}
}

func (p *Parser) mToken(kind ast.Kind, at core.TextRange) *ast.Node {
	return p.vibelangSynthesized(p.factory.NewToken(kind), at)
}

func (p *Parser) mString(text string, at core.TextRange) *ast.Node {
	return p.vibelangSynthesized(p.factory.NewStringLiteral(text, ast.TokenFlagsNone), at)
}

func (p *Parser) mBinary(left *ast.Node, operator ast.Kind, right *ast.Node, at core.TextRange) *ast.Node {
	return p.vibelangSpanning(p.factory.NewBinaryExpression(nil, left, nil, p.mToken(operator, at), right), at)
}

func (p *Parser) mParens(expr *ast.Node, at core.TextRange) *ast.Node {
	return p.vibelangSpanning(p.factory.NewParenthesizedExpression(expr), at)
}

func (p *Parser) mCall(callee *ast.Node, args []*ast.Node, at core.TextRange) *ast.Node {
	return p.vibelangSpanning(p.factory.NewCallExpression(callee, nil, nil, p.newNodeList(at, args), ast.NodeFlagsNone), at)
}

// mExtractCall writes $extract(matcher, subject). A global regular expression
// literal passes its flag as the type argument, $extract<"g">, which selects
// the runtime overload typing the extracted list as matchAll's RegExpExecArray
// elements (Chapter 004, Typing); every other matcher keeps the untyped call.
func (p *Parser) mExtractCall(matcher, subject *ast.Node, at core.TextRange) *ast.Node {
	var typeArguments *ast.NodeList
	if matcher.Kind == ast.KindRegularExpressionLiteral {
		text := matcher.Text()
		if strings.Contains(text[strings.LastIndex(text, "/")+1:], "g") {
			typeArguments = p.newNodeList(at, []*ast.Node{p.vibelangSynthesized(p.factory.NewLiteralTypeNode(p.mString("g", at)), at)})
		}
	}
	return p.vibelangSpanning(p.factory.NewCallExpression(p.vibelangIntrinsic("$extract", at), nil, typeArguments, p.newNodeList(at, []*ast.Node{matcher, subject}), ast.NodeFlagsNone), at)
}

func (p *Parser) mProperty(expr *ast.Node, name string, at core.TextRange) *ast.Node {
	return p.vibelangSpanning(p.factory.NewPropertyAccessExpression(expr, nil, p.mIdent(name, at), ast.NodeFlagsNone), at)
}

func (p *Parser) mElement(expr *ast.Node, argument *ast.Node, at core.TextRange) *ast.Node {
	return p.vibelangSpanning(p.factory.NewElementAccessExpression(expr, nil, argument, ast.NodeFlagsNone), at)
}

// mPatternRead marks read, the access a pattern writes to reach a part of its
// subject, after the test that the part exists: a list's length test or an
// object pattern's in test. The source does not spell the access, and the test
// proves what an index signature leaves open, so the checker holds the read to
// neither noUncheckedIndexedAccess nor noPropertyAccessFromIndexSignature
// (isVibeLangPatternRead).
func (p *Parser) mPatternRead(read *ast.Node) *ast.Node {
	read.Flags |= ast.NodeFlagsVibeLangPatternRead
	return read
}

func (p *Parser) mNumber(n int, at core.TextRange) *ast.Node {
	return p.vibelangSynthesized(p.factory.NewNumericLiteral(strconv.Itoa(n), ast.TokenFlagsNone), at)
}

func (p *Parser) mKeyword(kind ast.Kind, at core.TextRange) *ast.Node {
	return p.vibelangSynthesized(p.factory.NewKeywordExpression(kind), at)
}

func (p *Parser) mBlock(statements []*ast.Node, at core.TextRange) *ast.Node {
	return p.vibelangSpanning(p.factory.NewBlock(p.newNodeList(at, statements), true /*multiLine*/), at)
}

func (p *Parser) mConst(name *ast.Node, flags ast.NodeFlags, init *ast.Node, at core.TextRange) *ast.Node {
	declaration := p.vibelangSpanning(p.factory.NewVariableDeclaration(name, nil, nil, init), at)
	list := p.vibelangSpanning(p.factory.NewVariableDeclarationList(p.newNodeList(at, []*ast.Node{declaration}), flags), at)
	return p.vibelangSpanning(p.factory.NewVariableStatement(nil, list), at)
}

// patternErrorCall writes $patternError(code) or $patternError(code, detail),
// which the checker reports at at.
func (p *Parser) patternErrorCall(code int, detail string, at core.TextRange) *ast.Node {
	args := []*ast.Node{p.mNumber(code, at)}
	if detail != "" {
		args = append(args, p.mString(detail, at))
	}
	return p.mCall(p.vibelangIntrinsic("$patternError", at), args, at)
}

// cloneIdentExpression writes a new copy of expr, an identifier expression:
// a name or this, followed by property and element accesses whose arguments
// are literals. It returns nil for any other expression.
func (p *Parser) cloneIdentExpression(expr *ast.Node) *ast.Node {
	switch expr.Kind {
	case ast.KindIdentifier:
		if expr.Flags&ast.NodeFlagsVibeLangTemporary != 0 {
			return p.mTemp(expr.Text(), expr.Loc)
		}
		return p.mIdent(expr.Text(), expr.Loc)
	case ast.KindThisKeyword:
		start := scanner.SkipTrivia(p.sourceText, expr.Pos())
		return p.mKeyword(ast.KindThisKeyword, core.NewTextRange(start, start+len("this")))
	case ast.KindPropertyAccessExpression:
		base := p.cloneIdentExpression(expr.Expression())
		name := expr.Name()
		if base == nil || name.Kind != ast.KindIdentifier {
			return nil
		}
		return p.vibelangSpanning(p.factory.NewPropertyAccessExpression(base, nil, p.mIdent(name.Text(), name.Loc), ast.NodeFlagsNone), expr.Loc)
	case ast.KindElementAccessExpression:
		base := p.cloneIdentExpression(expr.Expression())
		argument := expr.AsElementAccessExpression().ArgumentExpression
		if base == nil {
			return nil
		}
		var copied *ast.Node
		switch argument.Kind {
		case ast.KindStringLiteral:
			copied = p.mString(argument.Text(), argument.Loc)
		case ast.KindNumericLiteral:
			copied = p.vibelangSynthesized(p.factory.NewNumericLiteral(argument.Text(), ast.TokenFlagsNone), argument.Loc)
		default:
			return nil
		}
		return p.mElement(base, copied, expr.Loc)
	}
	return nil
}

// subjectPath holds a match or is subject in a const that reads it once,
// before any pattern runs, as JavaScript's switch reads its discriminant
// once (D214). It returns the path of the const and its declaration, to
// write first. The declaration starts at the anchor, so the references
// written at the anchor do not come before it for TypeScript's
// use-before-declaration check, and it stands outside every arm, so a
// binding that shadows the subject's name cannot put the read in its
// temporal dead zone. The checker narrows the subject through the const,
// as TypeScript narrows a switch's discriminant in its clauses
// (match_subject.go in package vibelang).
func (p *Parser) subjectPath(subject *ast.Node, anchor core.TextRange, prefix string) (matchPath, *ast.Node) {
	p.vibelangMatchTemps++
	name := prefix + strconv.Itoa(p.vibelangMatchTemps)
	decl := p.mConst(p.mTemp(name, anchor), ast.NodeFlagsConst, p.valueOnly(subject), core.NewTextRange(min(anchor.Pos(), subject.Pos()), subject.End()))
	return func() *ast.Node { return p.mTemp(name, anchor) }, decl
}

// propertyPath returns the path of the property key of base's subject.
func (p *Parser) propertyPath(base matchPath, clause objectClause, ctx *matchCompile) matchPath {
	key := clause.key
	return func() *ast.Node {
		switch {
		case !clause.computed && key.Kind == ast.KindIdentifier:
			return p.cachePatternRead(p.mPatternRead(p.mProperty(base(), key.Text(), key.Loc)), ctx)
		case !clause.computed && key.Kind == ast.KindStringLiteral:
			return p.cachePatternRead(p.mPatternRead(p.mElement(base(), p.mString(key.Text(), key.Loc), key.Loc)), ctx)
		case !clause.computed && key.Kind == ast.KindNumericLiteral:
			return p.cachePatternRead(p.mPatternRead(p.mElement(base(), p.vibelangSynthesized(p.factory.NewNumericLiteral(key.Text(), ast.TokenFlagsNone), key.Loc), key.Loc)), ctx)
		}
		return p.cachePatternRead(p.mPatternRead(p.mElement(base(), p.cloneIdentExpression(key), key.Loc)), ctx)
	}
}

func isLiteralKey(key *ast.Node) bool {
	return key.Kind == ast.KindStringLiteral || key.Kind == ast.KindNumericLiteral
}

// patternKeyType writes the type of an admitted computed name without reading
// it at runtime. Indexed-access types retain a member's unique-symbol type;
// inferring a const from that member would widen it to symbol.
func (p *Parser) patternKeyType(expr *ast.Node) *ast.Node {
	at := expr.Loc
	switch expr.Kind {
	case ast.KindIdentifier:
		return p.vibelangSynthesized(p.factory.NewTypeQueryNode(p.cloneIdentExpression(expr), nil), at)
	case ast.KindThisKeyword:
		return p.vibelangSynthesized(p.factory.NewTypeQueryNode(p.mKeyword(ast.KindThisKeyword, at), nil), at)
	case ast.KindPropertyAccessExpression:
		index := p.vibelangSynthesized(p.factory.NewLiteralTypeNode(p.mString(expr.Name().Text(), expr.Name().Loc)), at)
		return p.vibelangSynthesized(p.factory.NewIndexedAccessTypeNode(p.patternKeyType(expr.Expression()), index), at)
	case ast.KindElementAccessExpression:
		argument := expr.AsElementAccessExpression().ArgumentExpression
		var literal *ast.Node
		if argument.Kind == ast.KindStringLiteral {
			literal = p.mString(argument.Text(), argument.Loc)
		} else {
			literal = p.vibelangSynthesized(p.factory.NewNumericLiteral(argument.Text(), ast.TokenFlagsNone), argument.Loc)
		}
		index := p.vibelangSynthesized(p.factory.NewLiteralTypeNode(literal), at)
		return p.vibelangSynthesized(p.factory.NewIndexedAccessTypeNode(p.patternKeyType(expr.Expression()), index), at)
	}
	return nil // general expressions retain their checker type through source metadata
}

// capturePatternKey evaluates a computed name and ToPropertyKey once, before
// the presence test, value read and rest exclusion use it (chapter 004).
// An explicit type or the original expression type prevents unique-symbol
// widening, including after inline hoisting. The source type retains indexing checks;
// only its runtime representation changes to a string or symbol.
func (p *Parser) capturePatternKey(clause objectClause, steps *[]matchStep, ctx *matchCompile) objectClause {
	if !clause.computed {
		return clause
	}
	at := clause.key.Loc
	p.vibelangMatchTemps++
	key := "$matchKey" + strconv.Itoa(p.vibelangMatchTemps)
	original := clause.key
	complex := p.cloneIdentExpression(original) == nil
	if complex {
		// A readonly tuple retains a call's unique-symbol or literal result.
		// Its type query also gives the converted scalar a real declaration type,
		// which TypeScript uses when narrowing discriminated payloads.
		rawName := key + "Source"
		array := p.vibelangSpanning(p.factory.NewArrayLiteralExpression(p.newNodeList(at, []*ast.Node{original}), false), at)
		constType := p.vibelangSynthesized(p.factory.NewTypeReferenceNode(p.mIdent("const", at), nil), at)
		tuple := p.vibelangSpanning(p.factory.NewAsExpression(array, constType), at)
		// Keep inference of a hoisted tuple independent of its assignment target.
		unknown := p.vibelangSynthesized(p.factory.NewKeywordTypeNode(ast.KindUnknownKeyword), at)
		initializer := p.vibelangSpanning(p.factory.NewSatisfiesExpression(tuple, unknown), at)
		raw := p.mConst(p.mTemp(rawName, at), ast.NodeFlagsConst, initializer, at)
		typedRaw := raw
		if ctx.inline {
			*steps = append(*steps, matchStep{test: p.hoistDeclaration(raw, at)})
			typedRaw = p.reparseList[len(p.reparseList)-1]
		} else {
			*steps = append(*steps, matchStep{decl: raw})
		}
		rawDeclaration := typedRaw.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0]
		p.recordMatchKeyType(rawDeclaration, tuple)
		clause.key = p.vibelangSpanning(p.factory.NewElementAccessExpression(p.mTemp(rawName, at), nil, p.mNumber(0, at), ast.NodeFlagsNone), at)
	}
	sourceType := p.patternKeyType(clause.key)
	converted := p.mCall(p.vibelangIntrinsic("$propertyKey", at), []*ast.Node{clause.key}, at)
	unknown := p.vibelangSynthesized(p.factory.NewKeywordTypeNode(ast.KindUnknownKeyword), at)
	converted = p.vibelangSpanning(p.factory.NewAsExpression(converted, unknown), at)
	value := p.vibelangSpanning(p.factory.NewAsExpression(converted, sourceType), at)
	decl := p.mConst(p.mTemp(key, at), ast.NodeFlagsConst, value, at)
	typed := decl
	if ctx.inline {
		*steps = append(*steps, matchStep{test: p.hoistDeclaration(decl, at)})
		typed = p.reparseList[len(p.reparseList)-1]
	} else {
		*steps = append(*steps, matchStep{decl: decl})
	}
	declaration := typed.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0]
	declaration.AsVariableDeclaration().Type = p.patternKeyType(clause.key)
	if complex {
		p.recordMatchKeyType(declaration, original)
	}
	p.overrideParentInImmediateChildren(declaration)
	clause.key = p.mTemp(key, at)
	return clause
}

// propertyKeyTest writes "key" in path(), or key in path() for a computed key.
func (p *Parser) propertyKeyTest(path matchPath, clause objectClause, at core.TextRange, ctx *matchCompile) *ast.Node {
	key := clause.key
	var left *ast.Node
	switch {
	case !clause.computed && (key.Kind == ast.KindIdentifier || key.Kind == ast.KindStringLiteral):
		left = p.mString(key.Text(), key.Loc)
	case !clause.computed && key.Kind == ast.KindNumericLiteral:
		left = p.vibelangSynthesized(p.factory.NewNumericLiteral(key.Text(), ast.TokenFlagsNone), key.Loc)
	default:
		left = p.cloneIdentExpression(key)
	}
	return p.cachePatternRead(p.mBinary(left, ast.KindInKeyword, path(), at), ctx)
}

// BuiltinMatcher is a matcher that a pattern names without a declaration of
// the program: the class of a primitive, which typeof tests, or a variant of
// effect's Option, Exit or Result, which its module's guard tests. The
// parser writes every variable pattern as $is(matcher, subject), and the
// checker decides by the symbol the matcher resolves to whether it is the
// built-in one (match_builtins.go in package vibelang): a parameter named
// String is a variable pattern, and Option.None of a data type named Option
// is that type's variant.
type BuiltinMatcher struct {
	Module, Guard string   // effect's module and the guard that tests the variant
	Values        []string // the properties an extractor pattern yields
	TypeOf        string   // for the class of a primitive: the typeof result
}

// BuiltinMatchers are the built-in matchers by the name a pattern writes:
// Option.Some, String.
var BuiltinMatchers = map[string]BuiltinMatcher{
	"Option.Some":    {Module: "Option", Guard: "isSome", Values: []string{"value"}},
	"Option.None":    {Module: "Option", Guard: "isNone"},
	"Exit.Success":   {Module: "Exit", Guard: "isSuccess", Values: []string{"value"}},
	"Exit.Failure":   {Module: "Exit", Guard: "isFailure", Values: []string{"cause"}},
	"Result.Success": {Module: "Result", Guard: "isSuccess", Values: []string{"success"}},
	"Result.Failure": {Module: "Result", Guard: "isFailure", Values: []string{"failure"}},
	"String":         {TypeOf: "string"},
	"Number":         {TypeOf: "number"},
	"Boolean":        {TypeOf: "boolean"},
	"BigInt":         {TypeOf: "bigint"},
	"Symbol":         {TypeOf: "symbol"},
}

// BuiltinMatcherNamed returns the built-in matcher that expr, a pattern's
// matcher, names as written, String or Option.Some, or false. Whether expr
// resolves to it is the checker's to say.
func BuiltinMatcherNamed(expr *ast.Node) (BuiltinMatcher, bool) {
	builtin, ok := BuiltinMatchers[dottedName(expr)]
	return builtin, ok
}

// dottedName returns the text of expr when it is a name or a name.name, or "".
func dottedName(expr *ast.Node) string {
	switch expr.Kind {
	case ast.KindIdentifier:
		return expr.Text()
	case ast.KindPropertyAccessExpression:
		if base := expr.Expression(); base.Kind == ast.KindIdentifier && expr.Name().Kind == ast.KindIdentifier {
			return base.Text() + "." + expr.Name().Text()
		}
	}
	return ""
}

// matcherTest writes $is(matcher, subject) for pat, a variable or variant
// pattern. The call spans the matcher, so that the language service finds
// a dotted matcher's names in it, and the subject of `subject is P`, a
// source node before the matcher, for the same reason: the language
// service searches a node's children inside its range.
func (p *Parser) matcherTest(pat *pattern, path matchPath) *ast.Node {
	at := pat.anchor
	subject := path()
	span := core.NewTextRange(at.Pos(), max(at.End(), pat.expr.End()))
	if subject.Flags&ast.NodeFlagsReparsed == 0 && subject.Pos() < span.Pos() {
		span = core.NewTextRange(subject.Pos(), span.End())
	}
	return p.mCall(p.vibelangIntrinsic("$is", at), []*ast.Node{pat.expr, subject}, span)
}

// compilePattern appends the steps that match pat against path to steps.
func (p *Parser) compilePattern(pat *pattern, path matchPath, steps *[]matchStep, ctx *matchCompile) {
	at := pat.anchor
	if ctx.coverage && coveragePattern(pat).kind != patternOr && patternHasCoverageCombinator(pat) {
		start := len(*steps)
		defer func() {
			hasTest := false
			for _, step := range (*steps)[start:] {
				if step.test != nil {
					hasTest = true
					step.test.Flags |= ast.NodeFlagsVibeLangUncountedPattern
				}
			}
			if !hasTest && ctx.uncovered {
				// Binding-only combinators otherwise emit an unconditional
				// arm, so native reachability erases the coverage query.
				// This pure comparison is always true at runtime and leaves
				// a false path in the flow graph for the coverage projection.
				condition := p.mBinary(p.mNumber(0, at), ast.KindEqualsEqualsEqualsToken, p.mNumber(0, at), at)
				condition.Flags |= ast.NodeFlagsVibeLangUncountedPattern
				*steps = append(*steps, matchStep{test: condition})
			}
		}()
	}
	test := func(t *ast.Node) { *steps = append(*steps, matchStep{test: t}) }
	if ctx.checked == nil {
		p.startCheckedBindings(pat, steps, ctx)
	}
	if pat.code == 4705 {
		// Combinators sharing a level have no meaning to compile; EK4705 reports them.
		test(p.patternErrorCall(4705, "", at))
		return
	}
	switch pat.kind {
	case patternInvalid:
		if pat.code != 0 {
			test(p.patternErrorCall(pat.code, pat.detail, at))
		}
	case patternLiteral:
		if IsSignedNumberZero(pat.expr) {
			// SameValue must use the real Object constructor, independently
			// of source bindings named Object or $global. The existing
			// intrinsic also retains Object.is's native TypeScript typing.
			object := p.mProperty(p.vibelangIntrinsic("$global", at), "Object", at)
			test(p.mCall(p.mProperty(object, "is", at), []*ast.Node{path(), pat.expr}, at))
		} else {
			test(p.mBinary(path(), ast.KindEqualsEqualsEqualsToken, pat.expr, at))
		}
	case patternValue:
		if pat.expr.Kind == ast.KindIdentifier && pat.expr.Text() == "undefined" {
			test(p.mBinary(path(), ast.KindEqualsEqualsEqualsToken, pat.expr, at))
		} else {
			test(p.matcherTest(pat, path))
		}
	case patternBinding:
		if flag := ctx.checked[bindingKey(pat)]; flag != "" && pat.name != nil {
			test(p.checkedBinding(pat, path, flag, ctx))
			return
		}
		if ctx.inline {
			test(p.inlineBinding(pat, path, ctx))
			return
		}
		flags := pat.bindFlags
		value := path()
		if flags == ast.NodeFlagsNone {
			// when var x: is EK0107, as var is everywhere in a .vibe file. The
			// recovery still binds x as let, so later references check.
			// Coverage derives from the original binding pattern.
			value = p.mParens(p.mBinary(p.patternErrorCall(107, "", at), ast.KindCommaToken, value, at), at)
			flags = ast.NodeFlagsLet
		}
		*steps = append(*steps, matchStep{decl: p.mConst(pat.name, flags, value, pat.name.Loc)})
	case patternGuard:
		// The parentheses span the guard's expression, so that the language
		// service finds its names.
		test(p.mParens(pat.expr, core.NewTextRange(at.Pos(), max(at.End(), pat.expr.End()))))
	case patternRelation:
		test(p.relationTest(pat, path))
	case patternArray:
		test(p.matchCacheCall(ctx, "iterable", at, path()))
		for i, item := range pat.items {
			has := func() *ast.Node { return p.matchCacheCall(ctx, "has", at, path(), p.mNumber(i, at)) }
			value := func() *ast.Node { return p.matchCacheCall(ctx, "at", at, path(), p.mNumber(i, at)) }
			switch {
			case item.kind == patternElision:
				// An elision skips an element that must exist.
				test(has())
			case !item.optional:
				test(has())
				p.compilePattern(item, p.enterSubject(value, item, steps, ctx), steps, ctx)
			default:
				// Chapter 004: an optional element the value leaves out
				// consumes nothing, and a present one must match its pattern.
				absent := p.mBinary(has(), ast.KindEqualsEqualsEqualsToken, p.mKeyword(ast.KindFalseKeyword, at), at)
				test(p.mParens(p.joinTests([]*ast.Node{absent, p.mParens(p.inlinePattern(item, value, ctx), at)}, ast.KindBarBarToken, at), at))
			}
		}
		if pat.hasRest {
			if pat.rest != nil {
				rest := func() *ast.Node { return p.matchCacheCall(ctx, "rest", at, path(), p.mNumber(len(pat.items), at)) }
				p.compilePattern(pat.rest, p.enterSubject(rest, pat.rest, steps, ctx), steps, ctx)
			}
		} else {
			test(p.matchCacheCall(ctx, "end", at, path(), p.mNumber(len(pat.items), at)))
		}
	case patternObject, patternVariant:
		var names []func() *ast.Node
		if pat.kind == patternVariant {
			// The variant's test; its tag is never part of a rest.
			test(p.matcherTest(pat, path))
			names = append(names, func() *ast.Node { return p.mString("_tag", at) })
		} else {
			// An object pattern matches an object: typeof "object" or
			// "function", and not null. It reads no property of a primitive
			// (D441).
			// The function test comes first, so an object subject runs
			// both and coverage sees no untaken branch.
			isFunction := p.mBinary(p.vibelangSpanning(p.factory.NewTypeOfExpression(path()), at), ast.KindEqualsEqualsEqualsToken, p.mString("function", at), at)
			isObject := p.mBinary(p.vibelangSpanning(p.factory.NewTypeOfExpression(path()), at), ast.KindEqualsEqualsEqualsToken, p.mString("object", at), at)
			test(p.mParens(p.mBinary(isFunction, ast.KindBarBarToken, isObject, at), at))
			test(p.mBinary(path(), ast.KindExclamationEqualsEqualsToken, p.mKeyword(ast.KindNullKeyword, at), at))
		}
		for _, clause := range pat.clauses {
			clause = p.capturePatternKey(clause, steps, ctx)
			if !clause.optional && (pat.kind == patternObject || clause.pattern == nil) {
				test(p.propertyKeyTest(path, clause, at, ctx))
			}
			key := clause.key
			if clause.computed {
				names = append(names, func() *ast.Node { return p.cloneIdentExpression(key) })
			} else {
				names = append(names, func() *ast.Node { return p.mString(key.Text(), key.Loc) })
			}
			if clause.optional {
				switch {
				case clause.pattern == nil:
				default:
					absent := p.vibelangSpanning(p.factory.NewPrefixUnaryExpression(ast.KindExclamationToken, p.mParens(p.propertyKeyTest(path, clause, at, ctx), at)), at)
					matches := p.mParens(p.inlinePattern(clause.pattern, p.propertyPath(path, clause, ctx), ctx), at)
					test(p.mParens(p.joinTests([]*ast.Node{absent, matches}, ast.KindBarBarToken, at), at))
				}
				continue
			}
			if clause.pattern != nil {
				p.compilePattern(clause.pattern, p.enterSubject(p.propertyPath(path, clause, ctx), clause.pattern, steps, ctx), steps, ctx)
			}
		}
		for _, item := range pat.items {
			p.compilePattern(item, path, steps, ctx) // a clause VibeLang does not support (patternInvalid)
		}
		if pat.rest != nil {
			restPath := func() *ast.Node {
				var copies []*ast.Node
				for _, name := range names {
					copies = append(copies, name())
				}
				keys := p.vibelangSpanning(p.factory.NewArrayLiteralExpression(p.newNodeList(at, copies), false), at)
				return p.mCall(p.vibelangIntrinsic("$rest", at), []*ast.Node{path(), keys}, at)
			}
			p.compilePattern(pat.rest, p.enterSubject(restPath, pat.rest, steps, ctx), steps, ctx)
		}
	case patternExtractor:
		if known, ok := BuiltinMatcherNamed(pat.expr); ok && known.TypeOf != "" {
			// The test is the variable pattern's; the values are the
			// built-in extractor's, the subject or the variant's property.
			test(p.matcherTest(pat, path))
			// Extract once before checking the list, even for an elision or
			// an arity mismatch: a wrapper's valueOf() is observable.
			typeOf := p.vibelangSpanning(p.factory.NewTypeOfExpression(path()), at)
			primitive := p.mBinary(typeOf, ast.KindEqualsEqualsEqualsToken, p.mString(known.TypeOf, at), at)
			keyword := map[string]ast.Kind{
				"string": ast.KindStringKeyword, "number": ast.KindNumberKeyword,
				"boolean": ast.KindBooleanKeyword, "bigint": ast.KindBigIntKeyword,
				"symbol": ast.KindSymbolKeyword,
			}[known.TypeOf]
			// The erased bridge keeps the extraction's primitive type even
			// when a statically primitive subject makes this branch unreachable.
			unknown := p.vibelangSynthesized(p.factory.NewKeywordTypeNode(ast.KindUnknownKeyword), at)
			boxed := p.vibelangSpanning(p.factory.NewAsExpression(path(), unknown), at)
			boxed = p.vibelangSpanning(p.factory.NewAsExpression(boxed, p.vibelangSynthesized(p.factory.NewKeywordTypeNode(keyword), at)), at)
			unboxed := p.mCall(p.mProperty(p.mParens(boxed, at), "valueOf", at), nil, at)
			value := p.vibelangSpanning(p.factory.NewConditionalExpression(primitive, p.mToken(ast.KindQuestionToken, at), path(), p.mToken(ast.KindColonToken, at), unboxed), at)
			p.vibelangMatchTemps++
			name := "$primitive" + strconv.Itoa(p.vibelangMatchTemps)
			declaration := p.mConst(p.mTemp(name, at), ast.NodeFlagsConst, value, at)
			if ctx.inline {
				test(p.hoistDeclaration(declaration, at))
			} else {
				*steps = append(*steps, matchStep{decl: declaration})
			}
			values := []string{""}
			if len(pat.items) > len(values) || (!pat.hasRest && len(pat.items) != len(values)) {
				test(p.mKeyword(ast.KindFalseKeyword, at))
				return
			}
			element := func(i int) matchPath {
				return func() *ast.Node { return p.mTemp(name, at) }
			}
			for i, item := range pat.items {
				p.compilePattern(item, p.enterSubject(element(i), item, steps, ctx), steps, ctx)
			}
			if pat.rest != nil {
				restPath := func() *ast.Node {
					var elements []*ast.Node
					for i := len(pat.items); i < len(values); i++ {
						elements = append(elements, element(i)())
					}
					return p.vibelangSpanning(p.factory.NewArrayLiteralExpression(p.newNodeList(at, elements), false), at)
				}
				p.compilePattern(pat.rest, p.enterSubject(restPath, pat.rest, steps, ctx), steps, ctx)
			}
			return
		}
		// A matcher the compiler does not know: $extract runs its custom matcher.
		matcher := pat.expr
		p.vibelangMatchTemps++
		name := "$extracted" + strconv.Itoa(p.vibelangMatchTemps)
		declaration := p.mConst(p.mTemp(name, at), ast.NodeFlagsConst, p.mExtractCall(matcher, path(), at), at)
		if ctx.inline {
			test(p.hoistDeclaration(declaration, at))
		} else {
			*steps = append(*steps, matchStep{decl: declaration})
		}
		extracted := func() *ast.Node { return p.mTemp(name, at) }
		test(p.mBinary(extracted(), ast.KindExclamationEqualsEqualsToken, p.mKeyword(ast.KindFalseKeyword, at), at))
		p.compileList(pat, extracted, len(pat.items), func(i int) matchPath {
			return func() *ast.Node { return p.mPatternRead(p.mElement(extracted(), p.mNumber(i, at), at)) }
		}, func(n int) *ast.Node {
			return p.mCall(p.mProperty(extracted(), "slice", at), []*ast.Node{p.mNumber(n, at)}, at)
		}, func() *ast.Node { return p.mProperty(extracted(), "length", at) }, steps, ctx)
	case patternAnd:
		first := len(*steps)
		for _, item := range pat.items {
			p.compilePattern(item, path, steps, ctx)
		}
		if !bindsBesideOneTest(pat.items) {
			p.markUncovered(*steps, first, ctx, at)
		}
	case patternOr:
		if flags := p.checkedOrFlags(pat, ctx); len(flags) > 0 {
			test(p.mParens(p.compileCheckedOr(pat, path, flags, ctx, at), at))
			return
		}
		var alternatives []*ast.Node
		for _, item := range pat.items {
			alternatives = append(alternatives, p.mParens(p.inlinePattern(item, path, ctx), at))
		}
		test(p.mParens(p.joinTests(alternatives, ast.KindBarBarToken, at), at))
	case patternNot:
		first := len(*steps)
		inner := p.mParens(p.inlineNotPattern(pat.items[0], path, steps, ctx), at)
		test(p.vibelangSpanning(p.factory.NewPrefixUnaryExpression(ast.KindExclamationToken, inner), at))
		p.markUncovered(*steps, first, ctx, at)
	}
}

// bindsBesideOneTest reports whether at most one of items tests anything: the
// others, let x or { let key }, only bind. Such an and covers what its test
// covers, as the form vibelang --fix writes for a Match handler's parameter
// needs: { _tag: "Square" } and let square.
func bindsBesideOneTest(items []*pattern) bool {
	tests := 0
	for _, item := range items {
		if !onlyBinds(item) {
			tests++
		}
	}
	return tests <= 1
}

// onlyBinds reports whether pat binds names and tests only that the keys it
// names exist.
func onlyBinds(pat *pattern) bool {
	pat = coveragePattern(pat)
	switch pat.kind {
	case patternBinding:
		return true
	case patternObject:
		for _, clause := range pat.clauses {
			if clause.computed || clause.pattern != nil && clause.pattern.kind != patternBinding {
				return false
			}
		}
		return pat.rest == nil || pat.rest.kind == patternBinding
	}
	return false
}

// markUncovered wraps the tests of steps from first on in parentheses flagged
// NodeFlagsVibeLang, which the checker's narrowUncoveredArm reads (match_closed.go
// in package vibelang): where such a test fails, the subject stays as it was.
func (p *Parser) markUncovered(steps []matchStep, first int, ctx *matchCompile, at core.TextRange) {
	if !ctx.uncovered {
		return
	}
	for i := first; i < len(steps); i++ {
		if test := steps[i].test; test != nil {
			steps[i].test = p.mParens(test, testsSpan(at, test))
			steps[i].test.Flags |= ast.NodeFlagsVibeLang
		}
	}
}

// coveragePattern removes only irrefutable captures from conjunctions.
// Preserve the source pattern for compilation: coverage must not change the
// order or scope of bindings. A property-presence test is not irrefutable.
func coveragePattern(pat *pattern) *pattern {
	if pat == nil || pat.kind != patternAnd {
		return pat
	}
	var tested, binding *pattern
	for _, item := range pat.items {
		item = coveragePattern(item)
		if item.kind == patternBinding {
			binding = item
		} else if tested == nil {
			tested = item
		} else {
			return pat
		}
	}
	if tested != nil {
		return tested
	}
	if binding != nil {
		return binding
	}
	return pat
}

// A containing object, array or extractor cannot hide a refutable and/not
// subpattern. Irrefutable captures preserve coverage recursively. Or is
// handled per alternative, retaining the credit of its other alternatives.
func patternHasCoverageCombinator(pat *pattern) bool {
	pat = coveragePattern(pat)
	if pat == nil {
		return false
	}
	if pat.kind == patternAnd || pat.kind == patternNot {
		return true
	}
	for _, item := range pat.items {
		if patternHasCoverageCombinator(item) {
			return true
		}
	}
	for _, clause := range pat.clauses {
		if patternHasCoverageCombinator(clause.pattern) {
			return true
		}
	}
	return patternHasCoverageCombinator(pat.rest)
}

// IsSignedNumberZero reports whether expr, a literal pattern, is a Number
// literal whose value is zero written with a sign: -0, +0, -0.0, +0e0, -0x0
// or -1e-400. Such a pattern matches by SameValue; unsigned 0 matches both
// zeros by SameValueZero, and a bigint has no negative zero.
func IsSignedNumberZero(expr *ast.Node) bool {
	if expr == nil || expr.Kind != ast.KindPrefixUnaryExpression {
		return false
	}
	unary := expr.AsPrefixUnaryExpression()
	if unary.Operator != ast.KindMinusToken && unary.Operator != ast.KindPlusToken || unary.Operand.Kind != ast.KindNumericLiteral {
		return false
	}
	text := strings.ToLower(strings.ReplaceAll(unary.Operand.Text(), "_", ""))
	if len(text) > 2 && text[0] == '0' && strings.ContainsRune("xob", rune(text[1])) {
		return strings.Trim(text[2:], "0") == ""
	}
	value, err := strconv.ParseFloat(text, 64)
	return err == nil && value == 0
}

// relationTest writes the test of a relational pattern. ===, !==, == and !=
// test as the operators do, and instanceof as the operator does, so the
// checker narrows them. <, >, <=, >= and in call $relation, which is false
// for a subject the proposal does not compare: not a string, number or
// bigint, or for in, not a property key or with an operand that is not an
// object. The proposal rejects such a subject before it evaluates the
// operand, so $relates tests it first: $relates("<=", s) && $relation("<=",
// s, bound). Neither narrows the subject, as chapter 004's Typing says.
func (p *Parser) relationTest(pat *pattern, path matchPath) *ast.Node {
	at := pat.anchor
	if !isAdmittedRelation(pat.operator) {
		return p.mParens(p.mBinary(path(), pat.operator, pat.expr, testsSpan(at, pat.expr)), at)
	}
	operator := scanner.TokenToString(pat.operator)
	admits := p.mCall(p.vibelangIntrinsic("$relates", at), []*ast.Node{p.mString(operator, at), path()}, at)
	compare := p.mCall(p.vibelangIntrinsic("$relation", at), []*ast.Node{p.mString(operator, at), path(), pat.expr}, testsSpan(at, pat.expr))
	return p.mParens(p.mBinary(admits, ast.KindAmpersandAmpersandToken, compare, testsSpan(at, pat.expr)), at)
}

// isAdmittedRelation reports whether a relational pattern with operator
// tests its subject before it evaluates its operand: <, >, <=, >= and in.
func isAdmittedRelation(operator ast.Kind) bool {
	switch operator {
	case ast.KindEqualsEqualsEqualsToken, ast.KindExclamationEqualsEqualsToken, ast.KindEqualsEqualsToken,
		ast.KindExclamationEqualsToken, ast.KindInstanceOfKeyword:
		return false
	}
	return true
}

// enterSubject returns the path through which pat, the pattern of a part of a
// subject (a property, an element, an extracted value or a rest), reads that
// part. A pattern that reads it more than once, to test it and bind it, reads
// it through a const that reads the part once where pat is entered, after the
// tests that it exists, as a match reads its subject once (D214, subjectPath)
// and the TC39 proposal caches each property it reads: a getter runs once, and
// every test and binding sees one value. An inline pattern, which can hold no
// declaration, reads the part where each test stands.
func (p *Parser) enterSubject(path matchPath, pat *pattern, steps *[]matchStep, ctx *matchCompile) matchPath {
	if subjectReads(pat) < 2 || (ctx.inline && isPropertyChain(path())) {
		return path
	}
	p.vibelangMatchTemps++
	name := "$match" + strconv.Itoa(p.vibelangMatchTemps)
	// Every occurrence is a temp (mTemp), as subjectPath's are, so
	// freshenVibeLangTemps renames all of them or none. A plain identifier
	// read as one the file spells: an is that hoists this const assigns it
	// through a temp, which then took the next free number ($match6) while
	// its declaration and reads kept $match4 (Smithers agent/fs Incur.vibe).
	*steps = append(*steps, matchStep{decl: p.mConst(p.mTemp(name, pat.anchor), ast.NodeFlagsConst, path(), pat.anchor)})
	return func() *ast.Node { return p.mTemp(name, pat.anchor) }
}

// subjectReads returns how many times compilePattern, outside an inline
// pattern, reads the subject of pat: once for each test and binding of it,
// and once for each read of a part of it that is not entered through a const
// of its own (enterSubject).
func subjectReads(pat *pattern) int {
	// A part is read once, through enterSubject's const.
	part := func(pat *pattern) int { return min(subjectReads(pat), 1) }
	// An alternative is compiled inline, where each read stands.
	inline := func(pat *pattern) int {
		n := subjectReads(pat)
		if pat.kind == patternObject || pat.kind == patternArray || pat.kind == patternVariant || pat.kind == patternExtractor {
			n = max(n, 2)
		}
		return n
	}
	if pat.code == 4705 {
		return 1
	}
	n := 0
	switch pat.kind {
	case patternRelation:
		if isAdmittedRelation(pat.operator) {
			return 2 // $relates and $relation
		}
		return 1
	case patternLiteral, patternValue, patternBinding:
		return 1
	case patternArray:
		n = 2 // Array.isArray and length
		for _, item := range pat.items {
			n += part(item)
		}
	case patternObject, patternVariant:
		n = 1 // the variant's test, or the object's typeof and null tests below
		if pat.kind == patternObject {
			n++
		}
		for _, clause := range pat.clauses {
			if pat.kind == patternObject || clause.pattern == nil {
				n++ // "key" in subject
			}
			if clause.pattern != nil {
				n += part(clause.pattern)
			}
		}
		for _, item := range pat.items {
			n += subjectReads(item)
		}
	case patternExtractor:
		n = 1 // the known test, or $extract's call
		if _, ok := BuiltinMatcherNamed(pat.expr); ok {
			for _, item := range pat.items {
				n += part(item)
			}
		}
	case patternAnd:
		for _, item := range pat.items {
			n += subjectReads(item)
		}
	case patternOr, patternNot:
		for _, item := range pat.items {
			n += inline(item)
		}
	}
	if pat.rest != nil {
		n += part(pat.rest)
	}
	return n
}

// compileList appends the steps of an array pattern or argument list: the
// length test, each item against its element, and the rest pattern against
// the remaining elements.
func (p *Parser) compileList(pat *pattern, path matchPath, n int, element func(int) matchPath, remaining func(int) *ast.Node, length func() *ast.Node, steps *[]matchStep, ctx *matchCompile) {
	at := pat.anchor
	// An optional element may be absent, so the list reaches only through the
	// last element that is not optional; every position counts toward the most
	// it can hold.
	required, hasOptional := 0, false
	for i, item := range pat.items {
		if item.optional {
			hasOptional = true
		} else {
			required = i + 1
		}
	}
	switch {
	case hasOptional:
		*steps = append(*steps, matchStep{test: p.mBinary(length(), ast.KindGreaterThanEqualsToken, p.mNumber(required, at), at)})
		if !pat.hasRest {
			*steps = append(*steps, matchStep{test: p.mBinary(length(), ast.KindLessThanEqualsToken, p.mNumber(n, at), at)})
		}
	case pat.hasRest:
		*steps = append(*steps, matchStep{test: p.mBinary(length(), ast.KindGreaterThanEqualsToken, p.mNumber(n, at), at)})
	default:
		*steps = append(*steps, matchStep{test: p.mBinary(length(), ast.KindEqualsEqualsEqualsToken, p.mNumber(n, at), at)})
	}
	// An extractor's values come from the array $extract made, which the
	// checker reads through for D215's narrowing (match_extract.go); an
	// array pattern's elements are the subject's own, read once.
	enter := func(path matchPath, item *pattern) matchPath {
		if pat.kind != patternArray {
			return path
		}
		return p.enterSubject(path, item, steps, ctx)
	}
	for i, item := range pat.items {
		switch {
		case item.kind == patternElision:
		case !item.optional:
			p.compilePattern(item, enter(element(i), item), steps, ctx)
		default:
			absent := p.mBinary(length(), ast.KindLessThanEqualsToken, p.mNumber(i, at), at)
			matches := p.mParens(p.inlinePattern(item, element(i), ctx), at)
			*steps = append(*steps, matchStep{test: p.mParens(p.joinTests([]*ast.Node{absent, matches}, ast.KindBarBarToken, at), at)})
		}
	}
	if pat.rest != nil {
		p.compilePattern(pat.rest, enter(func() *ast.Node { return remaining(n) }, pat.rest), steps, ctx)
	}
}

// inlineBinding writes a binding inside or or not as the test that assigns it,
// (name = value, true), after a let in the pattern's home. Chapter 004: an or
// pattern "shares one lexical cell for a name bound with the same keyword in its
// alternatives", and "a later alternative may replace a cell initialized by a
// failed earlier alternative", so only the first alternative that binds a name
// declares it. A different keyword declares the name again, which TypeScript
// reports as it does two let statements.
func (p *Parser) inlineBinding(pat *pattern, path matchPath, ctx *matchCompile) *ast.Node {
	flags, value := pat.bindFlags, path()
	if flags == ast.NodeFlagsNone {
		// Keep the ordinary pattern binding's var diagnostic and let recovery
		// when its home requires an inline assignment.
		value = p.mParens(p.mBinary(p.patternErrorCall(107, "", pat.anchor), ast.KindCommaToken, value, pat.anchor), pat.anchor)
		flags = ast.NodeFlagsLet
	}
	key := pat.name.Text() + "/" + strconv.Itoa(int(flags))
	// A new name per lowering: a later lowering of the match discards its lets,
	// and the first ones must keep a name that still has them for a parent.
	// Preserve a written binding's identity: a synthesized identifier would
	// make hoistDeclaration register its assignment as a hygienic temporary.
	name := p.vibelangSpanning(p.factory.NewIdentifier(pat.name.Text()), pat.name.Loc)
	assign := p.hoistDeclaration(p.mConst(name, flags, value, pat.name.Loc), pat.anchor)
	if ctx.bound[key] {
		last := len(p.reparseList) - 1
		delete(p.vibelangHoists, p.reparseList[last])
		p.reparseList = p.reparseList[:last]
	}
	ctx.bound[key] = true
	return assign
}

// inlinePattern writes pat as one boolean expression, for or, not, and an
// is outside an if or while condition.
func (p *Parser) inlinePattern(pat *pattern, path matchPath, ctx *matchCompile) *ast.Node {
	if ctx.bound == nil {
		ctx.bound = map[string]bool{}
	}
	inner := &matchCompile{anchor: ctx.anchor, inline: true, coverage: ctx.coverage, uncovered: ctx.uncovered, bound: ctx.bound, cache: ctx.cache, inlineLocals: ctx.inlineLocals, checked: ctx.checked, checkedOrder: ctx.checkedOrder, orNumbers: ctx.orNumbers, laterIn: ctx.laterIn}
	mark := len(p.reparseList)
	var steps []matchStep
	if subjectReads(pat) >= 2 {
		if original := path(); !isPropertyChain(original) {
			path = p.enterSubject(func() *ast.Node { return original }, pat, &steps, inner)
		}
	}
	p.compilePattern(pat, path, &steps, inner)
	var tests []*ast.Node
	for _, step := range steps {
		if step.decl != nil {
			tests = append(tests, p.hoistDeclaration(step.decl, pat.anchor))
		} else if step.test != nil {
			tests = append(tests, step.test)
		}
	}
	if ctx.inlineLocals != nil {
		for _, hoist := range p.takeHoists(mark) {
			decl := hoistedDeclarator(hoist)
			if decl != nil && decl.Name().Flags&ast.NodeFlagsVibeLangTemporary != 0 {
				*ctx.inlineLocals = append(*ctx.inlineLocals, hoist)
				delete(p.vibelangHoists, hoist)
			} else {
				p.reparseList = append(p.reparseList, hoist)
			}
		}
	}
	if len(tests) == 0 {
		return p.mKeyword(ast.KindTrueKeyword, pat.anchor)
	}
	return p.joinTests(tests, ast.KindAmpersandAmpersandToken, pat.anchor)
}

// inlineNotPattern keeps negation's initializations in its test. Its lexical
// declarations belong to the enclosing pattern home, while the assignments
// run only when their preceding tests succeed, just as for an is expression.
func (p *Parser) inlineNotPattern(pat *pattern, path matchPath, outer *[]matchStep, ctx *matchCompile) *ast.Node {
	// An enclosing inline or still has its existing binding restriction.
	if ctx.inline {
		return p.inlinePattern(pat, path, ctx)
	}
	var steps []matchStep
	p.compilePattern(pat, path, &steps, ctx)
	var tests []*ast.Node
	for _, step := range steps {
		if step.decl != nil {
			mark := len(p.reparseList)
			tests = append(tests, p.hoistDeclaration(step.decl, pat.anchor))
			for _, declaration := range p.takeHoists(mark) {
				*outer = append(*outer, matchStep{decl: declaration})
			}
		} else {
			tests = append(tests, step.test)
		}
	}
	if len(tests) == 0 {
		return p.mKeyword(ast.KindTrueKeyword, pat.anchor)
	}
	return p.joinTests(tests, ast.KindAmpersandAmpersandToken, pat.anchor)
}

// joinTests joins tests with operator, left to right. Each join spans at
// and the source its tests hold, so that the language service finds a name in
// a later test inside it, such as NotFound in `when NotFound and { _tag }`.
func (p *Parser) joinTests(tests []*ast.Node, operator ast.Kind, at core.TextRange) *ast.Node {
	result := tests[0]
	for _, t := range tests[1:] {
		span := testsSpan(at, result, t)
		result = p.vibelangSpanning(p.factory.NewBinaryExpression(nil, result, nil, p.mToken(operator, at), t), span)
	}
	return result
}

// testsSpan returns at extended to the end of each test that holds source,
// one the parser did not synthesize.
func testsSpan(at core.TextRange, tests ...*ast.Node) core.TextRange {
	for _, test := range tests {
		if test.Flags&ast.NodeFlagsReparsed == 0 && test.End() > at.End() {
			at = core.NewTextRange(at.Pos(), test.End())
		}
		// A test that holds a subject written before the keyword starts
		// there (hoistDeclaration), and so does the chain that holds it.
		if test.Pos() >= 0 && test.Pos() < at.Pos() {
			at = core.NewTextRange(test.Pos(), at.End())
		}
	}
	return at
}

// emitSteps writes steps as statements: each run of tests becomes an if
// whose block holds the rest, each declaration a statement, and success
// runs when every test passed.
func (p *Parser) emitSteps(steps []matchStep, success []*ast.Node, at core.TextRange) []*ast.Node {
	var out []*ast.Node
	i := 0
	for i < len(steps) && steps[i].decl != nil {
		out = append(out, steps[i].decl)
		i++
	}
	if i == len(steps) {
		return append(out, success...)
	}
	var tests []*ast.Node
	for i < len(steps) && steps[i].test != nil {
		tests = append(tests, steps[i].test)
		i++
	}
	inner := p.emitSteps(steps[i:], success, at)
	// The if and its block span the statements they hold, such as an arm's
	// return of its value, so that a position in the value is inside them
	// and the language service can find the value's tokens there.
	test := p.joinTests(tests, ast.KindAmpersandAmpersandToken, at)
	span := testsSpan(at, test)
	for _, statement := range inner {
		if statement.End() > span.End() {
			span = core.NewTextRange(at.Pos(), statement.End())
		}
	}
	then := p.mBlock(inner, span)
	return append(out, p.vibelangSpanning(p.factory.NewIfStatement(test, then, nil), span))
}

// isExpression writes subject is pattern, a pattern without bindings, as a
// boolean expression. A pattern that reads its subject once tests an
// identifier expression in place, so the checker narrows it. Any other
// subject, and one that the pattern reads more than once or not at all, is
// held by the parameter of a function called on it, so it is evaluated
// once; the checker narrows an identifier expression through the parameter
// (match_subject.go in package vibelang).
func (p *Parser) isExpression(info *isInfo, pos int) *ast.Node {
	ctx := &matchCompile{anchor: info.anchor, inline: true}
	if patternUsesCache(info.pattern) {
		ctx.cache = p.newMatchCacheName()
	}
	inner := ast.SkipParentheses(info.subject)
	if p.cloneIdentExpression(inner) != nil {
		// Count the reads with copies first, so that a pattern which reads
		// the subject more than once leaves the subject node to the call
		// below.
		reads := 0
		var probeLocals []*ast.Node
		probe := *ctx
		probe.inlineLocals = &probeLocals
		temps, counter := len(p.vibelangTemps), p.vibelangMatchTemps
		p.inlinePattern(info.pattern, func() *ast.Node { reads++; return p.cloneIdentExpression(inner) }, &probe)
		p.vibelangTemps = p.vibelangTemps[:temps]
		p.vibelangMatchTemps = counter
		if reads == 1 && ctx.cache == "" && len(probeLocals) == 0 {
			return p.finishNode(p.mParens(p.inlinePattern(info.pattern, func() *ast.Node { return inner }, ctx), info.anchor), pos)
		}
	}
	p.vibelangMatchTemps++
	name := "$is" + strconv.Itoa(p.vibelangMatchTemps)
	path := func() *ast.Node { return p.mTemp(name, info.anchor) }
	var locals []*ast.Node
	ctx.inlineLocals = &locals
	body := p.inlinePattern(info.pattern, path, ctx)
	if ctx.cache != "" || len(locals) != 0 {
		// Parameters precede the body in native TypeScript. Anchoring this
		// block at is would place its parameter inside the body's range,
		// making name resolution treat it as a temporary moved into the body.
		span := body.Loc
		cacheAt := info.anchor
		statements := append(locals, p.vibelangSpanning(p.factory.NewReturnStatement(body), span))
		if ctx.cache != "" {
			statements = p.matchCacheStatements(statements, ctx.cache, cacheAt)
		}
		body = p.mBlock(statements, span)
	}
	parameter := p.vibelangSpanning(p.factory.NewParameterDeclaration(nil, nil, p.mTemp(name, info.anchor), nil, nil, nil), info.anchor)
	arrow := p.vibelangProgramArrow([]*ast.Node{parameter}, body, info.anchor)
	callee := p.mParens(arrow, arrow.Loc)
	call := p.vibelangSpanning(p.factory.NewCallExpression(callee, nil, nil, p.newNodeList(info.subject.Loc, []*ast.Node{info.subject}), ast.NodeFlagsNone), core.NewTextRange(pos, p.nodePos()))
	return p.finishNode(call, pos)
}

// matchStatements writes the arms of a match: the subject's const, then a
// block per arm whose tests guard success(value), then the default arm or
// the fallthrough for an unmatched subject.
func (p *Parser) matchStatements(info *matchInfo, success func(value *ast.Node, at core.TextRange) []*ast.Node, unmatched func(subject *ast.Node, at core.TextRange) *ast.Node) []*ast.Node {
	path, decl := p.subjectPath(info.subject, info.anchor, "$match")
	cache := ""
	for _, arm := range info.arms {
		if patternUsesCache(arm.pattern) {
			cache = p.newMatchCacheName()
			break
		}
	}
	out := []*ast.Node{decl}
	if cache != "" {
		out = p.matchCacheStatements(out, cache, info.anchor)
	}
	for _, e := range info.errors {
		out = append(out, p.vibelangSpanning(p.factory.NewExpressionStatement(p.patternErrorCall(e.code, e.detail, e.at)), info.anchor))
	}
	hasDefault := slices.ContainsFunc(info.arms, func(arm matchArm) bool { return arm.pattern == nil })
	defaulted := false
	for i := range info.arms {
		arm := &info.arms[i]
		span := core.NewTextRange(arm.anchor.Pos(), arm.end)
		var steps []matchStep
		patternMark := len(p.reparseList)
		if arm.pattern != nil {
			p.compilePattern(arm.pattern, path, &steps, &matchCompile{anchor: arm.anchor, uncovered: !hasDefault, coverage: true, cache: cache})
		}
		var patternHoists, patternTemps []*ast.Node
		for _, hoist := range p.takeHoists(patternMark) {
			declaration := hoistedDeclarator(hoist)
			if declaration != nil && declaration.Name().Flags&ast.NodeFlagsVibeLangTemporary != 0 {
				patternTemps = append(patternTemps, hoist)
			} else {
				patternHoists = append(patternHoists, hoist)
			}
		}
		if !arm.hoisted {
			// An arm is its own lexical scope (chapter 004): the bindings of
			// an is in its value or in its guard are lets of the arm's block,
			// before the tests that assign them. A match is lowered again
			// when a statement claims it (matchStatement, the do block's
			// completion), so the arm keeps its lets for that lowering.
			arm.hoisted = true
			mark := len(p.reparseList)
			p.hoistVibeLangIs(arm.value)
			for _, step := range steps {
				if step.test != nil {
					p.hoistVibeLangIs(step.test)
				}
			}
			arm.hoists = append(patternHoists, p.takeHoists(mark)...)
		}
		if arm.pattern == nil {
			statements := success(arm.value, span)
			if len(arm.hoists) != 0 {
				statements = []*ast.Node{p.mBlock(append(slices.Clone(arm.hoists), statements...), span)}
			}
			out = append(out, statements...)
			defaulted = true
			continue
		}
		// A statement may claim and lower the match again. Private pattern
		// temporaries get fresh names on each lowering; their declarations
		// must follow the current tests rather than the cached source hoists.
		hoists := append(slices.Clone(arm.hoists), patternTemps...)
		block := p.mBlock(append(hoists, p.emitSteps(steps, success(arm.value, span), arm.anchor)...), span)
		if coveragePattern(arm.pattern).kind != patternOr && patternHasCoverageCombinator(arm.pattern) {
			block.Flags |= ast.NodeFlagsVibeLangUncountedPattern
		}
		out = append(out, block)
	}
	if !defaulted && len(info.arms) > 0 {
		noMatch := p.mCall(p.vibelangIntrinsic("$noMatch", info.anchor), []*ast.Node{path()}, info.anchor)
		p.recordMatchMemberArms(noMatch, info)
		out = append(out, unmatched(noMatch, info.anchor))
	}
	return out
}

// matchFunctionCall writes a match expression as a function called where it
// stands, whose arms return their values.
func (p *Parser) matchFunctionCall(info *matchInfo) *ast.Node {
	statements := p.matchStatements(info, func(value *ast.Node, at core.TextRange) []*ast.Node {
		return []*ast.Node{p.vibelangSpanning(p.factory.NewReturnStatement(value), at)}
	}, func(noMatch *ast.Node, at core.TextRange) *ast.Node {
		return p.vibelangSpanning(p.factory.NewReturnStatement(noMatch), at)
	})
	span := core.NewTextRange(info.anchor.End(), p.nodePos())
	body := p.mBlock(statements, span)
	var arrow *ast.Node
	if info.async != nil {
		// async () => { … }: the arrow of an async match.
		arrowToken := p.vibelangSpanning(p.factory.NewToken(ast.KindEqualsGreaterThanToken), info.anchor)
		arrowToken.Flags &^= ast.NodeFlagsReparsed
		modifiers := p.newModifierList(info.async.Loc, p.nodeSliceArena.NewSlice1(info.async))
		params := p.newNodeList(core.NewTextRange(info.anchor.Pos(), info.anchor.Pos()), nil)
		arrow = p.vibelangSpanning(p.factory.NewArrowFunction(modifiers, nil, params, nil, nil, arrowToken, body), core.NewTextRange(body.Pos(), body.End()))
		p.vibelangAsyncMatches = append(p.vibelangAsyncMatches, arrow)
	} else {
		arrow = p.vibelangProgramArrow(nil, body, info.anchor)
	}
	callee := p.vibelangSpanning(p.factory.NewParenthesizedExpression(arrow), span)
	call := p.factory.NewCallExpression(callee, nil, nil, p.newNodeList(core.NewTextRange(p.nodePos(), p.nodePos()), nil), ast.NodeFlagsNone)
	return p.finishNode(call, info.pos)
}

// matchReturnStatement writes return match (...) { ... } as a block whose
// arms return their values.
func (p *Parser) matchReturnStatement(info *matchInfo, pos int) *ast.Node {
	block := p.matchReturnStatementAt(info, core.NewTextRange(pos, p.nodePos()))
	p.recordVibeLangSourceReturn(block)
	return block
}

// matchReturnStatementAt also serves do completion after parsing has moved
// past the match. Keep the block at the original statement range.
func (p *Parser) matchReturnStatementAt(info *matchInfo, loc core.TextRange) *ast.Node {
	statements := p.matchStatements(info, func(value *ast.Node, at core.TextRange) []*ast.Node {
		return []*ast.Node{p.vibelangSpanning(p.factory.NewReturnStatement(value), at)}
	}, func(noMatch *ast.Node, at core.TextRange) *ast.Node {
		return p.vibelangSpanning(p.factory.NewReturnStatement(noMatch), at)
	})
	return p.finishNodeWithEnd(p.factory.NewBlock(p.newNodeList(loc, statements), true /*multiLine*/), loc.Pos(), loc.End())
}

// matchStatement writes a match that stands as a statement as a labeled
// block whose arms evaluate their values and leave it.
func (p *Parser) matchStatement(info *matchInfo, pos int) *ast.Node {
	p.vibelangMatchTemps++
	label := "$match" + strconv.Itoa(p.vibelangMatchTemps)
	statements := p.matchStatements(info, func(value *ast.Node, at core.TextRange) []*ast.Node {
		leave := p.vibelangSpanning(p.factory.NewBreakStatement(p.mTemp(label, info.anchor)), info.anchor)
		return []*ast.Node{p.vibelangSpanning(p.factory.NewExpressionStatement(value), at), leave}
	}, func(noMatch *ast.Node, at core.TextRange) *ast.Node {
		return p.vibelangSpanning(p.factory.NewExpressionStatement(noMatch), at)
	})
	block := p.finishNode(p.factory.NewBlock(p.newNodeList(core.NewTextRange(info.anchor.End(), p.nodePos()), statements), true /*multiLine*/), info.anchor.End())
	statement := p.finishNode(p.factory.NewLabeledStatement(p.mTemp(label, info.anchor), block), pos)
	p.vibelangMatches[statement] = info
	return statement
}

// conjuncts returns the operands of the && chain expr, outermost first.
func conjuncts(expr *ast.Node) []*ast.Node {
	inner := ast.SkipParentheses(expr)
	if ast.IsBinaryExpression(inner) && inner.AsBinaryExpression().OperatorToken.Kind == ast.KindAmpersandAmpersandToken {
		b := inner.AsBinaryExpression()
		return append(conjuncts(b.Left), conjuncts(b.Right)...)
	}
	return []*ast.Node{inner}
}

// conditionSteps returns the steps of condition when an is in its && chain
// binds names, or nil.
func (p *Parser) conditionSteps(condition *ast.Node) []matchStep {
	parts := conjuncts(condition)
	found := false
	for _, part := range parts {
		if p.vibelangIsBindings[part] != nil {
			found = true
		}
	}
	if !found {
		return nil
	}
	var steps []matchStep
	for _, part := range parts {
		info := p.vibelangIsBindings[part]
		if info == nil {
			steps = append(steps, matchStep{test: part})
			continue
		}
		cache := ""
		if patternUsesCache(info.pattern) {
			cache = p.newMatchCacheName()
			steps = append(steps, matchStep{decl: p.matchCacheStatements(nil, cache, info.anchor)[0]})
		}
		path, decl := p.subjectPath(info.subject, info.anchor, "$is")
		steps = append(steps, matchStep{decl: decl})
		ctx := &matchCompile{anchor: info.anchor, cache: cache}
		p.compilePattern(info.pattern, path, &steps, ctx)
		if cache != "" {
			// The condition's native block finishes a failed/abrupt test.
			// A successful is finishes before the following conjunct/body.
			finish := p.matchCacheCall(ctx, "finish", info.anchor)
			done := p.mParens(p.mBinary(finish, ast.KindCommaToken, p.mKeyword(ast.KindTrueKeyword, info.anchor), info.anchor), info.anchor)
			steps = append(steps, matchStep{test: done})
		}
	}
	return steps
}

// endsInJump reports whether statement ends with return, throw, break, or
// continue, so nothing written after it runs.
func endsInJump(statement *ast.Node) bool {
	if statement.Kind == ast.KindBlock {
		statements := statement.AsBlock().Statements.Nodes
		if len(statements) == 0 {
			return false
		}
		statement = statements[len(statements)-1]
	}
	switch statement.Kind {
	case ast.KindReturnStatement, ast.KindThrowStatement, ast.KindBreakStatement, ast.KindContinueStatement:
		return true
	}
	return false
}

// restructureVibeLangWhile rewrites while (... && x is P && ...) S, when P
// binds names, so the bindings are in scope in S and the condition runs
// before each iteration:
//
//	while (true) { if (...) { const name = ...; if (...) { S; continue } } break }
//
// An is that binds below the && chain, as in while (a || x is P) S, has the
// same loop-head home (chapter 004, Pattern bindings): each evaluation of the
// condition starts with fresh uninitialized cells that a true result shares
// with S. That is the home hoistForHead gives a for statement's test, so the
// loop becomes for (<cells>; condition; ) S, as restructureVibeLangDo does.
// It returns nil when no is in the condition binds names.
func (p *Parser) restructureVibeLangWhile(condition, body *ast.Node, pos int) *ast.Node {
	anchor := p.keywordRangeAt(pos, "while")
	nested := false
	for _, part := range conjuncts(condition) {
		if p.vibelangIsBindings[part] == nil && p.bindsIs(part) {
			nested = true
		}
	}
	if nested {
		initializer := p.hoistForHead(nil, condition, nil, anchor)
		return p.finishNode(p.factory.NewForStatement(initializer, condition, nil, body), pos)
	}
	steps := p.conditionSteps(condition)
	if steps == nil {
		return nil
	}
	success := []*ast.Node{body}
	if !endsInJump(body) {
		success = append(success, p.vibelangSpanning(p.factory.NewContinueStatement(nil), anchor))
	}
	statements := append(p.emitSteps(steps, success, anchor), p.vibelangSpanning(p.factory.NewBreakStatement(nil), anchor))
	loopBody := p.finishNode(p.factory.NewBlock(p.newNodeList(core.NewTextRange(pos, p.nodePos()), statements), true /*multiLine*/), pos)
	return p.finishNode(p.factory.NewWhileStatement(p.mKeyword(ast.KindTrueKeyword, anchor), loopBody), pos)
}

// restructureVibeLangDo rewrites do S while (... x is P ...), when P binds
// names, as a for statement whose head declares the bindings as the
// per-iteration cells hoistForHead gives a test binding (chapter 004, Pattern
// bindings): the first iteration skips the condition, so S runs with the cells
// uninitialized, and each later iteration evaluates the condition in a fresh
// environment before S, which shares the cells with it:
//
//	for (let $do1 = true, <cells>; $do1 || condition; $do1 = false) S
//
// The condition still runs right after each S, a continue reaches it, a break
// leaves the loop and a label stays on the statement. A direct read of a
// binding in S precedes the declaration, TS2448, as the chapter states. It
// returns nil when no is in the condition binds names.
func (p *Parser) restructureVibeLangDo(body, condition *ast.Node, pos int) *ast.Node {
	if !p.bindsIs(condition) {
		return nil
	}
	anchor := p.keywordRangeAt(pos, "do")
	p.vibelangMatchTemps++
	name := "$do" + strconv.Itoa(p.vibelangMatchTemps)
	first := p.vibelangSpanning(p.factory.NewVariableDeclaration(p.mTemp(name, anchor), nil, nil, p.mKeyword(ast.KindTrueKeyword, anchor)), anchor)
	test := p.mBinary(p.mTemp(name, anchor), ast.KindBarBarToken, condition, anchor)
	update := p.mBinary(p.mTemp(name, anchor), ast.KindEqualsToken, p.mKeyword(ast.KindFalseKeyword, anchor), anchor)
	initializer := p.hoistForHead(p.mLetList([]*ast.Node{first}, anchor), test, update, anchor)
	return p.finishNode(p.factory.NewForStatement(initializer, test, update, body), pos)
}

// bindsIs reports whether an is in expression binds names, outside the nested
// callables and classes that are homes of their own.
func (p *Parser) bindsIs(expression *ast.Node) bool {
	if expression == nil || len(p.vibelangIsBindings) == 0 {
		return false
	}
	found := false
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case p.vibelangIsBindings[node] != nil:
			found = true
			return true
		case ast.IsFunctionLike(node) || ast.IsClassLike(node):
			return false
		}
		return node.ForEachChild(visit)
	}
	visit(expression)
	return found
}

// keywordRangeAt returns the range of keyword, which starts the statement at pos.
func (p *Parser) keywordRangeAt(pos int, keyword string) core.TextRange {
	start := scanner.SkipTrivia(p.sourceText, pos)
	return core.NewTextRange(start, min(start+len(keyword), len(p.sourceText)))
}

// checkVibeLangAsyncMatchJumps runs before do lowering, while source targets
// and source returns still exist. Synchronous expression wrappers are transparent;
// nested source callables and nested async matches own their jumps.
func (p *Parser) checkVibeLangAsyncMatchJumps(file *ast.SourceFile) {
	if len(p.vibelangAsyncMatches) != 0 {
		p.vibelangAsyncMatchJumps = map[*ast.Node]bool{}
	}
	for _, boundary := range p.vibelangAsyncMatches {
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if ast.IsFunctionLike(n) && !isSynthesizedArrow(n) || ast.IsClassElement(n) {
				// Names and decorators run where the member is defined; its body
				// and field initializer keep their own source execution boundary.
				for _, decorator := range n.Decorators() {
					visit(decorator)
				}
				if name := n.Name(); name != nil && ast.IsComputedPropertyName(name) {
					visit(name)
				}
				return false
			}
			switch n.Kind {
			case ast.KindBlock:
				if p.vibelangSourceReturns[n] {
					p.vibelangAsyncMatchJumps[n] = true
					p.doError(p.skipRangeTrivia(n.Loc), 706, "return cannot leave an async match. Return a value from the arm instead.")
				}
			case ast.KindReturnStatement:
				if p.vibelangSourceReturns[n] {
					p.vibelangAsyncMatchJumps[n] = true
					p.doError(p.skipRangeTrivia(n.Loc), 706, "return cannot leave an async match. Return a value from the arm instead.")
				}
			case ast.KindBreakStatement, ast.KindContinueStatement:
				if !jumpTargetWithin(n, boundary) && asyncMatchHasOuterTarget(n, boundary) {
					p.vibelangAsyncMatchJumps[n] = true
					p.doError(p.skipRangeTrivia(n.Loc), 706, "{0} cannot leave an async match. Keep its target inside the async match.", keywordOf(n))
				}
			}
			n.ForEachChild(visit)
			return false
		}
		boundary.Body().ForEachChild(visit)
	}
	if len(p.vibelangAsyncMatches) != 0 {
		file.GetOrComputeData(asyncMatchFunctionsKey, func(*ast.SourceFile) []*ast.Node {
			return slices.Clone(p.vibelangAsyncMatches)
		})
		file.SetDiagnostics(attachFileToDiagnostics(p.diagnostics, file))
	}
}

// A jump with no source target keeps TypeScript's own diagnostic.
func asyncMatchHasOuterTarget(jump, boundary *ast.Node) bool {
	label := jump.Label()
	for child, n := boundary, boundary.Parent; n != nil; child, n = n, n.Parent {
		if ast.IsFunctionLike(n) && !isSynthesizedArrow(n) {
			// A computed name or decorator runs where the method is defined.
			if name := n.Name(); child == name && ast.IsComputedPropertyName(name) || ast.IsDecorator(child) {
				continue
			}
			return false
		}
		if label != nil {
			if ast.IsLabeledStatement(n) && n.Label().Text() == label.Text() {
				return true
			}
		} else if ast.IsIterationStatement(n, false) || jump.Kind == ast.KindBreakStatement && n.Kind == ast.KindSwitchStatement {
			return true
		}
	}
	return false
}

// Generated match-arm returns are not source jumps. Record source return
// identity before the parser replaces return match with its statement block.
func (p *Parser) recordVibeLangSourceReturn(node *ast.Node) {
	if !p.isVibeLangFile() {
		return
	}
	if p.vibelangSourceReturns == nil {
		p.vibelangSourceReturns = map[*ast.Node]bool{}
	}
	p.vibelangSourceReturns[node] = true
}

var asyncMatchFunctionsKey = ast.NewSourceFileDataKey[[]*ast.Node]()

// VibeLangAsyncMatches returns the native async boundaries written for source
// async match expressions. Their calls produce Promises in the enclosing context.
func VibeLangAsyncMatches(file *ast.SourceFile) []*ast.Node {
	return file.GetOrComputeData(asyncMatchFunctionsKey, func(*ast.SourceFile) []*ast.Node { return nil })
}
