package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const genericEffectCallQuote = "Calls retain ordinary JavaScript evaluation, including receivers, arguments and parameter initialization"
const genericEffectColdQuote = "Calling an \x60effect\x60 function returns its Effect unrun, as calling an \x60async\x60 function returns a Promise."

func TestEffectIntoPlainGenericQuoted(t *testing.T) {
	for chapter, quote := range map[string]string{
		"001-functions.md": genericEffectColdQuote,
		"002-running.md":   genericEffectCallQuote,
	} {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
}

// This is a static inference oracle, not a runtime differential generator.
// VIP-1/VIP-5 leave ordinary calls alone: T must infer the Effect, and assigning
// that value to number must fail. The @ts-expect-error is a negative control:
// accidental any or implicit execution makes it unused (TS2578).
func FuzzEffectIntoPlainGeneric(f *testing.F) {
	startShortBudget(f)
	for _, consumer := range []string{"expect", "identity", "method"} {
		for _, operand := range []string{"call", "block", "factory"} {
			f.Add(consumer+"/"+operand, uint8(7), false)
			f.Add(consumer+"/"+operand, uint8(8), true)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, n uint8, plain bool) {
		TestEffectIntoPlainGenericQuoted(t)
		consumer, operand, ok := strings.Cut(key, "/")
		if !ok {
			return
		}
		declaration, call := "", ""
		switch consumer {
		case "expect":
			declaration = "function expect<T>(value: T): { readonly value: T } { return { value } }\n"
			call = "expect(OPERAND).value"
		case "identity":
			declaration = "function identity<T>(value: T): T { return value }\n"
			call = "identity(OPERAND)"
		case "method":
			declaration = "const holder = { keep<T>(value: T): T { return value } }\n"
			call = "holder.keep(OPERAND)"
		default:
			return
		}
		value := int(n % 32)
		expression, native := "", ""
		switch operand {
		case "call":
			expression = fmt.Sprintf("awaited(%d)", value)
			native = expression
		case "block":
			expression = fmt.Sprintf("effect { return %d }", value)
			native = fmt.Sprintf("Effect.gen(function* () { return %d })", value)
		case "factory":
			expression = fmt.Sprintf("make(%d)", value)
			native = expression
		default:
			return
		}
		prefix := "import { Effect } from \"effect\"\n" + declaration +
			"function make(p: number): Effect.Effect<number> { return Effect.succeed(p) }\n"
		vibe := prefix + "effect function awaited(p: number) { return p }\n"
		ts := prefix + "function awaited(p: number) { return Effect.gen(function* () { return p }) }\n"
		body := func(expr string) string {
			return "const observed = " + strings.ReplaceAll(call, "OPERAND", expr) + "\n" +
				"const inferred: Effect.Effect<number> = observed\n" +
				"// @ts-expect-error An Effect is not its numeric success value.\n" +
				"const wrong: number = observed\n"
		}
		if plain {
			vibe += "export function probe() {\n" + body(expression) + "return inferred\n}\n"
			ts += "export function probe() {\n" + body(native) + "return inferred\n}\n"
		} else {
			vibe += "export effect function probe() {\n" + body(expression) + "return try inferred\n}\n"
			ts += "export function probe() { return Effect.gen(function* () {\n" + body(native) + "return yield* inferred\n}) }\n"
		}
		for file, source := range map[string]string{"main.vibe": vibe, "main.ts": ts} {
			r := toolsCompile(t, w, "FuzzEffectIntoPlainGeneric", map[string]string{file: source})
			defer r.Remove()
			if !toolsErrorFree(r) {
				Gap(t, "FuzzEffectIntoPlainGeneric", key,
					"VIP-1/VIP-5: %q; %q; generic inference must preserve the Effect type: %v\n%s",
					genericEffectCallQuote, genericEffectColdQuote, SortedKeys(Keys(r.Dir, r.Diagnostics)), source)
			}
		}
	})
}
