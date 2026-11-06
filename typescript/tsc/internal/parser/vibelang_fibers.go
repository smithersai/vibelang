package parser

import (
	"fmt"
	"strconv"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// The fiber forms of a .vibe file (D166-D180) parse into calls of the
// prelude's fork and of the runtime's $await, $select, and $forConcurrent, so
// the checker, the analyzer, and the lowering treat them as the calls they
// abbreviate.
//
//	fork getUser(id)                  fork(getUser(id))
//	fork { poll(queue) }              fork(() => { poll(queue) })
//	await user                        $await(user)
//	for concurrent(8) (const id of ids) save(id)
//	                                  $forConcurrent(ids, 8, (id) => { save(id) })
//
// select parses as a labeled block that races its cases and runs the winner's
// statements; see parseVibeLangSelect. The calls are not flagged NodeFlagsVibeLang,
// which marks the schema declaration's Schema.Struct calls (schemas.go);
// vibelang/fibers.go knows them by their synthesized callee.

// tokenRange returns the range of the current token, without its leading trivia.
func (p *Parser) tokenRange() core.TextRange {
	return core.NewTextRange(p.scanner.TokenStart(), p.scanner.TokenEnd())
}

// isStartOfVibeLangFork recognizes the reserved operator in source Effect
// context (VIP-17, amended). Outside it, only unambiguous legacy forms
// are recovered for their outside-effect diagnostics and migration.
func (p *Parser) isStartOfVibeLangFork() bool {
	return p.token == ast.KindIdentifier && p.scanner.TokenValue() == "fork" && p.isVibeLangFile() && (p.opts.VibeLangFiberOperations.Has(p.scanner.TokenStart()) || p.vibelangFiberContext && !p.lookAhead((*Parser).nextTokenIsEqualsGreaterThan) || p.lookAhead((*Parser).nextTokenStartsLegacyForkOperand))
}

func (p *Parser) nextTokenStartsLegacyForkOperand() bool {
	p.nextToken()
	if p.token == ast.KindDotToken {
		return p.legacyForkOwnerHasOperand()
	}
	if p.hasPrecedingLineBreak() {
		return false
	}
	switch p.token {
	case ast.KindDoKeyword:
		return p.lookAhead((*Parser).nextTokenIsOpenBraceOnSameLine)
	case ast.KindIdentifier, ast.KindThisKeyword, ast.KindNewKeyword, ast.KindSuperKeyword, ast.KindOpenBraceToken, ast.KindAwaitKeyword:
		return true
	}
	return false
}

// parenthesesLeadToArrow reports whether the parentheses at the current token
// are an arrow's parameters. The mapper's parse sees a written effect block
// that way once it blanks the keyword: effect { … } reads as ()=> { … } at the
// same offsets, so fork's operand there is an arrow, not a unary expression.
func (p *Parser) parenthesesLeadToArrow() bool {
	return p.skipParentheses() && p.token == ast.KindEqualsGreaterThanToken
}

// forkOwners maps each owner of fork.owner (VIP-17) to the runtime helper that
// gives the checker its signature. Lowering writes Effect's own operation.
var forkOwners = map[string]string{"in": "$forkIn", "scoped": "$forkScoped", "detached": "$forkDetach"}

// ForkOwnerMessage is EK1705's text: a name after fork. other than the three
// owners. %s is the name.
const ForkOwnerMessage = "fork.%s is not a fork owner: write fork.in(scope), fork.scoped or fork.detached before the operand, or fork alone."

// legacyForkOwnerHasOperand recovers a named owner outside effect code. An
// operand after the owner is a TypeScript syntax error, so a valid member
// access or call on a variable named fork keeps its reading.
func (p *Parser) legacyForkOwnerHasOperand() bool {
	p.nextToken() // .
	if !tokenIsIdentifierOrKeyword(p.token) {
		return false
	}
	owner := p.scanner.TokenValue()
	if _, ok := forkOwners[owner]; !ok {
		return false
	}
	p.nextToken()
	if owner == "in" && (p.token != ast.KindOpenParenToken || !p.skipParentheses()) {
		return false
	}
	if p.hasPrecedingLineBreak() {
		return false
	}
	switch p.token {
	case ast.KindIdentifier, ast.KindThisKeyword, ast.KindNewKeyword, ast.KindSuperKeyword, ast.KindAwaitKeyword:
		return true
	}
	return false
}

// skipParentheses moves past the balanced parentheses at the current token, and
// reports false at the end of the file.
func (p *Parser) skipParentheses() bool {
	for depth := 0; ; {
		switch p.token {
		case ast.KindOpenParenToken:
			depth++
		case ast.KindCloseParenToken:
			depth--
		case ast.KindEndOfFile:
			return false
		}
		p.nextToken()
		if depth == 0 {
			return true
		}
	}
}

// parseVibeLangForkOwner parses the rest of fork.in(scope), fork.scoped or
// fork.detached after fork, and returns the callee and the scope, if any.
// Whitespace, comments and line breaks may separate the tokens. Another name
// is EK1705 and reads as fork for recovery.
func (p *Parser) parseVibeLangForkOwner(callee *ast.Node, keyword core.TextRange) (*ast.Node, *ast.Node, core.TextRange) {
	p.nextToken() // .
	if !tokenIsIdentifierOrKeyword(p.token) {
		p.parseErrorAtCurrentToken(diagnostics.Identifier_expected)
		return callee, nil, keyword
	}
	name := p.scanner.TokenValue()
	end := p.scanner.TokenEnd()
	helper, ok := forkOwners[name]
	if !ok {
		p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, p.tokenRange(), "EK", diagnostics.CategoryError, 1705, fmt.Sprintf(ForkOwnerMessage, name)))
		p.hasParseError = true
		p.nextToken()
		return callee, nil, core.NewTextRange(keyword.Pos(), end)
	}
	p.nextToken()
	var scope *ast.Node
	if helper == "$forkIn" {
		p.parseExpected(ast.KindOpenParenToken)
		forms := p.vibelangSyntaxCount()
		scope = p.parseAssignmentExpressionOrHigher()
		// The formatter keeps the prefix word verbatim, so a form inside
		// the scope needs no edit of its own.
		p.vibelangSyntaxRewind(forms)
		end = p.scanner.TokenEnd()
		p.parseExpected(ast.KindCloseParenToken)
	}
	return p.vibelangIntrinsic(helper, keyword), scope, core.NewTextRange(keyword.Pos(), end)
}

