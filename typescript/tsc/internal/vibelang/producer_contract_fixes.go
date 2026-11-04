package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

func init() {
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		Source: diagnosticSource, ErrorCodes: []int32{EK2102.Code, EK9201.Code, EK9202.Code},
		GetCodeActions: producerContractFixActions,
	})
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		ErrorCodes: []int32{2322}, GetCodeActions: producerContractFixActions,
	})
	tsFormFixCodes = append(tsFormFixCodes, EK2102.Code, EK9201.Code, EK9202.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK2102.Code, EK9201.Code, EK9202.Code)
}

// Correct the written contract without changing the producer body. In
// particular, methods whose annotations used to bypass validation keep their
// yielded values, failures and requirements. Project --fix rechecks all uses
// before retaining this edit.
func producerContractFixActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
	defer done()
	var actions []*ls.CodeAction
	owner := ast.GetContainingFunction(astnav.GetTokenAtPosition(fix.SourceFile, fix.Span.Pos()))
	var visit func(*ast.Node) bool
	visit = func(fn *ast.Node) bool {
		fn.ForEachChild(visit)
		if len(actions) != 0 || !hasWrittenProducerContract(fn) ||
			fix.Span.Pos() < nodeStart(fix.SourceFile, fn) || fix.Span.End() > fn.End() || owner != fn {
			return false
		}
		// The native mismatch provider is restricted to the annotation itself:
		// a body's unrelated TS2322 must not cause a contract rewrite.
		if fix.ErrorCode == 2322 && (fix.Span.Pos() < nodeStart(fix.SourceFile, fn.Type()) || fix.Span.End() > fn.Type().End()) {
			return false
		}
		original := nodeText(fix.SourceFile, fn.Type())
		// Iterator annotations select native generator lowering. Replacing
		// one with Stream would change execution, even if the new type checks.
		if vibelangmapper.HasJavaScriptIteratorReturn(fn) {
			return false
		}
		if strings.Contains(original, "/*") || strings.Contains(original, "//") || streamInterface(c) == nil {
			return false
		}
		result := producerType(c, fn, c.GetReturnTypeFromBody(fn))
		annotation := c.TypeToStringEx(result, fn, checker.TypeFormatFlagsNoTruncation|checker.TypeFormatFlagsUseFullyQualifiedType, nil)
		if annotation == original {
			return false
		}
		actions = append(actions, &ls.CodeAction{
			Description: "Write the producer's inferred Stream contract",
			Changes:     replaceRange(fix, nodeStart(fix.SourceFile, fn.Type()), fn.Type().End(), annotation),
		})
		return false
	}
	fix.SourceFile.AsNode().ForEachChild(visit)
	return actions, nil
}
