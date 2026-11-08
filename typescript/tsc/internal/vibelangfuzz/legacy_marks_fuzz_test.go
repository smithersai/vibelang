package vibelangfuzz

import (
	"maps"
	"slices"
	"strings"
)

// legacyMark is one program as VibeLang before VIP-1 wrote it, and as it reads
// with its runs and its form explicit. Both give run, an expression in main.
type legacyMark struct{ declare, legacy, explicit, run string }

// legacyMarks are the forms the old compiler ran or lifted without saying so,
// each from a Smithers module. --fix-vip-only must turn legacy into a program
// that ends as explicit does (RULES 1: two inputs the spec says end alike).
var legacyMarks = map[string]legacyMark{
	"lifted/annotated-const": {
		legacy: "const f: () => number!! = () => 7", explicit: "const f: () => number!! = effect () => 7", run: "f()",
	},
	"lifted/written-result": {
		legacy: "const f = (n: number): number!! => n + 1", explicit: "const f = effect (n: number): number!! => n + 1", run: "f(6)",
	},
	"lifted/block": {
		legacy: "const f = (n: number): number!! => {\n  return n + 1\n}", explicit: "const f = effect (n: number): number!! => {\n  return n + 1\n}", run: "f(6)",
	},
	"lifted/argument": {
		declare: "const load = (f: () => number!!): number!! => f()\n",
		legacy:  "const f = (): number!! => load(() => 7)", explicit: "const f = (): number!! => load(effect () => 7)", run: "f()",
	},
	"lifted/suspend-arm-call": {
		declare: "const g = effect (n: number) => n + 1\n",
		legacy:  "const f = (n: number): number!! => Effect.suspend(() => n === 0 ? 0 : g(n))", explicit: "const f = (n: number): number!! => Effect.suspend(effect () => n === 0 ? 0 : try g(n))", run: "f(6)",
	},
	"lifted/suspend-arm-value": {
		declare: "const next: number!! = Effect.succeed(7)\n",
		legacy:  "const f = (n: number): number!! => Effect.suspend(() => n === 0 ? 0 : next)", explicit: "const f = (n: number): number!! => Effect.suspend(effect () => n === 0 ? 0 : try next)", run: "f(6)",
	},
	"lifted/catch-fallback": {
		legacy: `const f = (e: number!string): number!! => e |> Effect.catch(%, () => 7)`, explicit: `const f = (e: number!string): number!! => e |> Effect.catch(%, effect () => 7)`, run: `f(Effect.fail("x"))`,
	},
	"lifted/overloaded-function": {
		legacy: "const f = (n: number) => Effect.andThen(Effect.void, () => n)", explicit: "const f = (n: number) => Effect.andThen(Effect.void, effect () => n)", run: "f(7)",
	},
	"catch-body/effect-handler": {
		legacy: `const f = (e: number!string): number!boolean => e catch effect (cause) => { throw cause === "x" }`, explicit: `const f = effect (e: number!string): number!boolean => e catch effect (cause) => { throw cause === "x" }`, run: `f(Effect.fail("x"))`,
	},
	"catch-body/plain-handler": {
		legacy: `const f = (e: number!string): number!! => e catch () => 7`, explicit: `const f = effect (e: number!string): number!! => e catch () => 7`, run: `f(Effect.fail("x"))`,
	},
	"span/program-argument": {
		legacy: `const f = (key: string): string!! => withSpan(() => Effect.succeed(key), "span")`, explicit: `const f = (key: string): string!! => withSpan(effect { return try Effect.succeed(key) }, "span")`, run: `f("k")`,
	},
	"suspend/subtype-call": {
		legacy: "const f = () => Effect.suspend(effect () => Exit.succeed(7))", explicit: "const f = () => Effect.suspend(effect () => try Exit.succeed(7))", run: "f()",
	},
	"suspend/subtype-block": {
		legacy: "const f = () => Effect.suspend(effect () => { return Exit.succeed(7) })", explicit: "const f = () => Effect.suspend(effect () => { return try Exit.succeed(7) })", run: "f()",
	},
	"suspend/subtype-value": {
		declare: "const held = Exit.succeed(7)\n",
		legacy:  "const f = () => Effect.suspend(effect () => held)", explicit: "const f = () => Effect.suspend(effect () => try held)", run: "f()",
	},
	"suspend/subtype-arms": {
		declare: "const held = Exit.succeed(7)\nconst no = (): boolean => false\n",
		legacy:  "const f = () => Effect.suspend(effect () => no() ? Exit.succeed(1) : held)", explicit: "const f = () => Effect.suspend(effect () => no() ? try Exit.succeed(1) : try held)", run: "f()",
	},
	"suspend/plain-subtype-thunk": {
		legacy: "const f = () => Effect.suspend(() => Exit.succeed(7))", explicit: "const f = () => Effect.suspend(() => Exit.succeed(7))", run: "f()",
	},
	"suspend/plain-subtype-value": {
		declare: "const held = Exit.succeed(7)\n",
		legacy:  "const f = () => Effect.suspend(() => held)", explicit: "const f = () => Effect.suspend(() => held)", run: "f()",
	},
	"catch/plain-subtype-handler": {
		legacy: `const f = (e: number!string) => Effect.catch(e, () => Exit.succeed(7))`, explicit: `const f = (e: number!string) => Effect.catch(e, () => Exit.succeed(7))`, run: `f(Effect.fail("x"))`,
	},
	"suspend/subtype-used-result": {
		legacy: "const f = effect () => {\n  const n = try Effect.suspend(effect () => Exit.succeed(7))\n  return n + 1\n}", explicit: "const f = effect () => {\n  const n = try Effect.suspend(effect () => try Exit.succeed(7))\n  return n + 1\n}", run: "f()",
	},
	"suspend/subtype-failing": {
		legacy: `const f = () => Effect.suspend(effect () => Exit.fail("gone"))`, explicit: `const f = () => Effect.suspend(effect () => try Exit.fail("gone"))`, run: "f()",
	},
}

// legacyMarkInput reads an input: "key:<key>", or a byte that picks a key.
func legacyMarkInput(data []byte) (string, bool) {
	if key, ok := strings.CutPrefix(string(data), "key:"); ok {
		_, known := legacyMarks[key]
		return key, known
	}
	if len(data) == 0 {
		return "", false
	}
	keys := slices.Sorted(maps.Keys(legacyMarks))
	return keys[int(data[0])%len(keys)], true
}