// forkBraceIsObjectOperand reports whether a brace after fork in Effect code is
// an object UnaryExpression (VIP-17), as it is after await. `{ a = 1 }` parses as
// a cover grammar object, but only assignment statements can mean it here.
func (p *Parser) forkBraceIsObjectOperand() bool {
	if !p.vibelangFiberContext {
		return false
	}
	dos := len(p.vibelangDoOrder)
	defer func() {
		// mark and rewind do not cover do expressions read by the speculation.
		for _, d := range p.vibelangDoOrder[dos:] {
			delete(p.vibelangDos, d.call)
		}
		p.vibelangDoOrder = p.vibelangDoOrder[:dos]
	}()
	return p.lookAhead(func(p *Parser) bool {
		errors := len(p.diagnostics)
		object := p.parseObjectLiteralExpression()
		if len(p.diagnostics) != errors {
			return false
		}
		for _, property := range object.AsObjectLiteralExpression().Properties.Nodes {
			if ast.IsShorthandPropertyAssignment(property) && property.AsShorthandPropertyAssignment().ObjectAssignmentInitializer != nil {
				return false
			}
		}
		return true
	})
}

// parseVibeLangFork parses `fork operand` as fork(operand) and `fork { ... }` as
// fork(() => { ... }) (D166). The operand binds as await's does: fork
// getUser(id).name forks getUser(id).name, and fork a + b adds b to a fiber.
// In source Effect context fork is reserved, even before a parenthesis.
// Outside it, valid TypeScript calls keep their identifier reading. The
// synthesized callee marks the operator independently of local bindings.
// Bare brace-body recovery stays for statements until the legacy block
// fixtures migrate; in Effect code a brace that reads as an object is one.
func (p *Parser) parseVibeLangFork() *ast.Node {
	pos := p.nodePos()
	keyword := p.tokenRange()
	callee := p.parseIdentifier()
	callee.Flags |= ast.NodeFlagsVibeLangIntrinsic
	if !p.vibelangFiberContext {
		p.rejectVibeLangBlockDo("fork")
	}
	var scope *ast.Node
	word := keyword
	owned := p.token == ast.KindDotToken
	if owned {
		callee, scope, word = p.parseVibeLangForkOwner(callee, keyword)
	}
	var program *ast.Node
	if !owned && p.token == ast.KindOpenBraceToken && !p.forkBraceIsObjectOperand() {
		body := p.parseFunctionBlock(ParseFlagsNone, nil /*diagnosticMessage*/)
		p.recordVibeSyntaxBlock(VibeSyntaxForkBlock, keyword, body)
		program = p.vibelangProgramArrow(nil, body, keyword)
	} else {
		if !p.vibelangFiberContext && p.token == ast.KindOpenParenToken && p.lookAhead((*Parser).parenthesesLeadToArrow) {
			program = p.parseAssignmentExpressionOrHigher()
		} else {
			program = p.parseSimpleUnaryExpression()
		}
		p.recordVibeSyntax(VibeSyntax{Kind: VibeSyntaxPrefix, Word: word, Range: core.NewTextRange(keyword.Pos(), program.End())})
	}
	arguments := []*ast.Node{program}
	list := program.Loc
	if scope != nil {
		arguments = []*ast.Node{scope, program}
		list = core.NewTextRange(scope.Pos(), program.End())
	}
	return p.finishNode(p.factory.NewCallExpression(callee, nil, nil, p.newNodeList(list, arguments), ast.NodeFlagsNone), pos)
}

// isStartOfVibeLangJoin uses the same source Effect reservation as fork.
// Outside it, valid TypeScript identifier expressions retain their reading.
func (p *Parser) isStartOfVibeLangJoin() bool {
	return p.token == ast.KindIdentifier && p.scanner.TokenValue() == "join" && p.isVibeLangFile() && (p.opts.VibeLangFiberOperations.Has(p.scanner.TokenStart()) || p.vibelangFiberContext && !p.lookAhead((*Parser).nextTokenIsEqualsGreaterThan) || p.lookAhead((*Parser).nextTokenStartsLegacyJoinOperand))
}

func (p *Parser) nextTokenStartsLegacyJoinOperand() bool {
	keywordEnd := p.scanner.TokenEnd()
	p.nextToken()
	if p.hasPrecedingLineBreak() {
		return false
	}
	switch p.token {
	case ast.KindIdentifier, ast.KindThisKeyword, ast.KindOpenBraceToken:
		return true
	case ast.KindOpenBracketToken:
		return p.scanner.TokenStart() > keywordEnd
	}
	return false
}

// parseVibeLangJoin parses `join operand` as $join(operand), which joins a
// Fiber, or every fiber of an array or object of them, keeping the shape
// (D225). The operand binds as fork's does.
func (p *Parser) parseVibeLangJoin() *ast.Node {
	pos := p.nodePos()
	anchor := p.tokenRange()
	p.nextToken() // join
	operand := p.parseSimpleUnaryExpression()
	p.recordVibeSyntax(VibeSyntax{Kind: VibeSyntaxPrefix, Word: anchor, Range: core.NewTextRange(anchor.Pos(), operand.End())})
	callee := p.vibelangIntrinsic("$join", anchor)
	return p.finishNode(p.factory.NewCallExpression(callee, nil, nil, p.newNodeList(operand.Loc, []*ast.Node{operand}), ast.NodeFlagsNone), pos)
}

// vibelangProgramArrow returns the arrow function (params) => body, with its
// arrow synthesized at anchor, a token's range without trivia on the line
// where params end (TypeScript rejects a line break before an arrow). params
// may be nil.
func (p *Parser) vibelangProgramArrow(params []*ast.Node, body *ast.Node, anchor core.TextRange) *ast.Node {
	paramsLoc := core.NewTextRange(anchor.Pos(), anchor.Pos())
	if len(params) != 0 {
		paramsLoc = core.NewTextRange(params[0].Pos(), params[len(params)-1].End())
	}
	arrowToken := p.vibelangSynthesized(p.factory.NewToken(ast.KindEqualsGreaterThanToken), anchor)
	arrow := p.factory.NewArrowFunction(nil, nil, p.newNodeList(paramsLoc, params), nil, nil, arrowToken, body)
	start := body.Pos()
	if len(params) != 0 {
		start = params[0].Pos()
	}
	return p.vibelangSpanning(arrow, core.NewTextRange(start, body.End()))
}

