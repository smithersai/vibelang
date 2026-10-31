package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() {
	fileChecks = append(fileChecks, checkReferenceIdentifierTypes)
	typeScriptFileChecks = append(typeScriptFileChecks, checkReferenceIdentifierTypes)
}

// A Context.Reference has a value and a Shape namespace, but no identifier
// type (VIP-9). The parser represents service declarations as classes, so
// reject the instance type that this internal representation would expose.
// Reuse TypeScript's value-as-type diagnostic, as for a native Reference.
func checkReferenceIdentifierTypes(c *checker.Checker, file *ast.SourceFile) {
	if !referenceDeclarationsPresent(c) {
		return
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		var name *ast.Node
		importType := ast.IsImportTypeNode(node) && !node.AsImportTypeNode().IsTypeOf
		if ast.IsTypeReferenceNode(node) {
			name = node.AsTypeReferenceNode().TypeName
		} else if importType {
			name = node.AsImportTypeNode().Qualifier
		} else if ast.IsExpressionWithTypeArguments(node) && node.Parent != nil &&
			node.Parent.Kind == ast.KindHeritageClause &&
			(node.Parent.AsHeritageClause().Token == ast.KindImplementsKeyword || ast.IsInterfaceDeclaration(node.Parent.Parent)) {
			name = node.Expression()
		}
		if name != nil {
			symbol := c.GetSymbolAtLocation(name)
			imported := symbol
			if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
				symbol = c.GetAliasedSymbol(symbol)
			}
			if symbol != nil {
				class := symbol.ValueDeclaration()
				if classKindOf(class) == serviceClass && hasDefaultValue(class) {
					if importType && imported.Parent() != nil {
						member := name
						if ast.IsQualifiedName(member) {
							member = member.AsQualifiedName().Right
						}
						c.AddDiagnostic(ast.NewDiagnostic(file, scanner.GetErrorRangeForNode(file, member),
							diagnostics.Namespace_0_has_no_exported_member_1,
							c.GetFullyQualifiedName(imported.Parent()), member.Text()))
					} else {
						c.AddDiagnostic(ast.NewDiagnostic(file, scanner.GetErrorRangeForNode(file, name),
							diagnostics.X_0_refers_to_a_value_but_is_being_used_as_a_type_here_Did_you_mean_typeof_0,
							scanner.GetTextOfNode(name)))
					}
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

type referenceIdentifierTypesKey struct{}

// referenceDeclarationsPresent avoids resolving unrelated type names in
// programs without Reference services. The syntax-only result belongs to
// the checker, like the other service caches, and includes imported files.
func referenceDeclarationsPresent(c *checker.Checker) bool {
	return c.ExtensionState(referenceIdentifierTypesKey{}, func() any {
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if classKindOf(node) == serviceClass && hasDefaultValue(node) {
				return true
			}
			return node.ForEachChild(visit)
		}
		for _, file := range c.Program().SourceFiles() {
			if isVibeLangFile(file) && file.AsNode().ForEachChild(visit) {
				return true
			}
		}
		return false
	}).(bool)
}
