package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// VIP-16 and decided detail 241 assign the parser-owned separator diagnostic.
var EK1605 = message(1605, errorCategory, "These data members need a separator. Write `;` or a line break between them.")

func init() {
	registry[EK1605.Code] = EK1605
	ls.RegisterCodeFixProvider(dataMemberSeparatorFix)
}

var dataMemberSeparatorFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{1605},
	GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		if fix.Diagnostic == nil || fix.SourceFile == nil {
			return nil, nil
		}
		// Accept only the parser's zero-width insertion point in this file.
		for _, d := range fix.SourceFile.Diagnostics() {
			if d.Source() == diagnosticSource && d.Code() == 1605 && d.Len() == 0 && d.Pos() == fix.Span.Pos() {
				return []*ls.CodeAction{{
					Description: "Insert ; between data members",
					Changes:     []*lsproto.TextEdit{{Range: fix.Diagnostic.Range, NewText: ";"}},
				}}, nil
			}
		}
		return nil, nil
	},
}
