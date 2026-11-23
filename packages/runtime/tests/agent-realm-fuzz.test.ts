import { expect, test } from "bun:test"
import fc from "fast-check"
import { Effect, Exit } from "effect"
import * as Realm from "../dist/experimental/internal/agentRealm.js"
import { checkProperty } from "../../../scripts/testing/property.mjs"

// Fuzz for the sandbox agent cells run in (VIP-63 rules 2 and 4). A cell is
// text a model wrote, so the realm must hold for any text: generated cells
// built from hostile fragments and from arbitrary strings. Whatever the cell
// is, evaluating it gives a frame, in bounded time, the host is asked only
// for handed tools with JSON inputs, and nothing from the host leaks in.

const limits: Realm.Limits = { calls: 4, timeMs: 40, callMs: 1000, memoryBytes: Realm.minimumMemoryBytes }

// What a hostile or confused model writes.
const fragments = [
  `await tools.echo({ v: 1 })`,
  `tools.echo({ v: 2 })`,
  `await tools.echo()`,
  `await tools.nope({})`,
  `await tools["__proto__"]({})`,
  `tools.echo(tools)`,
  `tools.echo({ get v() { return tools.echo({ v: 3 }) } })`,
  `tools.echo({ v: () => 1 })`,
  `done({ ok: true })`,
  `done()`,
  `done(tools)`,
  `done(globalThis)`,
  `throw new Error("boom")`,
  `throw null`,
  `throw { toString() { throw 1 } }`,
  `for (;;) {}`,
  `while (true) { try { for (;;) {} } catch (e) {} }`,
  `await new Promise(() => {})`,
  `await new Promise((resolve) => resolve(tools.echo({ v: 4 })))`,
  `(function down() { down() })()`,
  `var big = []; for (;;) big.push("x".repeat(65536) + big.length)`,
  `var s = "x".repeat(2 ** 28)`,
  `new ArrayBuffer(2 ** 30)`,
  `JSON.parse("[".repeat(100000))`,
  `/(a+)+$/.test("a".repeat(40) + "!")`,
  `var host = ({}).constructor.constructor("return this")(); console.log(typeof host.process, typeof host.require, typeof host.Bun)`,
  `console.log(typeof new Function("return typeof process")())`,
  `console.log(eval("typeof globalThis.fetch"))`,
  `await import("node:fs")`,
  `console.log(typeof tools.echo.constructor("return typeof process")())`,
  `try { null.x } catch (e) { console.log(String(e.stack).length < 5000) }`,
  `tools = null; done = null; console = null`,
  `var JSON = null; var Object = null; var Promise = null; var Array = null; var TypeError = null`,
  `Object.defineProperty(globalThis, "tools", { value: 1 })`,
  `delete globalThis.done; delete globalThis.tools`,
  `Object.prototype.then = function (resolve) { resolve(1) }`,
  `Promise.prototype.then = function () { for (;;) {} }`,
  `Array.prototype.push = function () { throw 1 }`,
  `globalThis.__call = 1; console.log(typeof __call, typeof __print, typeof __done)`,
  `console.log(Symbol("s"))`,
  `console.log({ toJSON() { throw new Error("no") } })`,
  `console.log("y".repeat(200000))`,
  `label: { break label }`,
  `const again = 1`,
  `}`,
  `{`,
  `\u0000 `,
  // Code the interpreter runs while the host hands a value in or reads one
  // out: getters and toJSON on what crosses the boundary.
  `Object.defineProperty(Object.prototype, "then", { get() { for (;;) {} } })`,
  `Object.defineProperty(Error.prototype, "name", { get() { for (;;) {} } })`,
  `Object.defineProperty(Error.prototype, "message", { get() { for (;;) {} } })`,
  `Object.defineProperty(SyntaxError.prototype, "name", { get() { for (;;) {} } })`,
  `throw { toJSON() { for (;;) {} } }`,
  `throw { get name() { for (;;) {} } }`,
  `throw { name: "n".repeat(1000000), message: "m".repeat(1000000) }`,
  `tools.echo(Object.defineProperty({}, "toJSON", { value() {} }))`,
  `done(Object.defineProperty({}, "toJSON", { value() {} }))`,
  `done({ get a() { done(1); return 2 } })`,
  // Work left for the host or for the next cell.
  `function tick() { Promise.resolve().then(tick) } for (let i = 0; i < 8; i++) tick()`,
  `for (let i = 0; i < 200; i++) { try { tools.echo({ v: "x".repeat(100000) }) } catch (e) {} }`
]

