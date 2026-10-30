package vibelang

import (
	"context"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// EK1802: a retired await operation (VIP-18). {0} is the operation.
var EK1802 = message(1802, errorCategory, "{0} was removed by VIP-18: write try.all, try.race, try.any or try.allSettled over an array of Effects, or try all({ … }, { concurrency: \"unbounded\" }) for an object; vibelang --fix rewrites it.")

func init() {
	registry[EK1802.Code] = EK1802
	fileChecks = append(fileChecks, checkRetiredAwaitOperations)
	tsFormFixCodes = append(tsFormFixCodes, EK1802.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK1802.Code)
	ls.RegisterCodeFixProvider(retiredAwaitOperationFix)
}

func checkRetiredAwaitOperations(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if name := awaitOperationNames[fiberHelper(node)]; name != "" {
			report(c, node, EK1802, name)
			cover(c, node)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

var retiredAwaitOperationFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK1802.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		call := reportedNode(fix.SourceFile, fix.Span, func(node *ast.Node) bool { return awaitOperationNames[fiberHelper(node)] != "" })
		if call == nil {
			return nil, nil
		}
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		rewrite := retiredAwaitOperationRewrite(c, fix.SourceFile, call)
		if !rewrite.fixable() {
			return nil, nil
		}
		var changes []*lsproto.TextEdit
		for _, edit := range rewrite.edits {
			changes = append(changes, replaceRange(fix, edit.start, edit.end, edit.text)...)
		}
		return []*ls.CodeAction{{Description: "Write explicit Effect operands and try concurrency", Changes: changes}}, nil
	},
}
