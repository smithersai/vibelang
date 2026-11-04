package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

func TestAlchemyFnDestructuringRunsWithProgram(t *testing.T) {
	for _, source := range []string{
		`export const provider = { diff: Effect.fn(function* ({ news, output }: { news: string; output: boolean }) { return output ? news : undefined }) }
`,
		`interface Provider { diff(input: {news:string;output:boolean}): Effect.Effect<string | undefined> }
export const provider: Provider = { diff: Effect.fn(function* ({ news, output }) { return output ? news : undefined }) }
`,
	} {
		got, ok := effectGenQuickFix(t, source)
		if !ok {
			t.Fatalf("no generator conversion: %s", got)
		}
		if strings.Contains(got, "({ news, output }") {
			t.Fatalf("destructuring moved from program execution to construction:\n%s", got)
		}
	}
}

// A body function is hoisted in the body scope, which parameter defaults did
// not originally see. Moving the default there would silently select "inner".
func TestAlchemyFnParameterScopeRefusal(t *testing.T) {
	source := `const initial = () => "outer"
export const read = Effect.fn(function* ({news = initial()}: {news?:string}) {
  function initial() { return "inner" }
  return news
})
`
	got, result := fixedPipe(t, source)
	if !strings.Contains(got, "Effect.fn(") {
		t.Fatalf("changed default scope:\n%s", got)
	}
	program, file, _, _ := editorProgram(t, source)
	program.GetSemanticDiagnostics(t.Context(), file)
	c, done := program.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	found := false
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsCallExpression(node) {
			if g, _ := readGeneratorCall(c, file, node); g != nil && g.isFn {
				r := planEffectGen(c, file, node)
				found = found || r != nil && !r.fixable() && strings.Contains(r.why, "original lexical scope")
			}
		}
		node.ForEachChild(visit)
		return false
	}
	file.AsNode().ForEachChild(visit)
	if !found {
		t.Fatalf("missing lexical-scope refusal; result: %+v", result)
	}
}

func TestAlchemyFnKeepsPublicParameterLabels(t *testing.T) {
	source := "export const make = Effect.fn(function* ({news}: {news:string}) { return news })"
	got, ok := effectGenQuickFix(t, source)
	if !ok || !strings.Contains(got, "args_0:") {
		t.Fatalf("changed expanded parameter label: %s", got)
	}
	for _, source := range []string{
		"const args_0 = \"outer\"; export const make = Effect.fn(function* ({news}: {news:string}) { return args_0 + news })",
		"export const make = Effect.fn(function* ({news}: {news:string}, suffix:string = news) { return suffix })",
	} {
		got, _ := fixedPipe(t, source)
		if !strings.Contains(got, "Effect.fn(") {
			t.Fatalf("changed a public label or default scope: %s", got)
		}
	}
}
