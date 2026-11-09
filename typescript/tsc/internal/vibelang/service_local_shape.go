package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// A body-only service has a public Shape namespace only at module scope.
// A written whole-shape annotation has no implicit namespace (VIP-9 amended).
func serviceShapeNamespaceScope(class *ast.Node) bool {
	return serviceShape(class) == nil && class.Parent != nil && (ast.IsSourceFile(class.Parent) || ast.IsModuleBlock(class.Parent))
}

// serviceOwnShapeName admits VIP-9's type-only self-shape hook in the
// written instance member contract. The resolved class identifies the owner;
// spelling alone cannot capture a shadowing declaration. Initializers, bodies,
// computed names and static members do not form the instance member type.
func serviceOwnShapeName(class *ast.Node, name *ast.Node) bool {
	// An explicit annotation supplies the type inside its own key/default
	// body, without creating a public namespace (VIP-9 amended).
	if serviceShape(class) != nil {
		for _, member := range class.Members() {
			if ast.IsNodeDescendantOf(name, member) {
				return true
			}
		}
		return false
	}
	for _, member := range class.Members() {
		if ast.IsStatic(member) {
			continue
		}
		if ast.IsPropertyDeclaration(member) {
			if ast.IsNodeDescendantOf(name, member.Type()) {
				return true
			}
		} else if ast.IsMethodDeclaration(member) {
			if ast.IsNodeDescendantOf(name, member.Type()) {
				return true
			}
			for _, parameter := range member.Parameters() {
				if ast.IsNodeDescendantOf(name, parameter.Type()) {
					return true
				}
			}
			for _, parameter := range member.TypeParameters() {
				if ast.IsNodeDescendantOf(name, parameter) {
					return true
				}
			}
		}
	}
	return false
}
