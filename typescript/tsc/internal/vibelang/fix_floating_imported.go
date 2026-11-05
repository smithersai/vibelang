package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func init() {
	ls.RegisterCodeFixProvider(discardImportedEffectFix)
	tsFormFixCodes = append(tsFormFixCodes, 3801)
}

// Discarding an Effect is sometimes deliberate. Preserve the expression's
// evaluation and coldness: `void (e)` constructs it without running it. A try
// would change behavior and cannot be the migration used by ordinary --fix.
var discardImportedEffectFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{3801},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		if !isVibeLangFile(fix.SourceFile) {
			return nil, nil
		}
		node := reportedNode(fix.SourceFile, fix.Span, func(n *ast.Node) bool {
			return n.Parent != nil && ast.IsExpressionStatement(n.Parent) && n.Parent.Expression() == n
		})
		if node == nil {
			return nil, nil
		}
		edits := replaceRange(fix, nodeStart(fix.SourceFile, node), nodeStart(fix.SourceFile, node), "void (")
		edits = append(edits, replaceRange(fix, node.End(), node.End(), ")")...)
		return []*ls.CodeAction{{Description: "Explicitly discard the unrun Effect", Changes: edits}}, nil
	},
}
