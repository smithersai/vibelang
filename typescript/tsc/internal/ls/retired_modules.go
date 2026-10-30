package ls

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// hasRetiredInlineModule recognizes parser recovery for the inline modules
// denied by VIP-25. An empty name matches any declaration. Ordinary TypeScript
// namespaces and ambient modules never carry this VibeLang flag.
func hasRetiredInlineModule(file *ast.SourceFile, name string) bool {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindModuleDeclaration && node.Flags&ast.NodeFlagsVibeLang != 0 &&
			(name == "" || node.Name() != nil && node.Name().Text() == name) {
			return true
		}
		return node.ForEachChild(visit)
	}
	return file.AsNode().ForEachChild(visit)
}
