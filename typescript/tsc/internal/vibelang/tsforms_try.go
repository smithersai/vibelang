package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// directTryFormSite is the written bare try consuming call (detail 254), or
// nil. Only erased expression wrappers may intervene: never follow value flow,
// arguments, callbacks, catch heads, forks, joins or try.* elements. The try
// must stand in effect code (chapter 7, "TypeScript spellings with VibeLang
// forms"): elsewhere it is EK0501 and runs nothing.
func directTryFormSite(call *ast.Node) *ast.Node {
	site := writtenTryFormSite(call)
	if site == nil || !inEffectCode(site) {
		return nil
	}
	return site
}

func writtenTryFormSite(call *ast.Node) *ast.Node {
	for node := call; node != nil; {
		if node.Flags&ast.NodeFlagsVibeLangTry != 0 {
			return node
		}
		parent := node.Parent
		if parent == nil {
			return nil
		}
		if tryOperand(parent) == node {
			return parent
		}
		if (ast.IsParenthesizedExpression(parent) || ast.IsAsExpression(parent) ||
			ast.IsSatisfiesExpression(parent) || ast.IsNonNullExpression(parent)) && parent.Expression() == node {
			node = parent
			continue
		}
		return nil
	}
	return nil
}

// A wrapper can carry a written type check, assertion or non-null operation.
// Keep it, along with its independent diagnostics, when no exact repair exists.
const directTryWrapperNote = "No quick fix: keep the surrounding expression and its written type effects; rewrite the whole try only after checking its types and evaluation."
const directTrySafetyNote = "No quick fix: an automatic rewrite has not been proved to preserve evaluation order, coldness, types, comments and declaration output."
