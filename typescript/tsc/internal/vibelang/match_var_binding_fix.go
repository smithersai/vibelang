package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() {
	tsFormFixCodes = append(tsFormFixCodes, EK0107.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK0107.Code)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		Source: diagnosticSource, ErrorCodes: []int32{EK0107.Code},
		GetCodeActions: matchVarBindingActions,
	})
}

// Only a pattern's diagnostic marker admits this repair. Other EK0107
// constructs do not acquire a var-to-let rewrite with different scope.
func matchVarBindingActions(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	var marker *ast.Node
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if patternHelper(node) == "$patternError" {
			args := node.Arguments()
			if len(args) > 0 && args[0].Kind == ast.KindNumericLiteral && args[0].Text() == "107" &&
				node.Expression().Pos() <= fix.Span.Pos() && node.Expression().End() >= fix.Span.End() {
				marker = node
				return true
			}
		}
		return node.ForEachChild(visit)
	}
	fix.SourceFile.AsNode().ForEachChild(visit)
	if marker == nil {
		return nil, nil
	}
	text := fix.SourceFile.Text()
	start := scanner.SkipTrivia(text, marker.Expression().Pos())
	end := start + len("var")
	if end > len(text) || text[start:end] != "var" {
		return nil, nil
	}
	return []*ls.CodeAction{{
		Description: "Write let for this pattern binding",
		Changes:     replaceRange(fix, start, end, "let"),
	}}, nil
}
