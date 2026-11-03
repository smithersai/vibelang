package vibelang

import (
	"fmt"
	"strings"
	"testing"
)

// An argument the old compiler passed by name (D147) ran its calls inside the
// program it passed; --fix-vip-only writes that program as an effect block.
// It refused every such argument that also held a written function, though a
// plain function keeps its form inside the block (Smithers agent/fs
// SchemaBridge.test.vibe:402: failureOf(toCommandSchema(ref, sync(() =>
// Schema.suspend(() => { throw e }))))).
func TestFixVIPByNameArgumentHoldsPlainFunction(t *testing.T) {
	prelude := legacyRunsPrelude + "effect function take(n: number, thunk: () => number): number!! {\n  return n + thunk()\n}\n\n"
	for _, fn := range []string{
		"() => 2",
		"function () { return 2 }",
		"(): number => { throw new Error(\"plain\") }",
		"() => [1].map((x) => x + 1)[0]!",
	} {
		t.Run(fn, func(t *testing.T) {
			source := prelude + "export effect function f() {\n  return try Effect.map(take(load(1), " + fn + "), (n) => n + 1)\n}\n"
			want := prelude + "export effect function f() {\n  return try Effect.map(effect { return try take(try load(1), " + fn + ") }, (n) => n + 1)\n}\n"
			result, name := fixVIPOnlySource(t, source)
			fixed := result.Files[name]
			if fixed == nil || fixed.Text != want || len(result.Refused) != 0 {
				t.Fatalf("--fix-vip-only wrote %+v, want\n%s\nrefused %+v", fixed, want, result.Refused)
			}
		})
	}
}

// A written function whose body runs or gives an Effect still has a form the
// model does not follow: the site stays refused.
func TestFixVIPByNameArgumentHoldsEffectFunction(t *testing.T) {
	prelude := legacyRunsPrelude + "effect function give(n: number, thunk: () => unknown): number!! {\n  thunk()\n  return n\n}\n\n"
	source := prelude + "export effect function f() {\n  return try Effect.map(give(load(1), () => load(2)), (n) => n + 1)\n}\n"
	result, _ := fixVIPOnlySource(t, source)
	if len(result.Refused) == 0 {
		t.Fatalf("--fix-vip-only refused nothing: %+v", result.Files)
	}
	if !strings.Contains(fmt.Sprintf("%+v", result.Refused), "passed by name") {
		t.Fatalf("refused %+v", result.Refused)
	}
}

// An argument that is itself an effect block is the program its parameter
// receives: the tries go inside it and no block goes around it.
func TestFixVIPByNameArgumentIsEffectBlock(t *testing.T) {
	prelude := legacyRunsPrelude + "effect function hold(program: number!!): number!! {\n  return try program\n}\n\n"
	for _, c := range []struct{ name, site string }{
		{"map-argument", "return try Effect.map(effect { return plainId(CALL) }, (n) => n + 1)"},
		{"own-helper", "return try hold(effect { return plainId(CALL) })"},
		{"pipe-topic", "return try (effect { return plainId(CALL) } |> Effect.orDie(%))"},
		{"parenthesized", "return try hold((effect { return plainId(CALL) }))"},
	} {
		t.Run(c.name, func(t *testing.T) {
			write := func(call string) string {
				return prelude + "export effect function f() {\n  " + strings.Replace(c.site, "CALL", call, 1) + "\n}\n"
			}
			result, name := fixVIPOnlySource(t, write("load(1)"))
			fixed := result.Files[name]
			if fixed == nil || fixed.Text != write("try load(1)") || len(result.Refused) != 0 {
				t.Fatalf("--fix-vip-only wrote %+v, want\n%s\nrefused %+v", fixed, write("try load(1)"), result.Refused)
			}
		})
	}
}
