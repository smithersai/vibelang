package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() {
	tsFormFixCodes = append(tsFormFixCodes, EK4701.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK4701.Code)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		Source: diagnosticSource, ErrorCodes: []int32{EK4701.Code},
		GetCodeActions: matchCombinatorCoverageActions,
	})
}

// The explicit default must retain the old implicit TypeError, including its
// defect channel in effect code. An open match of void 0 against 0 cannot
// succeed; its never-valued arm contributes no result or error type. This
// uses the existing match fallback, independently of source globals, imports
// and shadowed TypeError/Effect bindings. No original pattern is re-evaluated.
const matchCombinatorFallback = " default: match (void 0 as unknown) { when 0: (void 0 as never); }; "

func matchCombinatorCoverageActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	var call *ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if patternHelper(n) == "$noMatch" && n.Expression().Pos() <= fix.Span.Pos() && n.Expression().End() >= fix.Span.End() {
			call = n
			return true
		}
		return n.ForEachChild(visit)
	}
	fix.SourceFile.AsNode().ForEachChild(visit)
	if call == nil {
		return nil, nil
	}
	statement := call
	for statement != nil && !ast.IsStatement(statement) {
		statement = statement.Parent
	}
	if statement == nil || statement.Parent == nil {
		return nil, nil
	}
	marked := false
	var mark func(*ast.Node) bool
	mark = func(n *ast.Node) bool {
		if n.Flags&ast.NodeFlagsVibeLangUncountedPattern != 0 {
			marked = true
			return true
		}
		if ast.IsFunctionLike(n) {
			return false
		}
		return n.ForEachChild(mark)
	}
	mark(statement.Parent)
	if !marked {
		// The constrained-type repair keeps its own provider and spelling.
		// Other missing finite cases can retain the same implicit fallback.
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		declared, remaining := matchRemainder(c, call)
		original, _ := matchSubjectTypes(c, call)
		generic := false
		if original != nil {
			constraint := c.GetBaseConstraintOfType(original)
			generic = constraint != nil && constraint != original
		}
		done()
		if declared == nil || remaining == nil || remaining.Flags()&checker.TypeFlagsNever != 0 || generic {
			return nil, nil
		}
	}
	_, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: fix.SourceFile.FileName(), PathKey: fix.SourceFile.PathKey()}, fix.SourceFile.Text())
	start := scanner.SkipTrivia(fix.SourceFile.Text(), call.Expression().Pos())
	for _, form := range forms {
		if form.Kind == parser.VibeSyntaxMatch && form.Word.Pos() == start && form.Close.Len() != 0 {
			return []*ls.CodeAction{{Description: "Write an explicit default preserving the implicit TypeError", Changes: replaceRange(fix, form.Close.Pos(), form.Close.Pos(), matchCombinatorFallback)}}, nil
		}
	}
	return nil, nil
}

// Parse patterns instead of searching their text: strings, property names and
// guard expressions may contain the contextual words and/not as ordinary data.
func matchPatternNeedsCombinatorFallback(pattern string) bool {
	file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/coverage.vibe", PathKey: "/coverage.vibe"}, "match (value) { when "+pattern+": 0; default: 0; }")
	var marked func(*ast.Node) bool
	marked = func(n *ast.Node) bool {
		return n.Flags&ast.NodeFlagsVibeLangUncountedPattern != 0 || n.ForEachChild(marked)
	}
	return marked(file.AsNode())
}
