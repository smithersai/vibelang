package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() {
	// Opt this recovered native syntax error into the guarded migration.
	// The provider handles only the comma of a generated concurrent limit.
	nativeFixCodes = append(nativeFixCodes, 1005)
	tsFormFixCodes = append(tsFormFixCodes, 1005)
	vipMigrationFixCodes = append(vipMigrationFixCodes, 1005)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		ErrorCodes:     []int32{1005},
		GetCodeActions: concurrentLimitCommaActions,
	})
}

func concurrentLimitCommaActions(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	if fix.SourceFile == nil {
		return nil, nil
	}
	file := fix.SourceFile
	limit := concurrentLimitCommaAt(file, fix.Span.Pos())
	if limit == nil {
		return nil, nil
	}
	start := scanner.SkipTrivia(file.Text(), limit.Pos())
	end := limit.End()
	if start < 0 || end <= start || end > len(file.Text()) {
		return nil, nil
	}
	text := "(" + file.Text()[start:end] + ")"
	return []*ls.CodeAction{{
		Description: "Parenthesize the comma expression used as a concurrent limit",
		Changes:     replaceRange(fix, start, end, text),
	}}, nil
}

// concurrentLimitCommaAt returns the bare comma expression of a generated
// for concurrent limit whose comma covers pos, the TS1005 the parser reports
// there, or nil.
func concurrentLimitCommaAt(file *ast.SourceFile, pos int) *ast.Node {
	if file == nil {
		return nil
	}
	var limit *ast.Node
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if fiberHelper(node) == "$forConcurrent" && len(node.Arguments()) == 3 {
			value := node.Arguments()[1]
			if ast.IsBinaryExpression(value) && value.AsBinaryExpression().OperatorToken.Kind == ast.KindCommaToken {
				comma := scanner.GetRangeOfTokenAtPosition(file, value.AsBinaryExpression().OperatorToken.Pos())
				if comma.Pos() <= pos && pos <= comma.End() &&
					!ast.NodeIsMissing(value.AsBinaryExpression().Left) && !ast.NodeIsMissing(value.AsBinaryExpression().Right) {
					limit = value
					return true
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return limit
}
