package vibelangmapper

import (
	"strings"
	"testing"
)

func TestTrySettledNamespaceHygiene(t *testing.T) {
	for _, operand := range []string{"xs", "[xs[0],xs[1]]", "[...xs]"} {
		t.Run(operand, func(t *testing.T) {
			source := "import { Effect as Eff } from \"effect\"; effect function f(xs: ReadonlyArray<Eff.Effect<number>>) { const Effect = { all: 0, exit: 0 }; void Effect; return try.allSettled " + operand + " }"
			projection := Project(source, testContext)
			if len(projection.Diagnostics) != 0 {
				t.Fatal(projection.Diagnostics)
			}
			assertValidMap(t, projection, source)
			text := projection.Text
			if !strings.Contains(text, "Effect_1.all(") || strings.Contains(text, "Effect.all(") || strings.Contains(text, "Effect.exit(") {
				t.Fatalf("checking captures the source binding:\n%s", text)
			}
			js, _, diagnostics := Emit(source, testContext)
			if len(diagnostics) != 0 {
				t.Fatal(diagnostics)
			}
			if !strings.Contains(js, "Effect_1.all(") || strings.Contains(js, "Effect.all(") || strings.Contains(js, "Effect.exit(") {
				t.Fatalf("execution captures the source binding:\n%s", js)
			}
		})
	}
}
