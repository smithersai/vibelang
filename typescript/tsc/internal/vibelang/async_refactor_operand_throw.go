package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// The bridge's plain callback cannot contain an explicit source throw. Do
// lowering has already lifted operand statements, so compare source spans.
// Nested async and Effect callables keep their own legal throw context.
func asyncAwaitOperandThrows(file *ast.SourceFile, operand *ast.Node) bool {
	within := func(node *ast.Node) bool {
		return node != nil && operand.Pos() <= node.Pos() && node.End() <= operand.End()
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindThrowStatement && node.Flags&ast.NodeFlagsVibeLangBindingCleanup == 0 &&
			!isSynthesizedCatchRethrow(node) && within(node) && !within(effectCodeOwner(node)) {
			return true
		}
		return node.ForEachChild(visit)
	}
	return visit(file.AsNode())
}
