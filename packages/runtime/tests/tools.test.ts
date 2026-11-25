import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Context, Effect, Exit, Layer, Schema, Stream } from "effect"
import { LanguageModel, Tool, Toolkit } from "effect/ai"
import { FetchHttpClient } from "effect/http"
import * as Capability from "../dist/experimental/Capability.js"
import * as Tools from "../dist/experimental/Tools.js"

// Experimental.Tools (VIP-64). Every test runs the real handlers over Node's
// own file system and spawner, and Bun's own HTTP server: no stubs between a
// tool and the world.

let dir = ""
let server: ReturnType<typeof Bun.serve> | undefined
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "vibe-tools-"))
  server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname === "/fail") return new Response("broken", { status: 500 })
      if (url.pathname === "/big") return new Response("x".repeat(Tools.limits.bodyBytes + 1000))
      if (url.pathname === "/page") {
        return new Response(
          "<!doctype html><html><head><title>Hi &amp; bye</title><style>p{}</style></head><body><p>One</p><script>evil()</script><p>Two&nbsp;three</p></body></html>",
          { headers: { "content-type": "text/html" } }
        )
      }
      if (request.method === "POST") return new Response(`got ${await request.text()}`)
      return new Response(`hello ${url.search}`, { headers: { "content-type": "text/plain" } })
    }
  })
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
  server?.stop(true)
})

const services = Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)
const run = <A, E>(effect: Effect.Effect<A, E, any>) => Effect.runPromise(Effect.provide(effect, services) as Effect.Effect<A, E>)
const runExit = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromiseExit(Effect.provide(effect, services) as Effect.Effect<A, E>)
const failure = async (effect: Effect.Effect<unknown, Tools.ToolError, any>) => {
  const exit = await runExit(effect)
  if (!Exit.isFailure(exit)) throw new Error("expected a failure")
  return Effect.runSync(Effect.flip(Effect.suspend(() => exit as any))) as Tools.ToolError
}

test("read keeps CRLF bytes, so its content is a valid edit anchor", async () => {
  const file = join(dir, "crlf.txt")
  writeFileSync(file, "a\r\nb\r\nc")
  const read = await run(Tools.read({ path: file }))
  expect(read).toEqual({ path: file, content: "a\r\nb\r\nc", startLine: 1, lines: 3, totalLines: 3, truncated: false })
  const slice = await run(Tools.read({ path: file, offset: 2, limit: 1 }))
  expect(slice.content).toBe("b\r\n")
  expect(slice.truncated).toBe(true)
  await run(Tools.edit({ path: file, oldText: slice.content, newText: "B\r\n" }))
  expect(readFileSync(file, "utf8")).toBe("a\r\nB\r\nc")
})

test("write creates directories and reports whether it created the file", async () => {
  const file = join(dir, "deep/er/new.txt")
  expect(await run(Tools.write({ path: file, content: "héllo" }))).toEqual({ path: file, bytes: 6, created: true })
  expect((await run(Tools.write({ path: file, content: "x" }))).created).toBe(false)
})

test("edit fails on a missing or ambiguous anchor and changes nothing", async () => {
  const file = join(dir, "edit.txt")
  writeFileSync(file, "x x y")
  expect((await failure(Tools.edit({ path: file, oldText: "z", newText: "q" }))).code).toBe("anchor_not_found")
  expect((await failure(Tools.edit({ path: file, oldText: "x", newText: "q" }))).code).toBe("anchor_ambiguous")
  expect(readFileSync(file, "utf8")).toBe("x x y")
  expect(await run(Tools.edit({ path: file, oldText: "x", newText: "$&q", replaceAll: true }))).toEqual({
    path: file,
    replacements: 2
  })
  // Replacement text is literal: `$&` is not a back-reference.
  expect(readFileSync(file, "utf8")).toBe("$&q $&q y")
})

test("read of a missing file is not_found with the path, and input is validated", async () => {
  const missing = join(dir, "missing.txt")
  const error = await failure(Tools.read({ path: missing }))
  expect(error.code).toBe("not_found")
  expect(error.path).toBe(missing)
  expect((await failure(Tools.read({ path: missing, offset: 0 } as any))).code).toBe("invalid_input")
  expect((await failure(Tools.read({ path: "" }))).code).toBe("invalid_input")
  expect((await failure(Tools.read({ path: dir }))).code).toBe("not_a_file")
})

