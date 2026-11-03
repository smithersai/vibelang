package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

var provideCommaFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK1202.Code},
	GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		start, end := fix.Span.Pos(), fix.Span.End()
		text := fix.SourceFile.Text()
		if start < 0 || end > len(text) || start >= end {
			return nil, nil
		}
		trivia := text[start:end]
		if strings.Contains(trivia, "//") {
			return nil, nil
		}
		// A line break inside a block comment is part of the comment's text.
		// Removing it would satisfy the grammar by changing that text.
		for tail := trivia; ; {
			start := strings.Index(tail, "/*")
			if start < 0 {
				break
			}
			tail = tail[start+2:]
			end := strings.Index(tail, "*/")
			if end < 0 || strings.ContainsAny(tail[:end], "\r\n\u2028\u2029") {
				return nil, nil
			}
			tail = tail[end+2:]
		}
		joined := strings.NewReplacer("\r\n", " ", "\r", " ", "\n", " ", "\u2028", " ", "\u2029", " ").Replace(trivia)
		return []*ls.CodeAction{{Description: "Keep the provider separator on one line", Changes: replaceRange(fix, start, end, joined)}}, nil
	},
}

func init() { ls.RegisterCodeFixProvider(provideCommaFix) }

func init() {
	tsFormFixCodes = append(tsFormFixCodes, EK1202.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK1202.Code)
}
