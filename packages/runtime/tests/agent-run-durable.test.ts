import { expect, test } from "bun:test"
import { Deferred, Duration, Effect, Exit, Fiber, Layer, Schema, Stream } from "effect"
import { LanguageModel, Tool, Toolkit } from "effect/ai"
import { Workflow } from "effect/workflow"
import * as Agent from "../dist/experimental/Agent.js"
import * as Durable from "../dist/experimental/Durable.js"

// VIP-63 rule 3: inside a task every tool call a cell makes is its own
// recorded step. A process that dies mid-cell resumes by running the cell
// from the top: the calls that settled replay their recorded values and run
// no handler, and the run reaches the call that did not settle.

const Add = Tool.make("add", { parameters: Schema.Struct({ a: Schema.Number, b: Schema.Number }), success: Schema.Number })
const Calc = Toolkit.make(Add)

const cell = "```cell\nconst x = await tools.add({ a: 1, b: 2 })\nconst y = await tools.add({ a: x, b: 10 })\ndone({ total: y })\n```"

// The model always answers with the same cell. It is not a recorded model, so
// a resumed run asks it again, as a model whose step did not settle would be.
const model = Layer.effect(
  LanguageModel.LanguageModel,
  LanguageModel.make({
    generateText: () => Effect.succeed([{ type: "text", text: cell }, { type: "finish", reason: "stop", usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } }] as any),
    streamText: () => Stream.empty
  })
)

const Turn = Durable.task("test#AgentTurn", {
  payload: { id: Schema.String },
  success: Schema.Number,
  error: Schema.Unknown
})
const Flow = Workflow.make("test#AgentFlow", {
  payload: { id: Schema.String },
  success: Schema.Number,
  error: Schema.Unknown,
  idempotencyKey: ({ id }) => id
})

const flowLayer = (store: Durable.Store, log: Array<[number, number]>, died?: Deferred.Deferred<void>) =>
  Flow.toLayer(({ id }) => Turn({ id })).pipe(
    Layer.provide(Turn.toLayer(() =>
      Agent.run({
        prompt: "Add",
        output: Schema.Struct({ total: Schema.Number }),
        tools: Calc.pipe(Effect.provide(Calc.toLayer({
          add: ({ a, b }) =>
            Effect.suspend(() => {
              log.push([a, b])
              // The process dies inside the second call, before it settles.
              if (died !== undefined && log.length === 2) return Effect.andThen(Deferred.succeed(died, void 0), Effect.never)
              return Effect.succeed(a + b)
            })
        })))
      }).pipe(Effect.map((result) => result.output.total))
    )),
    Layer.provide(model),
    Layer.provideMerge(Durable.layerStore(store))
  )

const process = (store: Durable.Store, id: string, log: Array<[number, number]>, dies: boolean) =>
  Effect.runPromise(Effect.gen(function*() {
    const died = yield* Deferred.make<void>()
    const fiber = yield* Effect.forkChild(Effect.exit(Flow.execute({ id }).pipe(
      Effect.provide(flowLayer(store, log, dies ? died : undefined))
    )))
    if (!dies) return yield* Fiber.join(fiber)
    yield* Deferred.await(died)
    yield* Fiber.interrupt(fiber)
    return "died"
  }).pipe(Effect.timeout(Duration.seconds(20))))

test("a resumed run replays settled tool calls and runs only the one that did not settle", async () => {
  const store = Durable.makeMemoryStore()
  const first: Array<[number, number]> = []
  expect(await process(store, "a", first, true)).toBe("died")
  expect(first).toEqual([[1, 2], [3, 10]])
  const second: Array<[number, number]> = []
  expect(await process(store, "a", second, false)).toEqual(Exit.succeed(13))
  // add(1, 2) was recorded, so the resumed cell read 3 from the journal.
  expect(second).toEqual([[3, 10]])
})

test("outside a workflow every call is live", async () => {
  const log: Array<[number, number]> = []
  const result = await Effect.runPromise(Effect.provide(
    Agent.run({
      prompt: "Add",
      output: Schema.Struct({ total: Schema.Number }),
      tools: Calc.pipe(Effect.provide(Calc.toLayer({ add: ({ a, b }) => Effect.sync(() => (log.push([a, b]), a + b)) })))
    }),
    model
  ))
  expect(result.output.total).toBe(13)
  expect(log).toEqual([[1, 2], [3, 10]])
})
