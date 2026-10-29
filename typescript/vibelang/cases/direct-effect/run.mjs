// Runs D274's direct Effects: their results, when their bodies run, and how
// many run-loop operations each costs beyond Effect.void under Effect 4.1.0.
const { Cause, Effect, Exit } = await import("effect")
const Scheduler = await import("effect/Scheduler")
const program = await import("./out/main.js")

let ops = 0
const base = new Scheduler.MixedScheduler()
const counting = { executionMode: base.executionMode, shouldYield: () => (ops++, false), makeDispatcher: () => base.makeDispatcher() }
const measure = (effect) => {
  ops = 0
  const value = Effect.runSync(Effect.provideService(effect, Scheduler.Scheduler, counting))
  return { value, ops }
}
const floor = measure(Effect.void).ops
const show = (name, effect) => {
  const { value, ops } = measure(effect)
  console.log(`${name}: ${JSON.stringify(value)} in ${ops - floor + 1} ops`)
}

show("step", program.step(1))
const runs = []
const recorded = program.record(runs, 7)
console.log(`record called, body runs: ${runs.length}`)
show("record", recorded)
show("record again", recorded)
console.log(`record ran, body runs: ${runs.length}`)
show("ignore", program.ignore("event"))
show("resolve cached", program.resolve("hit", () => Effect.succeed("miss")))
show("resolve load", program.resolve(undefined, () => Effect.succeed("miss")))
show("greet", new program.Greeter("ada").greet())
const exit = Effect.runSyncExit(program.first([]))
console.log(`first: ${exit._tag}, defect ${Exit.isFailure(exit) && Cause.squash(exit.cause) instanceof TypeError}`)
