package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// VIP-33/detail 90 exposes only the module's URL. Taking the meta object,
// even to read a literal computed key, would expose host-specific properties.
var importMetaPlatformDiagnostic = EK4402.With("Only import.meta.url is available in a .vibe file; use the Path or Config service for host state, or move this import.meta use to a .ts file.")

func init() { fileChecks = append(fileChecks, checkImportMetaPlatform) }

func checkImportMetaPlatform(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsMetaProperty(node) && node.AsMetaProperty().KeywordToken == ast.KindImportKeyword && !ast.IsPartOfTypeNode(node) {
			value := node
			for value.Parent != nil && ast.IsParenthesizedExpression(value.Parent) {
				value = value.Parent
			}
			parent := value.Parent
			if parent != nil && ast.IsPropertyAccessExpression(parent) && parent.Expression() == value && parent.Name().Text() == "url" {
				return false
			}
			at := value
			if parent != nil && (ast.IsPropertyAccessExpression(parent) || ast.IsElementAccessExpression(parent)) && parent.Expression() == value {
				at = parent
			}
			report(c, at, importMetaPlatformDiagnostic)
			cover(c, at)
			return false
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
