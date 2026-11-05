package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() {
	tsFormFixCodes = append(tsFormFixCodes, EK1010.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK1010.Code)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		Source: diagnosticSource, ErrorCodes: []int32{EK1010.Code}, GetCodeActions: throwCommaActions,
	})
}

// A comma was previously accepted after a throw expression. Group the whole
// throw, preserving its unary operand and the comma's original parent. Other
// forbidden punctuators leave the intended operand ambiguous and get no fix.
func throwCommaActions(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	file := fix.SourceFile
	if !isVibeLangFile(file) {
		return nil, nil
	}
	var expression *ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if n.End() < fix.Span.Pos() || n.Pos() > fix.Span.End() {
			return false
		}
		if isThrowExpression(file, n) && nodeStart(file, n) == fix.Span.Pos() && n.End() == fix.Span.End() {
			expression = n
			return true
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if expression == nil {
		return nil, nil
	}
	next := scanner.SkipTrivia(file.Text(), expression.End())
	if next >= len(file.Text()) || file.Text()[next] != ',' {
		return nil, nil
	}
	start, end := fix.Span.Pos(), fix.Span.End()
	return []*ls.CodeAction{{Description: "Parenthesize the throw expression", Changes: replaceRange(fix, start, end, "("+file.Text()[start:end]+")")}}, nil
}
