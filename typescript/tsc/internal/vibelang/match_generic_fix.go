package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// This deliberately open match always takes the implicit no-match path.
// It preserves the old TypeError defect, never result, and untracked throws
// in plain, async and effect code without referring to shadowable globals.
const genericMatchNoMatchDefault = " default: match (void 0 as unknown) { when false: (void 0 as never); }; "

func init() {
	tsFormFixCodes = append(tsFormFixCodes, EK4701.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK4701.Code)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		Source: diagnosticSource, ErrorCodes: []int32{EK4701.Code},
		GetCodeActions: genericMatchCoverageActions,
	})
}

func genericMatchCoverageActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	var call *ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if patternHelper(n) == "$noMatch" && n.Expression().Pos() <= fix.Span.Pos() && n.Expression().End() >= fix.Span.End() {
			call = n
			return true
		}
		return n.ForEachChild(visit)
	}
	fix.SourceFile.AsNode().ForEachChild(visit)
	if call == nil {
		return nil, nil
	}
	c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
	defer done()
	declared, _ := matchSubjectTypes(c, call)
	if declared == nil {
		return nil, nil
	}
	constraint := c.GetBaseConstraintOfType(declared)
	if constraint == nil || constraint == declared {
		return nil, nil
	}
	_, forms := parser.ParseVibeLangSyntax(fix.SourceFile.ParseOptions(), fix.SourceFile.Text())
	for _, form := range forms {
		if form.Kind == parser.VibeSyntaxMatch && form.Word.Pos() == call.Expression().Pos() && form.Close.Len() != 0 {
			return []*ls.CodeAction{{
				Description: "Preserve the no-match TypeError with a default arm",
				Changes:     replaceRange(fix, form.Close.Pos(), form.Close.Pos(), genericMatchNoMatchDefault),
			}}, nil
		}
	}
	return nil, nil
}
