package parser

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Spec functions and proof blocks (VIP-43, Appendix F):
//
//	spec function countPrefix(xs: readonly boolean[], end: number): number {
//	  proof {
//	    assume(0 <= end && end <= xs.length)
//	    decreases(end)
//	  }
//	  return end <= 0 ? 0 : countPrefix(xs, end - 1) + (xs[end - 1] ? 1 : 0)
//	}
//
// spec followed on the same line by function, async function or effect
// function is a spec function: the function declaration, flagged
// ast.NodeFlagsVibeLangSpec. proof followed on the same line by { where a
// statement can start is a proof block: the block, flagged
// ast.NodeFlagsVibeLangProof. In a proof block, an expression statement that
// calls assume, assert, ensures, invariant or decreases by its plain name is
// a proof statement: its call is flagged ast.NodeFlagsVibeLangProof too, and
// the checker types it against the statement's own signature, whatever
// binding of the name is in scope. Every form these rules recognize is a
// TypeScript syntax error, so no program that parses today changes meaning;
// anywhere else the words are identifiers. Placement and the other rules are
// the checker's (vibelang/proofs.go).

// proofStatementNames are the callees of proof statements.
var proofStatementNames = []string{"assume", "assert", "ensures", "invariant", "decreases"}

// scanStartOfSpecFunction reports whether the current token, spec, starts a
// spec function: function, async function or effect function follows on the
// same line. It moves the scanner; call it through lookAhead.
func (p *Parser) scanStartOfSpecFunction() bool {
	p.nextToken()
	if p.hasPrecedingLineBreak() {
		return false
	}
	if p.token == ast.KindAsyncKeyword || p.isVibeLangEffectWord() {
		p.nextToken()
		if p.hasPrecedingLineBreak() {
			return false
		}
	}
	return p.token == ast.KindFunctionKeyword
}

// parseSpecFunctionDeclaration parses a spec function at the current token,
// spec. An async or effect spec function, a generator and an overload parse
// as those forms do, and the checker rejects them (EK4302).
func (p *Parser) parseSpecFunctionDeclaration(pos int, jsdoc jsdocScannerInfo, modifiers *ast.ModifierList) *ast.Node {
	word := p.tokenRange()
	p.nextToken()
	var fn *ast.Node
	if p.isVibeLangEffectWord() {
		fn = p.parseEffectDeclaration(pos, jsdoc, modifiers)
	} else {
		if p.token == ast.KindAsyncKeyword {
			modifiers = p.joinModifiers(modifiers, p.parseModifiers())
		}
		fn = p.parseFunctionDeclaration(pos, jsdoc, modifiers, false /*effect*/)
	}
	fn.Flags |= ast.NodeFlagsVibeLangSpec
	p.recordVibeSyntax(VibeSyntax{Kind: VibeSyntaxSpec, Word: word, Range: core.NewTextRange(word.Pos(), fn.End())})
	return fn
}

// joinModifiers returns the modifiers before spec followed by those after it.
func (p *Parser) joinModifiers(before *ast.ModifierList, after *ast.ModifierList) *ast.ModifierList {
	if before == nil {
		return after
	}
	if after == nil {
		return before
	}
	return p.newModifierList(core.NewTextRange(before.Pos(), after.End()), slices.Concat(before.Nodes, after.Nodes))
}

// isStartOfVibeLangProofBlock reports whether the current token starts a
// proof block: proof, then { on the same line.
func (p *Parser) isStartOfVibeLangProofBlock() bool {
	return p.token == ast.KindIdentifier && p.scanner.TokenValue() == "proof" && p.isVibeLangFile() && p.lookAhead((*Parser).nextTokenIsOpenBraceOnSameLine)
}

// parseVibeLangProofBlock parses proof { … } as its block, flagged, with
// each proof statement's call flagged.
func (p *Parser) parseVibeLangProofBlock() *ast.Node {
	pos := p.nodePos()
	word := p.tokenRange()
	if p.scanner.HasUnicodeEscape() || p.scanner.HasExtendedUnicodeEscape() {
		p.parseErrorAtCurrentToken(diagnostics.Keywords_cannot_contain_escape_characters)
	}
	p.nextToken()
	block := p.parseBlock(false /*ignoreMissingOpenBrace*/, nil /*diagnosticMessage*/)
	open, closing := p.blockBraces(block)
	block.Loc = core.NewTextRange(pos, block.End())
	block.Flags |= ast.NodeFlagsVibeLangProof
	p.markProofStatements(block.Statements())
	p.recordVibeSyntax(VibeSyntax{Kind: VibeSyntaxBlockStatement, Range: core.NewTextRange(word.Pos(), block.End()), Word: word, Head: word, Open: open, Close: closing})
	return block
}

// markProofStatements flags the call of each proof statement among
// statements and in the if statements and blocks they hold. A nested proof
// block marks its own.
func (p *Parser) markProofStatements(statements []*ast.Node) {
	for _, statement := range statements {
		switch statement.Kind {
		case ast.KindExpressionStatement:
			if call := statement.Expression(); p.isProofStatementCall(call) {
				call.Flags |= ast.NodeFlagsVibeLangProof
			}
		case ast.KindIfStatement:
			p.markProofStatements([]*ast.Node{statement.AsIfStatement().ThenStatement})
			if otherwise := statement.AsIfStatement().ElseStatement; otherwise != nil {
				p.markProofStatements([]*ast.Node{otherwise})
			}
		case ast.KindBlock:
			if statement.Flags&ast.NodeFlagsVibeLangProof == 0 {
				p.markProofStatements(statement.Statements())
			}
		}
	}
}

// isProofStatementCall reports whether node is a call whose callee is one of
// proofStatementNames, written as a plain identifier without escapes, with no
// type arguments and no optional chaining.
func (p *Parser) isProofStatementCall(node *ast.Node) bool {
	if node == nil || !ast.IsCallExpression(node) || node.TypeArguments() != nil || node.Flags&ast.NodeFlagsOptionalChain != 0 {
		return false
	}
	callee := node.Expression()
	if !ast.IsIdentifier(callee) || !slices.Contains(proofStatementNames, callee.Text()) {
		return false
	}
	return p.sourceText[scanner.SkipTrivia(p.sourceText, callee.Pos()):callee.End()] == callee.Text()
}