test("applyPatch applies every file or none", async () => {
  const root = join(dir, "patch")
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, "a.txt"), "one\ntwo\nthree\n")
  writeFileSync(join(root, "gone.txt"), "bye\n")
  const patch = [
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1,3 +1,3 @@",
    " one",
    "-two",
    "+TWO",
    " three",
    "--- /dev/null",
    "+++ b/new.txt",
    "@@ -0,0 +1,1 @@",
    "+fresh",
    "--- a/gone.txt",
    "+++ /dev/null",
    "@@ -1,1 +0,0 @@",
    "-bye"
  ].join("\n")
  const result = await run(Tools.applyPatch({ patch, root }))
  expect(result.files.map((file: any) => file.change)).toEqual(["modified", "created", "deleted"])
  expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("one\nTWO\nthree\n")
  expect(readFileSync(join(root, "new.txt"), "utf8")).toBe("fresh\n")
  // A patch whose second file does not match leaves the first untouched.
  const stale = ["--- a/a.txt", "+++ b/a.txt", "@@ -1 +1 @@", "-one", "+ONE", "--- a/new.txt", "+++ b/new.txt", "@@ -1 +1 @@", "-stale", "+x"]
    .join("\n")
  const error = await failure(Tools.applyPatch({ patch: stale, root }))
  expect(error.code).toBe("patch_rejected")
  expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("one\nTWO\nthree\n")
  expect((await failure(Tools.applyPatch({ patch: "nonsense", root }))).code).toBe("invalid_patch")
})

test("ls, glob and grep are bounded, sorted and skip node_modules", async () => {
  const root = join(dir, "tree")
  mkdirSync(join(root, "src/sub"), { recursive: true })
  mkdirSync(join(root, "node_modules/pkg"), { recursive: true })
  writeFileSync(join(root, "src/a.ts"), "// TODO one\nconst x = 1\r\n// todo two\n")
  writeFileSync(join(root, "src/sub/b.ts"), "nothing\n")
  writeFileSync(join(root, "node_modules/pkg/c.ts"), "// TODO hidden\n")
  const ls = await run(Tools.ls({ path: root }))
  expect(ls.entries).toEqual([{ name: "node_modules", type: "directory" }, { name: "src", type: "directory" }])
  const glob = await run(Tools.glob({ pattern: "**/*.ts", root }))
  expect(glob.paths).toEqual(["src/a.ts", "src/sub/b.ts"])
  const grep = await run(Tools.grep({ pattern: "todo", root, ignoreCase: true }))
  expect(grep.matches).toEqual([
    { path: "src/a.ts", line: 1, text: "// TODO one" },
    { path: "src/a.ts", line: 3, text: "// todo two" }
  ])
  expect(grep.truncated).toBe(false)
  const capped = await run(Tools.grep({ pattern: "o", root, maxMatches: 1 }))
  expect(capped.matches.length).toBe(1)
  expect(capped.truncated).toBe(true)
  // An empty match set is a value, not a failure.
  expect((await run(Tools.grep({ pattern: "absent", root }))).matches).toEqual([])
  expect((await failure(Tools.grep({ pattern: "(", root }))).code).toBe("invalid_input")
  const filtered = await run(Tools.grep({ pattern: ".", root, glob: "src/sub/**" }))
  expect(filtered.matches.map((match: any) => match.path)).toEqual(["src/sub/b.ts"])
})

test("a remote search replaces the walk", async () => {
  const seen: Array<unknown> = []
  const layer = Tools.layerRemoteSearch((input) =>
    Effect.sync(() => {
      seen.push(input.pattern)
      return { root: input.root, matches: [{ path: "far.ts", line: 9, text: "remote" }], filesSearched: 1, truncated: false }
    })
  )
  const result = await run(Effect.provide(Tools.grep({ pattern: "x", root: dir }), layer))
  expect(result.matches[0].path).toBe("far.ts")
  expect(seen).toEqual(["x"])
})

