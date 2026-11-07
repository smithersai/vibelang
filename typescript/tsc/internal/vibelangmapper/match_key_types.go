package vibelangmapper

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// The checking view captures a readonly tuple so call results retain exact
// literal and unique-symbol types, including across assignment-based hoists.
// The executable view converts and stores the key once.
func (w *printer) computedPatternKeyValue(source *ast.Node, e env) {
	w.chunks = append(w.chunks, chunk{kind: editPatternFlow, part: partWhole, fields: []string{"[", helperRef("$propertyKey") + "("}})
	w.node(source, e)
	w.chunks = append(w.chunks, chunk{kind: editPatternFlow, part: partWhole, fields: []string{"] as const", ")"}})
}

func (w *printer) computedPatternKeyAssignment(node *ast.Node, e env) bool {
	if !ast.IsBinaryExpression(node) {
		return false
	}
	assignment := node.AsBinaryExpression()
	if assignment.OperatorToken.Kind != ast.KindEqualsToken || !ast.IsIdentifier(assignment.Left) {
		return false
	}
	source := parser.MatchKeyTypeSource(assignment.Left)
	if source == nil || !parser.MatchKeyTypeHoisted(assignment.Left) {
		return false
	}
	w.write("(" + w.identifier(assignment.Left) + " = ")
	value := assignment.Right
	for ast.IsAsExpression(value) || ast.IsParenthesizedExpression(value) {
		value = value.Expression()
	}
	if ast.IsCallExpression(value) && len(value.Arguments()) == 1 {
		source = value.Arguments()[0]
	}
	w.computedPatternKeyValue(source, e)
	w.write(")")
	return true
}

func (w *printer) computedPatternKeyRead(node *ast.Node) bool {
	if !parser.MatchKeyTypeHoisted(node) {
		return false
	}
	if parent := node.Parent; parent != nil {
		if ast.IsVariableDeclaration(parent) && parent.Name() == node {
			return false
		}
		if ast.IsBinaryExpression(parent) && parent.AsBinaryExpression().OperatorToken.Kind == ast.KindEqualsToken && parent.AsBinaryExpression().Left == node {
			return false
		}
	}
	name := w.identifier(node)
	w.chunks = append(w.chunks, chunk{kind: editPatternFlow, part: partWhole, fields: []string{name + "[0]", name}})
	return true
}
