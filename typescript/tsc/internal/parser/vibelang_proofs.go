package parser

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Theorems, spec functions and proof blocks (VIP-43, Appendix F):
//
//	theorem clampInRange(x: number, lo: number, hi: number) {
//	  assume(lo <= hi)
//	  const result = clamp(x, lo, hi)
//	  assert(lo <= result && result <= hi)
//	}
//
//	spec function countPrefix(xs: readonly boolean[], end: number): number {
//	  proof {
//	    assume(0 <= end && end <= xs.length)
//	    decreases(end)
//	  }
//	  return end <= 0 ? 0 : countPrefix(xs, end - 1) + (xs[end - 1] ? 1 : 0)
//	}
//
// theorem followed on the same line by a binding identifier other than as,
// satisfies or is, then ( or <, is a theorem: a function declaration without
// the function keyword, flagged ast.NodeFlagsVibeLangSpec and
// ast.NodeFlagsVibeLangProof together. The first flag erases it as a spec
// function erases; the two together tell a theorem from one. Its body is a
// proof context, so its proof statements are flagged as a proof block's are.
// spec followed on the same line by function, async function or effect
// function is a spec function: the function declaration, flagged
// ast.NodeFlagsVibeLangSpec alone. proof followed on the same line by { where a
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

// scanStartOfTheorem reports whether the current token, theorem, starts a
// theorem: a binding identifier other than as, satisfies or is follows on the
// same line, then ( or <. The excluded names keep theorem as T, theorem
// satisfies T and theorem is P expressions. It moves the scanner; call it
// through lookAhead.
func (p *Parser) scanStartOfTheorem() bool {
	p.nextToken()
	if p.hasPrecedingLineBreak() || !p.isBindingIdentifier() {
		return false
	}
	switch p.token {
	case ast.KindAsKeyword, ast.KindSatisfiesKeyword, ast.KindIsKeyword:
		return false
	}
	p.nextToken()
	return p.token == ast.KindOpenParenToken || p.token == ast.KindLessThanToken
}

// parseTheoremDeclaration parses a theorem at the current token, theorem, as
// a function declaration. A return type and a missing body parse, and the
// checker rejects them (rules 4303 and 4302).
func (p *Parser) parseTheoremDeclaration(pos int, jsdoc jsdocScannerInfo, modifiers *ast.ModifierList) *ast.Node {
	word := p.tokenRange()
	p.nextToken()
	nameRange := p.tokenRange()
	name := p.parseBindingIdentifier()
	typeParameters := p.parseTypeParameters()
	restoreFiberContext := p.setVibeLangFiberContext(false /*effect*/)
	saveContextFlags := p.contextFlags
	parameters := p.parseParameters(ParseFlagsNone)
	returnType := p.parseReturnType(ast.KindColonToken, false /*isType*/)
	body := p.parseFunctionBlockOrSemicolon(ParseFlagsNone, diagnostics.X_or_expected)
	p.contextFlags = saveContextFlags
	restoreFiberContext()
	fn := p.finishNode(p.factory.NewFunctionDeclaration(modifiers, nil /*asteriskToken*/, name, typeParameters, parameters, returnType, nil /*fullSignature*/, body), pos)
	p.withJSDoc(fn, jsdoc)
	p.checkJSSyntax(fn)
	fn.Flags |= ast.NodeFlagsVibeLangSpec | ast.NodeFlagsVibeLangProof
	if body != nil {
		p.markProofStatements(body.Statements())
	}
	// The formatter reads theorem name as async function name: the word, then
	// a declaration written without its function keyword.
	p.recordVibeSyntax(VibeSyntax{Kind: VibeSyntaxSpec, Word: word, Range: core.NewTextRange(word.Pos(), fn.End())})
	p.recordVibeSyntax(VibeSyntax{Kind: VibeSyntaxShorthand, Word: nameRange})
	return fn
}

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
