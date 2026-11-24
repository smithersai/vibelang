import { expect, test } from "bun:test"
import { createServer } from "node:http"
import { NodeHttpServer } from "@effect/platform-node"
import * as Config from "effect/Config"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import { HttpServer, HttpServerResponse } from "effect/http"
import * as fc from "fast-check"
import { ExperimentalNodeHttpServer } from "vibelang-runtime/experimental/platform-node"

const host = "127.0.0.1"
const portOf = (value: HttpServer.Address) => "port" in value ? value.port : -1
const urlOf = (value: HttpServer.Address) => `http://${host}:${portOf(value)}/`
// A port is the kernel's choice, so an address is compared without it.
const shape = (value: HttpServer.Address) => ({ ...value, port: portOf(value) > 0 })

// One cycle, inside one open scope: the layer binds a kernel-chosen port,
// answers a request with the cycle's body, and, when the cycle contends, a
// second bind of that held port fails. After the scope closes the port refuses
// a connection. Nothing binds a released port again by number.
const cycleOn = (layer: Layer.Layer<HttpServer.HttpServer, unknown>, body: string, contend: boolean) =>
  Effect.gen(function*() {
    const inside = yield* Effect.scoped(Effect.provide(Effect.gen(function*() {
      const server = yield* HttpServer.HttpServer
      yield* Effect.forkScoped(server.serve(Effect.succeed(HttpServerResponse.text(body))))
      const answer = yield* Effect.promise(async () => {
        const response = await fetch(urlOf(server.address), { signal: AbortSignal.timeout(5000) })
        return [response.status, await response.text()]
      })
      const clash = contend
        ? Exit.isFailure(yield* Effect.exit(Effect.scoped(Layer.build(ExperimentalNodeHttpServer.layer({ port: portOf(server.address), host })))))
        : undefined
      return { address: server.address, answer, clash }
    }), layer))
    const released = yield* Effect.promise(() =>
      fetch(urlOf(inside.address), { signal: AbortSignal.timeout(5000) }).then(() => false, () => true)
    )
    return { address: shape(inside.address), answer: inside.answer, clash: inside.clash, released }
  })

test("ExperimentalNodeHttpServer: generated literal/config cycles serve like Effect's own layer and release the port", async () => {
  const check = async (cycles: Array<{ config: boolean; contend: boolean; body: string }>) => {
    for (const cycle of cycles) {
      const layer = cycle.config
        ? Layer.provide(
          ExperimentalNodeHttpServer.layerConfig({ port: Config.succeed(0), host: Config.String("HOST") }),
          ConfigProvider.layer(ConfigProvider.fromUnknown({ HOST: host }))
        )
        : ExperimentalNodeHttpServer.layer({ port: 0, host })
      const actual = await Effect.runPromise(cycleOn(layer, cycle.body, cycle.contend))
      // Effect's layer with the same options is the oracle for the forwarded
      // options, the served answer and scope cleanup.
      const expected = await Effect.runPromise(cycleOn(NodeHttpServer.layer(createServer, { port: 0, host }), cycle.body, cycle.contend))
      expect(actual).toEqual(expected)
      expect(actual.answer).toEqual([200, cycle.body])
      expect(actual.released).toBe(true)
      if (cycle.contend) expect(actual.clash).toBe(true)
    }
  }
  const corpus = await Bun.file(new URL("./corpus/foldkit-cli-http-scoped-default-constructor.json", import.meta.url)).json()
  await check(corpus.cycles.map((cycle: { config: boolean; contend: boolean }) => ({ ...cycle, body: "corpus" })))
  await fc.assert(fc.asyncProperty(fc.array(fc.record({
    config: fc.boolean(),
    contend: fc.boolean(),
    body: fc.stringMatching(/^[a-z0-9 ]{0,16}$/)
  }), { minLength: 1, maxLength: 6 }), check), { seed: 73, numRuns: 30 })
}, 60000)
