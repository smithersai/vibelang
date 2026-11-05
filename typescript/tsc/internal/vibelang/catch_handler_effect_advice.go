package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() {
	// Running returned data changes meaning; offer this only as an explicit editor action.
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK0508.Code}, GetCodeActions: catchHandlerEffectActions})
}

// A mixed Effect/data union needs an explicit branch. For a straightforward
// arrow with an entirely Effect-valued result, the specified fix can run it.
func catchHandlerEffectEdits(c *checker.Checker, file *ast.SourceFile, handler *ast.Node) []core.TextChange {
	if !ast.IsArrowFunction(handler) || effectOfValue(c, plainCatchHandlerResult(c, handler)) == nil {
		return nil
	}
	expression := handler.Body()
	if ast.IsBlock(expression) {
		statements := expression.Statements()
		if len(statements) != 1 || !ast.IsReturnStatement(statements[0]) {
			return nil
		}
		expression = statements[0].Expression()
	}
	if expression == nil || ast.NodeIsMissing(expression) {
		return nil
	}
	start := scanner.SkipTrivia(file.Text(), handler.Pos())
	bodyStart := scanner.SkipTrivia(file.Text(), expression.Pos())
	return []core.TextChange{
		{TextRange: core.NewTextRange(start, start), NewText: "effect "},
		{TextRange: core.NewTextRange(bodyStart, bodyStart), NewText: "try ("},
		{TextRange: core.NewTextRange(expression.End(), expression.End()), NewText: ")"},
	}
}

func catchHandlerEffectActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	var handler *ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if call := catchExpressionOf(n); call != nil {
			_, fallback := catchParts(call)
			if h := plainCatchHandler(call, fallback); h != nil && scanner.SkipTrivia(fix.SourceFile.Text(), h.Pos()) == fix.Span.Pos() && h.End() == fix.Span.End() {
				handler = h
				return true
			}
		}
		return n.ForEachChild(visit)
	}
	fix.SourceFile.AsNode().ForEachChild(visit)
	if handler == nil {
		return nil, nil
	}
	c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
	defer done()
	edits := catchHandlerEffectEdits(c, fix.SourceFile, handler)
	if len(edits) == 0 {
		return nil, nil
	}
	var changes []*lsproto.TextEdit
	for _, edit := range edits {
		changes = append(changes, replaceRange(fix, edit.Pos(), edit.End(), edit.NewText)...)
	}
	return []*ls.CodeAction{{Description: "Run the returned Effect in an effect handler", Changes: changes}}, nil
}
