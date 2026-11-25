import { afterAll, beforeAll, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Context, Effect, Exit, Layer, Stream } from "effect"
import { LanguageModel, Tool } from "effect/ai"
import { FetchHttpClient } from "effect/http"
import { ChildProcess } from "effect/process"
import * as Capability from "../dist/experimental/Capability.js"
import * as McpClient from "../dist/experimental/McpClient.js"

// Experimental.McpClient (VIP-65). The stdio server is a real process,
// fixtures/mcp-stdio-server.mjs, and the HTTP server is a real Bun server:
// the client speaks the protocol to both over real pipes and sockets.

const fixture = fileURLToPath(new URL("./fixtures/mcp-stdio-server.mjs", import.meta.url))
const command = (env: Record<string, string> = {}) => ChildProcess.make(process.execPath, [fixture], { env })
const services = Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)
const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(Effect.scoped(Effect.provide(effect, services)) as Effect.Effect<A, E>)
const runExit = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromiseExit(Effect.scoped(Effect.provide(effect, services)) as Effect.Effect<A, E>)

const call = (kit: any, name: string, params: unknown) =>
  Effect.flatMap(kit.handle(name, params), (stream: any) => Stream.runCollect(stream)).pipe(
    Effect.map((results: any) => Array.from(results).at(-1) as any)
  )

test("include is an allowlist, and names are prefixed with the server", async () => {
  const names = await run(Effect.map(
    McpClient.toolkit("fx", { command: command(), include: ["echo", "refuse"] }),
    (kit) => Object.keys(kit.tools).sort()
  ))
  expect(names).toEqual(["fx__echo", "fx__refuse"])
  const all = await run(Effect.map(McpClient.toolkit("fx", { command: command(), include: "all" }), (kit) => Object.keys(kit.tools)))
  expect(all).toContain("fx__delete_repo")
})

test("include is required, and a name the server lacks fails before any call", async () => {
  const missing = await runExit(McpClient.toolkit("fx", { command: command() } as any))
  expect(Exit.isFailure(missing) && JSON.stringify(missing.cause)).toContain("invalid_options")
  const absent = await runExit(McpClient.toolkit("fx", { command: command(), include: ["nope"] }))
  expect(JSON.stringify(absent)).toContain("tool_missing")
  const badName = await runExit(McpClient.toolkit("bad name", { command: command(), include: "all" }))
  expect(JSON.stringify(badName)).toContain("invalid_options")
})

test("a call returns the server's result, and isError is a result, not a failure", async () => {
  const [echo, refuse] = await run(Effect.gen(function*() {
    const kit = yield* McpClient.toolkit("fx", { command: command(), include: ["echo", "refuse"] })
    return [yield* call(kit, "fx__echo", { text: "hi" }), yield* call(kit, "fx__refuse", {})]
  }))
  expect(echo.isFailure).toBe(false)
  expect(echo.result.content[0].text).toBe("echo:hi:1")
  expect(refuse.isFailure).toBe(false)
  expect(refuse.result.isError).toBe(true)
  expect(refuse.result.content[0].text).toBe("no such issue")
})

test("the child gets a small environment: provider keys stay home", async () => {
  const previous = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = "sk-host-secret"
  try {
    const text = await run(Effect.gen(function*() {
      const kit = yield* McpClient.toolkit("fx", { command: command({ DECLARED: "1" }), include: ["env"] })
      return (yield* call(kit, "fx__env", {})).result.content[0].text as string
    }))
    const names = text.split(",")
    expect(names).toContain("DECLARED")
    expect(names).not.toContain("OPENAI_API_KEY")
    for (const name of names) {
      expect(["PATH", "HOME", "USER", "LANG", "TERM", "TMPDIR", "SHELL", "DECLARED"].includes(name) || name.startsWith("LC_") || name === "__CF_USER_TEXT_ENCODING")
        .toBe(true)
    }
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previous
  }
})

