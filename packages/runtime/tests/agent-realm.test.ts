import { expect, test } from "bun:test"
import fc from "fast-check"
import { Deferred, Effect, Fiber } from "effect"
import * as Realm from "../dist/experimental/internal/agentRealm.js"
import { checkProperty } from "../../../scripts/testing/property.mjs"

// The realm is the boundary of VIP-63's rules 2 and 4: a cell reaches only the
// tools it was handed, and every cell is bounded.

const limits: Realm.Limits = { calls: 64, timeMs: 30_000, callMs: 120_000, memoryBytes: 128 * 1024 * 1024 }

interface Seen {
  readonly calls: Array<Realm.Call>
}

// A real handler over real data: it answers from a table and records every
// call that reached the host.
const table = (seen: Seen, answers: Record<string, (input: any) => Realm.CallResult>) => (call: Realm.Call) =>
  Effect.sync(() => {
    seen.calls.push(call)
    return answers[call.tool]!(call.input)
  })

const run = (
  cells: ReadonlyArray<string>,
  options: {
    readonly tools?: ReadonlyArray<string>
    readonly limits?: Partial<Realm.Limits>
    readonly answers?: Record<string, (input: any) => Realm.CallResult>
  } = {}
) => {
  const seen: Seen = { calls: [] }
  const answers = options.answers ?? { echo: (input) => ({ ok: true, value: input }) }
  return Effect.gen(function*() {
    const realm = yield* Realm.open({
      tools: options.tools ?? Object.keys(answers),
      limits: { ...limits, ...options.limits }
    })
    const frames: Array<Realm.Frame> = []
    for (const cell of cells) frames.push(yield* realm.evaluate(cell, table(seen, answers)))
    return { frames, seen }
  }).pipe(Effect.scoped, Effect.runPromise)
}

test("invalid cell budgets fail before loading the interpreter", async () => {
  const invalid = [
    { calls: NaN }, { calls: Infinity }, { calls: -1 }, { calls: 1.5 },
    { timeMs: NaN }, { timeMs: Infinity }, { timeMs: -1 },
    { callMs: NaN }, { callMs: Infinity }, { callMs: -1 }
  ]
  let loads = 0
  for (const budget of invalid) {
    const error = await Effect.runPromise(Effect.flip(Effect.scoped(Realm.open({
      tools: [], limits: { ...limits, ...budget },
      load: async () => { loads++; throw new Error("unexpected load") }
    }))))
    expect(error.reason).toBe("failed")
  }
  expect(loads).toBe(0)
})

test("a cell calls a handed tool, prints, and finishes with done", async () => {
  const { frames, seen } = await run([
    `const reply = await tools.echo({ text: "hi" })
console.log("got", reply)
done({ text: reply.text })`
  ])
  expect(frames).toEqual([
    { outcome: { _tag: "Done", value: { text: "hi" } }, prints: `got {"text":"hi"}`, calls: 1, spent: false }
  ])
  expect(seen.calls).toEqual([{ ordinal: 0, tool: "echo", input: { text: "hi" } }])
})

test("a top-level name outlives its cell, and declaring it again fails before anything runs", async () => {
  const { frames, seen } = await run([
    `var a = 1; const b = 2; let c = 3; function d() { return 4 }`,
    `c = c + 1; console.log(a, b, c, d())`,
    `await tools.echo({}); const b = 5`,
    `{ const b = 6; console.log(b) }`
  ])
  expect(frames.map((frame) => frame.prints)).toEqual(["", "1 2 4 4", "", "6"])
  expect(frames[2]!.outcome).toEqual({
    _tag: "Rejected",
    code: "compile_failed",
    message: "The cell did not compile. SyntaxError: redeclaration of 'b'"
  })
  expect(seen.calls).toEqual([])
})

test("rule 2: a tool that was not handed over fails inside the realm, and the host never sees it", async () => {
  const { frames, seen } = await run([
    `await tools.bash({ command: "rm -rf /" })`,
    `await tools["bash"]({ command: "id" })`,
    `console.log(JSON.stringify(Object.keys(tools)), Object.isFrozen(tools))`
  ])
  expect(frames[0]!.outcome).toEqual({ _tag: "Raised", name: "TypeError", message: "not a function" })
  expect(frames[1]!.outcome).toEqual({ _tag: "Raised", name: "TypeError", message: "not a function" })
  expect(frames[2]!.prints).toBe(`["echo"] true`)
  expect(seen.calls).toEqual([])
})

