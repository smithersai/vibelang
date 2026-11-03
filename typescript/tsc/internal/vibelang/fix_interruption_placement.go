package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func init() {
	tsFormFixCodes = append(tsFormFixCodes, EK2201.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK2201.Code)
	tsFormRules[EK2201.Code] = &tsFormRule{
		message:   EK2201,
		find:      func(*checker.Checker, *ast.SourceFile, func(*ast.Node, *formRewrite, ...any)) {},
		plan:      interruptionPlacementRewrite,
		diagnosed: func(n *ast.Node) bool { return maskMarkerWord(n) != "" },
	}
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK2201.Code}, GetCodeActions: typeScriptFormFix.GetCodeActions})
}

// Outside effect code the old lowering removed the marker and emitted an
// ordinary JavaScript block. Erase only the keyword to preserve that behavior,
// including comments, lexical scope, synchronous evaluation and outward jumps.
// Marking the callable effect would change its API and delay its body.
func interruptionPlacementRewrite(_ *checker.Checker, file *ast.SourceFile, node *ast.Node) *formRewrite {
	// EK2201 highlights the parser marker's keyword, not the whole block.
	if maskMarkerWord(node) != "" {
		node = node.Parent
	}
	if node == nil {
		return nil
	}
	word := maskWord(node)
	if word == "" || inInterruptionEffectCode(node) {
		return nil
	}
	start := nodeStart(file, node)
	if start+len(word) > len(file.Text()) || file.Text()[start:start+len(word)] != word {
		return nil
	}
	return &formRewrite{
		edits:       []sourceEdit{{start, start + len(word), ""}},
		description: "the ordinary JavaScript block emitted before VIP-22 placement checking",
	}
}
