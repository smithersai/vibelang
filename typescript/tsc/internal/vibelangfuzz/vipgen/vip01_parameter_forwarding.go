package vipgen

// VIP-1's call-bound parameter cells must not acquire user-visible iteration
// while the lowering forwards the call into its binding-error boundary.
func init() {
	for _, row := range []struct{ key, source, native, call string }{
		{"default", "const f = effect (x: number = 7) => x", "const f = (x = 7) => Effect.gen(function* () { return x })", "f()"},
		{"prefix", "const f = effect (a: number, x: number = 7) => a + x", "const f = (a, x = 7) => Effect.gen(function* () { return a + x })", "f(3)"},
		{"object", "const f = effect ({x}: {x:number} = {x:7}) => x", "const f = ({x} = {x:7}) => Effect.gen(function* () { return x })", "f({x:9})"},
		{"array", "const f = effect ([x]: number[] = [7]) => x", "const f = ([x] = [7]) => Effect.gen(function* () { return x })", "f()"},
		{"rest", "const f = effect (x: number = 7, ...tail: number[]) => x + tail.length", "const f = (x = 7, ...tail) => Effect.gen(function* () { return x + tail.length })", "f(5,1,2)"},
		{"declaration", "effect function f(x: number = 7) { return x }", "function f(x = 7) { return Effect.gen(function* () { return x }) }", "f()"},
		{"method", "const f = { effect run(x: number = 7) { return x } }.run", "const f = { run(x = 7) { return Effect.gen(function* () { return x }) } }.run", "f(9)"},
	} {
		common := "const a = observe(() => " + row.call + ", false); const b = observe(() => " + row.call + ", true);"
		if row.key == "array" {
			// The source pattern must still read and advance its input iterator.
			common = "const a = observe(() => " + row.call + ", false); const b = observe(() => " + row.call + ", false);"
		}
		registerWitness(1, ChapterWitness{
			Key:      "vip01.parameter-forwarding-" + row.key,
			Chapter:  "001-functions.md",
			Quote:    "Parameters, defaults included, are bound when the function is called, before `Effect.gen`, as an `async` function's are bound before its body starts.",
			Cite:     Citation{VIP: 1, Template: "Effect.gen(function* ()", Quote: vip01Unrun},
			Requires: []string{"vip01.effect-function", "vip05.try"},
			Files:    []ChapterWitnessFile{{Name: "forwarding.ts", Source: parameterForwardingObserver, Names: []string{"observe"}}},
			Vibe:     "effect function witness() { " + row.source + "; " + common + " return [[a.reads,a.steps], [b.reads,b.steps], try a.program, try a.program, try b.program]; }",
			Effect:   "function witness() { " + row.native + "; return Effect.gen(function* () { " + common + " return [[a.reads,a.steps], [b.reads,b.steps], yield* a.program, yield* a.program, yield* b.program]; }); }",
		})
	}
}

const parameterForwardingObserver = `import type { Effect } from "effect"
/** @throws {never} */
export function observe(call: () => Effect.Effect<number>, hostile: boolean) {
  const iterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!
  const proto = Object.getPrototypeOf([][Symbol.iterator]())
  const next = Object.getOwnPropertyDescriptor(proto, "next")!
  let reads = 0, steps = 0
  const problem = { hostile: true }
  Object.defineProperty(Array.prototype, Symbol.iterator, {
    configurable: true,
    get() { reads++; if (hostile) throw problem; return iterator.value },
  })
  Object.defineProperty(proto, "next", {
    ...next,
    value: function (this: unknown) { steps++; if (hostile) throw problem; return Reflect.apply(next.value, this, []) },
  })
  try { const program = call(); return { program, reads, steps } }
  finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, iterator)
    Object.defineProperty(proto, "next", next)
  }
}
`
