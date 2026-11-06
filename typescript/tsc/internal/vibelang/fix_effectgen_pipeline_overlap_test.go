package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

// These expressions minimize a paginated stream with nested Effect pipelines.
func TestEffectGenNestedCapturedPipelineDoesNotPanic(t *testing.T) {
	expressions := []string{
		"Stream.make(1).pipe(Stream.mapEffect((n: number) => Effect.succeed(n).pipe(Effect.map((x: number) => x + 1))), Stream.runCount, Effect.asVoid)",
		"Effect.succeed(1).pipe((p: Effect.Effect<number>) => p, Effect.flatMap((n: number) => Effect.succeed(n).pipe(Effect.map((x: number) => x + 1))))",
		"Stream.paginate(0, (n: number) => Effect.succeed(n).pipe(Effect.map((page: number) => [[page], Option.none<number>()] as const))).pipe(Stream.filter((n): n is number => n > 0), Stream.mapEffect((n: number) => Effect.succeed(n).pipe(Effect.catch(() => Effect.void)), { concurrency: 2 }), Stream.runCount, Effect.provide(Layer.empty))",
	}
	for index, expression := range expressions {
		for _, explicit := range []bool{false, true} {
			for _, indent := range []string{"", "  "} {
				key := fmt.Sprintf("shape%d/explicit%t/indent%d", index, explicit, len(indent))
				t.Run(key, func(t *testing.T) {
					generator := "function*"
					if explicit {
						generator = "effect " + generator
					}
					source := "import * as Stream from \"effect/Stream\";\nimport * as Option from \"effect/Option\";\nexport const run = Effect.fn(\"run\")(\n" + indent + generator + " () {\n" + indent + "  const value = yield* " + expression + ";\n" + indent + "  return value;\n" + indent + "}, Effect.catch(() => Effect.succeed(undefined)));\n"
					program, file, _, _ := editorProgram(t, source)
					c, done := program.GetTypeCheckerForFile(t.Context(), file)
					defer done()
					call := firstGeneratorCall(file.AsNode(), c)
					if call == nil {
						t.Fatal("missing generator")
					}
					rewrite := planEffectGen(c, file, call)
					if rewrite == nil {
						t.Fatal("missing rewrite")
					}
					if !rewrite.fixable() {
						t.Fatalf("unexpected refusal: %s", rewrite.why)
					}
					if rewrite != nil && rewrite.fixable() {
						fixed := applyEdits(file.Text(), rewrite.edits)
						if strings.TrimSpace(fixed) == "" {
							t.Fatal("empty generator rewrite")
						}
						checked, fixedFile, _, _ := editorProgram(t, fixed)
						for _, diagnostic := range checked.GetSyntacticDiagnostics(t.Context(), fixedFile) {
							if diagnostic.Category() == diagnostics.CategoryError {
								t.Fatalf("nested rewrite is not valid syntax: %s\n%s", diagnostic.String(), fixed)
							}
						}
					}
				})
			}
		}
	}
}

func firstGeneratorCall(node *ast.Node, c *checker.Checker) *ast.Node {
	var found *ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsCallExpression(n) {
			if g, _ := readGeneratorCall(c, ast.GetSourceFileOfNode(n), n); g != nil {
				found = n
				return true
			}
		}
		return n.ForEachChild(visit)
	}
	visit(node)
	return found
}
