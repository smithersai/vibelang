import assert from "node:assert/strict"
import { createServer, request as sendRequest } from "node:http"
import { Readable } from "node:stream"
import { EventEmitter } from "node:events"
import { readFileSync } from "node:fs"
import ts from "typescript"
import * as Effect from "effect/Effect"
import * as Scope from "effect/Scope"
import * as Exit from "effect/Exit"
import * as HttpServerRequest from "effect/http/HttpServerRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"
import * as NodeHttpServerRequest from "@effect/platform-node/NodeHttpServerRequest"
import * as NodeStream from "../../dist/experimental/NodeStream.js"
import { ExperimentalNodeStream } from "../../dist/experimental/platform-node/index.js"
import { ExperimentalBunNodeStream } from "../../dist/experimental/platform-bun/index.js"

const layer = process.versions.bun ? ExperimentalBunNodeStream.layer : ExperimentalNodeStream.layer
const service = await Effect.runPromise(Effect.provide(NodeStream.NodeStream, layer))
const corpus = JSON.parse(readFileSync(new URL("../corpus/foldkit-node-response-close.json", import.meta.url), "utf8"))
const exports = {}
const js = ts.transpileModule(corpus.original, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
new Function("Readable", "ReadableStream", "exports", js)(Readable, ReadableStream, exports)
function source() {
  const stats = { cancels: 0, pulls: 0 }
  const body = new ReadableStream({ pull() { stats.pulls++; return new Promise(() => {}) }, cancel() { stats.cancels++ } }, { highWaterMark: 0 })
  return { body, stats }
}
const closed = body => body.closed ? Promise.resolve() : new Promise(resolve => body.once("close", resolve))
async function head(kind) {
  const { body, stats } = source(), scope = await Effect.runPromise(Scope.make())
  let response, readable, ownListener
  const handler = await Effect.runPromise(NodeHttpServer.makeHandler(Effect.gen(function*() {
    const req = yield* HttpServerRequest.HttpServerRequest
    response = NodeHttpServerRequest.toServerResponse(req)
    const before = response.listeners("close"), signal = yield* Effect.abortSignal
    readable = kind === "original" ? exports.originalBridge({ body }, response, signal) : yield* service.fromWeb(body, { response, signal })
    ownListener = response.listeners("close").find(listener => !before.includes(listener))
    return HttpServerResponse.raw(readable)
  }), { scope }))
  const server = createServer(handler)
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve) })
    await new Promise((resolve, reject) => {
      const req = sendRequest({ hostname: "127.0.0.1", port: server.address().port, method: "HEAD" }, res => { res.resume(); res.once("end", resolve); res.once("error", reject) })
      req.once("error", reject); req.setTimeout(10000, () => req.destroy(new Error("bounded HEAD deadline"))); req.end()
    })
    await closed(readable)
    return { ...stats, owned: body.locked, listenerRemoved: !response.listeners("close").includes(ownListener) }
  } finally {
    await new Promise(resolve => server.close(resolve))
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
}
const before = await head("original"), after = await head("service")
assert.deepEqual(after, before)
assert.equal(after.cancels, 1); assert.equal(after.owned, true); assert.equal(after.listenerRemoved, true)
for (const aborted of [false, true]) {
  const { body, stats } = source(), response = new EventEmitter()
  const readable = await Effect.runPromise(service.fromWeb(body, { response, signal: { aborted } }))
  const done = closed(readable)
  if (!aborted) { assert.equal(response.listenerCount("close"), 1); response.emit("close") }
  await done
  assert.equal(stats.cancels, 1); assert.equal(response.listenerCount("close"), 0)
}
console.log("EAGER-WEB-BODY " + JSON.stringify({ host: process.versions.bun ? "bun" : "node", originalHeadEquivalent: true, cancels: after.cancels, listenerRemoved: true, responseClose: true, alreadyAborted: true }))
