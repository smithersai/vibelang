package parser

import (
	"strconv"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
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
	return p.token == ast.KindIdentifier && p.scanner.TokenValue() == "fork" && p.isVibeLangFile() && (p.vibelangFiberContext && !p.lookAhead((*Parser).nextTokenIsEqualsGreaterThan) || p.lookAhead((*Parser).nextTokenStartsLegacyForkOperand))
}

func (p *Parser) nextTokenStartsLegacyForkOperand() bool {
	p.nextToken()
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
	var program *ast.Node
	if p.token == ast.KindOpenBraceToken && !p.forkBraceIsObjectOperand() {
		body := p.parseFunctionBlock(ParseFlagsNone, nil /*diagnosticMessage*/)
		p.recordVibeSyntaxBlock(VibeSyntaxForkBlock, keyword, body)
		program = p.vibelangProgramArrow(nil, body, keyword)
	} else {
		program = p.parseSimpleUnaryExpression()
		p.recordVibeSyntax(VibeSyntax{Kind: VibeSyntaxPrefix, Word: keyword, Range: core.NewTextRange(keyword.Pos(), program.End())})
	}
	call := p.finishNode(p.factory.NewCallExpression(callee, nil, nil, p.newNodeList(program.Loc, []*ast.Node{program}), ast.NodeFlagsNone), pos)
	return call
}

