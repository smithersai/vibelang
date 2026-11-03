package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// asyncMaskBody identifies an ordinary async activation. A computed name
// evaluates in its enclosing activation; do arrows do not create one.
// Fields and static blocks keep their own native restrictions.
func asyncMaskBody(file *ast.SourceFile, block *ast.Node) bool {
	for n, child := block.Parent, block; n != nil; child, n = n, n.Parent {
		if n.Kind == ast.KindParameter && n.Parent != nil && ast.IsFunctionLike(n.Parent) {
			return false
		}
		if n.Kind == ast.KindClassStaticBlockDeclaration || n.Kind == ast.KindPropertyDeclaration && child == n.Initializer() {
			return false
		}
		if !ast.IsFunctionLike(n) || child != n.Body() {
			continue
		}
		if isDoArrow(file, n) {
			continue
		}
		return ast.GetFunctionFlags(n)&ast.FunctionFlagsAsync != 0 && !isMarkedEffect(n)
	}
	return false
}
