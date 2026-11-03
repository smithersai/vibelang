package vibelang

import (
	"fmt"
	"testing"
)

// Smithers Command.test.vibe passes an Exit pattern predicate to expect
// inside it.effect's generic callback. The generated predicate has no
// recursive source call, regardless of the callback's contextual type.
func TestIsEffectSubjectDoesNotInventRecursion(t *testing.T) {
	prefix := "declare function expect<T>(value: T): { toBe(expected: boolean): void }; declare function test<E,R>(fn: () => Effect.Effect<void,E,R>): void; "
	subjects := []struct{ name, expression string }{
		{"failure", "try exit(Effect.fail(\"bad\")) is Exit.Failure"},
		{"success", "try exit(Effect.succeed(1)) is Exit.Success"},
		{"option", "try Effect.succeed(Option.some(1)) is Option.Some"},
		{"primitive", "try Effect.succeed(1) is Number"},
		{"object", "try Effect.succeed({value: 1}) is {value: Number}"},
		{"list", "try Effect.succeed([1]) is [Number]"},
	}
	for _, subject := range subjects {
		for _, context := range []string{"declaration", "callback", "nested-callback"} {
			t.Run(subject.name+"/"+context, func(t *testing.T) {
				body := "expect(" + subject.expression + ").toBe(true)"
				source := prefix
				switch context {
				case "declaration":
					source += "export effect function check() { " + body + " }"
				case "callback":
					source += "test(effect () => { " + body + " })"
				default:
					source += "test(effect () => { test(effect () => { " + body + " }) })"
				}
				if ds := errorsOf(t, source); len(ds) != 0 {
					t.Fatalf("unexpected diagnostics: %v\n%s", ds, source)
				}
			})
		}
	}
	for _, contract := range []string{"", ": Effect.Effect<string[], string, never>", ": Effect.Effect<string[], string>", ": string[]!string!never"} {
		t.Run(fmt.Sprintf("source-callee/%s", contract), func(t *testing.T) {
			source := prefix + "export effect function lex(s: string)" + contract + " { if(s === \"bad\") throw \"bad\"; return [s] }; test(effect () => { expect(try exit(lex(\"bad\")) is Exit.Failure).toBe(true) })"
			if ds := errorsOf(t, source); len(ds) != 0 {
				t.Fatalf("unexpected diagnostics: %v\n%s", ds, source)
			}
		})
	}
}

// VIP-3 retires the written infer slot, so this partial-contract cycle now
// reports the EK4857 migration error instead of EK9206. Avoiding resolution of
// a Boolean predicate must not hide that diagnostic.
func TestIsEffectSubjectRetainsSourceRecursion(t *testing.T) {
	source := "error Neg { n: number }; export effect function either(n: number): Effect<number, Neg, infer R> { if (n < 0) throw new Neg({ n }); return n === 0 ? 0 : (try either(n - 1) || n) }"
	for _, d := range errorsOf(t, source) {
		if d.Code() == EK4857.Code {
			return
		}
	}
	t.Fatal("the retired written-infer cycle fixture must still report EK4857")
}
