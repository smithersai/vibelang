package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func init() {
	tsFormFixCodes = append(tsFormFixCodes, EK0705.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK0705.Code)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK0705.Code}, GetCodeActions: isStatementHomeActions})
}

// Only the parser's embedded-body recovery block carries a direct 705
// marker. Parameter/enum errors offer no brace repair: moving those
// initializers would change their evaluation environment.
func isStatementHomeActions(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	file := fix.SourceFile
	if !file.FileName().IsVibeLangSource() {
		return nil, nil
	}
	var body *ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsBlock(n) {
			for _, statement := range n.AsBlock().Statements.Nodes {
				if !ast.IsExpressionStatement(statement) {
					continue
				}
				call := statement.Expression()
				if !ast.IsCallExpression(call) || len(call.Arguments()) == 0 {
					continue
				}
				code := call.Arguments()[0]
				if ast.IsIdentifier(call.Expression()) && call.Expression().Text() == "$patternError" && code.Kind == ast.KindNumericLiteral && code.Text() == "705" && call.Pos() <= fix.Span.Pos() && fix.Span.End() <= call.End() {
					body = n
					return true
				}
			}
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if body == nil {
		return nil, nil
	}
	start, end := nodeStart(file, body), body.End()
	return []*ls.CodeAction{{Description: "Wrap the statement body in braces", Changes: replaceRange(fix, start, end, "{ "+file.Text()[start:end]+" }")}}, nil
}
