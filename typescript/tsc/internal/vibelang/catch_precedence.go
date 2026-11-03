package vibelang

import (
	"context"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

var EK0512 = message(parser.VibeLangCatchPrecedenceCode, errorCategory, parser.VibeLangCatchPrecedenceMessage)

func init() {
	registry[EK0512.Code] = EK0512
	tsFormFixCodes = append(tsFormFixCodes, EK0512.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK0512.Code)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK0512.Code}, GetCodeActions: catchPrecedenceActions})
}

func catchPrecedenceActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	var left *ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if call := catchExpressionOf(n); call != nil {
			head, _ := catchParts(call)
			if scanner.SkipTrivia(fix.SourceFile.Text(), head.Pos()) == fix.Span.Pos() && head.End() == fix.Span.End() {
				left = head
				return true
			}
		}
		return n.ForEachChild(visit)
	}
	fix.SourceFile.AsNode().ForEachChild(visit)
	if left != nil {
		text := fix.SourceFile.Text()[fix.Span.Pos():fix.Span.End()]
		return []*ls.CodeAction{{Description: "Parenthesize the catch operand", Changes: replaceRange(fix, fix.Span.Pos(), fix.Span.End(), "("+text+")")}}, nil
	}
	// The old parser treated the complete suffixed expression as a value
	// fallback. Use the same type-aware migration as EK0509, retaining its
	// evaluation phase, error channel, receiver and argument evaluation.
	return catchHandlerActions(ctx, fix)
}
