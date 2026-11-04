package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Checks of layer declarations (D129). The parser turns
//
//	layer UsersLive: Users { setup; find(id) { ... } }
//
// into Layer.effect(Users, () => { setup; return { find(id) { ... } } }), so
// the setup statements must come before the members: a statement between or
// after them would run before members that appear above it (EK9209).

func init() { fileChecks = append(fileChecks, checkLayerDeclarations) }

func checkLayerDeclarations(c *checker.Checker, file *ast.SourceFile) {
	for _, statement := range file.Statements.Nodes {
		checkLayerDeclaration(c, statement)
	}
}

// checkLayerDeclaration reports EK9209 for each setup statement of statement,
// if it is a layer declaration, that follows one of its members.
func checkLayerDeclaration(c *checker.Checker, statement *ast.Node) {
	if !ast.IsVariableStatement(statement) {
		return
	}
	declarations := statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes
	if len(declarations) != 1 || declarations[0].Initializer() == nil || !ast.IsCallExpression(declarations[0].Initializer()) {
		return
	}
	call := declarations[0].Initializer()
	callee := call.Expression()
	if callee.Flags&ast.NodeFlagsReparsed == 0 || !ast.IsPropertyAccessExpression(callee) || callee.Name().Text() != "effect" {
		return
	}
	arguments := call.Arguments()
	if len(arguments) != 2 || !ast.IsArrowFunction(arguments[1]) || arguments[1].Body() == nil || !ast.IsBlock(arguments[1].Body()) {
		return
	}
	statements := arguments[1].Body().AsBlock().Statements.Nodes
	returned := statements[len(statements)-1]
	if !ast.IsReturnStatement(returned) || returned.Expression() == nil || !ast.IsObjectLiteralExpression(returned.Expression()) {
		return
	}
	members := returned.Expression().AsObjectLiteralExpression().Properties.Nodes
	if len(members) == 0 {
		return
	}
	first := members[0]
	for _, setup := range statements[:len(statements)-1] {
		if setup.Pos() > first.Pos() {
			d := report(c, setup, EK9209)
			note(d, "Move it above {0}: setup runs once, before the members exist.", scanner.GetTextOfNode(first.Name()))
		}
	}
}
