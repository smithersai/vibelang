package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// EK1304: the error declaration grammar reads implements for a targeted repair.
var EK1304 = message(1304, errorCategory, "An error declaration cannot have an implements clause.")

func init() {
	registry[EK1304.Code] = EK1304
	fileChecks = append(fileChecks, checkErrorImplements)
}

func checkErrorImplements(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if form, _ := errorFormOf(node); form != errorFormNone {
			for _, clause := range node.ClassLikeData().HeritageClauses.Nodes {
				if clause.AsHeritageClause().Token == ast.KindImplementsKeyword {
					d := report(c, clause, EK1304)
					note(d, "Remove the implements clause; use the error's instance type structurally.")
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
