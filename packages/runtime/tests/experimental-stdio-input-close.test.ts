import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Stdio from "effect/Stdio"
import * as Experimental from "vibelang-runtime/experimental"
import * as Node from "vibelang-runtime/experimental/platform-node"
import * as fc from "fast-check"
import { EventEmitter } from "node:events"
import { fileURLToPath } from "node:url"
import corpus from "./fixtures/foldkit-mcp-server-input-close.json"

class Input extends EventEmitter {
  readableEnded = false
  destroyed = false
  calls: string[] = []
  setup: (event: string, input: Input) => void = () => {}
  override on(event: string, listener: (...args: any[]) => void): this {
    this.calls.push("on:" + event)
    super.on(event, listener)
    this.setup(event, this)
    return this
  }
  override off(event: string, listener: (...args: any[]) => void): this {
    this.calls.push("off:" + event)
    return super.off(event, listener)
  }
  read() { throw new Error("observer read input") }
  resume() { throw new Error("observer resumed input") }
  pause() { throw new Error("observer paused input") }
  destroy() { throw new Error("observer destroyed input") }
}
const withInput = async <A>(input: Input, body: () => Promise<A>): Promise<A> => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "stdin")!
  Object.defineProperty(process, "stdin", { configurable: true, value: input })
  try { return await body() } finally { Object.defineProperty(process, "stdin", descriptor) }
}
const get = () => Effect.runSync(Effect.provide(
  Effect.service(Experimental.Stdio.Stdio), Node.ExperimentalNodeStdio.layer
))
const lifecycle = async (mode: string, event: "end" | "close", cancel: boolean, repeat: number) => {
  const input = new Input()
  let ownedErrors = 0
  const ownedError = () => { ownedErrors++ }
  input.addListener("error", ownedError)
  if (mode === "ended") input.readableEnded = true
  if (mode === "destroyed") input.destroyed = true
  if (mode === "sync-end" || mode === "sync-close") {
    input.setup = (attached, host) => {
      if (attached === "end") {
        if (mode === "sync-end") host.readableEnded = true
        else host.destroyed = true
        host.emit(mode === "sync-end" ? "end" : "close")
      }
    }
  }
  if (mode === "flag-gap") input.setup = (attached, host) => { if (attached === "close") host.destroyed = true }
  if (mode === "throw-end" || mode === "throw-close") {
    input.setup = (attached) => { if (mode === "throw-" + attached) throw new Error("partial input setup") }
  }
  await withInput(input, async () => {
    const service = get()
    expect(input.calls).toEqual([])
    const wait = service.awaitInputClosed
    expect(Effect.isEffect(wait)).toBe(true)
    expect(input.calls).toEqual([])
    for (let i = 0; i < repeat; i++) {
      const fiber = Effect.runFork(wait)
      if (mode === "pending") {
        expect(fiber.pollUnsafe()).toBeUndefined()
        expect(input.listenerCount("end")).toBe(1)
        expect(input.listenerCount("close")).toBe(1)
        input.emit("error", new Error("transport owns errors"))
        if (cancel) await Effect.runPromise(Fiber.interrupt(fiber))
        else input.emit(event)
      }
      const exit = await Effect.runPromise(Fiber.await(fiber))
      if (mode.startsWith("throw-")) {
        expect(Exit.isFailure(exit)).toBe(true)
        expect(String(exit)).toContain("partial input setup")
      } else if (!(mode === "pending" && cancel)) expect(Exit.isSuccess(exit)).toBe(true)
      expect(input.listenerCount("end")).toBe(0)
      expect(input.listenerCount("close")).toBe(0)
      expect(input.listeners("error")).toEqual([ownedError])
      expect(input.calls.every((call) => /^(on|off):(end|close)$/.test(call))).toBe(true)
    }
    expect(ownedErrors).toBe(mode === "pending" ? repeat : 0)
  })
}

// VIP-33 section2: "What Effect lacks goes under Experimental.X".
// Oracle: a transport keeps exclusive byte/error ownership. Closure observation
// owns only end/close listeners and releases them even after synchronous setup,
// partial setup defects, interruption, and repeated runs of the same Effect.
test("Stdio.awaitInputClosed: seeded lifecycle and listener ownership", async () => {
  await fc.assert(fc.asyncProperty(
    fc.constantFrom("pending", "ended", "destroyed", "sync-end", "sync-close", "flag-gap", "throw-end", "throw-close"),
    fc.constantFrom("end" as const, "close" as const), fc.boolean(), fc.integer({ min: 1, max: 4 }),
    lifecycle
  ), { numRuns: 500, seed: 158032 })
}, 60_000)

test("Stdio.awaitInputClosed: consumed MCP minimized corpus", async () => {
  for (const witness of corpus.cases) await lifecycle(witness.mode, witness.event as "end" | "close", witness.cancel, 1)
})

test("Stdio: extension preserves Effect's exact stream, sinks, arguments and terminal effects", async () => {
  const base = Effect.runSync(Effect.provide(Effect.service(Stdio.Stdio), Stdio.layerTest({ args: Effect.succeed(["mcp"]) })))
  const current = Experimental.Stdio.make(base, { awaitInputClosed: Effect.void })
  for (const key of ["stdin", "stdout", "stderr", "args", "stdinIsTerminal", "stdoutIsTerminal", "stderrIsTerminal"] as const) {
    expect(current[key]).toBe(base[key])
  }
  const program = Effect.flatMap(Effect.service(Experimental.Stdio.Stdio), (stdio) => stdio.awaitInputClosed)
  expect(await Effect.runPromise(Effect.provide(program, Experimental.Stdio.layerTest()))).toBeUndefined()
  let observed = false
  await Effect.runPromise(Effect.provide(program, Experimental.Stdio.layerTest({
    awaitInputClosed: Effect.sync(() => { observed = true })
  })))
  expect(observed).toBe(true)
})

test("Stdio.awaitInputClosed: actual Node/Bun input remains exclusively transport-owned", () => {
  const fixture = fileURLToPath(new URL("./fixtures/stdio-input-close.mjs", import.meta.url))
  for (const runtime of ["node", "bun"]) {
    const child = Bun.spawnSync([runtime, fixture], {
      stdin: new TextEncoder().encode("foldkit-mcp-owned-input\n"), stdout: "pipe", stderr: "pipe", timeout: 15_000
    })
    expect(child.exitCode).toBe(0)
    expect(child.stderr.toString()).toBe("")
    expect(JSON.parse(child.stdout.toString())).toEqual({ untouchedBeforeConsumer: true, bytesPreserved: true, detached: true })
  }
}, 35_000)
