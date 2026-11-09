package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// Retained pipeline-stage analysis supports ordinary diagnostics.
// It does not register source rewrites or change evaluation.

// runningSite returns the try around node, where node runs, or nil where
// node is a value. Under VIP-1 a function that returns a program returns it,
// so a returned pipeline is a value: return try (x |> stage) runs it.
func runningSite(node *ast.Node) *ast.Node {
	top := node
	for ast.IsParenthesizedExpression(top.Parent) {
		top = top.Parent
		if top.Flags&ast.NodeFlagsVibeLangTry != 0 {
			return top
		}
	}
	if isTryCall(top.Parent) {
		return top.Parent
	}
	return nil
}

// catchLeftText returns the text of left as a catch expression's left side.
func catchLeftText(file *ast.SourceFile, left *ast.Node) string {
	text := expressionText(file, left)
	if isLowPrecedence(left) {
		return "(" + text + ")"
	}
	return text
}
