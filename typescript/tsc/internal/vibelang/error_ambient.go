package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// VIP-13/29, decided detail248: custom error declarations construct runtime
// values. Native TypeScript ambient classes retain their erased meaning.
var EK1307 = message(1307, errorCategory, "An error declaration needs a runtime constructor and cannot be ambient. Write a native TypeScript ambient class, or move the declaration to nonambient code.")

func init() {
	registry[EK1307.Code] = EK1307
	fileChecks = append(fileChecks, checkAmbientErrorDeclarations)
	tsFormFixCodes = append(tsFormFixCodes, EK1307.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK1307.Code)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		Source:         diagnosticSource,
		ErrorCodes:     []int32{EK1307.Code},
		GetCodeActions: errorMemberClassFix.GetCodeActions,
	})
}

func checkAmbientErrorDeclarations(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) {
		return
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if form, _ := errorFormOf(node); form != errorFormNone && node.Flags&ast.NodeFlagsAmbient != 0 {
			report(c, node.Name(), EK1307)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
