// What a provide block's statements see, and what one pass through a
// one-service block costs in run-loop operations beyond
// Effect.provideService, under Effect 4.1.0. A block that built a Layer paid
// for a Scope, a MemoMap fork and the Layer's build on every pass.
const { Effect } = await import("effect")
const Scheduler = await import("effect/Scheduler")
const program = await import("./out/main.js")

for (const name of ["single", "two", "layer", "mixed", "nested"]) {
  console.log(`${name}: ${Effect.runSync(program[name]())}`)
}

let ops = 0
const base = new Scheduler.MixedScheduler()
const counting = { executionMode: base.executionMode, shouldYield: () => (ops++, false), makeDispatcher: () => base.makeDispatcher() }
const measure = (effect) => {
  ops = 0
  Effect.runSync(Effect.provideService(effect, Scheduler.Scheduler, counting))
  return ops
}
const block = measure(program.once())
const direct = measure(Effect.provideService(program.bare(), program.Greeting, { text: () => Effect.succeed("hi") }))
console.log(`one-service block: ${block - direct} ops beyond Effect.provideService`)
