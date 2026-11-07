package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

const awaitEffectValueFixTitle = "Keep the Effect unrun across native await"

func init() {
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK0103.Code}, GetCodeActions: awaitEffectValueFix})
	tsFormFixCodes = append(tsFormFixCodes, EK0103.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK0103.Code)
}

// An erased operand boundary makes the data intent explicit while preserving
// native await itself, including Promise adoption and thenable assimilation.
// Keep the original awaited type so inference and declarations also stay intact.
func awaitEffectValueFix(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	var await *ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if n.End() < fix.Span.Pos() || n.Pos() > fix.Span.Pos() {
			return false
		}
		if n.Kind == ast.KindAwaitExpression && scanner.GetRangeOfTokenAtPosition(fix.SourceFile, n.Pos()).Pos() == fix.Span.Pos() {
			await = n
			return true
		}
		return n.ForEachChild(visit)
	}
	fix.SourceFile.AsNode().ForEachChild(visit)
	if await == nil {
		return nil, nil
	}
	c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
	defer done()
	if !holdsEffectValue(c, c.GetTypeAtLocation(await.Expression())) {
		return nil, nil
	}
	result := c.GetTypeAtLocation(await)
	target := c.TypeToStringEx(result, await, checker.TypeFormatFlagsNoTruncation|checker.TypeFormatFlagsUseFullyQualifiedType, nil)
	if target == "" {
		return nil, nil
	}
	operand := strings.TrimSpace(fix.SourceFile.Text()[fix.Span.End():await.Expression().End()])
	text := "((await (" + operand + " as unknown)) as " + target + ")"
	return []*ls.CodeAction{{Description: awaitEffectValueFixTitle, Changes: replaceRange(fix, fix.Span.Pos(), await.End(), text)}}, nil
}
