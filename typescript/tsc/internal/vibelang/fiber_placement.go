package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() {
	tsFormFixCodes = append(tsFormFixCodes, EK1701.Code)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		Source: diagnosticSource, ErrorCodes: []int32{EK1701.Code},
		GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
			// EK1701 highlights only the keyword, independently of its operand.
			var call *ast.Node
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if isFiberOperator(node) && scanner.GetRangeOfTokenAtPosition(fix.SourceFile, node.Pos()) == fix.Span {
					call = node
					return true
				}
				return node.ForEachChild(visit)
			}
			fix.SourceFile.AsNode().ForEachChild(visit)
			if call == nil {
				return nil, nil
			}
			rewrite := fiberPlacementRewrite(nil, fix.SourceFile, call)
			if !rewrite.fixable() {
				return nil, nil
			}
			var edits []*lsproto.TextEdit
			for _, edit := range rewrite.edits {
				edits = append(edits, replaceRange(fix, edit.start, edit.end, edit.text)...)
			}
			return []*ls.CodeAction{{Description: "Write " + rewrite.description, Changes: edits}}, nil
		},
	})
}

// isFiberOperator reads the parser marker: ordinary calls named fork/join
// outside effect code keep their TypeScript meaning.
func isFiberOperator(node *ast.Node) bool {
	if !isKeywordFormCall(node) {
		return false
	}
	callee := ast.SkipParentheses(node.Expression())
	return callee.Text() == "fork" || fiberHelper(node) == "$join"
}

// A misplaced operator emitted a cold runtime call. Preserve that meaning
// without making the surrounding function effectful or adding try. $join
// also retains the old collection behavior.
func fiberPlacementRewrite(_ *checker.Checker, file *ast.SourceFile, at *ast.Node) *formRewrite {
	if !isFiberOperator(at) || inEffectCode(at) || len(at.Arguments()) != 1 {
		return &formRewrite{}
	}
	export, module, base := "forkScoped", "effect/Effect", "$plainFork"
	if fiberHelper(at) == "$join" {
		export, module, base = "$join", "vibelang-runtime", "$plainJoin"
	}
	name, imported := retiredAwaitImport(file, export, module, base)
	word := scanner.GetRangeOfTokenAtPosition(file, at.Pos())
	edits := []sourceEdit{
		{word.Pos(), word.End(), name + "("},
		{at.End(), at.End(), ")"},
	}
	if !imported {
		pos := retiredAwaitImportPosition(file)
		edits = append(edits, sourceEdit{pos, pos, "\nimport { " + export + " as " + name + " } from \"" + module + "\"\n"})
	}
	return &formRewrite{edits: edits, description: "an ordinary cold program call"}
}
