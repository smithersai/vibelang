package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// A TC39 throw expression parses, in a .vibe file, into an immediately
// invoked arrow function, so the checker, the analyzer, and the lowering
// treat them as the call they abbreviate (D186, D187):
//
//	x ?? throw new NotFound({ id })   x ?? (() => { throw new NotFound({ id }) })()
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

// parseVibeLangDoExpression parses `do { statements }`, TC39's do expression
// (VIP-2, https://github.com/tc39/proposal-do-expressions): its block is a
// block of the code around it, so await and yield are what they are there.
// It returns the call (() => block)(), which parseVibeLangDos lowers once
// the whole file is read (vibelang_do.go).
func (p *Parser) parseVibeLangDoExpression() *ast.Node {
	pos := p.nodePos()
	anchor := p.tokenRange()
	p.nextToken() // do
	body := p.parseBlock(false /*ignoreMissingOpenBrace*/, nil /*diagnosticMessage*/)
	p.recordVibeSyntaxBlock(VibeSyntaxDo, anchor, body)
	call := p.vibelangInvoked(body, anchor, pos)
	arrow := ast.SkipParentheses(call.Expression())
	p.recordVibeLangDo(call, arrow, body, anchor)
	return call
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
