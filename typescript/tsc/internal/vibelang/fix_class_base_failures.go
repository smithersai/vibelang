package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// Before class bases were effect code, a plain call in one threw a defect
// from the generator. Keep that behavior when --fix repairs a newly exposed
// failure outside the enclosing function's written E. Explicitly run Effects
// keep their typed failures; this repair only wraps plain calls.
func init() {
	ls.RegisterCodeFixProvider(classBaseFailureFix)
}

var classBaseFailureFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK9201.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		call := tsFormNodeAt(fix.SourceFile, fix.Span, ast.IsCallExpression)
		if call == nil || !inClassBase(call) || !inEffectCode(call) {
			return nil, nil
		}
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		a := analyzerFor(c)
		if len(a.expectedFailures(call)) == 0 {
			return nil, nil
		}
		// An outer wrapper also preserves failures in its operands, even
		// when its own error is admitted and only an operand was reported.
		// Multiple diagnostics then offer the same, deduplicated repair.
		for n := call.Parent; n != nil && !isFunctionBoundary(n); n = n.Parent {
			if ast.IsCallExpression(n) && len(a.expectedFailures(n)) != 0 {
				call = n
			}
		}
		inputs, code := boundaryInputs(c, fix.SourceFile, call, nil)
		if len(inputs) != 0 {
			return nil, nil // running operands cannot move into a plain thunk
		}
		text := "(try Effect.orDie(Effect.try({ try: () => " + code + ", catch: (error) => error })))"
		return []*ls.CodeAction{{
			Description: "Keep the class-base call's exceptions as defects",
			Changes:     replaceRange(fix, nodeStart(fix.SourceFile, call), call.End(), text),
		}}, nil
	},
}

func inClassBase(node *ast.Node) bool {
	for child, parent := node, node.Parent; parent != nil; child, parent = parent, parent.Parent {
		if heritageTypeArgument(parent, child) {
			return false
		}
		if classExtendsChild(parent, child) {
			return true
		}
		if isFunctionBoundary(parent) {
			return false
		}
	}
	return false
}
