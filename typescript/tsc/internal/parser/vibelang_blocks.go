package parser

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Two TC39 expression forms parse, in a .vibe file, into an immediately
// invoked arrow function, so the checker, the analyzer, and the lowering
// treat them as the call they abbreviate (D186, D187):
//
//	x ?? throw new NotFound({ id })   x ?? (() => { throw new NotFound({ id }) })()
//	do { const u = getUser(id); u.name }
//	                                  (() => { const u = getUser(id); return u.name })()
//
// The arrow is a VibeLang function like any other: when its body fails or runs
// an Effect, the call runs it where it stands (D24), and a parameter that
// expects a program takes the call by name (D147). A throw expression
// therefore fails exactly as the throw statement does.

// isStartOfVibeLangThrowExpression reports whether the current token starts a
// throw expression: throw in expression position in a .vibe file. A
// statement that starts with throw is the throw statement, which the
// statement parser takes first.
func (p *Parser) isStartOfVibeLangThrowExpression() bool {
	return p.token == ast.KindThrowKeyword && p.isVibeLangFile()
}

// parseVibeLangThrowExpression parses `throw operand`, whose operand is a unary
// expression, as the proposal's grammar has it
// (https://github.com/tc39/proposal-throw-expressions).
func (p *Parser) parseVibeLangThrowExpression() *ast.Node {
	pos := p.nodePos()
	anchor := p.tokenRange()
	p.nextToken() // throw
	operand := p.parseSimpleUnaryExpression()
	p.recordVibeSyntax(VibeSyntax{Kind: VibeSyntaxPrefix, Word: anchor, Range: core.NewTextRange(anchor.Pos(), operand.End())})
	loc := core.NewTextRange(anchor.Pos(), operand.End())
	statement := p.vibelangSpanning(p.factory.NewThrowStatement(operand), loc)
	body := p.vibelangSpanning(p.factory.NewBlock(p.newNodeList(loc, []*ast.Node{statement}), false /*multiLine*/), loc)
	return p.vibelangInvoked(body, anchor, pos)
}

// isStartOfVibeLangDoExpression reports whether the current token starts a do
// expression: do followed by { in expression position in a .vibe file.
// A statement that starts with do is the do-while statement.
func (p *Parser) isStartOfVibeLangDoExpression() bool {
	return p.token == ast.KindDoKeyword && p.isVibeLangFile() && p.lookAhead((*Parser).nextTokenIsOpenBraceToken)
}

func (p *Parser) nextTokenIsOpenBraceToken() bool {
	p.nextToken()
	return p.token == ast.KindOpenBraceToken
}

// parseVibeLangDoExpression parses `do { statements }`, whose value is the
// completion value of its last statement
// (https://github.com/tc39/proposal-do-expressions). The last statement
// becomes a return; an if needs an else, and a declaration or a loop cannot
// end the block, as the proposal requires. A return inside the block is an
// error, because it would leave the expression rather than the function.
func (p *Parser) parseVibeLangDoExpression() *ast.Node {
	pos := p.nodePos()
	anchor := p.tokenRange()
	p.nextToken() // do
	body := p.parseFunctionBlock(ParseFlagsNone, nil /*diagnosticMessage*/)
	p.recordVibeSyntaxBlock(VibeSyntaxDo, anchor, body)
	p.reportReturnsInDo(body)
	statements := body.AsBlock().Statements
	if len(statements.Nodes) != 0 {
		p.vibelangCompletion(statements)
	}
	return p.vibelangInvoked(body, anchor, pos)
}

// vibelangInvoked returns (() => body)(), the arrow anchored on the keyword
// that starts the form, finished at pos.
func (p *Parser) vibelangInvoked(body *ast.Node, anchor core.TextRange, pos int) *ast.Node {
	arrow := p.vibelangProgramArrow(nil, body, anchor)
	loc := core.NewTextRange(anchor.Pos(), body.End())
	callee := p.vibelangSpanning(p.factory.NewParenthesizedExpression(arrow), loc)
	arguments := p.newNodeList(core.NewTextRange(body.End(), body.End()), nil)
	return p.finishNode(p.factory.NewCallExpression(callee, nil, nil, arguments, ast.NodeFlagsNone), pos)
}

