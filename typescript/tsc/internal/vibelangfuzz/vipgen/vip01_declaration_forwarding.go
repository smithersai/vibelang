package vipgen

// Source calls do not acquire an observable apply lookup from lowering.
func init() {
	for _, row := range []struct{ key, source, reference, call string }{
		{"empty", "effect function f() {}", "function f() { return Effect.gen(function* () {}) }", "f()"},
		{"bare-return", "effect function f() { return }", "function f() { return Effect.gen(function* () { return }) }", "f()"},
		{"statements", "effect function f() { const value = 7; return value }", "function f() { return Effect.gen(function* () { const value = 7; return value }) }", "f()"},
		{"delegated-tail", "effect function f() { return try Effect.succeed(7) }", "function f() { return Effect.gen(function* () { return yield* Effect.succeed(7) }) }", "f()"},
		{"suspension", "effect function f() { const value = try Effect.succeed(7); return value }", "function f() { return Effect.gen(function* () { const value = yield* Effect.succeed(7); return value }) }", "f()"},
		{"nested-arrow", "effect function f() { const read = () => 7; return read() }", "function f() { return Effect.gen(function* () { const read = () => 7; return read() }) }", "f()"},
		{"direct-control", "effect function f() { return 7 }", "function f() { return Effect.gen(function* () { return 7 }) }", "f()"},
		{"parameter-control", "effect function f(value: number) { const result = value; return result }", "function f(value) { return Effect.gen(function* () { const result = value; return result }) }", "f(7)"},
		{"expression-control", "const f = effect function () { const value = 7; return value }", "const f = function () { return Effect.gen(function* () { const value = 7; return value }) }", "f()"},
		{"method-control", "const object = { effect f() { const value = 7; return value } }", "const object = { f() { return Effect.gen(function* () { const value = 7; return value }) } }", "object.f()"},
	} {
		common := "const a = observe(() => " + row.call + ", false); const b = observe(() => " + row.call + ", true); "
		result := "return [a.reads, a.threw, b.reads, b.threw, try a.program, try b.program]"
		referenceResult := "return [a.reads, a.threw, b.reads, b.threw, yield* a.program, yield* b.program]"
		registerWitness(1, ChapterWitness{
			Key:      "vip01.declaration-forwarding-" + row.key,
			Chapter:  "001-functions.md",
			Quote:    "Each form keeps the form it is written in, as \x60async\x60 does.",
			Cite:     Citation{VIP: 1, Template: "Effect.gen(function* ()", Quote: vip01Unrun},
			Requires: []string{"vip01.effect-function", "vip05.try"},
			Files:    []ChapterWitnessFile{{Name: "forwarding.ts", Source: declarationForwardingObserver, Names: []string{"observe"}}},
			Vibe:     "effect function witness() { " + row.source + "; " + common + result + " }",
			Effect:   "function witness() { return Effect.gen(function* () { " + row.reference + "; " + common + referenceResult + " }) }",
		})
	}
}

const declarationForwardingObserver = `import { Effect } from "effect"
/** @throws {never} */
export function observe<A>(call: () => Effect.Effect<A>, hostile: boolean) {
  const descriptor = Object.getOwnPropertyDescriptor(Function.prototype, "apply")!
  let reads = 0
  const problem = { label: "unexpected forwarding" }
  Object.defineProperty(Function.prototype, "apply", {
    configurable: true,
    get() { reads++; if (hostile) throw problem; return descriptor.value },
  })
  try { return { program: call(), reads, threw: false } }
  catch (error) { return { program: Effect.die(error), reads, threw: true } }
  finally { Object.defineProperty(Function.prototype, "apply", descriptor) }
}
`