test("rule 2: a cell has no host globals, module loader, clock or randomness", async () => {
  const { frames } = await run([
    `console.log([typeof process, typeof require, typeof fetch, typeof globalThis.Bun, typeof setTimeout, typeof Date, typeof Math.random, typeof __call, typeof __print, typeof __done].join(","))`,
    `const fs = await import("node:fs")`,
    `import fs from "node:fs"`
  ])
  expect(frames[0]!.prints).toBe(new Array(10).fill("undefined").join(","))
  expect(frames[1]!.outcome._tag).toBe("Raised")
  expect(frames[2]!.outcome).toMatchObject({ _tag: "Rejected", code: "compile_failed" })
})

test("rule 2: a cell cannot replace the bindings later cells run on", async () => {
  const { frames, seen } = await run([
    `tools = { echo: () => "forged" }; done = () => {}; console = null; var JSON = null; var Object = null; var Promise = null`,
    `const reply = await tools.echo({ n: 1 }); console.log(reply.n); done(reply)`
  ])
  expect(frames[1]).toEqual({ outcome: { _tag: "Done", value: { n: 1 } }, prints: "1", calls: 1, spent: false })
  expect(seen.calls).toHaveLength(1)
})

test("a failed call resolves to { ok: false, error } and does not throw", async () => {
  const { frames } = await run(
    [`const reply = await tools.read({ path: "missing" }); console.log(reply.ok, reply.error.code, reply.error.message)`],
    { answers: { read: () => ({ ok: false, error: { code: "tool_failed", message: "no such file" } }) } }
  )
  expect(frames[0]).toEqual({ outcome: { _tag: "Continue" }, prints: "false tool_failed no such file", calls: 1, spent: false })
})

test("an input or an answer that is not JSON is refused inside the realm", async () => {
  const { frames, seen } = await run([
    `await tools.echo({ when: () => 1 })`,
    `const loop = {}; loop.self = loop; done(loop)`,
    `done()`
  ])
  expect(frames.map((frame) => frame.outcome)).toEqual([
    { _tag: "Raised", name: "TypeError", message: "The input of tools.echo must be JSON: it holds a function" },
    { _tag: "Raised", name: "TypeError", message: "The answer must be JSON: it holds a cycle" },
    { _tag: "Raised", name: "TypeError", message: "done(answer) takes the run's answer" }
  ])
  expect(seen.calls).toEqual([])
})

test("nothing after done calls a tool", async () => {
  const { frames, seen } = await run([
    `done({ n: 1 }); const late = await tools.echo({ n: 2 }); console.log(late.error.code); done({ n: 3 })`
  ])
  expect(frames[0]).toEqual({ outcome: { _tag: "Done", value: { n: 1 } }, prints: "run_completed", calls: 0, spent: false })
  expect(seen.calls).toEqual([])
})

test("rule 4: a cell that computes past its time limit is stopped, and the realm survives", async () => {
  const { frames } = await run([`var before = 1; for (;;) {}`, `console.log(before)`], { limits: { timeMs: 50 } })
  expect(frames[0]!.outcome).toEqual({
    _tag: "Rejected",
    code: "limit_exceeded",
    limit: "time",
    message: "The cell computed for more than its limit of 50 milliseconds."
  })
  expect(frames[1]).toEqual({ outcome: { _tag: "Continue" }, prints: "1", calls: 0, spent: false })
})

test("rule 4: a cell cannot catch its way past the time limit", async () => {
  const { frames } = await run([`for (;;) { try { for (;;) {} } catch (error) {} }`], { limits: { timeMs: 50 } })
  expect(frames[0]!.outcome).toMatchObject({ _tag: "Rejected", limit: "time" })
})

