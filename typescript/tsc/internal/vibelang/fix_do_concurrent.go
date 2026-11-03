package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func init() {
	tsFormFixCodes = append(tsFormFixCodes, EK0201.Code)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK0201.Code}, GetCodeActions: doConcurrentEndingActions})
}

// Concurrent iteration discards its item results. The old expression-statement
// representation therefore completed with undefined. Make that value explicit,
// preserving even a single-statement if/else body and all source comments.
// Other EK0201 endings may carry a native loop's completion value; this repair
// deliberately requires a recognized source concurrent loop at the diagnostic.
func doConcurrentEndingActions(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	file := fix.SourceFile
	if file == nil || fix.Span.End() > len(file.Text()) {
		return nil, nil
	}
	_, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: file.FileName(), PathKey: file.PathKey()}, file.Text())
	for _, form := range forms {
		if form.Kind != parser.VibeSyntaxForConcurrent || form.Word.Pos() != fix.Span.Pos() {
			continue
		}
		text := "{ " + file.Text()[fix.Span.Pos():fix.Span.End()] + "; void 0 as void; }"
		return []*ls.CodeAction{{Description: "Write the discarded loop value explicitly", Changes: replaceRange(fix, fix.Span.Pos(), fix.Span.End(), text)}}, nil
	}
	return nil, nil
}