// vibelangValueArrow reads a captured value without creating an Effect.
// Program arrows inherit Effect execution; lexical cell readers are native.
func (p *Parser) vibelangValueArrow(body *ast.Node, anchor core.TextRange) *ast.Node {
	arrow := p.vibelangProgramArrow(nil, body, anchor)
	arrow.AsArrowFunction().EqualsGreaterThanToken.Flags &^= ast.NodeFlagsReparsed
	return arrow
}

// inNativeAwaitContext selects the native expression grammar, without
// granting NodeFlagsAwaitContext. Namespace bodies and their plain functions
// retain TypeScript's syntax errors; effect code keeps its legacy recovery.
func (p *Parser) inNativeAwaitContext() bool {
	return p.inAwaitContext() || p.vibelangNamespaceContext && !p.vibelangFiberContext
}

// isVibeLangAwait reports whether the current token, await, is VibeLang's await:
// in a .vibe file, outside an async function, followed on the same line
// by an operand. Inside an async function, which only a boundary hatch may
// declare, await is JavaScript's.
func (p *Parser) isVibeLangAwait() bool {
	return p.token == ast.KindAwaitKeyword && p.isVibeLangFile() && !p.inNativeAwaitContext() && p.lookAhead((*Parser).nextTokenStartsAwaitOperand)
}

func (p *Parser) nextTokenStartsAwaitOperand() bool {
	p.nextToken()
	if p.hasPrecedingLineBreak() {
		return false
	}
	switch p.token {
	case ast.KindOpenBracketToken, ast.KindOpenBraceToken, ast.KindOpenParenToken, ast.KindNoSubstitutionTemplateLiteral, ast.KindTemplateHead:
		return true
	}
	return tokenIsIdentifierOrKeyword(p.token) || ast.IsLiteralKind(p.token)
}

// parseVibeLangAwait parses `await operand` as $await(operand), which waits
// for a Fiber, a Deferred, or an array or object of them (D167). The call
// runs where it stands, so its value is what it waits for and its failures
// join the function's E.
func (p *Parser) parseVibeLangAwait() *ast.Node {
	pos := p.nodePos()
	anchor := p.tokenRange()
	p.nextToken() // await
	operand := p.parseSimpleUnaryExpression()
	callee := p.vibelangIntrinsic("$await", anchor)
	call := p.finishNode(p.factory.NewCallExpression(callee, nil, nil, p.newNodeList(operand.Loc, []*ast.Node{operand}), ast.NodeFlagsNone), pos)
	return call
}

// awaitOperations maps each await operation (TC39 await operations, stage 1,
// and Await Dictionary, stage 3) to the runtime helper the parser calls
// (D196). Each behaves as the Promise method of the same name.
var awaitOperations = map[string]string{
	"all":        "$awaitAll",
	"allSettled": "$awaitAllSettled",
	"race":       "$awaitRace",
	"any":        "$awaitAny",
}

// isVibeLangAwaitOperation reports whether the current token, await, starts a
// retired await operation: in a .vibe file, await
// followed on the same line by a dot, one of the operations, and an operand.
// await. is a syntax error in a module, so the form takes no code that
// parses today.
func (p *Parser) isVibeLangAwaitOperation() bool {
	return p.token == ast.KindAwaitKeyword && p.isVibeLangFile() && p.lookAhead((*Parser).nextTokensStartAwaitOperation)
}

func (p *Parser) nextTokensStartAwaitOperation() bool {
	p.nextToken()
	if p.token != ast.KindDotToken || p.hasPrecedingLineBreak() {
		return false
	}
	p.nextToken()
	if !tokenIsIdentifierOrKeyword(p.token) || p.hasPrecedingLineBreak() {
		return false
	}
	if _, ok := awaitOperations[p.scanner.TokenValue()]; !ok {
		return false
	}
	return p.nextTokenStartsAwaitOperand()
}

// parseVibeLangAwaitOperation parses `await.all operand` as $awaitAll(operand),
// and likewise allSettled, race, and any (D196). The operand binds as await's
// does. With a parenthesized operand the form is a call in shape (D452):
// what follows the `)` applies to the form's value, so
// `await.all([a(), b()]).length` counts the results. The helper's callee
// stands on the await keyword alone: a synthesized node spans one token, and
// the dot and the operation's name belong to no child.
func (p *Parser) parseVibeLangAwaitOperation() *ast.Node {
	pos := p.nodePos()
	anchor := p.tokenRange()
	p.nextToken() // await
	p.nextToken() // .
	helper := awaitOperations[p.scanner.TokenValue()]
	p.nextToken() // the operation
	word := core.NewTextRange(anchor.Pos(), p.nodePos())
	parenthesized := p.token == ast.KindOpenParenToken
	var operand *ast.Node
	if parenthesized {
		operand = p.parseParenthesizedExpression()
	} else {
		operand = p.parseSimpleUnaryExpression()
	}
	p.recordVibeSyntax(VibeSyntax{Kind: VibeSyntaxPrefix, Word: word, Range: core.NewTextRange(anchor.Pos(), operand.End())})
	callee := p.vibelangIntrinsic(helper, anchor)
	call := p.finishNode(p.factory.NewCallExpression(callee, nil, nil, p.newNodeList(operand.Loc, []*ast.Node{operand}), ast.NodeFlagsNone), pos)
	if parenthesized {
		return p.parseCallExpressionRest(pos, call)
	}
	return call
}

// isStartOfVibeLangSelect reports whether the current token starts a select
// statement: in a .vibe file, the identifier select followed by { on the
// same line, which TypeScript cannot parse.
func (p *Parser) isStartOfVibeLangSelect() bool {
	return p.token == ast.KindIdentifier && p.scanner.TokenValue() == "select" && p.isVibeLangFile() && p.lookAhead((*Parser).nextTokenIsOpenBraceOnSameLine)
}