test("rule 4: time a tool takes is not the cell's compute time", async () => {
  const seen: Array<string> = []
  const frame = await Effect.gen(function*() {
    const realm = yield* Realm.open({ tools: ["slow"], limits: { ...limits, timeMs: 50 } })
    return yield* realm.evaluate(`const reply = await tools.slow({}); done(reply)`, (call) =>
      Effect.sleep(150).pipe(Effect.andThen(Effect.sync(() => {
        seen.push(call.tool)
        return { ok: true, value: { waited: true } } as const
      }))))
  }).pipe(Effect.scoped, Effect.runPromise)
  expect(frame.outcome).toEqual({ _tag: "Done", value: { waited: true } })
  expect(seen).toEqual(["slow"])
})

test("rule 4: calls past the call limit do not run", async () => {
  const { frames, seen } = await run(
    [`for (let i = 0; i < 5; i++) await tools.echo({ i }); done("unreachable")`],
    { limits: { calls: 3 } }
  )
  expect(frames[0]).toEqual({
    outcome: {
      _tag: "Rejected",
      code: "limit_exceeded",
      limit: "calls",
      message: "The cell made more than its limit of 3 tool calls. The calls past the limit did not run."
    },
    prints: "",
    calls: 3,
    spent: false
  })
  expect(seen.calls.map((call) => call.input)).toEqual([{ i: 0 }, { i: 1 }, { i: 2 }])
})

test("rule 4: a call past its own time limit resolves as a timeout the cell can read", async () => {
  const frame = await Effect.gen(function*() {
    const realm = yield* Realm.open({ tools: ["hang"], limits: { ...limits, callMs: 20 } })
    return yield* realm.evaluate(`const reply = await tools.hang({}); done(reply.error.code)`, () => Effect.never)
  }).pipe(Effect.scoped, Effect.runPromise)
  expect(frame.outcome).toEqual({ _tag: "Done", value: "timeout" })
})

test("rule 4: a recorder around a call sees the timeout the cell reads", async () => {
  const recorded: Array<Realm.CallResult> = []
  const frame = await Effect.gen(function*() {
    const realm = yield* Realm.open({ tools: ["hang"], limits: { ...limits, callMs: 20 } })
    return yield* realm.evaluate(
      `const reply = await tools.hang({}); done(reply.error.code)`,
      () => Effect.never,
      (_call, result) => Effect.tap(result, (settled) => Effect.sync(() => void recorded.push(settled)))
    )
  }).pipe(Effect.scoped, Effect.runPromise)
  expect(frame.outcome).toEqual({ _tag: "Done", value: "timeout" })
  expect(recorded).toEqual([
    { ok: false, error: { code: "timeout", message: "tools.hang took longer than its limit of 20 milliseconds." } }
  ])
})

// Each of these cells plants code the interpreter runs while the host hands
// it a value or reads one back. That code is the cell's, so it is stopped by
// the cell's time limit like the cell.
const planted = {
  "a then getter read when a call's answer arrives":
    `Object.defineProperty(Object.prototype, "then", { get() { for (;;) {} } }); await tools.echo({})`,
  "a toJSON run when a thrown value is read": `throw { toJSON() { for (;;) {} } }`,
  "a name getter run when a thrown error is read":
    `Object.defineProperty(Error.prototype, "name", { get() { for (;;) {} } }); throw new Error("x")`
}

for (const [name, cell] of Object.entries(planted)) {
  test(`rule 4: ${name} is on the cell's clock`, async () => {
    const { frames } = await run([cell], { limits: { timeMs: 200 } })
    expect(frames[0]!.outcome).toEqual({
      _tag: "Rejected",
      code: "limit_exceeded",
      limit: "time",
      message: "The cell computed for more than its limit of 200 milliseconds."
    })
  })
}

test("rule 4: a getter an earlier cell planted, run when a compile error is read, is on the cell's clock", async () => {
  const { frames } = await run(
    [`Object.defineProperty(SyntaxError.prototype, "name", { get() { for (;;) {} } })`, `(`],
    { limits: { timeMs: 200 } }
  )
  expect(frames[1]!.outcome).toEqual({
    _tag: "Rejected",
    code: "limit_exceeded",
    limit: "time",
    message: "The cell computed for more than its limit of 200 milliseconds."
  })
})

