import { test, expect } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { builtResponse, routeBuiltSite } from "../../site/scripts/built-site.mjs"

// //:site-contrast runs only after merge. Main b0387e3558d9 went RED there with
// `apiRequestContext.get: read ECONNRESET`: the check fetched each file from a
// local server, which dropped idle keep-alive sockets as Playwright reused them.
function withBuild(run: (root: string) => Promise<void>) {
  return async () => {
    const parent = mkdtempSync(join(tmpdir(), "built-site-"))
    const root = join(parent, "public")
    const files = {
      "index.html": "<h1>home</h1>",
      "001-onboarding/index.html": "<h1>onboarding</h1>",
      "cheat-sheet.html": "<h1>cheat sheet</h1>",
      "RSC/R/spec.txt": "flight",
      "assets/app.js": "export {}",
      "assets/font.woff2": "font",
    }
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    writeFileSync(join(parent, "outside.txt"), "secret")
    try {
      await run(root)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  }
}

test("a routed request reads the build without opening a connection", withBuild(async root => {
  const handlers: Array<(route: unknown) => Promise<void>> = []
  const patterns: string[] = []
  const context = {
    route: async (pattern: string, handler: (route: unknown) => Promise<void>) => {
      patterns.push(pattern)
      handlers.push(handler)
    },
    request: { get: async () => { throw Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) } },
  }
  await routeBuiltSite(context, root)
  expect(patterns).toEqual(["https://vibelang.sh/**"])
  const fulfilled: Array<{ status: number, contentType: string, body: Buffer }> = []
  await handlers[0]!({
    request: () => ({ url: () => "https://vibelang.sh/RSC/R/spec.txt?query=" }),
    fulfill: async (response: { status: number, contentType: string, body: Buffer }) => { fulfilled.push(response) },
  })
  expect(fulfilled.map(({ status, contentType, body }) => [status, contentType, String(body)]))
    .toEqual([[200, "text/plain", "flight"]])
}))

test("the built site answers like its host", withBuild(async root => {
  const answer = async (path: string) => {
    const { status, contentType, body } = await builtResponse(root, path)
    return [status, contentType, String(body)]
  }
  expect(await answer("/")).toEqual([200, "text/html", "<h1>home</h1>"])
  expect(await answer("/001-onboarding")).toEqual([200, "text/html", "<h1>onboarding</h1>"])
  expect(await answer("/cheat-sheet")).toEqual([200, "text/html", "<h1>cheat sheet</h1>"])
  expect(await answer("/assets/app.js")).toEqual([200, "text/javascript", "export {}"])
  expect(await answer("/assets/font.woff2")).toEqual([200, "font/woff2", "font"])
  expect((await answer("/absent"))[0]).toBe(404)
  expect((await answer("/%2e%2e/outside.txt"))[0]).toBe(403)
}))
