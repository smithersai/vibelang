package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"strings"
)

// Put new imports before declaration JSDoc, while keeping directives and
// existing imports first. Refuse file directives that cannot move safely.
func relicMigrationImportPosition(file *ast.SourceFile) (int, bool) {
	text := file.Text()
	header := 0
	if strings.HasPrefix(text, "\ufeff") {
		header = len("\ufeff")
	}
	if strings.HasPrefix(text[header:], "#!") {
		end := strings.IndexByte(text[header:], '\n')
		if end < 0 {
			return 0, false
		}
		header += end + 1
	}
	at := header
	for _, statement := range file.Statements.Nodes {
		if ast.IsImportDeclaration(statement) || statement.Kind == ast.KindImportEqualsDeclaration || statement.Kind == ast.KindExpressionStatement && statement.Expression().Kind == ast.KindStringLiteral {
			at = statement.End()
		} else {
			break
		}
	}
	if at == header && len(file.Statements.Nodes) > 0 {
		leading := text[header:nodeStart(file, file.Statements.Nodes[0])]
		if strings.Contains(leading, "@ts-") || strings.Contains(leading, "///") {
			return 0, false
		}
	}
	return at, true
}