test("rule 4: a cell that leaves jobs behind spends its realm, so the next cell has its whole time", async () => {
  const result = await Effect.gen(function*() {
    const realm = yield* Realm.open({ tools: [], limits: { ...limits, timeMs: 200 } })
    const first = yield* realm.evaluate(
      `function g() {} function f() { Promise.resolve().then(f); g() } for (let i = 0; i < 8; i++) f()`,
      () => Effect.die("no tools")
    )
    const second = yield* Effect.exit(realm.evaluate(`done(1)`, () => Effect.die("no tools")))
    return { first, second }
  }).pipe(Effect.scoped, Effect.runPromise)
  expect(result.first).toMatchObject({ outcome: { _tag: "Rejected", code: "limit_exceeded", limit: "time" }, spent: true })
  expect(result.second._tag).toBe("Failure")
})

test("rule 4: calls issued without awaiting are refused at the call limit, before the host holds them", async () => {
  const { frames, seen } = await run(
    [`let refused = 0
for (let i = 0; i < 10; i++) { try { tools.echo({ i }) } catch (error) { refused++ } }
console.log(refused)`],
    { limits: { calls: 3 } }
  )
  expect(frames[0]).toEqual({
    outcome: {
      _tag: "Rejected",
      code: "limit_exceeded",
      limit: "calls",
      message: "The cell made more than its limit of 3 tool calls. The calls past the limit did not run."
    },
    prints: "7",
    calls: 3,
    spent: false
  })
  expect(seen.calls.map((call) => call.input)).toEqual([{ i: 0 }, { i: 1 }, { i: 2 }])
})

test("rule 4: the inputs of one cell's calls are bounded by the run's memory", async () => {
  const { frames, seen } = await run(
    [`var s = "x".repeat(4 * 1024 * 1024); for (let i = 0; i < 16; i++) tools.echo({ s })`],
    { limits: { memoryBytes: Realm.minimumMemoryBytes } }
  )
  expect(frames[0]!.outcome).toMatchObject({ _tag: "Rejected", code: "limit_exceeded", limit: "memory" })
  expect(seen.calls.length).toBeLessThan(8)
})

test("a toJSON that gives no value is refused inside the realm, and the next call keeps its number", async () => {
  const { frames, seen } = await run([
    `const none = Object.defineProperty({}, "toJSON", { value() {} })
try { await tools.echo(none) } catch (error) { console.log(error.name + ": " + error.message) }
await tools.echo({ n: 1 })
done(none)`
  ])
  expect(frames[0]!.prints).toBe("TypeError: The input of tools.echo must be JSON: its toJSON gave no value")
  expect(frames[0]!.outcome).toEqual({ _tag: "Raised", name: "TypeError", message: "The answer must be JSON: its toJSON gave no value" })
  expect(seen.calls).toEqual([{ ordinal: 0, tool: "echo", input: { n: 1 } }])
})

test("the first done wins when an answer's getter calls done again", async () => {
  const { frames } = await run([`done({ get a() { done("inner"); return "outer" } })`])
  expect(frames[0]!.outcome).toEqual({ _tag: "Done", value: "inner" })
})

test("a thrown value's name and a compile error's message are cut before they reach a prompt", async () => {
  const { frames } = await run([
    `throw { name: "n".repeat(100000), message: "m".repeat(100000) }`,
    `var ${"v".repeat(50000)} = 1; let ${"v".repeat(50000)} = 2`
  ])
  const raised = frames[0]!.outcome as Extract<Realm.Outcome, { _tag: "Raised" }>
  expect(raised.name.length).toBe(201)
  expect(raised.message.length).toBe(2001)
  expect((frames[1]!.outcome as Extract<Realm.Outcome, { _tag: "Rejected" }>).message.length).toBeLessThan(2300)
})

test("a realm refuses a memory limit no WebAssembly memory can have", async () => {
  const exit = await Realm.open({ tools: [], limits: { ...limits, memoryBytes: Realm.maximumMemoryBytes + 65536 } }).pipe(
    Effect.scoped,
    Effect.flip,
    Effect.runPromise
  )
  expect(exit).toMatchObject({ _tag: "RealmError", reason: "failed" })
  expect(exit.message).toBe(`A realm's memory is between 33554432 and 4294967296 bytes, not 4295032832.`)
})

