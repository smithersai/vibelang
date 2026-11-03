package vibelangmapper

import (
	"strings"
	"testing"

	"gotest.tools/v3/assert"
)

// TestCatchFunctionExpressionHandler checks that a function expression, which
// the parser accepts as a catch handler, projects like an arrow handler.
func TestCatchFunctionExpressionHandler(t *testing.T) {
	source := `declare const load: () => Effect.Effect<number, string>
effect function main(): number!! { return load() catch function (error) { return 0 } }`
	result := Project(source, testContext)
	assert.Assert(t, strings.Contains(result.Text, "$catch("), result.Text)
	assert.Assert(t, strings.Contains(result.Text, "function (error)"), result.Text)
	assertParses(t, result.Text)
}
