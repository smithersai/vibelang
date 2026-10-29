package vibelangmapper

import (
	"gotest.tools/v3/assert"
	"strings"
	"testing"
)

func TestTryOperandEvaluation(t *testing.T) {
	for _, test := range []struct{ name, source, want, absent string }{
		{"array-producing call", "declare function build(): Effect.Effect<ReadonlyArray<Effect.Effect<number>>>; function f() { return try.all (try build()) }", "$run($try(build()))", ""},
		{"parenthesized try", "declare function build(): Effect.Effect<ReadonlyArray<Effect.Effect<number>>>; function f() { return try.all (try (build())) }", "$try((build()))", ""},
		{"tagged factory", "declare const make: (s: TemplateStringsArray) => Effect.Effect<ReadonlyArray<Effect.Effect<number>>>; function f() { return try.all (try make`x`) }", "$try(make`x`)", ""},
		{"array-producing value", "function f(p: Effect.Effect<ReadonlyArray<Effect.Effect<number>>>) { return try.all (try p) }", "$try(p)", ""},
		{"untried constructors", "declare function task(): Effect.Effect<number>; function f() { return try.all [task(), Effect.succeed(2)] }", "$tryAll([task(), Effect.succeed(2)])", "$run(task())"},
		{"nested operation", "function f(p: Effect.Effect<number>, q: Effect.Effect<number>) { return try.all [Effect.succeed(try.any [p, q])] }", "$tryAny([p, q])", "$run(Effect.succeed("},
	} {
		t.Run(test.name, func(t *testing.T) {
			projection := Project(test.source, testContext)
			assert.Equal(t, len(projection.Diagnostics), 0, "%v", projection.Diagnostics)
			body := virtualBody(t, projection)
			assert.Assert(t, strings.Contains(body, test.want), "%s", body)
			if test.absent != "" {
				assert.Assert(t, !strings.Contains(body, test.absent), "%s", body)
			}
			assertValidMap(t, projection, test.source)
			assertParses(t, projection.Text)
		})
	}
}
