package checker

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// TransparentYieldFunctionHook reports whether fn, a function-like node, is
// transparent to yield: a yield inside it belongs to the nearest enclosing
// function that is not transparent, whose yielded types include it, as if
// the yield stood in that function. VibeLang registers the body of a for
// concurrent loop, which a producer runs per item (vibelang/fibers.go).
type TransparentYieldFunctionHook func(fn *ast.Node) bool

var transparentYieldFunctionHooks []TransparentYieldFunctionHook

// RegisterTransparentYieldFunctionHook adds hook to every checker. Call it
// only from the init function of an in-tree package that tsc/cmd/tsc
// imports; registration is not synchronized.
func RegisterTransparentYieldFunctionHook(hook TransparentYieldFunctionHook) {
	transparentYieldFunctionHooks = append(transparentYieldFunctionHooks, hook)
}

func isTransparentYieldFunction(fn *ast.Node) bool {
	for _, hook := range transparentYieldFunctionHooks {
		if hook(fn) {
			return true
		}
	}
	return false
}