const hoards = {
  strings: `var kept = []; for (;;) kept.push("x".repeat(1024 * 1024) + kept.length)`,
  objects: `var kept = []; for (;;) kept.push({ n: kept.length })`,
  caught: `var kept = []; for (;;) { try { for (;;) kept.push("x".repeat(65536) + kept.length) } catch (error) {} }`,
  oneString: `var kept = "x".repeat(2 ** 29)`
}

for (const [name, cell] of Object.entries(hoards)) {
  test(`rule 4: memory is bounded (${name}) and a realm that ran out is spent`, async () => {
    const result = await Effect.gen(function*() {
      const realm = yield* Realm.open({ tools: [], limits: { ...limits, timeMs: 500, memoryBytes: Realm.minimumMemoryBytes } })
      const first = yield* realm.evaluate(cell, () => Effect.die("no tools"))
      const second = yield* Effect.exit(realm.evaluate(`console.log("again")`, () => Effect.die("no tools")))
      return { first, second }
    }).pipe(Effect.scoped, Effect.runPromise)
    if (name === "caught") {
      // A cell that swallows the failure is stopped by its time limit instead.
      expect(result.first.outcome).toMatchObject({ _tag: "Rejected", code: "limit_exceeded" })
    } else {
      expect(result.first).toMatchObject({ outcome: { _tag: "Rejected", code: "limit_exceeded", limit: "memory" }, spent: true })
      expect(result.second._tag).toBe("Failure")
    }
  })
}

test("rule 4: a cell that finds the run's memory full is refused before it runs", async () => {
  const result = await Effect.gen(function*() {
    const realm = yield* Realm.open({ tools: [], limits: { ...limits, memoryBytes: Realm.minimumMemoryBytes } })
    // Fill memory to within a few kilobytes and stop without failing.
    const fill = yield* realm.evaluate(
      `var kept = []; var size = 1024 * 1024
while (size >= 1024) { try { kept.push(new ArrayBuffer(size)) } catch (error) { size = size / 2 } }`,
      () => Effect.die("no tools")
    )
    const next = yield* realm.evaluate(`console.log(${JSON.stringify("p".repeat(4096))})`, () => Effect.die("no tools"))
    return { fill, next }
  }).pipe(Effect.scoped, Effect.runPromise)
  expect(result.fill.outcome).toEqual({ _tag: "Continue" })
  expect(result.next).toMatchObject({ outcome: { _tag: "Rejected", code: "limit_exceeded", limit: "memory" }, prints: "", spent: true })
})

test("a result too large for what is left of the realm's memory is a failure the cell can read", async () => {
  const { frames } = await run(
    [`const reply = await tools.big({}); done(reply.ok === false ? reply.error.code : "fit")`],
    {
      limits: { memoryBytes: Realm.minimumMemoryBytes },
      answers: { big: () => ({ ok: true, value: "y".repeat(48 * 1024 * 1024) }) }
    }
  )
  expect(frames[0]).toMatchObject({ outcome: { _tag: "Done", value: "result_too_large" }, spent: false })
})

test("output past the print bound is counted, not kept", async () => {
  const { frames } = await run([`for (let i = 0; i < 3000; i++) console.log("line " + i + " " + "z".repeat(40))`])
  const prints = frames[0]!.prints
  expect(prints.length).toBeLessThan(Realm.printBytes + 200)
  expect(prints).toMatch(/\[\d+ more printed lines were dropped: a cell keeps 65536 characters of output\]$/)
})

test("a cell that awaits something that never settles is stalled, not hung", async () => {
  const { frames } = await run([`await new Promise(() => {})`])
  expect(frames[0]!.outcome).toMatchObject({ _tag: "Rejected", code: "stalled" })
})

test("a deep recursion is the cell's error, not the host's", async () => {
  const { frames } = await run([`const down = (n) => down(n + 1) + 1; down(0)`, `console.log("alive")`])
  expect(frames[0]!.outcome).toMatchObject({ _tag: "Raised", name: "InternalError", message: "stack overflow" })
  expect(frames[1]!.prints).toBe("alive")
})

