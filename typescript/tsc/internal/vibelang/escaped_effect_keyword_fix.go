package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// VIP-1 gives effect the native keyword rules of async. Normalize a rejected
// escaped modifier without changing an ordinary escaped identifier.
func escapedEffectKeywordAt(file *ast.SourceFile, span core.TextRange) bool {
	if !isVibeLangFile(file) || span.Pos() < 0 || span.End() > len(file.Text()) || span.Pos() >= span.End() {
		return false
	}
	reported := false
	for _, diagnostic := range file.Diagnostics() {
		if diagnostic.Code() == 1260 && diagnostic.Pos() == span.Pos() && diagnostic.End() == span.End() {
			reported = true
			break
		}
	}
	if !reported {
		return false
	}
	raw := file.Text()[span.Pos():span.End()]
	if !strings.Contains(raw, "\\") {
		return false
	}
	token := scanner.NewScanner()
	token.SetText(raw)
	token.Scan()
	return token.TokenStart() == 0 && token.TokenEnd() == len(raw) &&
		token.TokenValue() == "effect" && (token.HasUnicodeEscape() || token.HasExtendedUnicodeEscape())
}

func init() {
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		ErrorCodes: []int32{1260},
		GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
			if !escapedEffectKeywordAt(fix.SourceFile, fix.Span) {
				return nil, nil
			}
			return []*ls.CodeAction{{Description: "Write the effect keyword without escapes", Changes: replaceRange(fix, fix.Span.Pos(), fix.Span.End(), "effect")}}, nil
		},
	})
}

func escapedEffectKeywordFixes(file *ast.SourceFile, refused map[string]bool) proposal {
	result := proposal{file: file}
	for _, diagnostic := range file.Diagnostics() {
		span := core.NewTextRange(diagnostic.Pos(), diagnostic.End())
		if diagnostic.Code() != 1260 || !escapedEffectKeywordAt(file, span) {
			continue
		}
		key := file.FileName().AsString() + ":TS1260:" + file.Text()[span.Pos():span.End()]
		if refused[key] {
			continue
		}
		result.fixes = append(result.fixes, fileFix{code: 1260, native: true, key: key, edits: []sourceEdit{{span.Pos(), span.End(), "effect"}}})
	}
	return result
}
