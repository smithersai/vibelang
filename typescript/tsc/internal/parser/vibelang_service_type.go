package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// ServiceShapeFactory is the name of the synthesized extends clause's
// expression in a service of any shape (D281); the checker and the tools
// recognize the declaration by it.
const ServiceShapeFactory = "$service"

// parseServiceShapeDeclaration parses the rest of a service of any shape
// (D281), from the colon after its name:
//
//	service Search: SearchApi { static readonly key = "app/Search" }
//	service Prefix: string {}
//
// as the abstract class
//
//	abstract class Search extends $service<SearchApi> { static readonly layer = ... }
//
// whose extends clause is synthesized: $service is the runtime's key class
// factory, and its type argument is the written shape, any type. The checker
// reads the shape there and gives the class the static side
// Context.Service<Search, SearchApi> (vibelang/services.go); the lowering
// replaces the clause with the key class, as for every service. The body is
// required and admits only the existing key/defaultValue members (EK0902). The recorded form's Head runs from the word through the
// shape, and Right is the shape.
func (p *Parser) parseServiceShapeDeclaration(pos int, jsdoc jsdocScannerInfo, modifiers *ast.ModifierList, word core.TextRange, name *ast.Node, typeParameters *ast.NodeList) *ast.Node {
	colon := p.tokenRange()
	p.nextToken() // :
	shape := p.parseType()
	form := VibeSyntax{Kind: VibeSyntaxDeclaration, Name: "service", Head: core.NewTextRange(word.Pos(), shape.End()), Right: p.sourceRange(shape)}
	var members *ast.NodeList
	if p.token == ast.KindOpenBraceToken {
		form.Open = p.tokenRange()
		p.nextToken()
		saveAbstract, saveService, saveControl, saveFieldBody, saveShapeBody := p.vibelangAbstractMembers, p.vibelangServiceMembers, p.vibelangControlMembers, p.vibelangFieldBody, p.vibelangServiceShapeBody
		p.vibelangAbstractMembers, p.vibelangServiceMembers, p.vibelangControlMembers, p.vibelangFieldBody, p.vibelangServiceShapeBody = true, true, false, false, true
		members = p.parseList(PCClassMembers, (*Parser).parseClassElement)
		p.vibelangAbstractMembers, p.vibelangServiceMembers, p.vibelangControlMembers, p.vibelangFieldBody, p.vibelangServiceShapeBody = saveAbstract, saveService, saveControl, saveFieldBody, saveShapeBody
		if p.token == ast.KindCloseBraceToken {
			form.Close = p.tokenRange()
		}
		p.parseExpected(ast.KindCloseBraceToken)
	} else {
		if !p.isVibeLangAmbientService(modifiers) {
			p.vibelangServiceError(name.Loc, 906, VibeLangServiceBodyMessage)
		}
		end := p.nodePos()
		members = p.newNodeList(core.NewTextRange(end, end), nil)
	}
	form.Range = core.NewTextRange(scanner.SkipTrivia(p.sourceText, pos), p.nodePos())
	p.recordVibeSyntax(form)

	span := core.NewTextRange(colon.Pos(), shape.End())
	factory := p.vibelangIntrinsic(ServiceShapeFactory, colon)
	base := p.vibelangSpanning(p.factory.NewExpressionWithTypeArguments(factory, p.newNodeList(shape.Loc, []*ast.Node{shape})), span)
	clause := p.vibelangSpanning(p.factory.NewHeritageClause(ast.KindExtendsKeyword, p.newNodeList(span, []*ast.Node{base})), span)
	modifiers = p.vibelangServiceModifiers(modifiers, word)
	result := p.factory.NewClassDeclaration(modifiers, name, typeParameters, p.newNodeList(span, []*ast.Node{clause}), members)
	p.finishNode(result, pos)
	p.withJSDoc(result, jsdoc)
	return result
}
