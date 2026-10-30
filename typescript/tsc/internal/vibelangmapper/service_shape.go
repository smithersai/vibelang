package vibelangmapper

import (
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Services of any shape (D281). The parser reads service Search: SearchApi
// as an abstract class whose synthesized extends clause is $service<SearchApi>.

// serviceShapeOf returns the written shape of node when node declares a
// service of any shape, and nil otherwise.
func serviceShapeOf(node *ast.Node) *ast.Node {
	if node.Kind != ast.KindClassDeclaration || node.Name() == nil {
		return nil
	}
	extends := ast.GetClassExtendsHeritageElement(node)
	if extends == nil {
		return nil
	}
	expression := extends.Expression()
	if !ast.IsIdentifier(expression) || expression.Text() != parser.ServiceShapeFactory || expression.Flags&ast.NodeFlagsReparsed == 0 {
		return nil
	}
	if arguments := extends.TypeArguments(); len(arguments) == 1 {
		return arguments[0]
	}
	return nil
}

// isServiceShapeClass reports whether node declares a service of any shape.
func isServiceShapeClass(node *ast.Node) bool {
	return serviceShapeOf(node) != nil
}

// serviceShapeDeclaration lowers a service of any shape to what the fork's
// declaration file prints for it: an interface that holds only the key's
// brand, so the type Search is the service's identifier, merged with a class
// whose base is the key for the written shape:
//
//	service Search: SearchApi { static readonly layer = live }
//	interface Search { readonly "~vibelang/service"?: "app/main#Search" } abstract class Search extends $service<Search, SearchApi>("app/main#Search") { static readonly layer = live }
//
// A static default makes the base $reference<SearchApi>(key) (D40). The
// shape stays in place, so its contracts project as every type's do. An
// instance member, which the fork reports (EK9207), and type parameters
// (EK3005) are left unprojected.
func (p *projector) serviceShapeDeclaration(node *ast.Node) {
	name := node.Name()
	shape := serviceShapeOf(node)
	if node.TypeParameters() != nil {
		p.unprojected(node)
		return
	}
	for _, member := range node.Members() {
		if !ast.IsStatic(member) && !ast.IsSemicolonClassElement(member) {
			p.unprojected(member)
			return
		}
	}
	key := p.serviceKey(node)
	headStart := p.tokenStart(node)
	var kept []string
	if modifiers := node.Modifiers(); modifiers != nil {
		for _, modifier := range modifiers.Nodes {
			if modifier.Flags&ast.NodeFlagsReparsed != 0 || modifier.Kind == ast.KindAbstractKeyword {
				continue
			}
			headStart = modifier.End()
			kept = append(kept, scanner.TokenToString(modifier.Kind))
		}
	}
	p.plan.replace(scanner.SkipTrivia(p.text, headStart), name.Pos(), "interface")
	base := "service"
	if hasDefaultValue(node) {
		base = "reference"
	}
	shapeStart := p.tokenStart(shape)
	classHead := strings.Join(append(kept, "abstract class "+name.Text()+" extends "), " ")
	p.plan.replace(name.End(), shapeStart, ` { readonly "~vibelang/service"?: `+strconv.Quote(key)+" } "+classHead)
	p.plan.markFields(editServiceBase, partOpen, shapeStart, shapeStart, base, key, name.Text())
	p.visit(shape, env{})
	p.plan.markFields(editServiceBase, partClose, shape.End(), shape.End(), base, key, name.Text())
	if body := scanner.SkipTrivia(p.text, shape.End()); body >= node.End() || p.text[body] != '{' {
		// service Prefix: string, written without a body.
		p.plan.insert(shape.End(), " {}")
		return
	}
	for _, member := range node.Members() {
		p.visit(member, env{})
	}
}
