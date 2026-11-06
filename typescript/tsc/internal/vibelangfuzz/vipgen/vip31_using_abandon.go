package vipgen

// Chapter 8: "`using` keeps TypeScript's meaning" and a non-success Exit of an
// Effect run by try abandons the generator without unwinding its scope. Each
// witness records disposal through an Effect that observes the Exit, so a
// lowering that disposes on abandonment differs from Effect.gen.
const usingQuote = "A non-success `Exit` of an Effect run by `try` [abandons](#abandonment) the generator without unwinding that scope."

const usingOpen = `const open = (trace: string[], name: string): Disposable => ({ [Symbol.dispose]() { trace.push(name) } });`
const usingOpenJS = `const open = (trace, name) => ({ [Symbol.dispose]() { trace.push(name) } });`

func init() {
	for _, row := range []struct{ key, vibe, effect string }{
		{"fail", `using a = open(trace, "a"); try Effect.fail("no")`, `using a = open(trace, "a"); yield* Effect.fail("no")`},
		{"die", `using a = open(trace, "a"); try Effect.die("no")`, `using a = open(trace, "a"); yield* Effect.die("no")`},
		{"throw", `using a = open(trace, "a"); throw "no"`, `using a = open(trace, "a"); return yield* Effect.fail("no")`},
		{"success", `using a = open(trace, "a"); using b = open(trace, "b"); trace.push("body"); return 1`, `using a = open(trace, "a"); using b = open(trace, "b"); trace.push("body"); return 1`},
		{"return-after-try", `using a = open(trace, "a"); try Effect.void; return 7`, `using a = open(trace, "a"); yield* Effect.void; return 7`},
		{"javascript-throw", `using a = open(trace, "a"); (undefined as any).bodyFailure`, `using a = open(trace, "a"); undefined.bodyFailure`},
		{"block", `{ using a = open(trace, "a"); try Effect.void }; trace.push("after")`, `{ using a = open(trace, "a"); yield* Effect.void }; trace.push("after")`},
		{"for-of", `for (using a of [open(trace, "a")]) { try Effect.fail("no") }`, `for (using a of [open(trace, "a")]) { yield* Effect.fail("no") }`},
		{"for-of-break", `for (using a of [open(trace, "a"), open(trace, "b")]) { try Effect.void; break }`, `for (using a of [open(trace, "a"), open(trace, "b")]) { yield* Effect.void; break }`},
		{"for-head", `for (using a = open(trace, "a"); ;) { try Effect.fail("no") }`, `for (using a = open(trace, "a"); ;) { yield* Effect.fail("no") }`},
		{"for-head-break", `for (using a = open(trace, "a"); ;) { try Effect.void; break }`, `for (using a = open(trace, "a"); ;) { yield* Effect.void; break }`},
	} {
		result := `return [trace, exit._tag, exit._tag === "Failure" ? exit.cause.reasons.map((r) => r._tag) : exit.value]`
		registerWitness(31, ChapterWitness{
			Key:      "vip31.using-abandon-" + row.key,
			Chapter:  "008-runtime.md",
			Quote:    usingQuote,
			Cite:     Citation{VIP: 31, Template: "Effect.gen(function* ()", Quote: "Compiled output gives the same \x60Exit\x60 as the Effect TypeScript shown in each VIP: success, failure, defect or interruption, with finalizers in the same order."},
			Requires: []string{"vip01.effect-function", "vip05.try", "vip02.effect-block"},
			Vibe:     usingOpen + " effect function witness() { const trace: string[] = []; const exit = try Effect.exit(effect { " + row.vibe + " }); " + result + " }",
			Effect:   usingOpenJS + " function witness() { return Effect.gen(function* () { const trace = []; const exit = yield* Effect.exit(Effect.gen(function* () { " + row.effect + " })); " + result + " }) }",
		})
	}
}
