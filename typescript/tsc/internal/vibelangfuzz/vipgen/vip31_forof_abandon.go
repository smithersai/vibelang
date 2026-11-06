package vipgen

// Chapter 8, Abandonment: a failed yield* never resumes the generator, so a
// for...of in effect code closes its iterator only on JavaScript completions.
// Each witness records the iterator's events through an Effect that observes
// the loop's Exit, so a loop that closes on abandonment differs from Effect.gen.
const forOfAbandonQuote = "So when a `yield*` in effect code fails, dies or is interrupted, no JavaScript after it runs"

const forOfIterator = `const closing = (trace: string[], fail: boolean): Iterable<number> => ({ [Symbol.iterator]() { return { next(): IteratorResult<number> { trace.push("next"); return { done: false, value: 1 } }, return(): IteratorResult<number> { trace.push("close"); if (fail) (undefined as any).closeFailure; return { done: true, value: 0 } } } } });`

// forOfIteratorJS is forOfIterator for the reference, which runs as JavaScript.
const forOfIteratorJS = `const closing = (trace, fail) => ({ [Symbol.iterator]() { return { next() { trace.push("next"); return { done: false, value: 1 } }, return() { trace.push("close"); if (fail) undefined.closeFailure; return { done: true, value: 0 } } } } });`

func init() {
	for _, row := range []struct{ key, vibe, effect string }{
		{"fail", `for (const x of closing(trace, false)) { try Effect.fail("no") }`,
			`for (const x of closing(trace, false)) { yield* Effect.fail("no") }`},
		{"late-fail", `let n = 0; for (const x of closing(trace, false)) { n++; if (n === 2) try Effect.fail("no") }`,
			`let n = 0; for (const x of closing(trace, false)) { n++; if (n === 2) yield* Effect.fail("no") }`},
		{"die", `for (const x of closing(trace, false)) { try Effect.die("no") }`,
			`for (const x of closing(trace, false)) { yield* Effect.die("no") }`},
		{"throw", `for (const x of closing(trace, false)) { throw "no" }`,
			`for (const x of closing(trace, false)) { return yield* Effect.fail("no") }`},
		{"nested", `for (const x of closing(trace, false)) { for (const y of closing(trace, false)) { try Effect.fail("no") } }`,
			`for (const x of closing(trace, false)) { for (const y of closing(trace, false)) { yield* Effect.fail("no") } }`},
		{"binding", `for (const [x = do { try Effect.fail("no") }] of [[]] as Array<Array<number | undefined>>) { trace.push("body") }`,
			`for (const [x = yield* Effect.fail("no")] of [[]]) { trace.push("body") }`},
		{"thrown-wins", `for (const x of closing(trace, true)) { (undefined as any).bodyFailure }`,
			`for (const x of closing(trace, true)) { undefined.bodyFailure }`},
		{"break", `for (const x of closing(trace, false)) { try Effect.void; break }`,
			`for (const x of closing(trace, false)) { yield* Effect.void; break }`},
		{"return", `for (const x of closing(trace, false)) { try Effect.void; return 7 }`,
			`for (const x of closing(trace, false)) { yield* Effect.void; return 7 }`},
		{"break-close-fails", `for (const x of closing(trace, true)) { try Effect.void; break }`,
			`for (const x of closing(trace, true)) { yield* Effect.void; break }`},
		{"labeled", `outer: for (const x of closing(trace, false)) { for (const y of closing(trace, false)) { try Effect.void; continue outer } }`,
			`outer: for (const x of closing(trace, false)) { for (const y of closing(trace, false)) { yield* Effect.void; continue outer } }`},
	} {
		body := row.vibe
		if row.key == "labeled" {
			body = "let turns = 0; " + `outer: for (const x of closing(trace, false)) { for (const y of closing(trace, false)) { try Effect.void; if (++turns === 2) break outer; continue outer } }`
			row.effect = "let turns = 0; " + `outer: for (const x of closing(trace, false)) { for (const y of closing(trace, false)) { yield* Effect.void; if (++turns === 2) break outer; continue outer } }`
		}
		result := `return [trace, exit._tag, exit._tag === "Failure" ? exit.cause.reasons.map((r) => r._tag) : exit.value]`
		registerWitness(31, ChapterWitness{
			Key:      "vip31.for-of-abandon-" + row.key,
			Chapter:  "008-runtime.md",
			Quote:    forOfAbandonQuote,
			Cite:     Citation{VIP: 31, Template: "Effect.gen(function* ()", Quote: "Compiled output gives the same \x60Exit\x60 as the Effect TypeScript shown in each VIP: success, failure, defect or interruption, with finalizers in the same order."},
			Requires: []string{"vip01.effect-function", "vip05.try", "vip02.effect-block"},
			Vibe:     forOfIterator + " effect function witness() { const trace: string[] = []; const exit = try Effect.exit(effect { " + body + " }); " + result + " }",
			Effect:   forOfIteratorJS + " function witness() { return Effect.gen(function* () { const trace = []; const exit = yield* Effect.exit(Effect.gen(function* () { " + row.effect + " })); " + result + " }) }",
		})
	}
}
