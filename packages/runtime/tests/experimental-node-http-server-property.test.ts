import { expect, test } from "bun:test"
import { createServer } from "node:http"
import { NodeHttpServer } from "@effect/platform-node"
import * as Config from "effect/Config"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import { HttpServer } from "effect/http"
import * as fc from "fast-check"
import { ExperimentalNodeHttpServer } from "vibelang-runtime/experimental/platform-node"

const address = Effect.map(Effect.service(HttpServer.HttpServer), (server) => server.address)
const portOf = (value: HttpServer.Address) => "port" in value ? value.port : -1

test("ExperimentalNodeHttpServer: generated literal/config cycles match Effect and release the real listening port", async () => {
  const corpus = await Bun.file(new URL("./corpus/foldkit-cli-http-scoped-default-constructor.json", import.meta.url)).json()
  const check = async (cycles: Array<{ config: boolean; contend: boolean }>) => {
    let port = portOf(await Effect.runPromise(Effect.scoped(Effect.provide(
      address, NodeHttpServer.layer(createServer, { port: 0, host: "127.0.0.1" })
    ))))
    expect(port).toBeGreaterThan(0)
    for (const cycle of cycles) {
      const options = { port, host: "127.0.0.1" }
      const layer = cycle.config
        ? Layer.provide(
          ExperimentalNodeHttpServer.layerConfig({ port: Config.Port("PORT"), host: Config.succeed(options.host) }),
          ConfigProvider.layer(ConfigProvider.fromUnknown({ PORT: port }))
        )
        : ExperimentalNodeHttpServer.layer(options)
      const actual = await Effect.runPromise(Effect.scoped(Effect.provide(Effect.gen(function*() {
        const bound = yield* address
        expect(portOf(bound)).toBe(port)
        if (cycle.contend) {
          const clash = yield* Effect.exit(Effect.scoped(Layer.build(ExperimentalNodeHttpServer.layer(options))))
          expect(Exit.isFailure(clash)).toBe(true)
        }
        return bound
      }), layer)))
      // Rebinding with Effect itself is the oracle for both forwarded options and scope cleanup.
      const expected = await Effect.runPromise(Effect.scoped(Effect.provide(
        address, NodeHttpServer.layer(createServer, options)
      )))
      expect(actual).toEqual(expected)
      port = portOf(expected)
    }
  }
  await check(corpus.cycles)
  await fc.assert(fc.asyncProperty(fc.array(fc.record({
    config: fc.boolean(),
    contend: fc.boolean()
  }), { minLength: 1, maxLength: 8 }), check), { seed: 73, numRuns: 40 })
}, 30000)
