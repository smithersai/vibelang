package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

func TestGeneratorConstructorDefectBridgeRefusesDirectEval(t *testing.T) {
	files := neverFixFiles("export class Box { constructor(readonly value: number) {} }", "helper.ts")
	files[neverFixRoot+"main.vibe"] = "import { Box } from './helper.js'\nexport const main = (value: number) => Effect.gen(function* () { return new Box(eval('value')).value })"
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
			if !strings.Contains(scan.why, "direct eval") {
				t.Fatalf("a constructor bridge must preserve eval's function scope; refusal=%q", scan.why)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if !seen {
		t.Fatal("missing generator site")
	}
}

func TestForeignInvocationDirectEvalCalleeGrouping(t *testing.T) {
	for _, test := range []struct {
		operand string
		want    bool
	}{
		{"eval('value')", true},
		{"(eval)('value')", true},
		{"((eval))('value')", true},
		{"(0, eval)('value')", false},
		{"globalThis.eval('value')", false},
		{"(() => eval('value'))", false},
	} {
		t.Run(test.operand, func(t *testing.T) {
			files := neverFixFiles("export class Box { constructor(readonly value: unknown) {} }", "helper.ts")
			files[neverFixRoot+"main.vibe"] = "import { Box } from './helper.js'\nexport const main = (value: number) => new Box(" + test.operand + ")"
			program := computedKeyProgram(t, files)
			file := program.GetSourceFile(neverFixRoot + "main.vibe")
			seen := false
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if ast.IsNewExpression(node) {
					seen = true
					if got := foreignInvocationHasDirectEval(node); got != test.want {
						t.Fatalf("direct eval detection = %t; want %t", got, test.want)
					}
				}
				return node.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if !seen {
				t.Fatal("missing constructor site")
			}
		})
	}
}
