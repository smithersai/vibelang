package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() {
	fileChecks = append(fileChecks, checkLegacyVarDeclarations)
}

// VIP-1 denies var everywhere in .vibe source, including plain functions.
// Inspect declaration lists, so properties and strings named var stay valid.
func checkLegacyVarDeclarations(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindVariableDeclarationList && node.Flags&ast.NodeFlagsBlockScoped == 0 && node.Flags&ast.NodeFlagsReparsed == 0 {
			span := scanner.GetRangeOfTokenAtPosition(file, node.Pos())
			if file.Text()[span.Pos():span.End()] == "var" {
				reportAt(c, file, span, EK0107.With("var is not allowed in a .vibe file. Preserve its scope with explicit block-scoped declarations, or keep legacy JavaScript in a .ts file."))
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
