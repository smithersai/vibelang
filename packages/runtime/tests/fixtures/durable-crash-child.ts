// One process of the durable SQLite crash test. It runs a workflow over a
// SQLite file. The outside world is a file of effects. When `crash` names an
// effect and a phase, the injected fault kills this process with SIGKILL
// there: before the effect, or after it and before the step's record.
// `mode` picks the workflow: `order`, three sequential steps; `pair`, one
// task called twice at once through Effect.all, the second call slower; and
// `race`, the order workflow with every effect slowed, for two processes
// that execute the same run at once.
import { appendFileSync } from "node:fs"
import { Context, Effect, Layer, Schema } from "effect"
import { Durable } from "vibelang-runtime/experimental"
import { layer as sqlite } from "./bun-sqlite-client.ts"

const [database, effects, crash = "", mode = "order"] = process.argv.slice(2)

interface OutsideShape {
  readonly perform: (name: string) => Effect.Effect<void>
}
const Outside = Context.Service<OutsideShape>("test/Durable/Outside")
const faulty = Layer.succeed(Outside, {
  perform: (name: string) =>
    Effect.andThen(
      mode === "race" ? Effect.sleep("30 millis") : Effect.void,
      Effect.sync(() => {
        if (crash === `${name}:before`) process.kill(process.pid, "SIGKILL")
        appendFileSync(effects!, `${name}\n`)
        if (crash === `${name}:after`) process.kill(process.pid, "SIGKILL")
      })
    )
})

const Reserve = Durable.task("crash#Reserve", { payload: { id: Schema.String }, success: Schema.Number })
const Charge = Durable.task("crash#Charge", { payload: { id: Schema.String, amount: Schema.Number }, success: Schema.String })
const Ship = Durable.task("crash#Ship", { payload: { id: Schema.String } })
const Order = Durable.workflow("crash#Order", { payload: { id: Schema.String }, success: Schema.String })

const perform = (name: string) => Effect.flatMap(Effect.service(Outside), (outside) => outside.perform(name))
const live = Order.toLayer(({ id }) =>
  Effect.gen(function*() {
    const amount = yield* Reserve({ id })
    const receipt = yield* Charge({ id, amount })
    yield* Ship({ id })
    return `${id}:${receipt}`
  })
).pipe(
  Layer.provide(Layer.mergeAll(
    Reserve.toLayer(({ id }) => Effect.as(perform(`reserve:${id}`), 42)),
    Charge.toLayer(({ id, amount }) => Effect.as(perform(`charge:${id}`), `receipt-${amount}`)),
    Ship.toLayer(({ id }) => perform(`ship:${id}`))
  )),
  Layer.provideMerge(Durable.layerSql),
  Layer.provide(Layer.merge(sqlite(database!), faulty))
)

const Fetch = Durable.task("crash#Fetch", { payload: { repo: Schema.String }, success: Schema.String })
const Pair = Durable.workflow("crash#Pair", { payload: { id: Schema.String }, success: Schema.Array(Schema.String) })
const pair = Pair.toLayer(() =>
  Effect.all(["a", "b"].map((repo) => Fetch({ repo })), { concurrency: "unbounded" })
).pipe(
  Layer.provide(Fetch.toLayer(({ repo }) =>
    Effect.andThen(
      // b starts with a and finishes well after a's step is recorded.
      repo === "b" ? Effect.sleep("200 millis") : Effect.void,
      Effect.as(perform(`fetch:${repo}`), `issues-of-${repo}`)
    )
  )),
  Layer.provideMerge(Durable.layerSql),
  Layer.provide(Layer.merge(sqlite(database!), faulty))
)

const program = mode === "pair"
  ? Effect.gen(function*() {
    const result = yield* Pair.execute({ id: "p1" })
    const run = yield* Pair.executionId({ id: "p1" })
    return { result, run }
  }).pipe(Effect.provide(pair))
  : Effect.gen(function*() {
    const result = yield* Order.execute({ id: "o1" })
    const run = yield* Order.executionId({ id: "o1" })
    return { result, run }
  }).pipe(Effect.provide(live))

console.log(JSON.stringify(await Effect.runPromise(program)))
