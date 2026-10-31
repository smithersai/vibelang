package vibelang

import (
	"context"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// VIP-5/detail 212: the parser reports this syntax error at the execution head.
var EK0510 = message(parser.VibeLangExecutionPowerCode, errorCategory, parser.VibeLangExecutionPowerMessage)

func init() {
	registry[EK0510.Code] = EK0510
	tsFormFixCodes = append(tsFormFixCodes, EK0510.Code)
	ls.RegisterCodeFixProvider(executionPowerFix)
}

var executionPowerFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK0510.Code},
	GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		text := fix.SourceFile.Text()
		if fix.Span.Pos() < 0 || fix.Span.End() > len(text) || fix.Span.Pos() >= fix.Span.End() {
			return nil, nil
		}
		expression := text[fix.Span.Pos():fix.Span.End()]
		return []*ls.CodeAction{{Description: "Parenthesize the execution expression", Changes: replaceRange(fix, fix.Span.Pos(), fix.Span.End(), "("+expression+")")}}, nil
	},
}
