import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Exit, Layer, Schema, Stream } from "effect"
import { AiError, DecisionModel, LanguageModel, Tool, Toolkit } from "effect/ai"
import * as Agent from "../dist/experimental/Agent.js"
import * as Tools from "../dist/experimental/Tools.js"

// Experimental.Agent.run and Agent.stream (VIP-63): the cell loop. The model
// is scripted, a LanguageModel that answers each turn with the next reply in
// a list and records what it was asked. Everything after the model is real:
// the QuickJS realm, the toolkit handlers and Node's file system.

const usage = { inputTokens: { total: 10 }, outputTokens: { total: 3 } }

const scripted = (replies: ReadonlyArray<string>) => {
  const asked: Array<any> = []
  let turn = 0
  const next = (options: any) => {
    asked.push(options.prompt.content)
    const reply = replies[Math.min(turn++, replies.length - 1)]!
    return reply
  }
  const model = LanguageModel.make({
    generateText: (options) =>
      Effect.succeed([{ type: "text", text: next(options) }, { type: "finish", reason: "stop", usage }] as any),
    streamText: (options) => {
      const text = next(options)
      const half = Math.floor(text.length / 2)
      return Stream.fromIterable([
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: text.slice(0, half) },
        { type: "text-delta", id: "t", delta: text.slice(half) },
        { type: "text-end", id: "t" },
        { type: "finish", reason: "stop", usage }
      ] as any)
    }
  })
  return { asked, layer: Layer.effect(LanguageModel.LanguageModel, model) }
}

const cell = (source: string) => "Here is the cell.\n```cell\n" + source + "\n```"

const runWith = <A, E>(replies: ReadonlyArray<string>, effect: Effect.Effect<A, E, any>) => {
  const model = scripted(replies)
  return Effect.runPromiseExit(Effect.provide(effect, Layer.mergeAll(model.layer, NodeServices.layer)) as Effect.Effect<A, E>)
    .then((exit) => ({ exit, asked: model.asked }))
}

const failed = (exit: Exit.Exit<unknown, unknown>): any => {
  if (!Exit.isFailure(exit)) throw new Error(`expected a failure, got ${JSON.stringify(exit)}`)
  const found = exit.cause.reasons.find((reason: any) => reason._tag === "Fail") as any
  if (found === undefined) throw new Error(`expected a typed failure: ${String(exit.cause)}`)
  return found.error
}

const Answer = Schema.Struct({ total: Schema.Number })

const Add = Tool.make("add", {
  description: "Adds two numbers",
  parameters: Schema.Struct({ a: Schema.Number, b: Schema.Number }),
  success: Schema.Number
})
const Calc = Toolkit.make(Add)
const calcCalls: Array<unknown> = []
const calc = Calc.pipe(Effect.provide(Calc.toLayer({
  add: ({ a, b }) => Effect.sync(() => (calcCalls.push([a, b]), a + b))
})))

test("a run calls a tool from a cell and ends with a decoded answer", async () => {
  calcCalls.length = 0
  const { exit, asked } = await runWith(
    [cell("const n = await tools.add({ a: 2, b: 3 })\nconsole.log('sum', n)"), cell("done({ total: n * 10 })")],
    Agent.run({ prompt: "Add 2 and 3, times ten", output: Answer, tools: calc })
  )
  expect(Exit.isSuccess(exit) && exit.value).toEqual({ output: { total: 50 }, turns: 2, usage: { inputTokens: 20, outputTokens: 6 } })
  expect(calcCalls).toEqual([[2, 3]])
  // The protocol names the tool and the output schema; the second turn sees what the cell printed.
  expect(asked[0][0].content).toContain('tools["add"]')
  expect(asked[0][0].content).toContain('"total"')
  expect(JSON.stringify(asked[1].at(-1))).toContain("sum 5")
})

test("a cell reaches only the tools it was handed", async () => {
  const { exit, asked } = await runWith(
    [cell("const r = await tools.secret({})"), cell("console.log(typeof tools.secret, Object.keys(tools).join())\ndone({ total: 0 })")],
    Agent.run({ prompt: "Try", output: Answer, tools: calc })
  )
  expect(Exit.isSuccess(exit)).toBe(true)
  expect(JSON.stringify(asked[1].at(-1))).toContain("TypeError")
})

test("a failed call is a value the cell reads, not a crash", async () => {
  const { exit } = await runWith(
    [cell("const r = await tools.add({ a: 'x' })\ndone({ total: r.ok === false ? -1 : r })")],
    Agent.run({ prompt: "Bad input", output: Answer, tools: calc })
  )
  expect(Exit.isSuccess(exit) && exit.value.output).toEqual({ total: -1 })
})

test("an answer that misses output spends a correction, then fails with output_invalid", async () => {
  const corrected = await runWith(
    [cell("done({ total: 'nine' })"), cell("done({ total: 9 })")],
    Agent.run({ prompt: "Nine", output: Answer })
  )
  expect(Exit.isSuccess(corrected.exit) && corrected.exit.value).toMatchObject({ output: { total: 9 }, turns: 2 })
  expect(JSON.stringify(corrected.asked[1].at(-1))).toContain("does not match the output schema")

  const spent = await runWith([cell("done({ total: 'nine' })")], Agent.run({ prompt: "Nine", output: Answer, corrections: 1 }))
  const error = failed(spent.exit)
  expect(error._tag).toBe("AgentFailed")
  expect(error.reason).toBe("output_invalid")
  expect(error.turns).toBe(2)
})