func (p *Parser) nextTokenIsOpenBraceOnSameLine() bool {
	p.nextToken()
	return p.token == ast.KindOpenBraceToken && !p.hasPrecedingLineBreak()
}

// selectCase is one clause of a select statement as written.
type selectCase struct {
	anchor     core.TextRange // the case or default keyword
	binding    *ast.Node      // the name or pattern after const, or nil
	program    *ast.Node      // the case's expression, or nil for default
	statements []*ast.Node
}

// parseVibeLangSelect parses
//
//	select {
//	  case const job = jobs.take(): run(job)
//	  case shutdown.await(): return
//	  case sleep("30 seconds"): heartbeat()
//	}
//
// as a labeled block (D168):
//
//	$select1: {
//	  const $selected = $select(false, () => jobs.take(), () => shutdown.await(), () => sleep("30 seconds"))
//	  if ($selected.index === 0) { const job = $selected.value; run(job) }
//	  else if ($selected.index === 1) { return }
//	  else if ($selected.index === 2) { heartbeat() }
//	}
//
// $select starts each case in its own fiber, in order; the first to finish
// wins, the others are interrupted, and a failure propagates. A case that
// finishes while the cases are starting stops the rest from starting, so of
// cases that are ready at once, the first written wins. A default clause runs
// when no case finishes while they start; its index is -1. The $selected
// result is a union discriminated by index, so each branch sees its case's
// value. A break in a clause leaves the select, as it leaves a switch: the
// parser labels it with the block's label. continue and return keep their
// meaning.
func (p *Parser) parseVibeLangSelect() *ast.Node {
	pos := p.nodePos()
	anchor := p.tokenRange()
	p.retiredControlForm(anchor, 4607, RetiredSelectMessage)
	p.nextToken() // select
	p.parseExpected(ast.KindOpenBraceToken)
	var cases []selectCase
	for p.token == ast.KindCaseKeyword || p.token == ast.KindDefaultKeyword {
		c := selectCase{anchor: p.tokenRange()}
		if p.token == ast.KindDefaultKeyword {
			p.nextToken()
		} else {
			p.nextToken() // case
			if p.token == ast.KindConstKeyword {
				p.nextToken()
				c.binding = p.parseIdentifierOrPattern()
				p.parseExpected(ast.KindEqualsToken)
				c.program = p.parseAssignmentExpressionOrHigher()
			} else {
				c.program = p.parseExpressionAllowIn()
			}
		}
		p.parseExpected(ast.KindColonToken)
		c.statements = p.parseList(PCSwitchClauseStatements, (*Parser).parseStatement).Nodes
		cases = append(cases, c)
	}
	p.parseExpected(ast.KindCloseBraceToken)

	p.vibelangSelects++
	labelName := "$select" + strconv.Itoa(p.vibelangSelects)
	selected := func(loc core.TextRange) *ast.Node {
		return p.vibelangSynthesized(p.factory.NewIdentifier("$selected"), loc)
	}

	// const $selected = $select(hasDefault, () => program, ...)
	hasDefault := false
	args := []*ast.Node{nil}
	for _, c := range cases {
		if c.program == nil {
			hasDefault = true
			continue
		}
		args = append(args, p.vibelangProgramArrow(nil, c.program, c.anchor))
	}
	args[0] = p.vibelangSynthesized(p.factory.NewKeywordExpression(core.IfElse(hasDefault, ast.KindTrueKeyword, ast.KindFalseKeyword)), anchor)
	// These wrappers contain written case expressions. Cover them all and
	// keep the wrappers visible to token lookup; only the generated names
	// and literals are synthesized. Otherwise references/hover/rename skip
	// the written callees during recovery of this retired form.
	programsSpan := anchor
	for _, c := range cases {
		if c.program != nil {
			programsSpan = core.NewTextRange(anchor.Pos(), c.program.End())
		}
	}
	callee := p.vibelangIntrinsic("$select", anchor)
	call := p.vibelangSpanning(p.factory.NewCallExpression(callee, nil, nil, p.newNodeList(programsSpan, args), ast.NodeFlagsNone), programsSpan)
	declaration := p.vibelangSpanning(p.factory.NewVariableDeclaration(selected(anchor), nil, nil, call), programsSpan)
	list := p.vibelangSpanning(p.factory.NewVariableDeclarationList(p.newNodeList(programsSpan, []*ast.Node{declaration}), ast.NodeFlagsConst), programsSpan)
	statements := []*ast.Node{p.vibelangSpanning(p.factory.NewVariableStatement(nil, list), programsSpan)}

	// if ($selected.index === i) { ... } else if ...
	var chain *ast.Node
	index := 0
	branches := make([]*ast.Node, len(cases))
	tests := make([]*ast.Node, len(cases))
	for i, c := range cases {
		var value *ast.Node
		if c.program == nil {
			one := p.vibelangSynthesized(p.factory.NewNumericLiteral("1", ast.TokenFlagsNone), c.anchor)
			value = p.vibelangSynthesized(p.factory.NewPrefixUnaryExpression(ast.KindMinusToken, one), c.anchor)
		} else {
			value = p.vibelangSynthesized(p.factory.NewNumericLiteral(strconv.Itoa(index), ast.TokenFlagsNone), c.anchor)
			index++
		}
		indexName := p.vibelangSynthesized(p.factory.NewIdentifier("index"), c.anchor)
		access := p.vibelangSynthesized(p.factory.NewPropertyAccessExpression(selected(c.anchor), nil, indexName, ast.NodeFlagsNone), c.anchor)
		operator := p.vibelangSynthesized(p.factory.NewToken(ast.KindEqualsEqualsEqualsToken), c.anchor)
		tests[i] = p.vibelangSynthesized(p.factory.NewBinaryExpression(nil, access, nil, operator, value), c.anchor)
		body := c.statements
		if c.binding != nil {
			valueName := p.vibelangSynthesized(p.factory.NewIdentifier("value"), c.binding.Loc)
			read := p.vibelangSynthesized(p.factory.NewPropertyAccessExpression(selected(c.binding.Loc), nil, valueName, ast.NodeFlagsNone), c.binding.Loc)
			bound := p.vibelangSpanning(p.factory.NewVariableDeclaration(c.binding, nil, nil, read), c.binding.Loc)
			boundList := p.vibelangSpanning(p.factory.NewVariableDeclarationList(p.newNodeList(c.binding.Loc, []*ast.Node{bound}), ast.NodeFlagsConst), c.binding.Loc)
			body = append([]*ast.Node{p.vibelangSpanning(p.factory.NewVariableStatement(nil, boundList), c.binding.Loc)}, body...)
		}
		// An empty arm still contains its written head and binding.
		end := c.anchor.End()
		if c.program != nil {
			end = max(end, c.program.End())
		}
		if c.binding != nil {
			end = max(end, c.binding.End())
		}
		if len(c.statements) != 0 {
			end = max(end, c.statements[len(c.statements)-1].End())
		}
		span := core.NewTextRange(c.anchor.Pos(), end)
		branches[i] = p.vibelangSpanning(p.factory.NewBlock(p.newNodeList(span, body), true /*multiLine*/), span)
	}
	// The last clause, or the default clause wherever it is written, is the
	// chain's final else, so a select whose clauses all return ends the
	// function for TypeScript's control flow, as a switch with a default does.
	order := make([]int, 0, len(cases))
	last := len(cases) - 1
	for i, c := range cases {
		if c.program == nil {
			last = i
		} else {
			order = append(order, i)
		}
	}
	if last >= 0 && cases[last].program != nil {
		order = order[:len(order)-1]
	}
	if last >= 0 {
		chain = branches[last]
		for j := len(order) - 1; j >= 0; j-- {
			i := order[j]
			// The default arm can precede a later case in source even though
			// it is the final else. Cover both branches for source navigation.
			span := core.NewTextRange(min(cases[i].anchor.Pos(), chain.Pos()), max(branches[i].End(), chain.End()))
			chain = p.vibelangSpanning(p.factory.NewIfStatement(tests[i], branches[i], chain), span)
		}
	}
	if chain != nil {
		statements = append(statements, chain)
	}
	label := p.vibelangSynthesized(p.factory.NewIdentifier(labelName), anchor)
	for _, c := range cases {
		for _, statement := range c.statements {
			p.labelSelectBreaks(statement, labelName)
		}
	}
	// The block is not flagged: a Block flagged NodeFlagsVibeLang is a provide block (provide.go).
	block := p.finishNode(p.factory.NewBlock(p.newNodeList(core.NewTextRange(anchor.End(), p.nodePos()), statements), true /*multiLine*/), anchor.End())
	result := p.finishNode(p.factory.NewLabeledStatement(label, block), pos)
	result.Flags |= ast.NodeFlagsVibeLang
	p.recordVibeSyntax(VibeSyntax{Kind: VibeSyntaxStatement, Word: anchor, Range: core.NewTextRange(anchor.Pos(), result.End())})
	return result
}