const cellText = fc.oneof(
  { weight: 5, arbitrary: fc.array(fc.constantFrom(...fragments), { minLength: 1, maxLength: 5 }).chain((parts) =>
    fc.constantFrom(";\n", "\n", " ; ").map((joiner) => parts.join(joiner))
  ) },
  { weight: 2, arbitrary: fc.tuple(fc.constantFrom(...fragments), fc.constantFrom(...fragments)).map(([first, second]) =>
    `try { ${first} } catch (error) { ${second} } finally { tools.echo({ v: 9 }) }`
  ) },
  { weight: 1, arbitrary: fc.string({ maxLength: 60 }) },
  { weight: 1, arbitrary: fc.string({ unit: "binary", maxLength: 40 }) }
)

const outcomes = new Set(["Continue", "Done", "Raised", "Rejected"])

test("fuzz: any cell gives a frame, in bounded time, and the host sees only handed tools", async () => {
  await checkProperty(fc, {
    name: "agent-realm-holds-for-any-cell",
    rule: "VIP-63 rule 2: a cell can call the tools it was handed and nothing else; the sandbox is the boundary. Rule 4: a cell is bounded",
    command: "bun test tests/agent-realm-fuzz.test.ts",
    arbitrary: fc.array(cellText, { minLength: 1, maxLength: 3 }),
    numRuns: 150,
    check: async (cells: ReadonlyArray<string>) => {
      const seen: Array<Realm.Call> = []
      const started = performance.now()
      const exit = await Effect.runPromiseExit(Effect.scoped(Effect.gen(function*() {
        const realm = yield* Realm.open({ tools: ["echo"], limits })
        const frames: Array<Realm.Frame> = []
        for (const cell of cells) {
          const frame = yield* realm.evaluate(cell, (call) =>
            Effect.sync(() => {
              seen.push(call)
              return { ok: true, value: call.input } as const
            }))
          frames.push(frame)
          // A spent realm runs no further cell; the run would open another.
          if (frame.spent) break
        }
        return frames
      })))
      // Never a defect and never a hang: every cell settled as a frame.
      if (!Exit.isSuccess(exit)) throw new Error(`a cell escaped the realm: ${String(exit.cause)}`)
      for (const frame of exit.value) {
        expect(outcomes.has(frame.outcome._tag)).toBe(true)
        expect(frame.calls).toBeLessThanOrEqual(limits.calls)
        expect(frame.prints.length).toBeLessThan(Realm.printBytes + 200)
        // What goes back into a prompt is bounded, whatever the cell threw.
        expect(JSON.stringify(frame.outcome).length).toBeLessThan(5000)
        // No fragment that probes for the host finds it.
        expect(frame.prints).not.toMatch(/\bobject\b.*\bfunction\b|\bfunction\b/)
        expect(frame.prints).not.toContain("[native code]")
      }
      for (const call of seen) {
        expect(call.tool).toBe("echo")
        expect(() => JSON.stringify(call.input)).not.toThrow()
      }
      // Each cell may compute for 40 ms; the whole case stays far under a hang.
      expect(performance.now() - started).toBeLessThan(15_000)
    }
  })
}, 300_000)

test("probes for the host find the realm's own globals and nothing else", async () => {
  const probes = [
    `({}).constructor.constructor("return typeof process + typeof require + typeof Bun + typeof Deno + typeof fetch + typeof setTimeout")()`,
    `(function () { return typeof this.process + typeof this.require })()`,
    `typeof tools.echo.constructor("return process")`,
    `(() => { try { return tools.echo.constructor("return process")() } catch (error) { return error.name } })()`,
    `typeof globalThis.__call + typeof globalThis.__print + typeof globalThis.__done`,
    `Object.getOwnPropertyNames(globalThis).filter((name) => /process|require|module|Bun|Deno|fetch|XMLHttp|WebSocket|Worker|setTimeout|setInterval/.test(name)).join(",")`
  ]
  const printed = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const realm = yield* Realm.open({ tools: ["echo"], limits: { ...limits, timeMs: 1000 } })
    const lines: Array<string> = []
    for (const probe of probes) {
      const frame = yield* realm.evaluate(`console.log(${probe})`, () => Effect.die("no tool is called"))
      lines.push(frame.prints)
    }
    return lines
  })))
  expect(printed).toEqual([
    "undefinedundefinedundefinedundefinedundefinedundefined",
    "undefinedundefined",
    "function",
    "ReferenceError",
    "undefinedundefinedundefined",
    ""
  ])
})