test("a handler that fails tears the cell down and the failure is the evaluation's", async () => {
  const exit = await Effect.gen(function*() {
    const realm = yield* Realm.open({ tools: ["deny"], limits })
    const first = yield* Effect.exit(
      realm.evaluate(`try { await tools.deny({}) } catch (error) { for (;;) {} }`, () => Effect.fail("denied" as const))
    )
    const second = yield* realm.evaluate(`console.log("next cell runs")`, () => Effect.die("unused"))
    return { first, second }
  }).pipe(Effect.scoped, Effect.runPromise)
  expect(exit.first._tag).toBe("Failure")
  expect(exit.second.prints).toBe("next cell runs")
})

test("interrupting an evaluation interrupts the tool it waits on", async () => {
  const result = await Effect.gen(function*() {
    const started = yield* Deferred.make<void>()
    const interrupted = yield* Deferred.make<void>()
    const realm = yield* Realm.open({ tools: ["wait"], limits })
    const fiber = yield* Effect.forkChild(
      realm.evaluate(`await tools.wait({})`, () =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))
        ))
    )
    yield* Deferred.await(started)
    yield* Fiber.interrupt(fiber)
    yield* Deferred.await(interrupted)
    return "interrupted"
  }).pipe(Effect.scoped, Effect.runPromise)
  expect(result).toBe("interrupted")
})

test("two runs do not share a realm", async () => {
  const [first, second] = await Promise.all([
    run([`var mine = "first"`, `console.log(mine)`]),
    run([`console.log(typeof mine)`])
  ])
  expect(first.frames[1]!.prints).toBe("first")
  expect(second.frames[0]!.prints).toBe("undefined")
})

// Property: whatever a cell does with the names it can reach, the calls the
// host sees are a prefix-bounded list of calls to handed tools, in the order
// the cell issued them, and never more than the call limit.
test("property: the host sees only handed tools, in issue order, within the call limit", async () => {
  const handed = ["alpha", "beta"]
  const reachable = [...handed, "gamma", "constructor", "__proto__", "toString", "__call"]
  const step = fc.record({ tool: fc.constantFrom(...reachable), value: fc.integer({ min: 0, max: 9 }), awaited: fc.boolean() })
  await checkProperty(fc, {
    name: "agent-realm-authority",
    rule: "VIP-63 rule 2: a cell can call the tools it was handed and nothing else; rule 4: a cell is bounded",
    command: "bun test tests/agent-realm.test.ts",
    arbitrary: fc.record({ steps: fc.array(step, { maxLength: 12 }), callLimit: fc.integer({ min: 1, max: 6 }) }),
    numRuns: 60,
    check: async ({ steps, callLimit }: { steps: ReadonlyArray<{ tool: string; value: number; awaited: boolean }>; callLimit: number }) => {
      const source = steps.map((entry, index) =>
        `try { const p${index} = tools[${JSON.stringify(entry.tool)}]({ value: ${entry.value}, index: ${index} }); ${
          entry.awaited ? `await p${index}` : ""
        } } catch (error) {}`
      ).join("\n")
      const answers = Object.fromEntries(handed.map((name) => [name, (input: unknown) => ({ ok: true as const, value: input })]))
      const { frames, seen } = await run([source], { answers, limits: { calls: callLimit } })
      const expected = steps
        .map((entry, index) => ({ tool: entry.tool, input: { value: entry.value, index } }))
        .filter((entry) => handed.includes(entry.tool))
      expect(seen.calls.length).toBeLessThanOrEqual(callLimit)
      expect(seen.calls.map((call) => ({ tool: call.tool, input: call.input }))).toEqual(expected.slice(0, seen.calls.length))
      expect(seen.calls.map((call) => call.ordinal)).toEqual(seen.calls.map((_, index) => index))
      if (expected.length <= callLimit) {
        expect(seen.calls).toHaveLength(expected.length)
        expect(frames[0]!.outcome._tag).toBe("Continue")
      } else {
        expect(frames[0]!.outcome).toMatchObject({ _tag: "Rejected", limit: "calls" })
      }
    }
  })
})
