package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// TS1260 uses the native TypeScript diagnostic. Only a diagnosed keyword
// changes: escaped binding names and ordinary identifier expressions stay put.
func init() {
	const code int32 = 1260
	nativeFixCodes = append(nativeFixCodes, code)
	tsFormFixCodes = append(tsFormFixCodes, code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, code)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{ErrorCodes: []int32{code}, GetCodeActions: unescapeDeclarationKeywordActions})
}

func unescapeDeclarationKeywordActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	if fix.Program == nil || fix.SourceFile == nil || !isVibeLangFile(fix.SourceFile) {
		return nil, nil
	}
	diagnosed := false
	for _, d := range fix.Program.GetSyntacticDiagnostics(ctx, fix.SourceFile) {
		if d.Source() == "" && d.Code() == 1260 && d.Pos() == fix.Span.Pos() && d.End() == fix.Span.End() {
			diagnosed = true
			break
		}
	}
	if !diagnosed {
		return nil, nil
	}
	text := fix.SourceFile.Text()
	if fix.Span.Pos() < 0 || fix.Span.End() > len(text) || fix.Span.Pos() >= fix.Span.End() {
		return nil, nil
	}
	s := scanner.NewScanner()
	s.SetText(text[fix.Span.Pos():fix.Span.End()])
	kind := s.Scan()
	if kind != ast.KindIdentifier && !ast.IsKeyword(kind) || !s.HasUnicodeEscape() && !s.HasExtendedUnicodeEscape() {
		return nil, nil
	}
	word := s.TokenValue()
	if word == "" || s.Scan() != ast.KindEndOfFile {
		return nil, nil
	}
	return []*ls.CodeAction{{Description: "Write the keyword without Unicode escapes", Changes: replaceRange(fix, fix.Span.Pos(), fix.Span.End(), word)}}, nil
}
