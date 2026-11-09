package vibelangfuzz

import (
	"fmt"
	"strings"
)

// fixGateFiles are the files FuzzFixGate builds projects of, by key. Each
// takes the index of its place in the input, so names do not collide.
var fixGateFiles = []struct {
	key   string
	files func(i int) map[string]string
}{
	// Nested contracts expose one repair per round. Mix them with refusals
	// so releasing an old checker cannot change a later round's decisions.
	// Smithers' flows exhausted memory while retaining earlier programs.
	{"rounds", func(i int) map[string]string {
		depth := 2 + i%3
		return map[string]string{fmt.Sprintf("rounds%d.vibe", i): fmt.Sprintf("export type Nested%d = ", i) + strings.Repeat("Effect.Effect<Array<", depth) + "number" + strings.Repeat(">>", depth) + "\n"}
	}},

	// A fix that adds no error.
	{"good", func(i int) map[string]string {
		return map[string]string{fmt.Sprintf("good%d.vibe", i): fmt.Sprintf("export type T%d = Effect.Effect<number>\n", i)}
	}},
	// A fix whose text holds the error it adds: the Match chain's fix
	// compares "oauth" | "token" with "none" (TS2367).
	{"match", func(i int) map[string]string {
		return map[string]string{fmt.Sprintf("match%d.vibe", i): fmt.Sprintf("export type T%d = Effect.Effect<number>\n", i) + fixGateMatch("kind")}
	}},
	// Two such fixes in one file, which add the same error twice.
	{"twice", func(i int) map[string]string {
		return map[string]string{fmt.Sprintf("twice%d.vibe", i): fixGateMatch("kind") + strings.ReplaceAll(fixGateMatch("other"), "type Config", "type Config2")}
	}},
	// A fix that adds an error to another file, which reads a declaration
	// the fix rewrote: Effect.succeed("fast") is a string once it runs,
	// which push("slow") fits, and "fast" alone, which it does not.
	{"cross", func(i int) map[string]string {
		return map[string]string{
			fmt.Sprintf("modes%d.vibe", i): "export effect function modes() {\n  const mode = try Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\n",
			fmt.Sprintf("uses%d.vibe", i):  fmt.Sprintf("import { modes } from \"./modes%d.vibe\"\nexport effect function more() {\n  const all = try modes()\n  all.push(\"slow\")\n  return all\n}\n", i),
		}
	}},
	// The same fix, read through a string in an import type: nothing the
	// error's statement names reaches the fix, so the gate halves.
	{"hidden", func(i int) map[string]string {
		return map[string]string{
			fmt.Sprintf("modes%d.vibe", i): "export effect function modes() {\n  const mode = try Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\n",
			fmt.Sprintf("uses%d.vibe", i):  fmt.Sprintf("export const more: ReturnType<(typeof import(\"./modes%d.vibe\"))[\"modes\"]> extends (\"fast\"[]!!) ? false : true = true\n", i),
		}
	}},
	// A refused fix behind a syntax error, which hides no type error.
	{"syntax", func(i int) map[string]string {
		return map[string]string{fmt.Sprintf("syntax%d.vibe", i): fixGateMatch("kind") + "const broken = ;\n"}
	}},
	// An error the original reports, in text a fix rewrites and keeps: it
	// is not added, so it refuses nothing.
	{"moved", func(i int) map[string]string {
		return map[string]string{fmt.Sprintf("moved%d.vibe", i): fmt.Sprintf("export type U%d = Effect.Effect<number, Missing%d>\n", i, i)}
	}},
}

// fixGateMatch is a Match chain named name whose quick fix adds TS2367.
func fixGateMatch(name string) string {
	return "type Config = { readonly method: \"token\" | \"oauth\" }\n" +
		"export function " + name + "(config: Config): string {\n" +
		"  return Match.value(config).pipe(\n" +
		"    Match.whenOr({ method: \"oauth\" }, { method: \"none\" }, (c) => c.method),\n" +
		"    Match.orElse(() => \"other\"),\n" +
		"  )\n" +
		"}\n"
}