test("errors withhold the server's text: stderr and remote bodies never surface", async () => {
  const [crash, remote] = await run(Effect.gen(function*() {
    const kit = yield* McpClient.toolkit("fx", { command: command(), include: ["crash", "delete_repo"] })
    const remote = yield* call(kit, "fx__delete_repo", {})
    const crash = yield* call(kit, "fx__crash", {})
    return [crash, remote]
  }))
  for (const failed of [crash, remote]) {
    expect(failed.isFailure).toBe(true)
    expect(failed.result._tag).toBe("McpError")
    expect(JSON.stringify(failed)).not.toContain("SECRET")
  }
  expect(crash.result.code).toBe("transport")
  expect(remote.result.tool).toBe("fx__delete_repo")
})

test("server hints are claims: copied only with trustAnnotations", async () => {
  const get = (kit: any, key: any) => Context.get(kit.tools.fx__echo.annotations, key)
  const untrusted = await run(McpClient.toolkit("fx", { command: command(), include: ["echo"] }))
  expect(get(untrusted, Tool.Readonly)).toBe(false)
  expect(get(untrusted, Tool.Destructive)).toBe(true)
  const trusted = await run(McpClient.toolkit("fx", { command: command(), include: ["echo"], trustAnnotations: true }))
  expect(get(trusted, Tool.Readonly)).toBe(true)
  expect(get(trusted, Tool.Destructive)).toBe(false)
  expect(McpClient.descriptorOf(trusted.tools.fx__echo)?.name).toBe("echo")
})

test("the kernel checks proc:spawn and net:post before connecting", async () => {
  const spawn = await runExit(Effect.provide(
    McpClient.toolkit("fx", { command: command(), include: "all" }),
    Capability.grantStore({ allow: [], deny: ["proc:*:*"] })
  ))
  expect(JSON.stringify(spawn)).toContain("permission_denied")
  const net = await runExit(Effect.provide(
    McpClient.toolkit("web", { url: "https://mcp.example/", include: "all" }),
    Capability.grantStore({ allow: [], deny: ["net:*:*"] })
  ))
  expect(JSON.stringify(net)).toContain("permission_denied")
})

// A Streamable HTTP server that answers JSON, never SSE.
let http: ReturnType<typeof Bun.serve> | undefined
beforeAll(() => {
  http = Bun.serve({
    port: 0,
    fetch: async (request) => {
      if (request.method !== "POST") return new Response(null, { status: 405 })
      const message = await request.json() as any
      if (message.id === undefined) return new Response(null, { status: 202 })
      const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: message.id, result })
      if (message.method === "initialize") {
        return reply({ protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "h", version: "1" } })
      }
      if (message.method === "tools/list") {
        return reply({ tools: [{ name: "add", inputSchema: { type: "object" } }, { name: "drop", inputSchema: { type: "object" } }] })
      }
      if (message.method === "tools/call") {
        const { a, b } = message.params.arguments
        return reply({ content: [{ type: "text", text: String(a + b) }] })
      }
      return new Response("SECRET-REMOTE-BODY", { status: 500 })
    }
  })
})
afterAll(() => http?.stop(true))

test("Streamable HTTP gives the same toolkit, and a model reaches it", async () => {
  const url = `http://127.0.0.1:${http!.port}/mcp`
  let turn = 0
  const model = LanguageModel.make({
    generateText: () =>
      Effect.succeed(turn++ === 0 ? [{ type: "tool-call", id: "c", name: "calc__add", params: { a: 2, b: 3 } }] as any : []),
    streamText: () => Stream.empty
  })
  const response = await run(Effect.gen(function*() {
    const kit = yield* McpClient.toolkit("calc", { url, include: ["add"] })
    expect(Object.keys(kit.tools)).toEqual(["calc__add"])
    return yield* Effect.provideServiceEffect(
      LanguageModel.generateText({ prompt: "add", toolkit: kit }),
      LanguageModel.LanguageModel,
      model
    )
  }))
  expect((response.toolResults[0] as any).result.content[0].text).toBe("5")
  const bad = await runExit(McpClient.toolkit("calc", { url: "ftp://x", include: "all" }))
  expect(JSON.stringify(bad)).toContain("invalid_options")
})