// labelSelectBreaks gives each unlabeled break in node that would leave the
// select the select's label, so it leaves the select as a break leaves a
// switch. A break inside a loop, a switch, or a nested function keeps its
// target.
func (p *Parser) labelSelectBreaks(node *ast.Node, label string) {
	switch {
	case node == nil:
		return
	case node.Kind == ast.KindBreakStatement:
		if b := node.AsBreakStatement(); b.Label == nil {
			b.Label = p.vibelangSynthesized(p.factory.NewIdentifier(label), p.jumpKeywordRange(node))
			b.Label.Parent = node
		}
		return
	case ast.IsIterationStatement(node, false /*lookInLabeledStatements*/), node.Kind == ast.KindSwitchStatement, isFunctionOrClassBoundary(node):
		return
	}
	node.ForEachChild(func(child *ast.Node) bool {
		p.labelSelectBreaks(child, label)
		return false
	})
}

// jumpKeywordRange returns the range of the keyword of node, a break or
// continue statement, for the nodes that stand in for it.
func (p *Parser) jumpKeywordRange(node *ast.Node) core.TextRange {
	start := scanner.SkipTrivia(p.sourceText, node.Pos())
	keyword := "break"
	if node.Kind == ast.KindContinueStatement {
		keyword = "continue"
	}
	return core.NewTextRange(start, min(start+len(keyword), node.End()))
}

// isFunctionOrClassBoundary reports whether node starts code that a jump in
// its parent cannot leave.
func isFunctionOrClassBoundary(node *ast.Node) bool {
	return ast.IsFunctionLike(node) || ast.IsClassLike(node) || node.Kind == ast.KindClassStaticBlockDeclaration
}

// isVibeLangConcurrentFor reports whether the current token, after for, starts
// for concurrent: in a .vibe file, the identifier concurrent followed by (
// with ordinary token separation, as await follows for in for await.
func (p *Parser) isVibeLangConcurrentFor() bool {
	return p.token == ast.KindIdentifier && p.scanner.TokenValue() == "concurrent" && p.isVibeLangFile() && p.lookAhead((*Parser).nextTokenIsOpenParen)
}

func (p *Parser) nextTokenIsOpenParenOnSameLine() bool {
	p.nextToken()
	return p.token == ast.KindOpenParenToken && !p.hasPrecedingLineBreak()
}

// nextTokenStartsConcurrentDeclaration recognizes both valid declarations
// and native declaration kinds recovered for EK1906. `using` alone can be
// a limit expression or an assignment head, so only consume its declaration
// spelling here.
func (p *Parser) nextTokenStartsConcurrentDeclaration() bool {
	p.nextToken()
	switch p.token {
	case ast.KindConstKeyword, ast.KindLetKeyword, ast.KindVarKeyword:
		return true
	case ast.KindUsingKeyword:
		return p.lookAhead((*Parser).nextTokenIsBindingIdentifierOrStartOfDestructuringOnSameLineDisallowOf)
	case ast.KindAwaitKeyword:
		return p.lookAhead(func(p *Parser) bool { return p.nextToken() == ast.KindUsingKeyword })
	}
	return false
}