test("maxTurns bounds the loop, and a reply without a cell spends a turn", async () => {
  const { exit, asked } = await runWith(["I am thinking."], Agent.run({ prompt: "Loop", output: Answer, maxTurns: 3 }))
  const error = failed(exit)
  expect(error.reason).toBe("turns_exhausted")
  expect(error.turns).toBe(3)
  expect(asked.length).toBe(3)
  expect(JSON.stringify(asked[1].at(-1))).toContain("No cell was found")
})

test("invalid budgets fail before the model is asked", async () => {
  for (const options of [{ maxTurns: 0 }, { corrections: -1 }, { judge: 1.5 }, { maxTurns: Infinity }]) {
    const { exit, asked } = await runWith([cell("done({ total: 1 })")], Agent.run({ prompt: "x", output: Answer, ...options }))
    expect(failed(exit).reason).toBe("invalid_options")
    expect(asked.length).toBe(0)
  }
  const removed = await runWith(
    [cell("done({ total: 1 })")],
    Agent.run({ prompt: "x", output: Answer, limits: { timeMs: Infinity } })
  )
  expect(failed(removed.exit).reason).toBe("invalid_options")
})

test("a cell that runs past its compute limit is stopped and the run continues", async () => {
  const { exit, asked } = await runWith(
    [cell("while (true) {}"), cell("done({ total: 1 })")],
    Agent.run({ prompt: "Spin", output: Answer, limits: { timeMs: 50 } })
  )
  expect(Exit.isSuccess(exit) && exit.value.turns).toBe(2)
  expect(JSON.stringify(asked[1].at(-1))).toContain("limit_exceeded")
})

test("top-level state persists between cells", async () => {
  const { exit } = await runWith(
    [cell("var kept = 41"), cell("done({ total: kept + 1 })")],
    Agent.run({ prompt: "Keep", output: Answer })
  )
  expect(Exit.isSuccess(exit) && exit.value.output).toEqual({ total: 42 })
})

test("the standard tools run inside a cell", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vibe-agent-"))
  try {
    writeFileSync(join(dir, "n.txt"), "7")
    const { exit } = await runWith(
      [cell(`const r = await tools.read({ path: ${JSON.stringify(join(dir, "n.txt"))} })\ndone({ total: Number(r.content) })`)],
      Agent.run({ prompt: "Read", output: Answer, tools: Tools.filesystem })
    )
    expect(Exit.isSuccess(exit) && exit.value.output).toEqual({ total: 7 })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const judgeLayer = (probabilities: ReadonlyArray<number | "down">) => {
  let at = 0
  return Layer.succeed(DecisionModel.DecisionModel, {
    decide: () =>
      Effect.suspend(() => {
        const next = probabilities[Math.min(at++, probabilities.length - 1)]!
        return next === "down"
          ? Effect.fail(AiError.make({ module: "Test", method: "decide", reason: new AiError.UnknownError({ description: "connection refused" }) } as any))
          : Effect.succeed({ answers: { supported: { probability: next } }, usage: {} } as any)
      }),
    decideSettled: () => Effect.die("unused")
  } as any)
}

test("judge rejects an unsupported claim, and an unreachable judge never approves", async () => {
  const model = scripted([cell("done({ total: 1 })"), cell("done({ total: 2 })")])
  const judged = await Effect.runPromiseExit(Effect.provide(
    Agent.run({ prompt: "Claim", output: Answer, judge: 1 }),
    Layer.mergeAll(model.layer, judgeLayer([0.1]))
  ))
  // The first claim is rejected; the judge has checked its one claim, so the second stands.
  expect(Exit.isSuccess(judged) && judged.value).toMatchObject({ output: { total: 2 }, turns: 2 })
  expect(JSON.stringify(model.asked[1].at(-1))).toContain("unsupported")

  const down = await Effect.runPromiseExit(Effect.provide(
    Agent.run({ prompt: "Claim", output: Answer, judge: 1 }),
    Layer.mergeAll(scripted([cell("done({ total: 1 })")]).layer, judgeLayer(["down"]))
  ))
  expect(failed(down).reason).toBe("judge_unavailable")

  const missing = await runWith([cell("done({ total: 1 })")], Agent.run({ prompt: "x", output: Answer, judge: 1 }))
  expect(failed(missing.exit).reason).toBe("judge_unavailable")
})

test("stream gives the run's events in order, ending in Finished", async () => {
  calcCalls.length = 0
  const { exit } = await runWith(
    [cell("const n = await tools.add({ a: 1, b: 1 })\ndone({ total: n })")],
    Stream.runCollect(Agent.stream({ prompt: "Stream", output: Answer, tools: calc }))
  )
  if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause))
  const events = Array.from(exit.value) as Array<any>
  const tags = events.map((event) => event._tag)
  expect(tags[0]).toBe("TurnStarted")
  expect(tags.filter((tag) => tag === "TextDelta").length).toBe(2)
  expect(tags.slice(tags.indexOf("Cell"))).toEqual(["Cell", "ToolCall", "ToolResult", "CellEnded", "Finished"])
  expect(events.at(-1).result).toEqual({ output: { total: 2 }, turns: 1, usage: { inputTokens: 10, outputTokens: 3 } })

  const failing = await runWith(["no cell"], Stream.runCollect(Agent.stream({ prompt: "x", output: Answer, maxTurns: 1 })))
  expect(failed(failing.exit).reason).toBe("turns_exhausted")
})
