package vibelangfuzz

import (
	"strings"
	"testing"
)

const migrationWrittenGeneratorTarget = "FuzzMigrationWrittenGenerator"
const migrationWrittenGeneratorQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

// Written generator return types contextualize the returned object. The
// migration must preserve the TypeScript twin's success and failure behavior.
const migrationWrittenGeneratorPrelude = `import { Effect } from "effect"
type Outcome = { readonly kind: "ok"; readonly value: number }
`

var migrationWrittenGeneratorPrograms = []struct{ key, source string }{
	{"smithers-fn-return", "export const main = () => Effect.gen(function* (): Effect.fn.Return<Outcome> { yield* Effect.void; return { kind: \"ok\", value: 7 } })\n"},
	{"smithers-generator-return", "export const main = () => Effect.gen(function* (): Generator<Effect.Effect<unknown>, Outcome, never> { yield* Effect.void; return { kind: \"ok\", value: 7 } })\n"},
	{"alias", "type G = Generator<Effect.Effect<unknown>, Outcome, never>\nexport const main = () => Effect.gen(function* (): G { yield* Effect.void; return { kind: \"ok\", value: 7 } })\n"},
	{"failure", "export const main = () => Effect.result(Effect.gen(function* (): Effect.fn.Return<Outcome, string> { yield* Effect.fail(\"bad\"); return { kind: \"ok\", value: 7 } }))\n"},
	{"t3code-device-hub-record-inexact", ""},
	{"t3code-device-hub-record-exact", ""},
	{"t3code-device-hub-renamed-inexact", ""},
	{"t3code-device-hub-renamed-exact", ""},
	{"t3code-device-hub-conditional-inexact", ""},
	{"t3code-device-hub-conditional-exact", ""},
}

func TestMigrationWrittenGeneratorQuoted(t *testing.T) {
	if chapter := SpecText("007-tooling.md"); !strings.Contains(chapter, migrationWrittenGeneratorQuote) {
		t.Fatalf("Chapter 7 no longer says %q", migrationWrittenGeneratorQuote)
	}
}
