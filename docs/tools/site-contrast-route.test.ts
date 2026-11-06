import { test, expect } from "bun:test"
import fc from "fast-check"
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
      "videos/clip.mp4": "0123456789",
      "videos/empty.mp4": "",
      "videos/binary.mp4": Buffer.from([0, 255, 128, 64]),
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
    request: () => ({ url: () => "https://vibelang.sh/RSC/R/spec.txt?query=", headers: () => ({}) }),
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

test("built media serves closed, open and suffix byte ranges", withBuild(async root => {
  for (const [range, start, end] of [["bytes=2-5", 2, 5], ["bytes=7-", 7, 9], ["bytes=-3", 7, 9], ["bytes=0-99", 0, 9], ["bytes=-99", 0, 9]] as const) {
    const response = await builtResponse(root, "/videos/clip.mp4", range)
    expect(response.status).toBe(206)
    expect(response.contentType).toBe("video/mp4")
    expect(response.headers).toMatchObject({ "accept-ranges": "bytes", "content-range": "bytes " + start + "-" + end + "/10" })
    expect(String(response.body)).toBe("0123456789".slice(start, end + 1))
  }
}))

test("unsatisfiable ranges are distinct from malformed or unsupported ranges", withBuild(async root => {
  for (const range of ["bytes=10-", "bytes=12-15", "bytes=5-2", "bytes=-0"]) {
    const response = await builtResponse(root, "/videos/clip.mp4", range)
    expect(response.status).toBe(416)
    expect(response.headers["content-range"]).toBe("bytes */10")
    expect(response.body.length).toBe(0)
  }
  for (const range of ["items=0-1", "bytes=-", "bytes=0-1,3-4", "bytes=oops", undefined]) {
    const response = await builtResponse(root, "/videos/clip.mp4", range)
    expect(response.status).toBe(200)
    expect(String(response.body)).toBe("0123456789")
    expect(response.contentType).toBe("video/mp4")
  }
  expect((await builtResponse(root, "/absent", "bytes=0-1")).status).toBe(404)
  expect((await builtResponse(root, "/%2e%2e/outside.txt", "bytes=0-1")).status).toBe(403)
}))

test("the actual router forwards a media request range to its file response", withBuild(async root => {
  let handler: any
  let result: any
  await routeBuiltSite({ route: async (_: string, run: any) => { handler = run } }, root)
  await handler({
    request: () => ({ url: () => "https://vibelang.sh/videos/clip.mp4", headers: () => ({ range: "bytes=4-6" }) }),
    fulfill: async (response: any) => { result = response },
  })
  expect(result.status).toBe(206)
  expect(String(result.body)).toBe("456")
}))

test("generated single ranges retain precisely the requested bytes", withBuild(async root => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: 9 }), fc.integer({ min: 0, max: 30 }), async (start, width) => {
    const end = Math.min(9, start + width)
    const response = await builtResponse(root, "/videos/clip.mp4", "bytes=" + start + "-" + (start + width))
    expect(response.status).toBe(206)
    expect(response.headers["content-range"]).toBe("bytes " + start + "-" + end + "/10")
    expect(Buffer.from(response.body)).toEqual(Buffer.from(Array.from({ length: end - start + 1 }, (_, offset) => 48 + start + offset)))
  }), { numRuns: 64, seed: 41 })
}))

test("empty and binary media keep byte boundaries", withBuild(async root => {
  const empty = await builtResponse(root, "/videos/empty.mp4", "bytes=0-")
  expect(empty.status).toBe(416)
  expect(empty.headers["content-range"]).toBe("bytes */0")
  const binary = await builtResponse(root, "/videos/binary.mp4", "bytes=1-2")
  expect(binary.status).toBe(206)
  expect(Buffer.from(binary.body)).toEqual(Buffer.from([255, 128]))
}))
