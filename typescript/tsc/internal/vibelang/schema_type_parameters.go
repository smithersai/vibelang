package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

var EK1502 = message(1502, errorCategory, parser.VibeLangSchemaTypeParametersMessage)

func init() {
	registry[EK1502.Code] = EK1502
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK1502.Code)
	tsFormFixCodes = append(tsFormFixCodes, EK1502.Code)
	ls.RegisterCodeFixProvider(schemaTypeParametersFix)
}

// Previously the schema ended at its name and the remaining tokens began
// another TypeScript expression. Make that empty body and boundary explicit;
// this preserves its decoder, public type and expression evaluation order.
var schemaTypeParametersFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{1502},
	GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		if fix.Diagnostic == nil || fix.SourceFile == nil {
			return nil, nil
		}
		for _, d := range fix.SourceFile.Diagnostics() {
			at := d.Pos()
			if d.Source() == diagnosticSource && d.Code() == 1502 && d.Len() == 0 && at == fix.Span.Pos() &&
				at >= 0 && at < len(fix.SourceFile.Text()) && fix.SourceFile.Text()[at] == '<' {
				return []*ls.CodeAction{{
					Description: "Keep the previous empty schema and TypeScript expression",
					Changes:     []*lsproto.TextEdit{{Range: fix.Diagnostic.Range, NewText: " {}; "}},
				}}, nil
			}
		}
		return nil, nil
	},
}
