package vibelang

import (
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Keep the legacy parse tree for migration: parentheses make its existing
// channel grouping explicit without changing the declaration or runtime value.
// VIP-3 requires EK0301 before bare compound channels can be accepted.
var EK0301 = message(301, errorCategory, parser.VibeLangEffectChannelMessage)

func init() {
	registry[EK0301.Code] = EK0301
	tsFormFixCodes = append(tsFormFixCodes, EK0301.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK0301.Code)
	tsFormRules[EK0301.Code] = &tsFormRule{
		message: EK0301,

		plan:      effectChannelParentheses,
		diagnosed: isWrittenEffectType,
	}
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK0301.Code}, GetCodeActions: typeScriptFormFix.GetCodeActions})
}

func isWrittenEffectType(node *ast.Node) bool {
	if node == nil || !ast.IsTypeReferenceNode(node) {
		return false
	}
	name := node.AsTypeReferenceNode().TypeName
	return name.Flags&ast.NodeFlagsReparsed != 0 && isEffectName(name)
}

func effectChannelParentheses(_ *checker.Checker, file *ast.SourceFile, node *ast.Node) *formRewrite {
	if !isWrittenEffectType(node) {
		return nil
	}
	type insertions struct{ open, close int }
	at := map[int]insertions{}
	wrap := func(part *ast.Node) {
		start, end := nodeStart(file, part), part.End()
		a, b := at[start], at[end]
		a.open++
		b.close++
		at[start], at[end] = a, b
	}
	for _, part := range parser.VibeLangEffectChannelParts(node, node.Parent) {
		wrap(part)
	}
	if len(at) == 0 {
		return nil
	}
	var points []int
	for pos := range at {
		points = append(points, pos)
	}
	slices.Sort(points)
	var edits []sourceEdit
	for _, pos := range points {
		n := at[pos]
		edits = append(edits, sourceEdit{pos, pos, strings.Repeat(")", n.close) + strings.Repeat("(", n.open)})
	}
	return &formRewrite{edits: edits, description: "parenthesized Effect type operands"}
}
