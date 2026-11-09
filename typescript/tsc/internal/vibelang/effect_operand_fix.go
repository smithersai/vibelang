package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// A legacy try around a malformed catch can become invalid only after the
// handler repair. Remove that redundant keyword in the same edit, so the
// normal fix gate never has to accept a temporary new EK0502.
func legacyCatchTryRemoval(file *ast.SourceFile, call *ast.Node) *core.TextChange {
	site := outerParentheses(call)
	if site.Parent != nil && isTryCall(site.Parent) {
		site = site.Parent
	} else if !triedFlag(site) {
		return nil
	}
	keyword := tryKeyword(file, site)
	end := keyword.End()
	for end < len(file.Text()) && file.Text()[end] == ' ' {
		end++
	}
	return &core.TextChange{TextRange: core.NewTextRange(keyword.Pos(), end)}
}
