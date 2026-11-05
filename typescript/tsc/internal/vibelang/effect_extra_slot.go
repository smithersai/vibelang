package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

var EK0302 = message(302, errorCategory, parser.VibeLangExtraEffectSlotMessage)

func init() {
	registry[EK0302.Code] = EK0302
	tsFormFixCodes = append(tsFormFixCodes, EK0302.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK0302.Code)
	tsFormRules[EK0302.Code] = &tsFormRule{
		message:   EK0302,
		diagnosed: isExtraEffectSlot,
		plan: func(_ *checker.Checker, file *ast.SourceFile, node *ast.Node) *formRewrite {
			inner := node.TypeArguments()[0]
			return &formRewrite{description: "an explicitly nested Effect type", edits: []sourceEdit{
				{nodeStart(file, inner), nodeStart(file, inner), "("},
				{inner.End(), inner.End(), ")"},
			}}
		},
	}
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK0302.Code}, GetCodeActions: typeScriptFormFix.GetCodeActions})
}
func isExtraEffectSlot(node *ast.Node) bool {
	return isWrittenEffectType(node) && len(node.TypeArguments()) == 3 && isWrittenEffectType(node.TypeArguments()[0])
}
