package checker

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// YieldExpressionResultTypeHook can supply the value of a nondelegating yield.
// The normal grammar, operand and written yielded-type checks run first.
// Returning nil retains the generator's native next-input typing.
type YieldExpressionResultTypeHook func(c *Checker, yield, fn *ast.Node) *Type

var yieldExpressionResultTypeHooks []YieldExpressionResultTypeHook

// RegisterYieldExpressionResultTypeHook registers an in-tree init-time extension.
func RegisterYieldExpressionResultTypeHook(hook YieldExpressionResultTypeHook) {
	yieldExpressionResultTypeHooks = append(yieldExpressionResultTypeHooks, hook)
}

func (c *Checker) yieldExpressionResultTypeFromHooks(yield, fn *ast.Node) *Type {
	for _, hook := range yieldExpressionResultTypeHooks {
		if result := hook(c, yield, fn); result != nil {
			return result
		}
	}
	return nil
}
