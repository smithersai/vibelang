package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

func TestYieldActivationFixBoundaries(t *testing.T) {
	for _, source := range []string{
		"export effect function f() { yield 1 }",
		"export effect function f(x = yield* Effect.succeed(1)) { return x }",
		"export effect function* f() { yield* Effect.succeed(1) }",
		"export function* f() { yield* [1, 2] }",
	} {
		_, file, _, _ := editorProgram(t, source)
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if ast.IsYieldExpression(n) && yieldActivationFixable(n) {
				t.Fatalf("unsafe fix: %s", source)
			}
			return n.ForEachChild(visit)
		}
		file.AsNode().ForEachChild(visit)
	}
}