// parseVibeLangConcurrentFor parses, after for,
//
//	for concurrent(8) (const id of ids) save(fetchPage(id))
//
// as the statement $forConcurrent(ids, 8, (id) => { save(fetchPage(id)) })
// (D169): one fiber per item, at most the limit at once, all joined before
// the loop ends, and a failure interrupts the rest. Without a limit the
// second argument is undefined. The body is a function, so it parses as one:
// a continue that would go to the next item returns from it instead, a break
// that would leave the loop is flagged for EK1903, and a return the body
// writes is EK1904 (both reported by the checker).
func (p *Parser) parseVibeLangConcurrentFor(pos int) *ast.Node {
	anchor := p.tokenRange()
	p.nextToken() // concurrent
	var limit, assignmentHead *ast.Node
	var head core.TextRange
	if p.token == ast.KindOpenParenToken && !p.lookAhead((*Parser).nextTokenStartsConcurrentDeclaration) {
		p.nextToken()
		head = p.tokenRange()
		first := p.parseExpressionAllowIn()
		if p.token == ast.KindOfKeyword {
			// An assignment head has no declaration keyword. Parse the group
			// once, then recover it as the head instead of as a limit.
			assignmentHead = first
		} else {
			// The limit runs before the loop head exists (detail 249).
			// The optional limit is one AssignmentExpression (VIP-19). Keep
			// the complete comma tree for recovery and its parentheses fix.
			if ast.IsBinaryExpression(first) && first.AsBinaryExpression().OperatorToken.Kind == ast.KindCommaToken {
				p.parseErrorAtRange(p.skipRangeTrivia(first.AsBinaryExpression().OperatorToken.Loc), diagnostics.X_0_expected, ")")
			}
			limit = p.hoistVibeLangIs(first)
			p.parseExpected(ast.KindCloseParenToken)
		}
	}
	forKeyword := scanner.SkipTrivia(p.sourceText, pos)
	p.recordVibeSyntax(VibeSyntax{Kind: VibeSyntaxForConcurrent, Word: core.NewTextRange(forKeyword, forKeyword+len("for")), Head: core.NewTextRange(anchor.Pos(), p.nodePos()), Range: core.NewTextRange(forKeyword, p.nodePos())})
	declarationKind := ast.NodeFlagsConst
	var binding *ast.Node
	if assignmentHead != nil {
		p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, head, "EK", diagnostics.CategoryError, ConcurrentHeadDiagnosticCode, ConcurrentHeadDiagnosticText))
		binding = assignmentHead
		if binding.Kind != ast.KindIdentifier {
			binding = p.vibelangSynthesized(p.factory.NewIdentifier("$invalidConcurrentHead"), binding.Loc)
		}
	} else {
		p.parseExpected(ast.KindOpenParenToken)
		head = p.tokenRange()
		if p.token == ast.KindLetKeyword {
			declarationKind = ast.NodeFlagsLet
		}
		valid := p.token == ast.KindConstKeyword || p.token == ast.KindLetKeyword
		if !valid {
			p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, head, "EK", diagnostics.CategoryError, ConcurrentHeadDiagnosticCode, ConcurrentHeadDiagnosticText))
		}
		nativeDeclaration := valid || p.token == ast.KindVarKeyword || p.token == ast.KindUsingKeyword && p.lookAhead((*Parser).nextTokenIsBindingIdentifierOrStartOfDestructuringOnSameLineDisallowOf) || p.token == ast.KindAwaitKeyword && p.lookAhead(func(p *Parser) bool { return p.nextToken() == ast.KindUsingKeyword })
		if nativeDeclaration {
			if p.token == ast.KindAwaitKeyword {
				p.nextToken()
			}
			p.nextToken()
			binding = p.parseIdentifierOrPattern()
		} else {
			binding = p.parseLeftHandSideExpressionOrHigher()
			if binding.Kind != ast.KindIdentifier {
				binding = p.vibelangSynthesized(p.factory.NewIdentifier("$invalidConcurrentHead"), binding.Loc)
			}
		}
	}

	ofKeyword := p.tokenRange()
	p.parseExpected(ast.KindOfKeyword)
	mark := len(p.reparseList)
	p.hoistVibeLangIs(binding)
	defaults := p.takeHoists(mark)
	items := p.parseAssignmentExpressionOrHigher()
	p.hoistVibeLangIs(items)
	headBindings := p.takeHoists(mark)
	p.parseExpected(ast.KindCloseParenToken)
	saveContextFlags := p.contextFlags
	// A concurrent item body keeps its enclosing producer yield context.
	p.setContextFlags(ast.NodeFlagsAwaitContext, false)
	body := p.parseEmbeddedStatement()
	p.contextFlags = saveContextFlags
	// The source body has its own scope below the callback parameter, as a
	// for...of body does below its head binding. Keep its braces so a body
	// declaration may shadow the iteration binding.
	body = p.vibelangSpanning(p.factory.NewBlock(p.newNodeList(body.Loc, []*ast.Node{body}), true /*multiLine*/), body.Loc)
	p.rewriteConcurrentJumps(body, false /*inSwitch*/, "")
	// The source head is a declaration from the native iterated value, not
	// a contextually typed callback parameter. This preserves any and lets
	// TypeScript narrow the head normally. Pattern defaults and computed
	// keys also run in this item region.
	name := p.mTemp("$concurrentItem", ofKeyword)
	item := p.mTemp("$concurrentItem", ofKeyword)
	headDeclaration := p.vibelangSpanning(p.factory.NewVariableDeclaration(binding, nil /*exclamationToken*/, nil /*type*/, item), binding.Loc)
	headList := p.vibelangSpanning(p.factory.NewVariableDeclarationList(p.newNodeList(binding.Loc, []*ast.Node{headDeclaration}), declarationKind), binding.Loc)
	headStatement := p.vibelangSpanning(p.factory.NewVariableStatement(nil /*modifiers*/, headList), binding.Loc)
	// The block is finished already, so the new headStatement's parents are set here.
	p.overrideParentInImmediateChildren(headDeclaration)
	p.overrideParentInImmediateChildren(headList)
	p.overrideParentInImmediateChildren(headStatement)
	headStatement.Parent = body
	bodyStatements := body.AsBlock().Statements
	// The generated block also owns the source head. Navigation must be able
	// to descend to that declaration before the written body begins.
	body.Loc = core.NewTextRange(binding.Pos(), body.End())
	body.AsBlock().Statements = p.newNodeList(body.Loc, append([]*ast.Node{headStatement}, bodyStatements.Nodes...))
	parameter := p.vibelangSpanning(p.factory.NewParameterDeclaration(nil, nil, name, nil, nil, nil), binding.Loc)
	// The item's binding keeps the kind its head declares: a const binding,
	// destructured or not, is a constant, so assigning it is TS2588, as in
	// a for...of loop.
	parameter.Flags |= declarationKind & ast.NodeFlagsConst
	arrow := p.vibelangProgramArrow([]*ast.Node{parameter}, body, ofKeyword)
	arrow.Flags |= ast.NodeFlagsVibeLang // a for concurrent body (fibers.go)
	if limit == nil {
		// A missing limit must not read a source binding named undefined.
		zero := p.vibelangSynthesized(p.factory.NewNumericLiteral("0", ast.TokenFlagsNone), anchor)
		limit = p.vibelangSynthesized(p.factory.NewVoidExpression(zero), anchor)
	}
	callee := p.vibelangIntrinsic("$forConcurrent", anchor)
	call := p.vibelangSpanning(p.factory.NewCallExpression(callee, nil, nil, p.newNodeList(core.NewTextRange(items.Pos(), body.End()), []*ast.Node{items, limit, arrow}), ast.NodeFlagsNone), core.NewTextRange(anchor.Pos(), body.End()))
	statement := p.finishNode(p.factory.NewExpressionStatement(call), pos)
	if p.opts.VibeLangDoAsFunction {
		return statement
	}
	return p.concurrentHeadEnvironment(statement, binding, headDeclaration, declarationKind, &forEachIsHome{head: headBindings, defaults: defaults})
}

