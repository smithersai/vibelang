// Compare a one-service block with its exact native Layer counterpart.
const { Effect, Layer } = await import("effect")
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
const direct = measure(Effect.provide(program.bare(), Layer.succeed(program.Greeting, { text: () => Effect.succeed("hi") })))
console.log(`one-service block: ${block - direct} ops beyond Effect.provide`)