// isStartOfVibeLangJoin uses the same source Effect reservation as fork.
// Outside it, valid TypeScript identifier expressions retain their reading.
func (p *Parser) isStartOfVibeLangJoin() bool {
	return p.token == ast.KindIdentifier && p.scanner.TokenValue() == "join" && p.isVibeLangFile() && (p.vibelangFiberContext && !p.lookAhead((*Parser).nextTokenIsEqualsGreaterThan) || p.lookAhead((*Parser).nextTokenStartsLegacyJoinOperand))
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
	callee := p.vibelangIntrinsic("$select", anchor)
	call := p.vibelangSpanning(p.factory.NewCallExpression(callee, nil, nil, p.newNodeList(anchor, args), ast.NodeFlagsNone), anchor)
	declaration := p.vibelangSynthesized(p.factory.NewVariableDeclaration(selected(anchor), nil, nil, call), anchor)
	list := p.vibelangSynthesized(p.factory.NewVariableDeclarationList(p.newNodeList(anchor, []*ast.Node{declaration}), ast.NodeFlagsConst), anchor)
	statements := []*ast.Node{p.vibelangSynthesized(p.factory.NewVariableStatement(nil, list), anchor)}

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
		span := c.anchor
		if len(c.statements) != 0 {
			span = core.NewTextRange(c.anchor.Pos(), c.statements[len(c.statements)-1].End())
		}
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
			span := core.NewTextRange(cases[i].anchor.Pos(), chain.End())
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

func (p *Parser) nextTokenIsConstOrLet() bool {
	p.nextToken()
	return p.token == ast.KindConstKeyword || p.token == ast.KindLetKeyword
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
	var limit *ast.Node
	if p.token == ast.KindOpenParenToken && !p.lookAhead((*Parser).nextTokenIsConstOrLet) {
		p.nextToken()
		// A binding in the limit belongs to the home around the loop: the
		// limit runs before the loop head exists (decided detail 249).
		limit = p.hoistVibeLangIs(p.parseExpressionAllowIn())
		p.parseExpected(ast.KindCloseParenToken)
	}
	forKeyword := scanner.SkipTrivia(p.sourceText, pos)
	p.recordVibeSyntax(VibeSyntax{Kind: VibeSyntaxForConcurrent, Word: core.NewTextRange(forKeyword, forKeyword+len("for")), Head: core.NewTextRange(anchor.Pos(), p.nodePos()), Range: core.NewTextRange(forKeyword, p.nodePos())})
	p.parseExpected(ast.KindOpenParenToken)
	declarationKind := ast.NodeFlagsConst
	if p.token == ast.KindLetKeyword {
		declarationKind = ast.NodeFlagsLet
	}
	if p.token == ast.KindConstKeyword || p.token == ast.KindLetKeyword {
		p.nextToken()
	} else {
		p.parseExpected(ast.KindConstKeyword)
	}
	binding := p.parseIdentifierOrPattern()
	ofKeyword := p.tokenRange()
	p.parseExpected(ast.KindOfKeyword)
	items := p.parseAssignmentExpressionOrHigher()
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
	p.rewriteConcurrentJumps(body, false /*inSwitch*/)
	name := binding
	if binding.Kind != ast.KindIdentifier {
		// A head pattern binds inside the item, as a for...of pattern binds
		// inside its body: its defaults and computed keys may run Effects
		// (chapter 2, "Destructuring and parameter defaults"), which a
		// parameter list cannot. The item arrives as a synthesized parameter,
		// and the pattern declares from it as the body's first statement.
		name = p.vibelangSynthesized(p.factory.NewIdentifier("$concurrentItem"), ofKeyword)
		item := p.vibelangSynthesized(p.factory.NewIdentifier("$concurrentItem"), ofKeyword)
		declaration := p.vibelangSpanning(p.factory.NewVariableDeclaration(binding, nil /*exclamationToken*/, nil /*type*/, item), binding.Loc)
		list := p.vibelangSpanning(p.factory.NewVariableDeclarationList(p.newNodeList(binding.Loc, []*ast.Node{declaration}), declarationKind), binding.Loc)
		statement := p.vibelangSpanning(p.factory.NewVariableStatement(nil /*modifiers*/, list), binding.Loc)
		// The block is finished already, so the new statement's parents are set here.
		p.overrideParentInImmediateChildren(declaration)
		p.overrideParentInImmediateChildren(list)
		p.overrideParentInImmediateChildren(statement)
		statement.Parent = body
		statements := body.AsBlock().Statements
		body.AsBlock().Statements = p.newNodeList(statements.Loc, append([]*ast.Node{statement}, statements.Nodes...))
	}
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
	return p.finishNode(p.factory.NewExpressionStatement(call), pos)
}

// rewriteConcurrentJumps replaces each unlabeled continue in node that would
// go to the loop's next item with return, and flags each unlabeled break that
// would leave the loop. inSwitch is set inside a switch, where a break leaves
// the switch.
func (p *Parser) rewriteConcurrentJumps(node *ast.Node, inSwitch bool) {
	replace := func(statement *ast.Node) *ast.Node {
		if statement != nil && statement.Kind == ast.KindContinueStatement && statement.AsContinueStatement().Label == nil {
			ret := p.vibelangSynthesized(p.factory.NewReturnStatement(nil), p.jumpKeywordRange(statement))
			ret.Parent = statement.Parent
			return ret
		}
		p.rewriteConcurrentJumps(statement, inSwitch)
		return statement
	}
	switch {
	case node == nil:
		return
	case node.Kind == ast.KindBreakStatement:
		if !inSwitch && node.AsBreakStatement().Label == nil {
			node.Flags |= ast.NodeFlagsVibeLang // EK1903
		}
		return
	case ast.IsIterationStatement(node, false /*lookInLabeledStatements*/), isFunctionOrClassBoundary(node):
		return
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
		s.Statement = replace(s.Statement)
	case node.Kind == ast.KindSwitchStatement:
		for _, clause := range node.AsSwitchStatement().CaseBlock.AsCaseBlock().Clauses.Nodes {
			statements := clause.AsCaseOrDefaultClause().Statements.Nodes
			for i, statement := range statements {
				if statement.Kind == ast.KindContinueStatement && statement.AsContinueStatement().Label == nil {
					statements[i] = replace(statement)
				} else {
					p.rewriteConcurrentJumps(statement, true /*inSwitch*/)
				}
			}
		}
	default:
		node.ForEachChild(func(child *ast.Node) bool {
			p.rewriteConcurrentJumps(child, inSwitch)
			return false
		})
	}
}
