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

// LabelTransparentFunctionHook reports whether fn, a function-like node, is
// transparent to source labels: a labeled statement inside it is checked
// against the labels around fn, as if it stood there. VibeLang registers the
// functions it writes around a do or match expression and calls in place,
// which ECMAScript does not treat as function boundaries (vibelang/forms.go).
type LabelTransparentFunctionHook func(fn *ast.Node) bool

var labelTransparentFunctionHooks []LabelTransparentFunctionHook

// RegisterLabelTransparentFunctionHook adds hook to every checker. Call it
// only from the init function of an in-tree package that tsc/cmd/tsc
// imports; registration is not synchronized.
func RegisterLabelTransparentFunctionHook(hook LabelTransparentFunctionHook) {
	labelTransparentFunctionHooks = append(labelTransparentFunctionHooks, hook)
}

func isLabelTransparentFunction(fn *ast.Node) bool {
	for _, hook := range labelTransparentFunctionHooks {
		if hook(fn) {
			return true
		}
	}
	return false
}
