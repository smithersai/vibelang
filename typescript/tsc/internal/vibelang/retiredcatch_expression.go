package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// The parser keeps a catch expression's arrow parameter annotation. It does
// not filter failures, so report the same retirement as a statement catch,
// and offer the same explicit match for a class annotation. Its default
// rethrows, so the handler is catch effect: a throw in a plain handler is
// EK0401.
func retiredCatchExpressionActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	var handler *ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if call := catchExpressionOf(n); call != nil {
			arrow := call.Arguments()[1]
			if len(arrow.Parameters()) == 1 {
				p := arrow.Parameters()[0]
				if p.Type() != nil && p.Type().Pos() <= fix.Span.Pos() && fix.Span.End() <= p.Type().End() {
					handler = arrow
					return false
				}
			}
		}
		return n.ForEachChild(visit)
	}
	fix.SourceFile.AsNode().ForEachChild(visit)
	if handler == nil || !ast.IsIdentifier(handler.Parameters()[0].Name()) || handler.Parameters()[0].Initializer() != nil {
		return nil, nil
	}
	c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
	defer done()
	parameter := handler.Parameters()[0]
	pattern, ok := patternOf(c, fix.SourceFile.Text(), parameter.Type())
	if !ok {
		return nil, nil
	}
	name := parameter.Name().Text()
	body := strings.TrimSpace(fix.SourceFile.Text()[handler.Body().Pos():handler.Body().End()])
	replacement := "effect (" + name + ") => match (" + name + ") { when " + pattern + ": " + body + "; default: throw " + name + "; }"
	description := "Test the failure with match"
	if ast.IsBlock(handler.Body()) {
		replacement = "effect (" + name + ") => { if (" + name + " is " + pattern + ") " + body + " else { throw " + name + " } }"
		description = "Test the failure with is"
	}
	span := core.NewTextRange(scanner.SkipTrivia(fix.SourceFile.Text(), handler.Pos()), handler.End())
	return []*ls.CodeAction{{
		Description: description,
		Changes:     []*lsproto.TextEdit{{Range: fix.LS.ToLSPRange(fix.SourceFile, span), NewText: replacement}},
	}}, nil
}
