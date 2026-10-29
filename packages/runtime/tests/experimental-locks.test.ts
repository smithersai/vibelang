import { afterAll, beforeAll, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as PlatformError from "effect/PlatformError"
import { existsSync } from "node:fs"
import { Locks } from "vibelang-runtime/experimental"
import { ExperimentalBrowserLocks, ExperimentalBrowserServices } from "vibelang-runtime/experimental/platform-browser"
import { ExperimentalNodeLocks } from "vibelang-runtime/experimental/platform-node"

const packageDir = new URL("..", import.meta.url).pathname

// What every real lock manager must observe; locks-scenarios.ts says how each is produced.
const scenarios = {
  exclusive: { waiting: true, whileWaiting: { held: 1, pending: 1 }, after: { held: 0, pending: 0 } },
  withdrawn: { held: 0, pending: 0 },
  stolen: { afterSteal: { held: 1, pending: 0 }, afterRobbedClose: { held: 1, pending: 0 }, thirdWaits: true },
  stealFree: { whileHeld: { held: 1, pending: 0 }, neverLost: true, after: { held: 0, pending: 0 } },
  tried: {
    taken: true,
    whileTaken: { held: 1, pending: 0 },
    refused: true,
    afterRefusal: { held: 1, pending: 0 },
    refusedToWaiter: true,
    after: { held: 0, pending: 0 }
  },
  triedStolen: { afterClose: { held: 1, pending: 0 } },
  described: ["exclusive true", "exclusive true"],
  refused: { hold: "BadArgument hold", steal: "BadArgument hold", tryHold: "BadArgument tryHold" }
}

// A lock manager whose every call rejects with `cause`.
const refusing = (cause: unknown) =>
  Locks.make({ request: () => Promise.reject(cause), query: () => Promise.reject(cause) })

const reasonOf = <A>(effect: Effect.Effect<A, PlatformError.PlatformError>) =>
  Effect.runPromise(Effect.map(Effect.flip(effect), (error) => {
    expect(PlatformError.isPlatformError(error)).toBe(true)
    return { _tag: error.reason._tag, module: error.reason.module, method: error.reason.method }
  }))

test("Locks: a lock manager's refusal fails with a PlatformError, not a defect", async () => {
  const cases: ReadonlyArray<readonly [unknown, string]> = [
    [new DOMException("names starting with - are reserved", "NotSupportedError"), "BadArgument"],
    [new DOMException("opaque origin", "SecurityError"), "PermissionDenied"],
    [new DOMException("document is not fully active", "InvalidStateError"), "BadResource"],
    [new TypeError("something else"), "Unknown"]
  ]
  for (const [cause, _tag] of cases) {
    const locks = refusing(cause)
    expect(await reasonOf(Effect.scoped(locks.hold("x")))).toEqual({ _tag, module: "Locks", method: "hold" })
    expect(await reasonOf(Effect.scoped(locks.hold("x", { steal: true })))).toEqual({ _tag, module: "Locks", method: "hold" })
    expect(await reasonOf(Effect.scoped(locks.tryHold("x")))).toEqual({ _tag, module: "Locks", method: "tryHold" })
    expect(await reasonOf(locks.query)).toEqual({ _tag, module: "Locks", method: "query" })
  }
})

test("Locks: gives back a lock granted in the moment its wait was interrupted", async () => {
  let grant: (() => Promise<void>) | undefined
  const late = Locks.make({
    request: (_name, options, callback) =>
      new Promise((resolve) => {
        ;(options as { readonly signal: AbortSignal }).signal.addEventListener("abort", () => {
          grant = () => callback({}).then(resolve)
        })
      }),
    query: () => Promise.resolve({})
  })
  await Effect.runPromise(Effect.gen(function*() {
    const waiting = yield* Effect.forkChild(late.hold("late").pipe(Effect.scoped))
    yield* Effect.yieldNow
    yield* Fiber.interrupt(waiting)
  }))
  // The lock manager grants the withdrawn request anyway; the grant ends at once.
  await grant!()
})

test("Locks: asks a wait with a signal, a steal and tryHold without one", async () => {
  const asked: Array<unknown> = []
  const recording = Locks.make({
    request: (_name, options, callback) => {
      asked.push(options)
      return callback({})
    },
    query: () => Promise.resolve({})
  })
  await Effect.runPromise(Effect.gen(function*() {
    yield* recording.hold("asked", { steal: true }).pipe(Effect.scoped)
    yield* recording.hold("asked").pipe(Effect.scoped)
    expect(Option.isSome(yield* recording.tryHold("asked").pipe(Effect.scoped))).toBe(true)
  }))
  expect(asked).toEqual([{ steal: true }, { signal: expect.any(AbortSignal) }, { ifAvailable: true }])
})

test("Locks: query fills in what the lock manager leaves out", async () => {
  const sparse = Locks.make({
    request: () => Promise.resolve(),
    query: () => Promise.resolve({ held: [{ name: "a", mode: "shared", clientId: "c" }, {}] })
  })
  expect(await Effect.runPromise(sparse.query)).toEqual({
    held: [{ name: "a", mode: "shared", clientId: "c" }, { name: "", mode: "exclusive", clientId: "" }],
    pending: []
  })
})

test("Locks: the navigator.locks layers are a defect where there is none, as in Bun", async () => {
  expect((globalThis as { readonly navigator?: { readonly locks?: unknown } }).navigator?.locks).toBeUndefined()
  for (const layer of [ExperimentalBrowserLocks.layer, ExperimentalNodeLocks.layer, ExperimentalBrowserServices.layer]) {
    const exit = await Effect.runPromiseExit(Effect.provide(Effect.service(Locks.Locks), layer))
    expect(Exit.isFailure(exit) && Exit.hasDies(exit)).toBe(true)
    expect(String(exit)).toContain("The Locks layer needs navigator.locks")
  }
})

test("Locks: layerTest grants every request at once and never loses a lock", async () => {
  const observed = await Effect.runPromise(Effect.gen(function*() {
    const locks = yield* Locks.Locks
    const first = yield* locks.hold("x")
    yield* locks.hold("x", { steal: true })
    const tried = yield* locks.tryHold("x")
    const lost = yield* Effect.forkChild(first.lost)
    yield* Effect.yieldNow
    return { tried: Option.isSome(tried), lost: lost.pollUnsafe() === undefined, query: yield* locks.query }
  }).pipe(Effect.scoped, Effect.provide(Locks.layerTest())))
  expect(observed).toEqual({ tried: true, lost: true, query: { held: [], pending: [] } })
  const none = await Effect.runPromise(Effect.gen(function*() {
    const locks = yield* Locks.Locks
    return yield* locks.tryHold("x")
  }).pipe(Effect.scoped, Effect.provide(Locks.layerTest({ tryHold: () => Effect.succeedNone }))))
  expect(none).toEqual(Option.none())
})

// Node 22 has no Web Locks. Probe the selected Node, not the Bun test host.
const nodeHasLocks = Bun.spawnSync(["node", "--input-type=module", "-e",
  "process.exit(globalThis.navigator?.locks === undefined ? 1 : 0)"]).exitCode === 0

test("Locks: Node without Web Locks rejects only the opt-in layer", () => {
  if (nodeHasLocks) return
  const result = Bun.spawnSync(["node", "--input-type=module", "-e", `
    import { Effect, Exit } from "vibelang-runtime"
    import { Locks } from "vibelang-runtime/experimental"
    import { ExperimentalNodeLocks } from "vibelang-runtime/experimental/platform-node"
    const exit = await Effect.runPromiseExit(Effect.provide(Effect.service(Locks.Locks), ExperimentalNodeLocks.layer))
    if (!Exit.isFailure(exit) || !String(exit).includes("The Locks layer needs navigator.locks")) process.exit(1)
  `], { cwd: packageDir })
  expect(result.stderr.toString()).toBe("")
  expect(result.exitCode).toBe(0)
})

test.skipIf(!nodeHasLocks)("Locks: Node.js's layer runs every scenario over its own navigator.locks", () => {
  const result = Bun.spawnSync(["node", "tests/fixtures/locks-node.ts", "scenarios"], {
    cwd: packageDir, stdout: "pipe", stderr: "pipe"
  })
  expect(result.stderr.toString()).toBe("")
  expect(result.exitCode).toBe(0)
  expect(JSON.parse(result.stdout.toString())).toEqual(scenarios)
}, 30_000)

test.skipIf(!nodeHasLocks)("Locks: Node.js's locks exclude a worker thread, never another process", () => {
  const result = Bun.spawnSync(["node", "tests/fixtures/locks-node.ts", "reach"], {
    cwd: packageDir, stdout: "pipe", stderr: "pipe"
  })
  expect(result.stderr.toString()).toBe("")
  expect(result.exitCode).toBe(0)
  expect(JSON.parse(result.stdout.toString())).toEqual({ thread: "refused", process: "taken" })
}, 30_000)

// Chromium through Playwright. Without it the browser tests skip, naming the setup step.
const chromium = await import("playwright").then((playwright) => playwright.chromium, () => undefined)
const browserReady = chromium !== undefined && existsSync(chromium.executablePath())
if (!browserReady) {
  console.warn("Skipping the Chromium Locks tests: run `bunx playwright install chromium` in packages/runtime.")
}

let server: ReturnType<typeof Bun.serve> | undefined
let browser: Awaited<ReturnType<NonNullable<typeof chromium>["launch"]>> | undefined

beforeAll(async () => {
  if (!browserReady) return
  const bundled = await Bun.build({ entrypoints: [`${packageDir}tests/fixtures/locks-browser.ts`], target: "browser", format: "esm" })
  if (!bundled.success) throw new AggregateError(bundled.logs, "bundling locks-browser.ts failed")
  const script = await bundled.outputs[0].text()
  // 127.0.0.1 is a secure context, which Web Locks need.
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === "/locks.js"
        ? new Response(script, { headers: { "content-type": "text/javascript" } })
        : new Response('<!doctype html><script type="module" src="/locks.js"></script>', { headers: { "content-type": "text/html" } })
  })
  browser = await chromium!.launch()
})

