package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// A constructor bridge cannot enclose a generator's suspended operand in
// a synchronous thunk. Keep the existing manual migration boundary.
func TestGeneratorConstructorDefectBridgeRefusesSuspension(t *testing.T) {
	for _, operand := range []string{"yield* Effect.succeed(value)", "(yield* Effect.succeed(value))"} {
		t.Run(operand, func(t *testing.T) {
			files := neverFixFiles("export class Box { constructor(readonly value: number) {} }", "helper.ts")
			files[neverFixRoot+"main.vibe"] = "import { Box } from './helper.js'\nexport const main = (value: number) => Effect.gen(function* () { return new Box(" + operand + ").value })"
			program := computedKeyProgram(t, files)
			file := program.GetSourceFile(neverFixRoot + "main.vibe")
			checker, done := program.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			seen := false
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if isGeneratorExpression(node) {
					seen = true
					scan := scanEffectGenBody(checker, analyzerFor(checker), file, node)
					if !strings.Contains(scan.why, "yield*") {
						t.Fatalf("suspension moved into a synchronous constructor bridge: refusal=%q", scan.why)
					}
				}
				return node.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if !seen {
				t.Fatal("missing generator site")
			}
		})
	}
}
