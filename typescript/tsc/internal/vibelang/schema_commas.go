package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

func init() {
	fileChecks = append(fileChecks, checkSchemaCommas)
	tsFormFixCodes = append(tsFormFixCodes, EK1013.Code)
}

// Only a schema declaration's body has declaration separators. Object types
// nested in mappings and alias types retain TypeScript's comma separators.
func checkSchemaCommas(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindVariableDeclaration && !isSchemaAlias(node) && node.Initializer() != nil && isSchemaStruct(node.Initializer()) {
			for _, property := range node.Initializer().Arguments()[0].AsObjectLiteralExpression().Properties.Nodes {
				reportDataComma(c, file, property, EK1013, "a schema declaration")
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