test("bash reports a non-zero exit as a value and bounds its capture", async () => {
  const result = await run(Tools.bash({ command: "printf out; printf err 1>&2; exit 3" }))
  expect(result).toEqual({
    exitCode: 3,
    stdout: "out",
    stderr: "err",
    stdoutTruncated: false,
    stderrTruncated: false,
    timedOut: false
  })
  const big = await run(Tools.bash({ command: `head -c ${Tools.limits.outputBytes + 5000} /dev/zero | tr '\\0' a` }))
  expect(big.stdout.length).toBe(Tools.limits.outputBytes)
  expect(big.stdoutTruncated).toBe(true)
  const slow = await run(Tools.bash({ command: "sleep 5", timeoutMs: 200 }))
  expect(slow.timedOut).toBe(true)
  const test = await run(Tools.test({ command: "true" }))
  expect(test.passed).toBe(true)
})

test("a child gets a small environment: provider keys are withheld unless named", async () => {
  const previous = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = "sk-secret"
  try {
    const hidden = await run(Tools.bash({ command: "echo \"[$ANTHROPIC_API_KEY][$PATH]\"" }))
    expect(hidden.stdout.startsWith("[][")).toBe(true)
    expect(hidden.stdout).not.toContain("sk-secret")
    const named = await run(Tools.bash({ command: "echo $ANTHROPIC_API_KEY $EXTRA", inherit: ["ANTHROPIC_API_KEY"], env: { EXTRA: "e" } }))
    expect(named.stdout.trim()).toBe("sk-secret e")
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = previous
  }
})

test("fetch and post give any status as a value; bodies are bounded; webfetch reads text", async () => {
  const base = `http://127.0.0.1:${server!.port}`
  const ok = await run(Tools.fetch({ url: `${base}/x?q=1` }))
  expect(ok).toMatchObject({ status: 200, body: "hello ?q=1", truncated: false })
  expect((await run(Tools.fetch({ url: `${base}/fail` }))).status).toBe(500)
  const big = await run(Tools.fetch({ url: `${base}/big` }))
  expect(big.truncated).toBe(true)
  expect(big.body.length).toBe(Tools.limits.bodyBytes)
  expect((await run(Tools.post({ url: `${base}/p`, body: "data" }))).body).toBe("got data")
  const page = await run(Tools.webfetch({ url: `${base}/page` }))
  expect(page.title).toBe("Hi & bye")
  expect(page.text).toBe("One\nTwo three")
  expect((await failure(Tools.fetch({ url: "file:///etc/passwd" }))).code).toBe("invalid_input")
  expect((await failure(Tools.fetch({ url: "not a url" }))).code).toBe("invalid_input")
  expect((await failure(Tools.fetch({ url: "http://127.0.0.1:1/" }))).code).toBe("network_failed")
})

test("websearch and lsp say unavailable until a provider is installed", async () => {
  expect((await failure(Tools.websearch({ query: "x" }))).code).toBe("unavailable")
  expect((await failure(Tools.hover({ path: join(dir, "a"), line: 1, character: 1 }))).code).toBe("unavailable")
  const searched = await run(Effect.provide(
    Tools.websearch({ query: "effect", limit: 1 }),
    Tools.layerWebSearch({
      search: () =>
        Effect.succeed({
          results: [{ title: "a", url: "https://a", snippet: "" }, { title: "b", url: "https://b", snippet: "" }],
          truncated: false
        })
    })
  ))
  expect(searched).toEqual({ results: [{ title: "a", url: "https://a", snippet: "" }], truncated: true })
  const symbols = await run(Effect.provide(
    Tools.symbols({ path: "x.ts" }),
    Tools.layerLanguageServer({
      definition: () => Effect.succeed([]),
      references: () => Effect.succeed([]),
      hover: () => Effect.succeed(""),
      diagnostics: () => Effect.succeed([]),
      symbols: (path) => Effect.succeed([{ name: "f", kind: "function", path, line: 1, character: 1 }])
    })
  ))
  expect(symbols.symbols[0].path.endsWith("x.ts")).toBe(true)
})