// vibelangCompletion turns the last statement of statements into the
// statement that returns its completion value, in place. Trailing empty
// statements, as in `do { 3;; }`, produce no value of their own, so the
// proposal's UpdateEmpty keeps the value before them.
func (p *Parser) vibelangCompletion(statements *ast.NodeList) {
	i := len(statements.Nodes) - 1
	for i > 0 && statements.Nodes[i].Kind == ast.KindEmptyStatement {
		i--
	}
	last := statements.Nodes[i]
	if replaced := p.vibelangCompletionOf(last); replaced != last {
		statements.Nodes[i] = replaced
	}
}

// vibelangCompletionOf returns the statement that returns statement's
// completion value: a return for an expression statement, or the statement
// itself with its branches converted.
func (p *Parser) vibelangCompletionOf(statement *ast.Node) *ast.Node {
	// Statement matches are already lowered to labeled blocks. At a do
	// completion, return each selected arm instead of discarding
	// its arm value or treating its generated label as a user statement.
	if info := p.vibelangMatches[statement]; info != nil {
		returned := p.matchReturnStatementAt(info, statement.Loc)
		returned.Parent = statement.Parent
		return returned
	}
	switch statement.Kind {
	case ast.KindExpressionStatement:
		if isVibeLangMaskMarker(statement) {
			// An empty interruption block's marker, $uninterruptibleBlock(), is
			// not its value: the block completes empty, so the do is undefined.
			return statement
		}
		returned := p.factory.NewReturnStatement(statement.Expression())
		returned.Parent = statement.Parent
		return p.vibelangSpanning(returned, statement.Loc)
	case ast.KindThrowStatement:
		return statement
	case ast.KindBlock:
		if statements := statement.AsBlock().Statements; len(statements.Nodes) != 0 {
			p.vibelangCompletion(statements)
			p.overrideParentInImmediateChildren(statement)
		}
		return statement
	case ast.KindIfStatement:
		ifStatement := statement.AsIfStatement()
		if ifStatement.ElseStatement == nil {
			p.reportDoCompletion(statement, "an if without an else")
			return statement
		}
		ifStatement.ThenStatement = p.vibelangCompletionOf(ifStatement.ThenStatement)
		ifStatement.ElseStatement = p.vibelangCompletionOf(ifStatement.ElseStatement)
		p.overrideParentInImmediateChildren(statement)
		return statement
	case ast.KindTryStatement:
		tryStatement := statement.AsTryStatement()
		p.vibelangCompletionOf(tryStatement.TryBlock)
		if tryStatement.CatchClause != nil {
			p.vibelangCompletionOf(tryStatement.CatchClause.AsCatchClause().Block)
		}
		return statement
	case ast.KindLabeledStatement:
		// A labeled statement completes as its statement does (the proposal's
		// predicate recurses), so a labeled block ending well is admitted.
		labeled := statement.AsLabeledStatement()
		labeled.Statement = p.vibelangCompletionOf(labeled.Statement)
		p.overrideParentInImmediateChildren(statement)
		return statement
	case ast.KindSwitchStatement:
		// CaseBlock : { } is admitted, and so is a case block whose clauses end
		// well (chapter 2, static predicates); a clause ending in a loop, a
		// bare if or a declaration is reported. The clause values stay as
		// written: a switch's completion follows fallthrough, which a return
		// per clause would not.
		for _, clause := range statement.AsSwitchStatement().CaseBlock.AsCaseBlock().Clauses.Nodes {
			if kind, at := p.doCompletionProblem(clause.AsCaseOrDefaultClause().Statements); kind != "" {
				p.reportDoCompletion(at, kind)
			}
		}
		return statement
	case ast.KindEmptyStatement:
		return statement // an empty completion: the do is undefined
	case ast.KindBreakStatement, ast.KindContinueStatement:
		// A jump has no completion to report: EK1019 (do_blocks.go) names a
		// break or continue that leaves the do expression.
		return statement
	case ast.KindReturnStatement:
		return statement // reportReturnsInDo reports it
	}
	if kind := doCompletionKind(statement); kind != "" {
		p.reportDoCompletion(statement, kind)
	}
	return statement
}