// concurrentHeadEnvironment reuses the native-loop TDZ cells from do
// lowering (VIP-19). The item callback shadows these never-initialized
// cells. A written limit runs in the enclosing scope, before entering them.
func (p *Parser) concurrentHeadEnvironment(statement, binding, headDeclaration *ast.Node, kind ast.NodeFlags, home *forEachIsHome) *ast.Node {
	call := statement.Expression()
	args := call.Arguments()
	p.vibelangMatchTemps++
	id := strconv.Itoa(p.vibelangMatchTemps)
	label := p.mTemp("$concurrentHead"+id, statement.Loc)
	leave := p.vibelangSpanning(p.factory.NewBreakStatement(p.mTemp(label.Text(), statement.Loc)), statement.Loc)
	var statements, perItem []*ast.Node
	statements = append(statements, home.head...)
	if len(home.head) > 0 {
		items := p.mTemp("$concurrentIsItems"+id, args[0].Loc)
		statements = append(statements, p.mConst(items, ast.NodeFlagsConst, args[0], args[0].Loc))
		args[0] = p.mTemp(items.Text(), items.Loc)
		for i, hoist := range home.head {
			decl := hoistedDeclarator(hoist)
			if decl.Flags&ast.NodeFlagsVibeLangIsBinding == 0 {
				continue
			}
			name := decl.Name()
			reader := p.mTemp("$concurrentIsHead"+id+"_"+strconv.Itoa(i), name.Loc)
			statements = append(statements, p.mConst(reader, ast.NodeFlagsConst,
				p.vibelangValueArrow(p.mIdent(name.Text(), name.Loc), name.Loc), name.Loc))
			copy := p.mConst(p.mIdent(name.Text(), name.Loc), ast.NodeFlagsLet,
				p.mCall(p.mTemp(reader.Text(), name.Loc), nil, name.Loc), name.Loc)
			hoistedDeclarator(copy).Flags |= decl.Flags & (ast.NodeFlagsVibeLangConst | ast.NodeFlagsVibeLangIsBinding)
			perItem = append(perItem, copy)
		}
	}
	perItem = append(perItem, home.defaults...)
	if len(perItem) > 0 {
		body := args[2].Body()
		body.AsBlock().Statements.Nodes = append(perItem, body.AsBlock().Statements.Nodes...)
		p.overrideParentInImmediateChildren(body)
	}
	statements = append(statements, statement, leave)
	p.overrideParentInImmediateChildren(call)
	if p.vibelangHeadCells == nil {
		p.vibelangHeadCells = map[*ast.Node]*ast.Node{}
	}
	var cells func(*ast.Node)
	cells = func(source *ast.Node) {
		name := source.Name()
		if ast.IsIdentifier(name) {
			cell := p.mConst(p.mIdent(name.Text(), name.Loc), ast.NodeFlagsLet, nil, name.Loc)
			decl := cell.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0]
			if kind&ast.NodeFlagsConst != 0 {
				decl.Flags |= ast.NodeFlagsVibeLangConst
			}
			decl.AsVariableDeclaration().ExclamationToken = p.vibelangSynthesized(p.factory.NewToken(ast.KindExclamationToken), name.Loc)
			p.overrideParentInImmediateChildren(decl)
			p.vibelangHeadCells[decl] = source
			statements = append(statements, cell)
		} else if ast.IsBindingPattern(name) {
			for _, element := range name.AsBindingPattern().Elements.Nodes {
				if !isOmittedBindingElement(element) {
					cells(element)
				}
			}
		}
	}
	if ast.IsIdentifier(binding) {
		cells(headDeclaration)
	} else {
		for _, element := range binding.AsBindingPattern().Elements.Nodes {
			if !isOmittedBindingElement(element) {
				cells(element)
			}
		}
	}
	head := p.vibelangSpanning(p.factory.NewLabeledStatement(label, p.mBlock(statements, statement.Loc)), statement.Loc)
	limit := args[1]
	if limit.Flags&ast.NodeFlagsReparsed != 0 {
		return head
	}
	name := "$concurrentLimit" + id
	declaration := p.mConst(p.mTemp(name, limit.Loc), ast.NodeFlagsConst, limit, limit.Loc)
	ref := p.mTemp(name, limit.Loc)
	// It still represents a written limit for source-aware checks.
	ref.Flags &^= ast.NodeFlagsReparsed
	args[1] = ref
	p.overrideParentInImmediateChildren(call)
	return p.mBlock([]*ast.Node{declaration, head}, statement.Loc)
}

