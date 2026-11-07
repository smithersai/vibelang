package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// The Promise bridge moves its operand into a callback. The parser has already
// lifted do bodies into statements, so use their source spans rather than the
// operand's lowered children to find jumps and their original targets.
func asyncAwaitOperandJumps(file *ast.SourceFile, operand *ast.Node) bool {
	within := func(node *ast.Node) bool {
		return node != nil && operand.Pos() <= node.Pos() && node.End() <= operand.End()
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if within(node) {
			switch node.Kind {
			case ast.KindReturnStatement:
				if !within(effectCodeOwner(node)) {
					return true
				}
			case ast.KindBreakStatement, ast.KindContinueStatement:
				if !within(jumpTarget(node)) {
					return true
				}
			}
		}
		return node.ForEachChild(visit)
	}
	return visit(file.AsNode())
}
