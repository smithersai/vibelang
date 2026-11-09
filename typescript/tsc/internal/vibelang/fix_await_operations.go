package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// Preserve leading comments and directive prologues (including use client).
func retiredAwaitImportPosition(file *ast.SourceFile) int {
	statements := file.Statements.Nodes
	if len(statements) == 0 {
		return len(file.Text())
	}
	at := nodeStart(file, statements[0])
	for _, statement := range statements {
		if statement.Kind != ast.KindExpressionStatement || statement.Expression().Kind != ast.KindStringLiteral {
			break
		}
		at = statement.End()
	}
	return at
}
