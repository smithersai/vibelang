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
//	service Search: SearchApi { static readonly layer = Layer.succeed(Search, impl) }
//	service Prefix: string
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
// optional and holds static members; the checker reports an instance member
// there (EK9207). The recorded form's Head runs from the word through the
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
		saveAbstract := p.vibelangAbstractMembers
		p.vibelangAbstractMembers = true
		members = p.parseList(PCClassMembers, (*Parser).parseClassElement)
		p.vibelangAbstractMembers = saveAbstract
		if p.token == ast.KindCloseBraceToken {
			form.Close = p.tokenRange()
		}
		p.parseExpected(ast.KindCloseBraceToken)
	} else {
		end := p.nodePos()
		members = p.newNodeList(core.NewTextRange(end, end), nil)
	}
	form.Range = core.NewTextRange(scanner.SkipTrivia(p.sourceText, pos), p.nodePos())
	p.recordVibeSyntax(form)

	span := core.NewTextRange(colon.Pos(), shape.End())
	factory := p.vibelangIntrinsic(ServiceShapeFactory, colon)
	base := p.vibelangSpanning(p.factory.NewExpressionWithTypeArguments(factory, p.newNodeList(shape.Loc, []*ast.Node{shape})), span)
	clause := p.vibelangSpanning(p.factory.NewHeritageClause(ast.KindExtendsKeyword, p.newNodeList(span, []*ast.Node{base})), span)
	abstract := p.vibelangSynthesized(p.factory.NewModifier(ast.KindAbstractKeyword), word)
	if modifiers == nil {
		modifiers = p.newModifierList(word, []*ast.Node{abstract})
	} else {
		modifiers = p.newModifierList(core.NewTextRange(modifiers.Pos(), word.End()), append(append([]*ast.Node{}, modifiers.Nodes...), abstract))
	}
	result := p.factory.NewClassDeclaration(modifiers, name, typeParameters, p.newNodeList(span, []*ast.Node{clause}), members)
	p.finishNode(result, pos)
	p.withJSDoc(result, jsdoc)
	return result
}
