package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() {
	ls.RegisterCodeFixProvider(effectAsyncConflictFix)
	tsFormFixCodes = append(tsFormFixCodes, EK0105.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK0105.Code)
}

// The parser diagnoses only recognized mixed heads. Keep native async first:
// accepted async-effect declarations and methods previously emitted Promises.
// Blocks have no async counterpart, so only removing async is offered there.
var effectAsyncConflictFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{parser.EffectAsyncConflictDiagnosticCode},
	GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		text := fix.SourceFile.Text()
		if fix.Span.Pos() < 0 || fix.Span.End() > len(text) {
			return nil, nil
		}
		s := scanner.NewScanner()
		s.SetText(text)
		s.ResetPos(fix.Span.Pos())
		type modifier struct {
			start, end int
			name       string
		}
		var mods []modifier
		for s.Scan() != ast.KindEndOfFile && s.TokenStart() < fix.Span.End() {
			name := s.TokenValue()
			if name == "effect" || name == "async" {
				mods = append(mods, modifier{s.TokenStart(), s.TokenEnd(), name})
			}
		}
		if len(mods) != 2 || mods[0].name == mods[1].name {
			return nil, nil
		}
		s.ResetPos(fix.Span.End())
		block := s.Scan() == ast.KindOpenBraceToken
		var actions []*ls.CodeAction
		for _, name := range []string{"effect", "async"} {
			for _, m := range mods {
				if m.name != name || block && name == "effect" {
					continue
				}
				actions = append(actions, &ls.CodeAction{Description: "Remove " + m.name + " modifier", Changes: replaceRange(fix, m.start, m.end, "")})
			}
		}
		return actions, nil
	},
}
