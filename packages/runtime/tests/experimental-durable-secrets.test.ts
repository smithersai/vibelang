import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Layer, Redacted, Schema, Stream } from "effect"
import { Durable } from "vibelang-runtime/experimental"

// Effect's JSON codec writes a Redacted value's secret as plain text, so
// the engine refuses one wherever the journal would store it.
const journalText = async (store: Durable.Store) => {
  const program = Effect.gen(function*() {
    const runs = Array.from(yield* Stream.runCollect(Durable.runs()))
    const entries = []
    for (const row of runs) entries.push(...Array.from(yield* Stream.runCollect(Durable.history(row.run))))
    return JSON.stringify({ runs, entries })
  })
  return Effect.runPromise(program.pipe(Effect.provide(Durable.layerStore(store))))
}

test("a workflow payload holding a Redacted value is refused before anything is journaled", async () => {
  const store = Durable.makeMemoryStore()
  const Deploy = Durable.workflow("secret#Deploy", { payload: { token: Schema.Redacted(Schema.String) } })
  const exit = await Effect.runPromiseExit(
    Deploy.execute({ token: Redacted.make("hunter2") }).pipe(
      Effect.provide(Deploy.toLayer(() => Effect.void).pipe(Layer.provideMerge(Durable.layerStore(store))))
    )
  )
  expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain("holds a Redacted value at $.token, and credentials never reach the journal")
  expect(await journalText(store)).not.toContain("hunter2")
  expect(JSON.parse(await journalText(store)).runs).toEqual([])
})

test("a step result holding a Redacted value fails the step, and the secret is not journaled", async () => {
  const store = Durable.makeMemoryStore()
  const Login = Durable.task("secret#Login", {
    payload: { user: Schema.String },
    success: Schema.Struct({ session: Schema.Array(Schema.Struct({ token: Schema.Redacted(Schema.String) })) })
  })
  const Flow = Durable.workflow("secret#Flow", { payload: { user: Schema.String } })
  const layer = Flow.toLayer(({ user }) => Effect.asVoid(Login({ user }))).pipe(
    Layer.provide(Login.toLayer(() => Effect.succeed({ session: [{ token: Redacted.make("hunter2") }] }))),
    Layer.provideMerge(Durable.layerStore(store))
  )
  const exit = await Effect.runPromiseExit(Flow.execute({ user: "ada" }).pipe(Effect.provide(layer)))
  expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain("The result of task secret#Login holds a Redacted value at $.session[0].token")
  const text = await journalText(store)
  expect(text).toContain("StepCompleted")
  expect(text).not.toContain("hunter2")
})

test("a secret read inside a step, and passed to it by name, never reaches the journal", async () => {
  const store = Durable.makeMemoryStore()
  const secrets = new Map([["deploy-key", Redacted.make("hunter2")]])
  const Push = Durable.task("secret#Push", { payload: { secret: Schema.String }, success: Schema.Number })
  const Flow = Durable.workflow("secret#Ship", { payload: { secret: Schema.String }, success: Schema.Number })
  const layer = Flow.toLayer(({ secret }) => Push({ secret })).pipe(
    Layer.provide(Push.toLayer(({ secret }) => Effect.sync(() => Redacted.value(secrets.get(secret)!).length))),
    Layer.provideMerge(Durable.layerStore(store))
  )
  expect(await Effect.runPromise(Flow.execute({ secret: "deploy-key" }).pipe(Effect.provide(layer)))).toBe(7)
  expect(await journalText(store)).not.toContain("hunter2")
})