test("each call asks the permission kernel for the resolved resource", async () => {
  const file = join(dir, "guarded.txt")
  writeFileSync(file, "secret")
  const policy = Capability.grantStore({ allow: [`fs:read:${dir}/ok*`], deny: [`fs:read:${file}`] })
  const denied = await failure(Effect.provide(Tools.read({ path: file }), policy))
  expect(denied.code).toBe("permission_denied")
  // A relative path is resolved before it is checked.
  const relative = await failure(Effect.provide(Tools.read({ path: join(dir, "x/../guarded.txt") }), policy))
  expect(relative.code).toBe("permission_denied")
  const spawn = await failure(Effect.provide(Tools.bash({ command: "true" }), Capability.grantStore({ allow: [], deny: ["proc:*:*"] })))
  expect(spawn.code).toBe("permission_denied")
  const net = await failure(Effect.provide(Tools.fetch({ url: "https://example.com/" }), Capability.grantStore({ allow: [], deny: ["net:*:*"] })))
  expect(net.code).toBe("permission_denied")
})

test("each tool carries annotations from its capability", () => {
  const get = (name: keyof typeof Tools.declarations, key: any) => Context.get((Tools.declarations[name] as any).annotations, key)
  expect(get("read", Tool.Readonly)).toBe(true)
  expect(get("read", Tool.Destructive)).toBe(false)
  expect(get("write", Tool.Destructive)).toBe(true)
  expect(get("bash", Tool.Destructive)).toBe(true)
  expect(get("edit", Tool.Idempotent)).toBe(false)
  expect(Object.keys(Tools.capabilities).sort()).toEqual(Object.keys(Tools.declarations).sort())
})

test("a toolkit's handler is the same handler a direct call reaches, and a failure returns to the model", async () => {
  const file = join(dir, "kit.txt")
  writeFileSync(file, "kit")
  const handle = (name: string, input: unknown) =>
    run(Effect.gen(function*() {
      const kit: any = yield* Tools.filesystem
      const stream = yield* kit.handle(name, input)
      return Array.from(yield* Stream.runCollect(stream)) as Array<any>
    }))
  const kit = await run(Tools.filesystem)
  expect(Object.keys(kit.tools).sort()).toEqual(["applyPatch", "edit", "glob", "grep", "ls", "read", "write"])
  const ok = (await handle("read", { path: file })).at(-1)
  expect(ok.isFailure).toBe(false)
  expect(ok.result).toEqual(await run(Tools.read({ path: file })))
  const failed = (await handle("read", { path: join(dir, "nope") })).at(-1)
  expect(failed.isFailure).toBe(true)
  expect(failed.result).toMatchObject({ _tag: "ToolError", code: "not_found" })
  expect(Object.keys((await run(Tools.readOnly)).tools)).not.toContain("write")
  expect(Object.keys((await run(Tools.shell)).tools).sort()).toEqual(["bash", "test"])
})

test("a model reaches the tools through LanguageModel.generateText", async () => {
  const file = join(dir, "model.txt")
  writeFileSync(file, "from disk")
  let turn = 0
  const model = LanguageModel.make({
    generateText: () =>
      Effect.succeed(turn++ === 0
        ? [{ type: "tool-call", id: "c1", name: "read", params: { path: file } }, {
          type: "finish",
          reason: "tool-calls",
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } }
        }] as any
        : []),
    streamText: () => {
      throw new Error("unused")
    }
  })
  const response = await run(Effect.provideServiceEffect(
    LanguageModel.generateText({ prompt: "read it", toolkit: Tools.filesystem }),
    LanguageModel.LanguageModel,
    model
  ))
  expect((response.toolResults[0] as any).result.content).toBe("from disk")
  // A custom tool merges with the standard set.
  const Echo = Tool.make("echo", { parameters: Schema.Struct({ text: Schema.String }), success: Schema.String })
  const merged = Toolkit.merge(Toolkit.make(Echo), Toolkit.make(...Object.values((await run(Tools.filesystem)).tools)))
  expect(Object.keys(merged.tools)).toContain("echo")
})
