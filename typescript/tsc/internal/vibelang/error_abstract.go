package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// VIP-13 and the relic ruling: retain the old abstract root as the native
// class it already declared before rejecting the source spelling.
var EK1308 = message(1308, warningCategory, "An abstract error root is a legacy declaration form. Run vibelang --fix to retain it as its Effect TypeScript class.")

func init() {
	registry[EK1308.Code] = EK1308
	fileChecks = append(fileChecks, checkAbstractErrorRoots)
	tsFormFixCodes = append(tsFormFixCodes, EK1308.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK1308.Code)
	provider := *errorMemberClassFix
	provider.ErrorCodes = []int32{EK1308.Code}
	ls.RegisterCodeFixProvider(&provider)
}

func checkAbstractErrorRoots(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if form, _ := errorFormOf(node); (form == errorFormRoot || form == errorFormSchemaRoot) && ast.HasSyntacticModifier(node, ast.ModifierFlagsAbstract) {
			report(c, node.Name(), EK1308)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
