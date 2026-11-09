package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

type catchExecutionDiagnosticsKey struct{}

func catchExecutionMismatchRanges(c *checker.Checker) map[*ast.SourceFile][]core.TextRange {
	return c.ExtensionState(catchExecutionDiagnosticsKey{}, func() any { return map[*ast.SourceFile][]core.TextRange{} }).(map[*ast.SourceFile][]core.TextRange)
}

func init() {
	checker.RegisterDiagnosticsFilterHook(func(c *checker.Checker, file *ast.SourceFile, ds []*ast.Diagnostic) []*ast.Diagnostic {
		ranges := catchExecutionMismatchRanges(c)[file]
		if len(ranges) == 0 {
			return ds
		}
		return slices.DeleteFunc(slices.Clone(ds), func(d *ast.Diagnostic) bool {
			// The generated catch-operand return duplicates the owning head
			// diagnostic. Match its mapped range, retaining errors inside it.
			return d.Source() == "" && (d.Code() == 2322 || d.Code() == 2739 || d.Code() == 2740) && slices.ContainsFunc(ranges, func(r core.TextRange) bool {
				return r.Pos() == d.Pos() && r.End() == d.End()
			})
		})
	})

	tsFormRules[EK0505.Code] = &tsFormRule{
		message: EK0505,
		find:    func(*checker.Checker, *ast.SourceFile, func(*ast.Node, *formRewrite, ...any)) {},
	}
}

// Inspect source operators only. In particular, do not descend into a call's
// arguments or skip source parentheses. A try can itself be represented by
// a flagged parenthesized operand, so recognize execution before barriers.
func isCatchExecutionHead(n *ast.Node) bool {
	if n == nil {
		return false
	}
	if n.Flags&ast.NodeFlagsVibeLangTry != 0 || isTryCall(n) || tryOperationName(n) != "" || fiberHelper(n) == "$join" || isForkOwner(n) {
		return true
	}
	return ast.IsCallExpression(n) && ast.IsIdentifier(n.Expression()) && n.Expression().Text() == "fork" && n.Expression().Flags&ast.NodeFlagsVibeLangIntrinsic != 0
}

func catchExecutionHeads(n *ast.Node, visit func(*ast.Node)) {
	if n == nil {
		return
	}
	if isCatchExecutionHead(n) {
		visit(n)
		return
	}
	switch n.Kind {
	case ast.KindPrefixUnaryExpression:
		catchExecutionHeads(n.AsPrefixUnaryExpression().Operand, visit)
	case ast.KindPostfixUnaryExpression:
		catchExecutionHeads(n.AsPostfixUnaryExpression().Operand, visit)
	case ast.KindAsExpression, ast.KindSatisfiesExpression, ast.KindTypeAssertionExpression, ast.KindNonNullExpression, ast.KindExpressionWithTypeArguments,
		ast.KindTypeOfExpression, ast.KindVoidExpression, ast.KindDeleteExpression:
		catchExecutionHeads(n.Expression(), visit)
	case ast.KindBinaryExpression:
		catchExecutionHeads(n.AsBinaryExpression().Left, visit)
		catchExecutionHeads(n.AsBinaryExpression().Right, visit)
	}
}

func checkCatchExecutionHead(c *checker.Checker, file *ast.SourceFile, call, left, fallback *ast.Node) bool {
	if malformedCatchHandler(call, fallback) != nil {
		return false
	}
	found := false
	catchExecutionHeads(left, func(head *ast.Node) {
		found = true
		reportAt(c, file, tsFormSpan(file, head), EK0505)

	})
	if found {
		// Match diagnostic anchors: satisfies points at its keyword,
		// while the source execution head starts at its operand.
		catchExecutionMismatchRanges(c)[file] = append(catchExecutionMismatchRanges(c)[file], scanner.GetErrorRangeForNode(file, left))
	}
	return found
}
