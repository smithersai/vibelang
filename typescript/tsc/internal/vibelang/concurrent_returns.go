package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// A do arrow is an implementation detail. Computed member names and class
// heritage execute in the surrounding item; member bodies and initializers
// have their own source activation.
func concurrentItemChildren(file *ast.SourceFile, n *ast.Node, visit func(*ast.Node) bool) bool {
	if ast.IsFunctionLike(n) && !isDoArrow(file, n) || ast.IsClassElement(n) {
		if name := n.Name(); name != nil && ast.IsComputedPropertyName(name) && visit(name) {
			return true
		}
		for _, modifier := range n.ModifierNodes() {
			if ast.IsDecorator(modifier) && visit(modifier) {
				return true
			}
		}
		return false
	}
	if ast.IsClassLike(n) {
		return n.ForEachChild(func(child *ast.Node) bool {
			if ast.IsClassElement(child) {
				return concurrentItemChildren(file, child, visit)
			}
			return visit(child)
		})
	}
	return n.ForEachChild(visit)
}