// doCompletionProblem returns the kind and node of the last statement of
// statements that the proposal's EndsInIterationOrBareIfOrDeclaration
// rejects, descending through blocks, labeled statements, if branches, try
// blocks and switch clauses as the predicate does, or "" and nil when the
// statements may end a do expression. Trailing empty statements are skipped,
// as UpdateEmpty keeps the value before them.
func (p *Parser) doCompletionProblem(statements *ast.NodeList) (string, *ast.Node) {
	if statements == nil {
		return "", nil
	}
	i := len(statements.Nodes) - 1
	for i >= 0 && statements.Nodes[i].Kind == ast.KindEmptyStatement {
		i--
	}
	if i < 0 {
		return "", nil
	}
	return p.doStatementProblem(statements.Nodes[i])
}

func (p *Parser) doStatementProblem(statement *ast.Node) (string, *ast.Node) {
	switch statement.Kind {
	case ast.KindBlock:
		return p.doCompletionProblem(statement.AsBlock().Statements)
	case ast.KindLabeledStatement:
		return p.doStatementProblem(statement.AsLabeledStatement().Statement)
	case ast.KindIfStatement:
		ifStatement := statement.AsIfStatement()
		if ifStatement.ElseStatement == nil {
			return "an if without an else", statement
		}
		if kind, at := p.doStatementProblem(ifStatement.ThenStatement); kind != "" {
			return kind, at
		}
		return p.doStatementProblem(ifStatement.ElseStatement)
	case ast.KindTryStatement:
		tryStatement := statement.AsTryStatement()
		if kind, at := p.doStatementProblem(tryStatement.TryBlock); kind != "" {
			return kind, at
		}
		if tryStatement.CatchClause != nil {
			return p.doStatementProblem(tryStatement.CatchClause.AsCatchClause().Block)
		}
		return "", nil
	case ast.KindSwitchStatement:
		for _, clause := range statement.AsSwitchStatement().CaseBlock.AsCaseBlock().Clauses.Nodes {
			if kind, at := p.doCompletionProblem(clause.AsCaseOrDefaultClause().Statements); kind != "" {
				return kind, at
			}
		}
		return "", nil
	}
	if kind := doCompletionKind(statement); kind != "" {
		return kind, statement
	}
	return "", nil
}

// DoCompletionMessage is EK0201's text, for a do expression whose last
// statement has no completion value (VIP-2; decided detail 247). %s names the
// statement.
const DoCompletionMessage = "A do expression must end in a statement with a value: an expression, a block, an if with an else, or a throw. This one ends in %s, which has no value. End the block with an expression."

// reportDoCompletion reports EK0201 at statement, the last statement of a do
// expression, which has no completion value.
func (p *Parser) reportDoCompletion(statement *ast.Node, kind string) {
	p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, p.skipRangeTrivia(statement.Loc), "EK", diagnostics.CategoryError, 201, fmt.Sprintf(DoCompletionMessage, kind)))
	p.hasParseError = true
}

// isVibeLangMaskMarker reports whether statement is the marker call the parser
// writes first in an interruption block, $uninterruptibleBlock(),
// $restoreBlock() or $interruptibleBlock() (vibelang_primitives.go), which the
// lowering replaces and which has no value of its own.
func isVibeLangMaskMarker(statement *ast.Node) bool {
	if statement.Kind != ast.KindExpressionStatement || !ast.IsCallExpression(statement.Expression()) {
		return false
	}
	callee := statement.Expression().Expression()
	if !ast.IsIdentifier(callee) {
		return false
	}
	switch callee.Text() {
	case "$uninterruptible" + vibelangMaskBlockLabel, "$restore" + vibelangMaskBlockLabel, "$interruptible" + vibelangMaskBlockLabel:
		return true
	}
	return false
}

