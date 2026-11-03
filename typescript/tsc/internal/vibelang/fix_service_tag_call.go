package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// try FileSystem.FileSystem() was service access before explicit effects, and
// is now TS2349, or TS2348 for a class tag or a Context.Reference: a tag is an
// Effect value, not a function (VIP-1, VIP-5). --fix-vip-only rewrites it with
// the rest of a migration (fix_effect_value_call.go). This quick fix, which
// vibelang --fix also applies, is for code already on the new compiler. It
// handles only a call that try runs: an untried p() in effect code may be a
// mistake of another kind, and a call with arguments is EK3007's.

func init() {
	for _, code := range tagCallCodes {
		nativeFixCodes = append(nativeFixCodes, code)
		tsFormFixCodes = append(tsFormFixCodes, code)
	}
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{ErrorCodes: tagCallCodes, GetCodeActions: tagCallActions})
}

// tagCallCodes are TS2349, for a value with no call signature, and TS2348, for
// one with a construct signature or a Reference's.
var tagCallCodes = []int32{2349, 2348}

func tagCallActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	if fix.Program == nil || fix.SourceFile == nil {
		return nil, nil
	}
	call := emptyCallAround(fix.SourceFile, fix.Span.Pos(), fix.Span.End())
	if call == nil || !underTry(call) {
		return nil, nil
	}
	c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
	defer done()
	at, open, edits, ok := effectValueCallEdits(analyzerFor(c), fix.SourceFile, call)
	if !ok {
		return nil, nil
	}
	var changes []*lsproto.TextEdit
	if open != "" {
		changes = append(changes, replaceRange(fix, at, at, open)...)
	}
	for _, edit := range edits {
		changes = append(changes, replaceRange(fix, edit.start, edit.end, edit.text)...)
	}
	return []*ls.CodeAction{{Description: "Run the value with try, without calling it", Changes: changes}}, nil
}

// emptyCallAround returns the innermost call without arguments that holds the
// span from pos to end, where the checker reports a call of a value: at the
// callee's name, or for TS2348 at the call, whose start includes its try.
func emptyCallAround(file *ast.SourceFile, pos, end int) *ast.Node {
	var found *ast.Node
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if nodeStart(file, n) > pos || n.End() < end {
			return false
		}
		if ast.IsCallExpression(n) && len(n.Arguments()) == 0 {
			found = n
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return found
}
