package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

var EK1303 = message(1303, errorCategory, "An error declaration cannot have type parameters. Use concrete field types, or write the generic error in TypeScript.")

func init() {
	registry[EK1303.Code] = EK1303
	fileChecks = append(fileChecks, checkErrorTypeParameters)
	tsFormFixCodes = append(tsFormFixCodes, EK1303.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK1303.Code)
	provider := *errorMemberClassFix
	provider.ErrorCodes = []int32{EK1303.Code}
	ls.RegisterCodeFixProvider(&provider)
}

func checkErrorTypeParameters(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if errorDeclarationBase(node) {
			if parameters := node.ClassLikeData().TypeParameters; parameters != nil && len(parameters.Nodes) != 0 {
				report(c, parameters.Nodes[0], EK1303)
				cover(c, node.Name()) // TS2562 on the synthesized schema Self type
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
