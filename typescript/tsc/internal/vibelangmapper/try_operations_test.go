package vibelangmapper

import (
	"gotest.tools/v3/assert"
	"strings"
	"testing"
)

func TestTryOperations(t *testing.T) {
	for _, operation := range []struct{ word, helper string }{
		{"all", "$tryAll"}, {"race", "$tryRace"}, {"any", "$tryAny"}, {"allSettled", "$tryAllSettled"},
	} {
		source := "function f(xs: ReadonlyArray<Effect.Effect<number>>) { return try." + operation.word + " xs }"
		projection := Project(source, testContext)
		assert.Equal(t, len(projection.Diagnostics), 0, "%v", projection.Diagnostics)
		assert.Assert(t, strings.Contains(virtualBody(t, projection), operation.helper+"(xs)"), "%s", projection.Text)
		assertValidMap(t, projection, source)
		assertParses(t, projection.Text)
	}
}
