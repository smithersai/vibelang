package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// isLegacyTrailingBlockStart reports whether a block param follows expression:
// in a .vibe file, a { on the same line after a name, a property access,
// or a call, which TypeScript cannot parse
// (https://github.com/samuelgoto/proposal-block-params). A heritage clause
// and a provide block's providers are followed by their own blocks.
func (p *Parser) isLegacyTrailingBlockStart(expression *ast.Node) bool {
	if p.token != ast.KindOpenBraceToken || p.hasPrecedingLineBreak() || p.vibelangNoBlockParams || !p.isVibeLangFile() {
		return false
	}
	return isLegacyTrailingBlockHead(expression)
}

func isLegacyTrailingBlockHead(expression *ast.Node) bool {
	switch expression.Kind {
	case ast.KindIdentifier, ast.KindPropertyAccessExpression, ast.KindCallExpression:
		return expression.Flags&ast.NodeFlagsOptionalChain == 0
	}
	return false
}

// parseLegacyTrailingBlock is private compatibility decoding for diagnostics
// and codemods. Ordinary compilation never calls it. It parses the block after expression as a program and
// passes it as the last argument of one call (D188): `f { block }` is
// f(() => { block }) and `f(args) { block }` is f(args, () => { block }). The
// checker offers an Effect dual's call the forms that take the block as the
// program, and the lowering moves it there (vibelang/blockparams.go).
func (p *Parser) parseLegacyTrailingBlock(pos int, expression *ast.Node) *ast.Node {
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
