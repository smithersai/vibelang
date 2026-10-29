package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// A function marked effect is an Effect function (VIP-1), and an effect
// block is the Effect its block builds (VIP-2). The parser flags each
// (parser/vibelang_effect.go): the function itself, and for effect { … } an
// arrow with no parameters whose => stands on effect.

// isMarkedEffect reports whether fn is marked effect or is an effect block.
func isMarkedEffect(fn *ast.Node) bool {
	return fn != nil && fn.Flags&ast.NodeFlagsVibeLangEffect != 0
}

// isEffectBlock reports whether node is the arrow the parser writes for an
// effect block, effect { … }.
func isEffectBlock(node *ast.Node) bool {
	return isMarkedEffect(node) && isProgramArrow(node)
}

// markedForm is the form a marked function compiles to: a program for an
// effect block, an Effect function for any other function marked effect,
// and formNone for a function without the mark.
func markedForm(fn *ast.Node) form {
	switch {
	case isEffectBlock(fn):
		return formProgram
	case isMarkedEffect(fn):
		return formEffect
	}
	return formNone
}