// rewriteConcurrentJumps replaces each unlabeled continue in node that would
// go to the loop's next item with return, and flags each unlabeled break that
// would leave the loop. With selfLabel, only continues naming that source
// loop are rewritten, including through nested native loops. inSwitch is set
// inside a switch, where a break leaves the switch.
func (p *Parser) rewriteConcurrentJumps(node *ast.Node, inSwitch bool, selfLabel string) bool {
	rewritten := false
	replace := func(statement *ast.Node) *ast.Node {
		if statement != nil && statement.Kind == ast.KindContinueStatement && (selfLabel == "" && statement.Label() == nil || selfLabel != "" && statement.Label() != nil && statement.Label().Text() == selfLabel) {
			rewritten = true
			ret := p.vibelangSynthesized(p.factory.NewReturnStatement(nil), p.jumpKeywordRange(statement))
			ret.Parent = statement.Parent
			return ret
		}
		if p.rewriteConcurrentJumps(statement, inSwitch, selfLabel) {
			rewritten = true
		}
		return statement
	}
	switch {
	case node == nil:
		return false
	case node.Kind == ast.KindBreakStatement:
		if selfLabel == "" && !inSwitch && node.AsBreakStatement().Label == nil {
			node.Flags |= ast.NodeFlagsVibeLang // EK1903
		}
		return false
	case isFunctionOrClassBoundary(node):
		return false
	case ast.IsIterationStatement(node, false /*lookInLabeledStatements*/):
		if selfLabel == "" || node.Kind == ast.KindForOfStatement && node.Flags&ast.NodeFlagsVibeLang != 0 {
			// A nested for try has its own outward-jump restriction.
			return false
		}
		switch node.Kind {
		case ast.KindForStatement:
			node.AsForStatement().Statement = replace(node.Statement())
		case ast.KindForInStatement, ast.KindForOfStatement:
			node.AsForInOrOfStatement().Statement = replace(node.Statement())
		case ast.KindWhileStatement:
			node.AsWhileStatement().Statement = replace(node.Statement())
		case ast.KindDoStatement:
			node.AsDoStatement().Statement = replace(node.Statement())
		}
	case node.Kind == ast.KindBlock:
		statements := node.AsBlock().Statements.Nodes
		for i, statement := range statements {
			statements[i] = replace(statement)
		}
	case node.Kind == ast.KindIfStatement:
		s := node.AsIfStatement()
		s.ThenStatement = replace(s.ThenStatement)
		if s.ElseStatement != nil {
			s.ElseStatement = replace(s.ElseStatement)
		}
	case node.Kind == ast.KindLabeledStatement:
		s := node.AsLabeledStatement()
		if selfLabel != "" && s.Label.Text() == selfLabel {
			return false
		}
		s.Statement = replace(s.Statement)
	case node.Kind == ast.KindSwitchStatement:
		for _, clause := range node.AsSwitchStatement().CaseBlock.AsCaseBlock().Clauses.Nodes {
			statements := clause.AsCaseOrDefaultClause().Statements.Nodes
			for i, statement := range statements {
				if statement.Kind == ast.KindContinueStatement && (selfLabel == "" && statement.Label() == nil || selfLabel != "" && statement.Label() != nil && statement.Label().Text() == selfLabel) {
					statements[i] = replace(statement)
				} else {
					if p.rewriteConcurrentJumps(statement, true /*inSwitch*/, selfLabel) {
						rewritten = true
					}
				}
			}
		}
	default:
		node.ForEachChild(func(child *ast.Node) bool {
			if p.rewriteConcurrentJumps(child, inSwitch, selfLabel) {
				rewritten = true
			}
			return false
		})
	}
	return rewritten
}

// rewriteConcurrentLabelContinues runs once the source label is available.
// Every label in a chain names the same concurrent loop. A continue to it
// ends the item, including from a nested native loop; a nested callable or
// concurrent item retains its own boundary and diagnostics.
func (p *Parser) rewriteConcurrentLabelContinues(node *ast.Node) {
	if !p.isVibeLangFile() {
		return
	}
	call := VibeLangConcurrentCall(node.Statement())
	if call == nil {
		return
	}
	if p.rewriteConcurrentJumps(call.Arguments()[2].Body(), false, node.Label().Text()) {
		// The item return still references this source label for unused-label checks.
		node.Label().Flags |= ast.NodeFlagsVibeLang
	}
}

// VibeLangConcurrentCall finds a source concurrent loop through the generated
// limit and RHS head environment. Ordinary source blocks are not transparent.
func VibeLangConcurrentCall(statement *ast.Node) *ast.Node {
	for statement != nil {
		switch {
		case ast.IsLabeledStatement(statement):
			statement = statement.Statement()
		case ast.IsBlock(statement):
			statements := statement.Statements()
			if len(statements) == 2 && ast.IsVariableStatement(statements[0]) &&
				ast.IsLabeledStatement(statements[1]) && statements[1].Label().Flags&ast.NodeFlagsReparsed != 0 {
				// A hoisted written limit has a generated binding referenced
				// by the call. A source declaration leaves its block opaque.
				declarations := statements[0].AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes
				if len(declarations) != 1 {
					return nil
				}
				name := declarations[0].Name()
				if !ast.IsIdentifier(name) || name.Flags&ast.NodeFlagsReparsed == 0 {
					return nil
				}
				call := VibeLangConcurrentCall(statements[1])
				if call != nil && ast.IsIdentifier(call.Arguments()[1]) && call.Arguments()[1].Text() == name.Text() {
					return call
				}
				return nil
			} else if len(statements) >= 2 && ast.IsExpressionStatement(statements[0]) &&
				ast.IsCallExpression(statements[0].Expression()) && isIntrinsicCall(statements[0].Expression()) == "$forConcurrent" &&
				statements[1].Kind == ast.KindBreakStatement && statements[1].Label() != nil &&
				statements[1].Label().Flags&ast.NodeFlagsReparsed != 0 {
				statement = statements[0]
			} else {
				return nil
			}
		case ast.IsExpressionStatement(statement):
			call := statement.Expression()
			if ast.IsCallExpression(call) && isIntrinsicCall(call) == "$forConcurrent" && len(call.Arguments()) == 3 {
				return call
			}
			return nil
		default:
			return nil
		}
	}
	return nil
}
