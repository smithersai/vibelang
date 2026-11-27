package parser

import (
	"strconv"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// Concise tagged catch expressions (VIP-75):
//
//	e catch {
//	  when NotFound: "missing";
//	  when RateLimited(let err): try sleep(err.retryAfter), "retry";
//	}
//
// parses as $catchExpression(() => e, effect ($catchN) => { ...; throw $matchN }),
// reusing VIP-7 pattern arms. Arm bodies evaluate in effect context (allowing
// try and throw). When no default arm is written, unmatched failures rethrow
// with their flow-narrowed residual type, mirroring Effect.catchTags.

// IsVibeLangTaggedCatchHandler reports whether node is the synthesized effect
// arrow handler written for a block-arm `catch { when ... }` expression (VIP-75).
func IsVibeLangTaggedCatchHandler(node *ast.Node) bool {
	return node != nil && node.Kind == ast.KindArrowFunction &&
		node.Flags&(ast.NodeFlagsVibeLangEffect|ast.NodeFlagsVibeLang) == (ast.NodeFlagsVibeLangEffect|ast.NodeFlagsVibeLang)
}

// isStartOfVibeLangTaggedCatch reports whether the current token after `catch`
// opens a tagged catch arm block: `{` followed by `when <pattern>` or `default:`.
// Ordinary object literals such as `{ a: 1 }` or `{ when: 1 }` return false and
// continue through the existing invalid-handler EK0509 path.
func (p *Parser) isStartOfVibeLangTaggedCatch() bool {
	return p.token == ast.KindOpenBraceToken && p.isVibeLangFile() && p.lookAhead((*Parser).scanStartOfVibeLangTaggedCatch)
}

func (p *Parser) scanStartOfVibeLangTaggedCatch() bool {
	p.nextToken() // {
	if p.isMatchWord("when") {
		p.nextToken()
		return p.token != ast.KindColonToken
	}
	if p.token == ast.KindDefaultKeyword {
		p.nextToken()
		return p.token == ast.KindColonToken
	}
	return false
}

// parseVibeLangTaggedCatch parses `{ when ...; default: ... }` after `catch`
// into a synthesized effect arrow handler whose body matches the caught error
// and rethrows any unmatched residual error when no default arm is written.
func (p *Parser) parseVibeLangTaggedCatch(pos int, form *VibeSyntax) *ast.Node {
	openBrace := p.tokenRange()
	form.Open = openBrace
	p.nextToken() // {
	defer p.setVibeLangFiberContext(true)()
	p.vibelangMatchTemps++
	errName := "$catch" + strconv.Itoa(p.vibelangMatchTemps)
	paramName := p.mTemp(errName, openBrace)
	param := p.vibelangSynthesized(p.factory.NewParameterDeclaration(nil, nil, paramName, nil, nil, nil), openBrace)
	info := &matchInfo{
		pos:             openBrace.Pos(),
		anchor:          openBrace,
		subject:         p.mTemp(errName, openBrace),
		implicitDefault: true,
	}
	p.parseTaggedCatchArms(info, form)
	closeBrace := openBrace
	if p.token == ast.KindCloseBraceToken {
		closeBrace = p.tokenRange()
		form.Close = closeBrace
	}
	p.parseExpected(ast.KindCloseBraceToken)
	statements := p.taggedCatchStatements(info, closeBrace)
	body := p.mBlock(statements, core.NewTextRange(openBrace.Pos(), p.nodePos()))
	arrowToken := p.vibelangSpanning(p.factory.NewToken(ast.KindEqualsGreaterThanToken), openBrace)
	arrowToken.Flags &^= ast.NodeFlagsReparsed
	params := p.newNodeList(openBrace, []*ast.Node{param})
	handler := p.finishNode(p.factory.NewArrowFunction(nil, nil, params, nil, nil, arrowToken, body), pos)
	handler.Flags |= ast.NodeFlagsVibeLangEffect | ast.NodeFlagsVibeLang
	return handler
}

// parseTaggedCatchArms reads every `when` or `default` arm inside `catch { ... }`.
func (p *Parser) parseTaggedCatchArms(info *matchInfo, form *VibeSyntax) {
	sawDefault := false
	for p.token != ast.KindCloseBraceToken && p.token != ast.KindEndOfFile {
		if arm, armForm, ok := p.parseTaggedCatchArm(info, &sawDefault); ok {
			info.arms = append(info.arms, arm)
			form.Arms = append(form.Arms, armForm)
		}
	}
}

// parseTaggedCatchArm parses one `when` or `default` arm inside `catch { ... }`.
// A trailing semicolon before `}` is optional; semicolons separate multiple arms.
func (p *Parser) parseTaggedCatchArm(info *matchInfo, sawDefault *bool) (matchArm, VibeSyntaxArm, bool) {
	arm := matchArm{anchor: p.tokenRange()}
	armForm := VibeSyntaxArm{}
	armError := func(detail string) {
		info.errors = append(info.errors, matchError{707, detail, p.tokenRange()})
	}
	switch {
	case p.token == ast.KindDefaultKeyword:
		if *sawDefault {
			armError("A catch block has one default arm. Remove this one.")
		}
		*sawDefault = true
		p.nextToken()
	case p.isMatchWord("when"):
		if *sawDefault {
			armError("The default arm comes last. Move this arm before it.")
		}
		p.nextMatchWord()
		arm.pattern = p.parseMatchPattern()
	default:
		armError("An arm starts with when or default.")
		p.skipToMatchArm()
		return arm, armForm, false
	}
	armForm.Head = core.NewTextRange(arm.anchor.Pos(), p.nodePos())
	if p.token == ast.KindColonToken {
		p.nextToken()
	} else {
		armError("Write : after the pattern, when P: value;.")
	}
	arm.value = p.parseMatchArmBody()
	arm.end = p.nodePos()
	armForm.Value = p.sourceRange(arm.value)
	armForm.Comma = ast.IsBinaryExpression(arm.value) && arm.value.AsBinaryExpression().OperatorToken.Kind == ast.KindCommaToken
	switch p.token {
	case ast.KindSemicolonToken:
		armForm.Semicolon = p.tokenRange()
		p.nextToken()
	case ast.KindCloseBraceToken:
		// Trailing semicolon before `}` is optional in tagged catch blocks.
	case ast.KindCommaToken:
		info.errors = append(info.errors, matchError{701, "", p.tokenRange()})
		p.nextToken()
	default:
		info.errors = append(info.errors, matchError{701, "", core.NewTextRange(arm.end, arm.end)})
	}
	return arm, armForm, true
}

// taggedCatchStatements builds the body of a tagged catch handler: each arm
// returns its value, and any unmatched failure rethrows with its narrowed type.
func (p *Parser) taggedCatchStatements(info *matchInfo, closeBrace core.TextRange) []*ast.Node {
	return p.matchStatements(info, func(value *ast.Node, at core.TextRange) []*ast.Node {
		return []*ast.Node{p.vibelangSpanning(p.factory.NewReturnStatement(value), nodesSpan(at, value))}
	}, func(subject *ast.Node, _ core.TextRange) *ast.Node {
		return p.vibelangSynthesized(p.factory.NewThrowStatement(subject), closeBrace)
	})
}
