import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { Server } from "node:http"
import { fileURLToPath } from "node:url"
import * as Cause from "effect/Cause"
import * as Config from "effect/Config"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import { HttpServer, HttpServerResponse } from "effect/http"
import { ExperimentalNodeHttpServer } from "vibelang-runtime/experimental/platform-node"

// Every test holds one scope open and asserts inside it. No test closes a
// server and binds its port again by number: another process may take a
// released port, and then the test fails or passes for the wrong reason.
const host = "127.0.0.1"
const portOf = (value: HttpServer.Address) => "port" in value ? value.port : -1
const urlOf = (value: HttpServer.Address) => `http://${host}:${portOf(value)}/`

// Serves `pong` on the layer's server and hands `use` the bound address.
const serving = <A, E, R>(
  layer: Layer.Layer<HttpServer.HttpServer, E, R>,
  use: (address: HttpServer.Address) => Effect.Effect<A, unknown>
) =>
  Effect.scoped(Effect.provide(Effect.gen(function*() {
    const server = yield* HttpServer.HttpServer
    yield* Effect.forkScoped(server.serve(Effect.succeed(HttpServerResponse.text("pong"))))
    return yield* use(server.address)
  }), layer))

const roundTrip = (address: HttpServer.Address) =>
  Effect.promise(async () => {
    const response = await fetch(urlOf(address), { signal: AbortSignal.timeout(5000) })
    return [response.status, await response.text()] as const
  })

const refused = (url: string) =>
  fetch(url, { signal: AbortSignal.timeout(5000) }).then(() => "answered", (error: Error) => error.name)

const failureText = (exit: Exit.Exit<unknown, unknown>) => Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "succeeded"

test("ExperimentalNodeHttpServer: layer serves a request, refuses a second bind, and stops answering when its scope closes", async () => {
  const seen = await Effect.runPromise(serving(ExperimentalNodeHttpServer.layer({ port: 0, host }), (address) =>
    Effect.gen(function*() {
      const answer = yield* roundTrip(address)
      const clash = yield* Effect.exit(Effect.scoped(Layer.build(ExperimentalNodeHttpServer.layer({ port: portOf(address), host }))))
      return { address, answer, clash: failureText(clash) }
    })))
  expect(portOf(seen.address)).toBeGreaterThan(0)
  expect(seen.answer).toEqual([200, "pong"])
  expect(seen.clash).toMatch(/EADDRINUSE|address already in use|in use/i)
  // Release is proven by the closed port refusing a connection, not by a rebind.
  expect(await refused(urlOf(seen.address))).not.toBe("answered")
})

test("ExperimentalNodeHttpServer: layerConfig reads its options from Config and serves; a port Config refuses fails the layer", async () => {
  const configured = Layer.provide(
    ExperimentalNodeHttpServer.layerConfig({ port: Config.succeed(0), host: Config.String("HOST") }),
    ConfigProvider.layer(ConfigProvider.fromUnknown({ HOST: host }))
  )
  const seen = await Effect.runPromise(serving(configured, (address) => Effect.map(roundTrip(address), (answer) => ({ address, answer }))))
  expect(portOf(seen.address)).toBeGreaterThan(0)
  expect(seen.answer).toEqual([200, "pong"])

  const refusedPort = Layer.provide(
    ExperimentalNodeHttpServer.layerConfig({ port: Config.Port("PORT") }),
    ConfigProvider.layer(ConfigProvider.fromUnknown({ PORT: 0 }))
  )
  const exit = await Effect.runPromiseExit(Effect.scoped(Layer.build(refusedPort)))
  expect(exit._tag).toBe("Failure")
})

test("ExperimentalNodeHttpServer: constructing a layer listens on nothing until Effect builds it", async () => {
  const listen = Server.prototype.listen
  let listens = 0
  // Effect's server listens through node:http's Server under Node and Bun.
  Server.prototype.listen = function(this: Server, ...args: Array<unknown>) {
    listens++
    return (listen as (...args: Array<unknown>) => Server).apply(this, args)
  } as typeof listen
  try {
    const pending = ExperimentalNodeHttpServer.layer({ port: 0, host })
    const pendingConfig = ExperimentalNodeHttpServer.layerConfig({ port: Config.succeed(0), host: Config.succeed(host) })
    expect(listens).toBe(0)
    const answer = await Effect.runPromise(serving(pending, roundTrip))
    expect(listens).toBe(1)
    expect(answer).toEqual([200, "pong"])
    await Effect.runPromise(serving(pendingConfig, roundTrip))
    expect(listens).toBe(2)
  } finally {
    Server.prototype.listen = listen
  }
})

// The layer is a Node layer; under Bun only Bun's node:http compatibility
// runs it. The fixture builds it under Node itself, serves one request, and
// checks that importing the barrel loads none of Effect's HTTP stack.
test("ExperimentalNodeHttpServer: under Node the barrel defers Effect's HTTP stack, and the layer serves a request", () => {
  const file = fileURLToPath(new URL("./fixtures/node-http-server-host.mjs", import.meta.url))
  const result = spawnSync("node", [file], { encoding: "utf8", timeout: 30_000 })
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.stderr).toBe("")
  expect(result.status).toBe(0)
  const line = result.stdout.split("\n").find((line) => line.startsWith("NODE-HTTP-SERVER "))
  expect(line).toBeDefined()
  expect(JSON.parse(line!.slice("NODE-HTTP-SERVER ".length))).toEqual({
    host: "node",
    barrelLoadsHttp: false,
    listensBeforeBuild: 0,
    answer: [200, "pong"],
    refusedAfterClose: true
  })
}, 45_000)
