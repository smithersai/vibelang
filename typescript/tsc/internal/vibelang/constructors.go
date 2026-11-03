package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// isTypeScriptModule reports whether node is a module declaration, module
// name { ... }, whose body is TypeScript, not a namespace.
func isTypeScriptModule(node *ast.Node) bool {
	return node.Kind == ast.KindModuleDeclaration && node.AsModuleDeclaration().Keyword == ast.KindModuleKeyword
}