afterAll(async () => {
  await browser?.close()
  server?.stop(true)
})

test.skipIf(!browserReady)("Locks: the browser layer runs every scenario over Chromium's navigator.locks", async () => {
  const page = await browser!.newPage()
  try {
    await page.goto(`${server!.url}?role=scenarios`)
    await page.waitForFunction(() => "result" in globalThis || "failure" in globalThis, undefined, { timeout: 15_000 })
    expect(await page.evaluate(() => (globalThis as { readonly failure?: string }).failure)).toBeUndefined()
    expect(await page.evaluate(() => (globalThis as unknown as { readonly result: unknown }).result)).toEqual(scenarios)
  } finally {
    await page.close()
  }
}, 30_000)

test.skipIf(!browserReady)("Locks: tabs of one origin wait for, inherit and steal each other's locks", async () => {
  const context = await browser!.newContext()
  try {
    const name = `tabs-${Date.now()}`
    const tab = async (role: string) => {
      const page = await context.newPage()
      await page.goto(`${server!.url}?role=${role}&name=${name}`)
      return page
    }
    const events = (page: Awaited<ReturnType<typeof tab>>) =>
      page.evaluate(() => (globalThis as unknown as { readonly events: ReadonlyArray<string> }).events.join(" "))
    const until = (page: Awaited<ReturnType<typeof tab>>, expected: string) =>
      page.waitForFunction(
        (expected) => (globalThis as unknown as { readonly events: ReadonlyArray<string> }).events.join(" ") === expected,
        expected,
        { timeout: 5_000 }
      )

    const holder = await tab("holder")
    await until(holder, "held")
    // Another tab finds the lock taken, then waits for it.
    const waiter = await tab("waiter")
    await until(waiter, "refused")
    await Bun.sleep(200)
    expect(await events(waiter)).toBe("refused")
    // Closing the holder's tab hands the lock to the waiting tab.
    await holder.close()
    await until(waiter, "refused held")
    // A third tab steals it; the robbed tab learns so.
    const thief = await tab("thief")
    await until(thief, "held")
    await until(waiter, "refused held lost")
    const trier = await tab("trier")
    await until(trier, "refused")
  } finally {
    await context.close()
  }
}, 30_000)
