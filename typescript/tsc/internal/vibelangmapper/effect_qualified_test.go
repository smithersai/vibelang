package vibelangmapper

import (
	"strings"
	"testing"

	"gotest.tools/v3/assert"
)

// VIP-14: through the implicit Effect, Effect.Array names effect's Array
// module, in values and in types, while bare Array stays JavaScript's
// (#514). effect/Effect has no Array export, so the projection imports the
// root module under an alias.
func TestEffectQualifiedModules(t *testing.T) {
	t.Parallel()
	source := "export effect function main() {\n  const xs: Effect.Array.NonEmptyReadonlyArray<number> = [1, 2]\n  const head = Effect.Array.head(xs)\n  const keys = Effect.Record.keys({ a: 1 })\n  return Array.isArray(xs) ? Option.getOrElse(head, () => 0) + keys.length : 0\n}\n"
	projection := Project(source, testContext)
	assert.Equal(t, len(projection.Diagnostics), 0, "diagnostics: %v", projection.Diagnostics)
	line, body, _ := strings.Cut(projection.Text, "\n")
	assert.Assert(t, strings.Contains(line, "Array as Array_1") && strings.Contains(line, "Record as Record_1"), line)
	assert.Assert(t, !strings.Contains(line, " Array,") && !strings.Contains(line, " Array }"), "bare Array must stay JavaScript's: %s", line)
	assert.Assert(t, strings.Contains(body, "const xs: Array_1.NonEmptyReadonlyArray<number>"), body)
	assert.Assert(t, strings.Contains(body, "Array_1.head(xs)"), body)
	assert.Assert(t, strings.Contains(body, "Record_1.keys({ a: 1 })"), body)
	assert.Assert(t, strings.Contains(body, "Array.isArray(xs)"), body)
	assert.Assert(t, !strings.Contains(body, "Effect.Array") && !strings.Contains(body, "Effect.Record"), body)
	assertValidMap(t, projection, source)
	assertParses(t, projection.Text)

	js, _, diagnostics := Emit(source, testContext)
	assert.Equal(t, len(diagnostics), 0, "diagnostics: %v", diagnostics)
	assert.Assert(t, strings.Contains(js, "Array as Array_1") && strings.Contains(js, "Record as Record_1"), js)
	assert.Assert(t, strings.Contains(js, `from "effect"`), js)
	assert.Assert(t, strings.Contains(js, "Array_1.head(xs)") && strings.Contains(js, "Array.isArray(xs)"), js)
}

// A written Effect, imported or declared, keeps its TypeScript meaning: an
// explicit namespace has no Array member (VIP-14, amended 2026-11-01), and
// only the collision modules are members of the implicit Effect.
func TestEffectQualifiedModulesNeedTheImplicitEffect(t *testing.T) {
	t.Parallel()
	for _, source := range []string{
		"import { Effect } from \"effect\"\nconst head = Effect.Array.head([1])\n",
		"import * as Effect from \"effect/Effect\"\nconst head = Effect.Array.head([1])\n",
		"function f() { const Effect = { Array: [] }; return Effect.Array }\n",
	} {
		projection := Project(source, testContext)
		assert.Assert(t, strings.Contains(projection.Text, "Effect.Array"), "%s\n%s", source, projection.Text)
		assert.Assert(t, !strings.Contains(projection.Text, "Array_1"), projection.Text)
	}
	projection := Project("const o = Effect.Option.some(1)\nconst s = Effect.succeed(1)\n", testContext)
	assert.Assert(t, strings.Contains(projection.Text, "Effect.Option.some(1)") && strings.Contains(projection.Text, "Effect.succeed(1)"), projection.Text)
}

// VIP-14's precedence table: Request is platform-specific, so bare Request
// is Effect's module (#514). The import carries no type meaning, so a
// Request type annotation keeps the DOM's type under stock TypeScript.
func TestBareRequestIsEffectsModule(t *testing.T) {
	t.Parallel()
	source := "type Get = Request.Request<number> & { readonly _tag: \"Get\" }\nconst Get = Request.tagged<Get>(\"Get\")\nfunction url(r: globalThis.Request) { return r.url }\n"
	projection := Project(source, testContext)
	assert.Equal(t, len(projection.Diagnostics), 0, "diagnostics: %v", projection.Diagnostics)
	line, body, _ := strings.Cut(projection.Text, "\n")
	assert.Assert(t, strings.Contains(line, " Request,") || strings.Contains(line, " Request }"), line)
	assert.Assert(t, strings.Contains(body, "Request.tagged<Get>(\"Get\")"), body)
	js, _, diagnostics := Emit(source, testContext)
	assert.Equal(t, len(diagnostics), 0, "diagnostics: %v", diagnostics)
	assert.Assert(t, strings.Contains(js, "import { Request } from \"effect\""), js)
}
