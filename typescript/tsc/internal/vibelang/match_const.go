package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() { fileChecks = append(fileChecks, checkConstBindingAssignments) }

// checkConstBindingAssignments reports TS2588 at an assignment to a name an
// is pattern binds with const: chapter 004 keeps ordinary const immutability
// for source assignments. The parser hoists every binding of an is in a
// statement head as a let without an initializer, so that the pattern's own
// assignment runs where the pattern matches (parser.hoistDeclaration), and
// marks the let of a const binding NodeFlagsVibeLangConst; TypeScript sees a
// let, so this check supplies the error a const declaration would get. The
// pattern's own assignment, whose target the parser wrote, initializes the
// name and is not an assignment of the program.
func checkConstBindingAssignments(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsIdentifier(node) && node.Flags&ast.NodeFlagsReparsed == 0 && ast.IsAssignmentTarget(node) && isConstBinding(c, node) {
			c.AddDiagnostic(ast.NewDiagnostic(file, scanner.GetErrorRangeForNode(file, node), diagnostics.Cannot_assign_to_0_because_it_is_a_constant, node.Text()))
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// isConstBinding reports whether name resolves to a binding an is pattern
// wrote with const (the hoisted let the parser marks).
func isConstBinding(c *checker.Checker, name *ast.Node) bool {
	symbol := c.GetSymbolAtLocation(name)
	if symbol == nil || symbol.ValueDeclaration() == nil {
		return false
	}
	declaration := symbol.ValueDeclaration()
	return ast.IsVariableDeclaration(declaration) && declaration.Flags&ast.NodeFlagsVibeLangConst != 0
}