// doCompletionKind names a statement that cannot end a do expression, a
// lexical declaration or a loop (the proposal's
// EndsInIterationOrBareIfOrDeclaration), or "" for any other statement,
// whose completion, a value or empty, the do may give. A var statement is a
// Statement, not a Declaration, there; in .vibe it is EK1019 (do_blocks.go).
func doCompletionKind(statement *ast.Node) string {
	switch statement.Kind {
	case ast.KindVariableStatement:
		if statement.AsVariableStatement().DeclarationList.Flags&(ast.NodeFlagsLet|ast.NodeFlagsConst) == 0 {
			return ""
		}
		return "a declaration"
	case ast.KindFunctionDeclaration, ast.KindClassDeclaration, ast.KindInterfaceDeclaration, ast.KindTypeAliasDeclaration, ast.KindEnumDeclaration:
		return "a declaration"
	case ast.KindForStatement, ast.KindForInStatement, ast.KindForOfStatement, ast.KindWhileStatement, ast.KindDoStatement:
		return "a loop"
	}
	return ""
}

// reportReturnsInDo reports each return statement of a do expression's
// block, not counting those of nested functions and classes.
func (p *Parser) reportReturnsInDo(body *ast.Node) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindReturnStatement {
			p.parseErrorAtRange(p.skipRangeTrivia(node.Loc), diagnostics.A_return_statement_can_only_be_used_within_a_function_body)
		}
		if ast.IsFunctionLike(node) || ast.IsClassLike(node) {
			return false
		}
		node.ForEachChild(visit)
		return false
	}
	body.ForEachChild(visit)
}

// isStartOfVibeLangBlockParam reports whether a block param follows expression:
// in a .vibe file, a { on the same line after a name, a property access,
// or a call, which TypeScript cannot parse
// (https://github.com/samuelgoto/proposal-block-params). A heritage clause
// and a provide block's providers are followed by their own blocks.
func (p *Parser) isStartOfVibeLangBlockParam(expression *ast.Node) bool {
	if p.token != ast.KindOpenBraceToken || p.hasPrecedingLineBreak() || p.vibelangNoBlockParams || !p.isVibeLangFile() {
		return false
	}
	return isVibeLangBlockParamHead(expression)
}

func isVibeLangBlockParamHead(expression *ast.Node) bool {
	switch expression.Kind {
	case ast.KindIdentifier, ast.KindPropertyAccessExpression, ast.KindCallExpression:
		return expression.Flags&ast.NodeFlagsOptionalChain == 0
	}
	return false
}

// parseVibeLangBlockParam parses the block after expression as a program and
// passes it as the last argument of one call (D188): `f { block }` is
// f(() => { block }) and `f(args) { block }` is f(args, () => { block }). The
// checker offers an Effect dual's call the forms that take the block as the
// program, and the lowering moves it there (vibelang/blockparams.go).
func (p *Parser) parseVibeLangBlockParam(pos int, expression *ast.Node) *ast.Node {
	anchor := p.tokenRange()
	body := p.parseFunctionBlock(ParseFlagsNone, nil /*diagnosticMessage*/)
	p.recordVibeSyntaxBlock(VibeSyntaxBlockParam, p.sourceRange(expression), body)
	program := p.vibelangProgramArrow(nil, body, anchor)
	if expression.Kind == ast.KindCallExpression {
		call := expression.AsCallExpression()
		nodes := append(append([]*ast.Node{}, call.Arguments.Nodes...), program)
		arguments := p.newNodeList(core.NewTextRange(call.Arguments.Pos(), program.End()), nodes)
		return p.finishNode(p.factory.NewCallExpression(call.Expression, nil /*questionDotToken*/, call.TypeArguments, arguments, ast.NodeFlagsNone), pos)
	}
	arguments := p.newNodeList(program.Loc, []*ast.Node{program})
	return p.finishNode(p.factory.NewCallExpression(expression, nil /*questionDotToken*/, nil /*typeArguments*/, arguments, ast.NodeFlagsNone), pos)
}
