package vipgen

// Chapter 8: a default's suspensions and jumps stay in the enclosing function,
// in an object pattern as in an array pattern. Elements read in source order,
// and a jump leaves the elements after it unread.
func init() {
	for _, row := range []struct{ key, vibe, effect string }{
		{"return", `const { y = do { return 7 } } = {} as { y?: number }; return y`,
			`const { y } = {}; if (y === undefined) return 7; return y`},
		{"present", `const { y = do { return 7 } } = { y: 1 } as { y?: number }; return y`,
			`const { y } = { y: 1 }; if (y === undefined) return 7; return y`},
		{"empty-literal", `const { x = do { try Effect.succeed(7) } } = {}; const { y = do { return x } } = {}; return 0`,
			`const { x = yield* Effect.succeed(7) } = {}; const { y } = {}; if (y === undefined) return x; return 0`},
		{"literal-neighbor", `const { a, b = do { return a } } = { a: 1 }; return b`,
			`const a = 1; return a`},
		{"read-order", `const source = { get a() { trace.push("a"); return 1 }, get b(): number | undefined { trace.push("b"); return undefined }, get c() { trace.push("c"); return 3 } }; const { a, b = do { return trace }, c } = source; return [a, b, c]`,
			`const source = { get a() { trace.push("a"); return 1 }, get b() { trace.push("b"); return undefined }, get c() { trace.push("c"); return 3 } }; const a = source.a; const b = source.b; if (b === undefined) return trace; const c = source.c; return [a, b, c]`},
		{"neighbor-default", `const { a = trace.push("a"), b = do { trace.push("b"); return trace }, c = trace.push("c") } = {} as { a?: number; b?: number; c?: number }; return [a, b, c]`,
			`const { a = trace.push("a") } = {}; trace.push("b"); return trace`},
		{"string-key", `const { "a-b": v = do { return 2 } } = {} as { "a-b"?: number }; return v`,
			`const { "a-b": v } = {}; if (v === undefined) return 2; return v`},
		{"break", `const seen: number[] = []; for (const row of [{ n: 1 }, {}, { n: 3 }] as Array<{ n?: number }>) { const { n = do { break } } = row; seen.push(n) }; return seen`,
			`const seen = []; for (const row of [{ n: 1 }, {}, { n: 3 }]) { const { n } = row; if (n === undefined) break; seen.push(n) }; return seen`},
		{"continue", `const seen: number[] = []; for (const row of [{ n: 1 }, {}, { n: 3 }] as Array<{ n?: number }>) { const { n = do { continue } } = row; seen.push(n) }; return seen`,
			`const seen = []; for (const row of [{ n: 1 }, {}, { n: 3 }]) { const { n } = row; if (n === undefined) continue; seen.push(n) }; return seen`},
	} {
		registerWitness(2, ChapterWitness{
			Key:      "vip02.do-object-default-" + row.key,
			Chapter:  "008-runtime.md",
			Quote:    "A default's suspensions and jumps stay in the enclosing function:",
			Cite:     Citation{VIP: 31, Template: "Effect.gen(function* ()", Quote: "Compiled output gives the same \x60Exit\x60 as the Effect TypeScript shown in each VIP: success, failure, defect or interruption, with finalizers in the same order."},
			Requires: []string{"vip01.effect-function", "vip05.try"},
			Vibe:     "effect function witness() { const trace: string[] = []; " + row.vibe + " }",
			Effect:   "function witness() { return Effect.gen(function* () { const trace = []; " + row.effect + " }) }",
		})
	}
}
