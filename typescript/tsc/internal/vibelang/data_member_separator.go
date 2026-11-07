package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// VIP-15, VIP-16 and decided detail 241 assign the parser-owned separator
// diagnostics of schema bodies (EK1504) and data declarations (EK1605).
var (
	EK1504 = message(1504, errorCategory, "These schema fields need a separator. Write `;` or a line break between them.")
	EK1605 = message(1605, errorCategory, "These data members need a separator. Write `;` or a line break between them.")
)

// memberSeparatorFixTitles names each separator diagnostic's quick fix.
var memberSeparatorFixTitles = map[int32]string{
	1504: "Insert ; between schema fields",
	1605: "Insert ; between data members",
}

func init() {
	registry[EK1504.Code] = EK1504
	registry[EK1605.Code] = EK1605
	ls.RegisterCodeFixProvider(dataMemberSeparatorFix)
}

var dataMemberSeparatorFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{1504, 1605},
	GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		if fix.Diagnostic == nil || fix.SourceFile == nil {
			return nil, nil
		}
		// Accept only the parser's zero-width insertion point in this file.
		for _, d := range fix.SourceFile.Diagnostics() {
			if title := memberSeparatorFixTitles[d.Code()]; title != "" && d.Source() == diagnosticSource && d.Len() == 0 && d.Pos() == fix.Span.Pos() {
				return []*ls.CodeAction{{
					Description: title,
					Changes:     []*lsproto.TextEdit{{Range: fix.Diagnostic.Range, NewText: ";"}},
				}}, nil
			}
		}
		return nil, nil
	},
}
