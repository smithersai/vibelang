// Run by node: builds ExperimentalNodeHttpServer under Node, serves one
// request, and records every module Node resolves to show the barrel's import
// loads no part of @effect/platform-node's HTTP server until a layer is built.
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { Server } from "node:http"

const resolved = []
registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context)
    resolved.push(result.url)
    return result
  }
})
// @effect/platform-node's HTTP server modules and ws, which they bring.
const http = () => resolved.filter((url) => /\/node_modules\/(?:@effect\/platform-node[^/]*\/dist\/NodeHttp|ws\/)/.test(url))

const { ExperimentalNodeHttpServer } = await import("../../dist/experimental/platform-node/index.js")
const barrelLoadsHttp = http().length > 0

const Effect = await import("effect/Effect")
const { HttpServer, HttpServerResponse } = await import("effect/http")

const listen = Server.prototype.listen
let listens = 0
Server.prototype.listen = function(...args) {
  listens++
  return listen.apply(this, args)
}
const layer = ExperimentalNodeHttpServer.layer({ port: 0, host: "127.0.0.1" })
const listensBeforeBuild = listens

const { answer, url } = await Effect.runPromise(Effect.scoped(Effect.provide(Effect.gen(function*() {
  const server = yield* HttpServer.HttpServer
  yield* Effect.forkScoped(server.serve(Effect.succeed(HttpServerResponse.text("pong"))))
  const url = `http://127.0.0.1:${server.address.port}/`
  const answer = yield* Effect.promise(async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
    return [response.status, await response.text()]
  })
  return { answer, url }
}), layer)))
Server.prototype.listen = listen
// Building the layer loads the module the barrel deferred, so the check above is not vacuous.
assert.ok(http().length > 0, "building the layer loads NodeHttpServer")
const refusedAfterClose = await fetch(url, { signal: AbortSignal.timeout(5000) }).then(() => false, () => true)

console.log("NODE-HTTP-SERVER " + JSON.stringify({ host: "node", barrelLoadsHttp, listensBeforeBuild, answer, refusedAfterClose }))
