package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// A choice is syntax-only and reusable in the same source/context. The
// parser pool resets the whole Parser between files. Never cache an AST:
// each real parse must still record its own syntax, nodes and diagnostics.
type effectAssertionChoiceKey struct {
	pos, omitAt, diagnostics, slotDepth int
	flags                               ast.NodeFlags
	contexts                            ParsingContexts
	asi, fiber, namespace, hasThrowStop bool
	throwStop                           throwStop
}

// Appendix A gives present R priority among complete parses, including ASI.
// An argument or parenthesized expression cannot end at a newline; a real
// statement nested inside it can. Carry that boundary from the native caller.
func (p *Parser) withVibeLangExpressionASI(allow bool, parse func(*Parser) *ast.Expression) *ast.Expression {
	saved := p.vibeLangExpressionASI
	p.vibeLangExpressionASI = allow
	defer func() { p.vibeLangExpressionASI = saved }()
	return parse(p)
}

func (p *Parser) parseVibeLangExpressionAllowInASI() *ast.Expression {
	return p.doInContext(ast.NodeFlagsDisallowInContext, false, func(p *Parser) *ast.Expression {
		return p.withVibeLangExpressionASI(true, (*Parser).parseExpressionWorker)
	})
}

func (p *Parser) parseVibeLangExpressionInitializer(allowASI bool) *ast.Expression {
	if !p.parseOptional(ast.KindEqualsToken) {
		return nil
	}
	return p.withVibeLangExpressionASI(allowASI, func(p *Parser) *ast.Expression {
		return p.parseAssignmentExpressionOrHigherWorker(true)
	})
}

func (p *Parser) parseVibeLangClassInitializer() *ast.Expression {
	defer p.setVibeLangFiberContext(false)()
	return p.parseVibeLangExpressionInitializer(true)
}

// Only an omitted E followed by an unparenthesized contextual keyword is
// ambiguous here. Pure type positions never call this assertion helper.
func (p *Parser) optionalVibeLangRequirementKeyword(typeNode *ast.TypeNode) (int, bool) {
	if typeNode.Kind != ast.KindTypeReference {
		return 0, false
	}
	args := typeNode.TypeArguments()
	if len(args) != 3 || args[1].Kind != ast.KindNeverKeyword || args[2].Kind != ast.KindTypeReference {
		return 0, false
	}
	errorSlot := args[1]
	if errorSlot.Pos() < 0 || errorSlot.End() > len(p.sourceText) || p.sourceText[errorSlot.Pos():errorSlot.End()] != "!" {
		return 0, false
	}
	name := args[2].AsTypeReferenceNode().TypeName
	if !ast.IsIdentifier(name) || (name.Text() != "as" && name.Text() != "satisfies") {
		return 0, false
	}
	bang := scanner.SkipTrivia(p.sourceText, errorSlot.End())
	return bang, bang < len(p.sourceText) && p.sourceText[bang] == '!'
}

func (p *Parser) parseVibeLangAssertionType() *ast.TypeNode {
	if !p.isVibeLangFile() {
		return p.parseType()
	}
	key := effectAssertionChoiceKey{pos: p.scanner.TokenStart(), omitAt: p.vibeLangOmitRequirementAt,
		diagnostics: len(p.diagnostics), slotDepth: p.vibeLangSlotDepth,
		flags: p.contextFlags, contexts: p.parsingContexts, asi: p.vibeLangExpressionASI,
		fiber: p.vibelangFiberContext, namespace: p.vibelangNamespaceContext}
	if p.vibelangThrowStop != nil {
		key.hasThrowStop = true
		key.throwStop = *p.vibelangThrowStop
	}
	if choice, cached := p.vibeLangAssertionChoices[key]; cached {
		saved := p.vibeLangOmitRequirementAt
		if choice != 0 {
			p.vibeLangOmitRequirementAt = choice
		}
		result := p.parseType()
		p.vibeLangOmitRequirementAt = saved
		return result
	}
	before := p.mark()
	present := p.parseType()
	bang, ambiguous := p.optionalVibeLangRequirementKeyword(present)
	if !ambiguous {
		return present
	}
	if p.vibeLangAssertionChoices == nil {
		p.vibeLangAssertionChoices = make(map[effectAssertionChoiceKey]int)
	}
	if len(p.diagnostics) == before.diagnosticsLen && p.lookAhead((*Parser).vibeLangAssertionRestComplete) {
		p.vibeLangAssertionChoices[key] = 0
		return present
	}
	p.rewind(before)
	saved := p.vibeLangOmitRequirementAt
	p.vibeLangOmitRequirementAt = bang
	omitted := p.parseType()
	p.vibeLangOmitRequirementAt = saved
	if len(p.diagnostics) == before.diagnosticsLen && p.lookAhead((*Parser).vibeLangAssertionRestComplete) {
		p.vibeLangAssertionChoices[key] = bang
		return omitted
	}
	// Neither alternative completes: replay the original branch, including its
	// diagnostics and recorded syntax, rather than returning a recovery oracle.
	p.rewind(before)
	p.vibeLangAssertionChoices[key] = 0
	return p.parseType()
}

func (p *Parser) vibeLangAssertionRestComplete() bool {
	// The native throw stop has a mutable reported bit. A speculative
	// diagnostic must never consume the real expression's stop record.
	if saved := p.vibelangThrowStop; saved != nil {
		probe := *saved
		p.vibelangThrowStop = &probe
		defer func() { p.vibelangThrowStop = saved }()
	}
	diagnostics := len(p.diagnostics)
	pos := p.nodePos()
	// A probe must never reparent an operand in the real expression tree.
	dummy := p.factory.NewIdentifier("__vibe_assertion_probe")
	dummy.Loc = core.NewTextRange(pos, pos)
	expr := p.parseBinaryExpressionRest(ast.OperatorPrecedenceLowest, dummy, pos)
	expr = p.parseVibeLangCatchRest(expr, pos)
	expr = p.parseConditionalExpressionRest(expr, pos, true)
	p.parsePipeRest(expr, pos)
	if len(p.diagnostics) != diagnostics {
		return false
	}
	switch p.token {
	case ast.KindCommaToken, ast.KindSemicolonToken, ast.KindCloseParenToken, ast.KindCloseBracketToken, ast.KindCloseBraceToken, ast.KindColonToken, ast.KindEndOfFile:
		return true
	case ast.KindOfKeyword, ast.KindInKeyword:
		return p.inDisallowInContext()
	}
	return p.vibeLangExpressionASI && p.canParseSemicolon()
}
