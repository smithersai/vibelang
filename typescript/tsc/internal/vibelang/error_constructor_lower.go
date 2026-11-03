package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/printer"
)

// Share the actual fieldless-base lowering with the preserving inheritance
// repair. Passing the fields to super instead would copy extra payload keys
// (including _tag) and would change getter evaluation.
func lowerFieldlessErrorConstructor(f *printer.NodeFactory, node *ast.Node) *ast.Node {
	super := f.NewExpressionStatement(f.NewCallExpression(f.NewKeywordExpression(ast.KindSuperKeyword), nil, nil, f.NewNodeList(nil), ast.NodeFlagsNone))
	statements := []*ast.Node{super}
	// The parser's Pick<Sub, "field" | ...> names exactly the declared
	// input fields. Do not copy extra properties such as _tag from an
	// otherwise assignable fields object.
	keys := node.Parameters()[0].Type().TypeArguments()[1].TypeArguments()[1]
	fields := []*ast.Node{keys}
	if keys.Kind == ast.KindUnionType {
		fields = keys.AsUnionTypeNode().Types.Nodes
	}
	for _, field := range fields {
		name := field.AsLiteralTypeNode().Literal.Text()
		target := f.NewElementAccessExpression(f.NewThisExpression(), nil, f.NewStringLiteral(name, ast.TokenFlagsNone), ast.NodeFlagsNone)
		value := f.NewElementAccessExpression(f.NewIdentifier("args"), nil, f.NewStringLiteral(name, ast.TokenFlagsNone), ast.NodeFlagsNone)
		statements = append(statements, f.NewExpressionStatement(f.NewBinaryExpression(nil, target, nil, f.NewToken(ast.KindEqualsToken), value)))
	}
	return f.UpdateConstructorDeclaration(node.AsConstructorDeclaration(), node.Modifiers(), nil, node.AsConstructorDeclaration().Parameters, nil, nil, f.NewBlock(f.NewNodeList(statements), true))
}
