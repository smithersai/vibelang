import { describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Exit from "effect/Exit"
import fc from "fast-check"
import ts from "typescript"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"

const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-create-app-nonwaiting-child.json", import.meta.url), "utf8"))
const load = () => import("../src/experimental/ChildProcess.js")
type Event = { readonly tag: "error" | "exit"; readonly code: number | null }
type Model = { readonly events: ReadonlyArray<Event>; readonly initialCode: number | null; readonly initialKilled: boolean; readonly killResult: boolean; readonly windows: boolean; readonly args: ReadonlyArray<string>; readonly sync: "none" | "error" | "exit" }
class FakeChild {
  exitCode: number | null
  killed: boolean
  readonly errors: Array<(error: Error) => void> = []
  readonly exits: Array<(code: number | null) => void> = []
  readonly calls: Array<ReadonlyArray<unknown>> = []
  constructor(readonly model: Model, readonly error: Error) { this.exitCode = model.initialCode; this.killed = model.initialKilled }
  on(event: "error", listener: (error: Error) => void): this
  on(event: "exit", listener: (code: number | null) => void): this
  on(event: "error" | "exit", listener: ((error: Error) => void) | ((code: number | null) => void)): this {
    if (event === "error") {
      this.errors.push(listener as (error: Error) => void)
      if (this.model.sync === "error") (listener as (error: Error) => void)(this.error)
    } else {
      this.exits.push(listener as (code: number | null) => void)
      if (this.model.sync === "exit") { this.exitCode = 0; (listener as (code: number | null) => void)(0) }
    }
    return this
  }
  emit(event: Event) {
    if (event.tag === "error") this.errors.forEach(listener => listener(this.error))
    else { this.exitCode = event.code; this.exits.forEach(listener => listener(event.code)) }
  }
  kill(...args: ReadonlyArray<unknown>): boolean {
    this.calls.push(args)
    if (this.model.killResult) this.killed = true
    return this.model.killResult
  }
}
const defaultModel: Model = { events: [], initialCode: null, initialKilled: false, killResult: true, windows: false, args: ["install"], sync: "none" }
function host(model: Model, error = new Error("native-spawn")) {
  const child = new FakeChild(model, error)
  const spawns: Array<{ command: string; args: ReadonlyArray<string>; options: unknown }> = []
  return { child, spawns, spawn(command: string, args: ReadonlyArray<string>, options: unknown) { spawns.push({ command, args, options }); return child } }
}
function original(spawn: ReturnType<typeof host>["spawn"], windows: boolean) {
  expect(createHash("sha256").update(corpus.original).digest("hex")).toBe(corpus.source.sha256)
  const output = ts.transpileModule(corpus.original + "\nexport { runCommand }\n", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const exports: { runCommand?: (command: string, args: ReadonlyArray<string>, cwd: string) => Effect.Effect<void, Error> } = {}
  new Function("Effect", "spawn", "isWindows", "exports", output)(Effect, spawn, windows, exports)
  return exports.runCommand!
}
const normalize = (program: Effect.Effect<void, Error>, native: Error) => Effect.match(program, {
  onFailure: error => ({ tag: "failure", name: error.name, message: error.message, native: error === native }),
  onSuccess: () => ({ tag: "success" })
})
const turn = () => new Promise<void>(resolve => setImmediate(resolve))
async function observe(program: Effect.Effect<void, Error>, h: ReturnType<typeof host>, model: Model, native: Error) {
  const fiber = Effect.runFork(normalize(program, native))
  await turn()
  for (const event of model.events) h.child.emit(event)
  await turn()
  await Effect.runPromise(Fiber.interrupt(fiber))
  const exit = await Effect.runPromise(Fiber.await(fiber))
  // Late events must remain handled and cannot replace the first completion.
  h.child.emit({ tag: "error", code: null }); h.child.emit({ tag: "exit", code: 9 })
  return { outcome: Exit.isSuccess(exit) ? exit.value : { tag: "interrupted" }, calls: h.child.calls, spawns: h.spawns }
}
function caller(program: Effect.Effect<number | null, Error>, command: string) {
  return Effect.flatMap(program, code => code === 0 ? Effect.void : Effect.fail(new Error(command + " exited with code " + code)))
}
describe("Experimental inherited child cancellation", () => {
  it("is cold, reads arguments on execution and preserves inherited non-detached options", async () => {
    const api = await load(), h = host(defaultModel), args = ["first"]
    const command = api.make(h).runInherited("tool", args, { cwd: "/test/work", shell: false })
    expect(h.spawns).toHaveLength(0)
    args.push("second")
    const fiber = Effect.runFork(command)
    await turn()
    expect(h.spawns).toEqual([{ command: "tool", args: ["first", "second"], options: { cwd: "/test/work", shell: false, stdio: "inherit" } }])
    expect(h.spawns[0]!.args).not.toBe(args)
    h.child.emit({ tag: "exit", code: 0 })
    expect(await Effect.runPromise(Fiber.join(fiber))).toBe(0)
  })
  it("keeps the native Error identity and nullable exit status", async () => {
    const api = await load()
    for (const code of [0, 3, null]) {
      const h = host(defaultModel), fiber = Effect.runFork(api.make(h).runInherited("tool", [], { cwd: "/test/work" }))
      await turn(); h.child.emit({ tag: "exit", code })
      expect(await Effect.runPromise(Fiber.join(fiber))).toBe(code)
    }
    const error = new TypeError("native-error"), h = host(defaultModel, error)
    const fiber = Effect.runFork(Effect.match(api.make(h).runInherited("tool", [], { cwd: "/test/work" }), { onFailure: e => e, onSuccess: () => undefined }))
    await turn(); h.child.emit({ tag: "error", code: null })
    expect(await Effect.runPromise(Fiber.join(fiber))).toBe(error)
  })
  it("sends one default signal without waiting, only while exitCode is null and killed is false", async () => {
    const api = await load()
    for (const initialCode of [null, 0, 2]) for (const initialKilled of [false, true]) for (const killResult of [false, true]) {
      const model = { ...defaultModel, initialCode, initialKilled, killResult }, h = host(model)
      const fiber = Effect.runFork(api.make(h).runInherited("tool", [], { cwd: "/test/work" }))
      await turn()
      await Effect.runPromise(Fiber.interrupt(fiber))
      expect(h.child.calls).toEqual(initialCode === null && !initialKilled ? [[]] : [])
      // No exit is emitted to release the interrupted fiber.
    }
  })
  it("does not turn native construction defects into wrapped typed failures", async () => {
    const api = await load(), error = new Error("spawn-construction")
    const service = api.make({ spawn: () => { throw error } })
    const exit = await Effect.runPromiseExit(Effect.match(service.runInherited("tool", [], { cwd: "/test/work" }), { onFailure: () => "typed", onSuccess: () => "success" }))
    expect(Exit.isFailure(exit)).toBe(true)
  })
  it("provides a fake without touching the host and permits overrides", async () => {
    const api = await load()
    const run = Effect.flatMap(api.ChildProcess, child => child.runInherited("tool", [], { cwd: "/test/work" }))
    expect(await Effect.runPromise(Effect.provide(run, api.layerTest()))).toBe(0)
    expect(await Effect.runPromise(Effect.provide(run, api.layerTest({ runInherited: () => Effect.succeed(17) })))).toBe(17)
  })
  it("agrees with Foldkit's frozen original across 500 callback/exit/kill schedules", async () => {
    const api = await load()
    const arbitrary = fc.record({
      events: fc.array(fc.record({ tag: fc.constantFrom("error" as const, "exit" as const), code: fc.constantFrom(null, 0, 1, 7) }), { maxLength: 5 }),
      initialCode: fc.constantFrom(null, 0, 2), initialKilled: fc.boolean(), killResult: fc.boolean(), windows: fc.boolean(),
      args: fc.array(fc.string({ maxLength: 16 }), { maxLength: 4 }), sync: fc.constantFrom("none" as const, "error" as const, "exit" as const)
    })
    await fc.assert(fc.asyncProperty(arbitrary, async model => {
      const error = new Error("native-event"), before = host(model, error), after = host(model, error)
      const baseline = original(before.spawn.bind(before), model.windows)("tool", model.args, "/test/work")
      const migrated = caller(api.make(after).runInherited("tool", model.args, { cwd: "/test/work", shell: model.windows }), "tool")
      expect(await observe(migrated, after, model, error)).toEqual(await observe(baseline, before, model, error))
    }), { seed: 531163, numRuns: 500, examples: corpus.models.map((model: Model) => [model]) })
  })
})

it("uses Node and Bun and cancels before an owned native child exits", async () => {
  await load()
  const { spawnSync } = await import("node:child_process")
  const { fileURLToPath } = await import("node:url")
  const fixture = fileURLToPath(new URL("./fixtures/child-inherited-host.mjs", import.meta.url))
  for (const executable of ["node", "bun"]) {
    const child = spawnSync(executable, [fixture], { encoding: "utf8", timeout: 30000 })
    expect(child.error).toBeUndefined()
    expect(child.status).toBe(0)
    const line = child.stdout.split("\n").find(line => line.startsWith("CHILD-INHERITED "))
    expect(line).toBeDefined()
    expect(JSON.parse(line!.slice("CHILD-INHERITED ".length))).toEqual({ host: executable, code: 0, nativeError: true, canceledBeforeExit: true, defaultTermObserved: true })
  }
}, 65000)
