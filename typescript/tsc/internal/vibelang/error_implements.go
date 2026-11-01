package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// EK1304: the error declaration grammar reads implements for a targeted repair.
var EK1304 = message(1304, errorCategory, "An error declaration cannot have an implements clause.")

func init() {
	registry[EK1304.Code] = EK1304
	fileChecks = append(fileChecks, checkErrorImplements)
	tsFormFixCodes = append(tsFormFixCodes, EK1304.Code)
	ls.RegisterCodeFixProvider(errorImplementsFix)
}

func checkErrorImplements(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if form, _ := errorFormOf(node); form != errorFormNone {
			for _, clause := range node.ClassLikeData().HeritageClauses.Nodes {
				if clause.AsHeritageClause().Token == ast.KindImplementsKeyword {
					d := report(c, clause, EK1304)
					note(d, "Remove the implements clause; use the error's instance type structurally.")
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// implements has no emitted behavior; removing it preserves the runtime class.
var errorImplementsFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK1304.Code},
	GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		if fix.Diagnostic == nil || !insideImplementsClause(fix.SourceFile, fix.Span.Pos()) {
			return nil, nil
		}
		return []*ls.CodeAction{{
			Description: "Remove the implements clause",
			Changes:     []*lsproto.TextEdit{{Range: fix.Diagnostic.Range, NewText: ""}},
		}}, nil
	},
}

// insideImplementsClause reports whether pos lies in an implements clause of a
// class: EK1304 also names rejected members (error_rejected_members.go), whose
// fix keeps the member in a class rather than deleting it.
func insideImplementsClause(file *ast.SourceFile, pos int) bool {
	found := false
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if found || node.Pos() > pos || node.End() <= pos {
			return found
		}
		if node.Kind == ast.KindHeritageClause && node.AsHeritageClause().Token == ast.KindImplementsKeyword {
			found = true
			return true
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return found
}
