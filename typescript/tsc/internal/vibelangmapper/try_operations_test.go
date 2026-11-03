package vibelangmapper

import (
	"gotest.tools/v3/assert"
	"strings"
	"testing"
)

func TestTryOperations(t *testing.T) {
	for _, operation := range []struct{ word, helper string }{
		{"all", "$tryAll"}, {"race", "$tryRace"}, {"any", "$tryAny"},
	} {
		source := "function f(xs: ReadonlyArray<Effect.Effect<number>>) { return try." + operation.word + " xs }"
		projection := Project(source, testContext)
		assert.Equal(t, len(projection.Diagnostics), 0, "%v", projection.Diagnostics)
		assert.Assert(t, strings.Contains(virtualBody(t, projection), operation.helper+"(xs)"), "%s", projection.Text)
		assertValidMap(t, projection, source)
		assertParses(t, projection.Text)
	}
}

func TestTryAllSettledNativeTypes(t *testing.T) {
	for _, test := range []struct{ operand, want string }{
		{"xs", "$Effect.all((xs).map($Effect.exit), { concurrency: \"unbounded\" })"},
		{"[xs[0], xs[1]]", "$Effect.all([$Effect.exit(xs[0]), $Effect.exit(xs[1])], { concurrency: \"unbounded\" })"},
		{"[...xs]", "$Effect.all([...([...(" + "xs" + ")].map($Effect.exit))], { concurrency: \"unbounded\" })"},
	} {
		source := "effect function f(xs: ReadonlyArray<Effect.Effect<number>>) { return try.allSettled " + test.operand + " }"
		projection := Project(source, testContext)
		assert.Equal(t, len(projection.Diagnostics), 0, "%v", projection.Diagnostics)
		body := strings.NewReplacer("Effect_1.", "$Effect.", "Effect.", "$Effect.").Replace(virtualBody(t, projection))
		assert.Assert(t, strings.Contains(body, test.want), "%s", body)
		assertValidMap(t, projection, source)
		assertParses(t, projection.Text)
	}
}
