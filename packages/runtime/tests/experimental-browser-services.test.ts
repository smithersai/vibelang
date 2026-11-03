import { afterAll, beforeAll, expect, test } from "bun:test"
import { existsSync } from "node:fs"

const packageDir = new URL("..", import.meta.url).pathname

// Chromium through Playwright. Without it the browser tests skip, naming the setup step.
const chromium = await import("playwright").then((playwright) => playwright.chromium, () => undefined)
const browserReady = chromium !== undefined && existsSync(chromium.executablePath())
if (!browserReady && process.env.VIBELANG_REQUIRE_BROWSER_TESTS === "1") {
  throw new Error("Chromium is required for this run: install it with bunx playwright install chromium")
}
if (!browserReady) {
  console.warn("Skipping the Chromium browser service tests: run `bunx playwright install chromium` in packages/runtime.")
}

let server: ReturnType<typeof Bun.serve> | undefined
let browser: Awaited<ReturnType<NonNullable<typeof chromium>["launch"]>> | undefined

const bundle = async (fixture: string) => {
  const bundled = await Bun.build({ entrypoints: [`${packageDir}tests/fixtures/${fixture}`], target: "browser", format: "esm" })
  if (!bundled.success) throw new AggregateError(bundled.logs, `bundling ${fixture} failed`)
  return await bundled.outputs[0].text()
}

beforeAll(async () => {
  if (!browserReady) return
  const page = await bundle("browser-services.ts")
  const worker = await bundle("browser-services-worker.ts")
  const script = (text: string) => new Response(text, { headers: { "content-type": "text/javascript" } })
  // 127.0.0.1 is a secure context, which Web Locks need.
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      const { pathname } = new URL(request.url)
      if (pathname === "/page.js") return script(page)
      if (pathname === "/worker.js") return script(worker)
      return new Response(
        pathname === "/worker"
          ? '<!doctype html><script>new Worker("/worker.js", { type: "module" }).onmessage = (event) => Object.assign(globalThis, event.data)</script>'
          : '<!doctype html><body><script type="module" src="/page.js"></script>',
        { headers: { "content-type": "text/html" } }
      )
    }
  })
  browser = await chromium!.launch()
})

afterAll(async () => {
  await browser?.close()
  server?.stop(true)
})

const resultOf = async (path: string) => {
  const page = await browser!.newPage()
  const diagnostics: Array<string> = []
  page.on("pageerror", (error) => diagnostics.push(error.stack ?? error.message))
  page.on("console", (message) => { if (message.type() === "error") diagnostics.push(message.text()) })
  try {
    await page.goto(`${server!.url}${path}`.replace(/([^:])\/\//, "$1/"))
    await page.waitForFunction(() => "result" in globalThis || "failure" in globalThis, undefined, { timeout: 20_000 })
    expect(await page.evaluate(() => (globalThis as { readonly failure?: string }).failure)).toBeUndefined()
    return await page.evaluate(() => (globalThis as unknown as { readonly result: unknown }).result)
  } catch (cause) {
    throw new Error("browser service fixture " + path + " failed\n" + diagnostics.join("\n"), { cause })
  } finally {
    await page.close()
  }
}

test.skipIf(!browserReady)("browser services: each runs over Chromium's real API through the bundle", async () => {
  expect(await resultOf("/")).toEqual({
    matches: true,
    malformed: false,
    changes: [true],
    frame: true,
    ownFrame: true,
    deltas: true,
    finished: "finished",
    cancelled: "idle",
    text: "hi",
    dataUrl: "data:text/plain;base64,aGk=",
    bytes: 2,
    resizes: [10, 20],
    document: true
  })
}, 30_000)

test.skipIf(!browserReady)("browser services: the bundle builds in a worker, and what needs the page fails only when it runs", async () => {
  expect(await resultOf("/worker")).toEqual({ text: "from a worker", missing: true })
}, 30_000)
