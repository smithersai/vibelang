package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

func init() {
	checker.RegisterYieldExpressionResultTypeHook(func(c *checker.Checker, yield, fn *ast.Node) *checker.Type {
		if fn == nil || fn.Flags&ast.NodeFlagsVibeLangEffect == 0 || !isVibeLangFile(ast.GetSourceFileOfNode(fn)) {
			return nil
		}
		flags := ast.GetFunctionFlags(fn)
		if flags&ast.FunctionFlagsGenerator == 0 || flags&ast.FunctionFlagsAsync != 0 {
			return nil
		}
		// Names, formal initialization and enum members are outside this source body.
		// In particular a computed method name runs in its enclosing scope.
		for node, child := yield.Parent, yield; node != nil && node != fn; child, node = node, node.Parent {
			if node.Kind == ast.KindEnumDeclaration {
				return nil
			}
			if node.Kind == ast.KindParameter {
				return nil
			}
			// Field initializers and static blocks retain native yield typing.
			if node.Kind == ast.KindClassStaticBlockDeclaration ||
				node.Kind == ast.KindPropertyDeclaration && child == node.Initializer() {
				return nil
			}
			if node == fn.Body() {
				// No stream consumer supplies a next input (VIP-21).
				return c.GetUndefinedType()
			}
		}
		return nil
	})
}
