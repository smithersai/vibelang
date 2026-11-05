package vibelang

import (
	"context"
	"strconv"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Plain Effect.fn callbacks are valid native code, so no diagnostic routes
// them through fileFixes. Report the teaching planner's unsupported callbacks
// at the final fixed point without changing their invocation phase.
func plainEffectFnRefusals(ctx context.Context, program *compiler.Program, file *ast.SourceFile) []declinedSite {
	c, done := program.GetTypeCheckerForFile(ctx, file)
	defer done()
	var declined []declinedSite
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsCallExpression(node) && len(node.Arguments()) > 0 {
			callee := node.Expression()
			direct := isEffectFunction(c, callee, "Effect", "fn")
			named := ast.IsCallExpression(callee) && isEffectFunction(c, callee.Expression(), "Effect", "fn")
			// A direct fn(callback) also returns a callable. Calling that
			// result with a function argument is an invocation, not a name
			// builder receiving its callback.
			if named && len(callee.Arguments()) > 0 {
				first := c.GetTypeAtLocation(callee.Arguments()[0])
				named = len(c.GetSignaturesOfType(first, checker.SignatureKindCall)) == 0
			}
			if direct || named {
				callback := ast.SkipParentheses(node.Arguments()[0])
				// The name/options builder is not a callback application.
				// Resolve callable values too, but retain inline generators
				// under their existing planner and refusal diagnostics.
				if !isGeneratorExpression(callback) && len(c.GetSignaturesOfType(c.GetTypeAtLocation(callback), checker.SignatureKindCall)) > 0 {
					key := diagnosticSource + strconv.Itoa(int(EK1002.Code)) + ":" + nodeText(file, node)
					declined = append(declined, declinedSite{
						start: scanner.SkipTrivia(file.Text(), node.Pos()), end: node.End(),
						code: EK1002.Code, key: key,
						reason: "No quick fix: this Effect.fn callback is not an inline generator; preserve when it constructs its returned program in a manual rewrite.",
					})
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return declined
}
