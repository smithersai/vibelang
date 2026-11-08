package vibelang

import (
	"strings"
	"testing"
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
