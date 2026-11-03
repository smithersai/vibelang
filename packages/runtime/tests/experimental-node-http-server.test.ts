import { expect, test } from "bun:test"
import * as Config from "effect/Config"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { HttpServer } from "effect/http"
import { ExperimentalNodeHttpServer } from "vibelang-runtime/experimental/platform-node"

const address = Effect.map(Effect.service(HttpServer.HttpServer), (server) => server.address)

const portOf = (value: HttpServer.Address) => "port" in value ? value.port : -1

test("ExperimentalNodeHttpServer: layer starts a real server on the given port, and closes with the scope", async () => {
  const found = await Effect.runPromise(Effect.scoped(Effect.provide(address, ExperimentalNodeHttpServer.layer({ port: 0 }))))
  expect(portOf(found)).toBeGreaterThan(0)
  const again = await Effect.runPromise(Effect.scoped(Effect.provide(address, ExperimentalNodeHttpServer.layer({ port: portOf(found) }))))
  expect(portOf(again)).toBe(portOf(found))
})

test("ExperimentalNodeHttpServer: a port in use fails the layer, it does not hang", async () => {
  const clash = Effect.gen(function*() {
    const taken = portOf(yield* address)
    return yield* Effect.exit(Effect.scoped(Layer.build(ExperimentalNodeHttpServer.layer({ port: taken }))))
  })
  const exit = await Effect.runPromise(Effect.scoped(Effect.provide(clash, ExperimentalNodeHttpServer.layer({ port: 0 }))))
  expect(exit._tag).toBe("Failure")
})

test("ExperimentalNodeHttpServer: layerConfig reads the port from Config, and a port Config refuses fails the layer", async () => {
  const layerOn = (PORT: number) =>
    Layer.provide(
      ExperimentalNodeHttpServer.layerConfig({ port: Config.Port("PORT") }),
      ConfigProvider.layer(ConfigProvider.fromUnknown({ PORT }))
    )
  const free = portOf(await Effect.runPromise(Effect.scoped(Effect.provide(address, ExperimentalNodeHttpServer.layer({ port: 0 })))))
  expect(portOf(await Effect.runPromise(Effect.scoped(Effect.provide(address, layerOn(free)))))).toBe(free)
  const refused = await Effect.runPromiseExit(Effect.scoped(Effect.provide(address, layerOn(0))))
  expect(refused._tag).toBe("Failure")
})

test("ExperimentalNodeHttpServer: constructing a layer is cold until Effect builds it", async () => {
  const port = portOf(await Effect.runPromise(Effect.scoped(Effect.provide(
    address, ExperimentalNodeHttpServer.layer({ port: 0, host: "127.0.0.1" })
  ))))
  const pending = ExperimentalNodeHttpServer.layer({ port, host: "127.0.0.1" })
  // If constructing pending bound the port, this competing scoped server would fail.
  expect(portOf(await Effect.runPromise(Effect.scoped(Effect.provide(
    address, ExperimentalNodeHttpServer.layer({ port, host: "127.0.0.1" })
  ))))).toBe(port)
  expect(portOf(await Effect.runPromise(Effect.scoped(Effect.provide(address, pending))))).toBe(port)
})
