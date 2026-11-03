/**
 * `@effect/platform-node`'s HTTP server with its default constructor.
 *
 * `NodeHttpServer.layer` takes `http.createServer`, and a `.vibe` file does not
 * import `node:http` as a value. These layers are Effect's, with that argument
 * supplied. A server that needs its own `createServer` options belongs in a
 * `.ts` file, which calls `NodeHttpServer.layer` itself.
 *
 * @experimental
 * @since 0.0.11
 */
import type * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"
import type * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { createServer } from "node:http"

/**
 * What `NodeHttpServer.layer` takes after `createServer`: the listen options and
 * Effect's shutdown options.
 *
 * @category models
 * @since 0.0.11
 */
export type Options = Parameters<typeof NodeHttpServer.layer>[1]

// `@effect/platform-node/NodeHttpServer` brings Effect's http stack and ws, about
// 180 modules. The barrel of this directory re-exports every module, so a
// program that imports it for another service, such as a Vite build whose
// plugin provides ExperimentalNodeProcess, would load them too (foldkit-147).
// The module loads when a layer is built instead.
const server = Effect.promise(() => import("@effect/platform-node/NodeHttpServer"))

/**
 * `NodeHttpServer.layer(createServer, options)`: listens on `options`, and
 * closes the server when the layer's scope closes. Port 0 picks a free port.
 *
 * @category layers
 * @since 0.0.11
 */
export const layer = (options: Options): ReturnType<typeof NodeHttpServer.layer> =>
  Layer.unwrap(Effect.map(server, (module) => module.layer(createServer, options)))

/**
 * `NodeHttpServer.layerConfig(createServer, options)`: reads the listen options
 * from `Config`, such as `{ port: Config.Port("PORT") }`.
 *
 * @category layers
 * @since 0.0.11
 */
export const layerConfig = (options: Config.Wrap<Options>): ReturnType<typeof NodeHttpServer.layerConfig> =>
  Layer.unwrap(Effect.map(server, (module) => module.layerConfig(createServer, options)))
