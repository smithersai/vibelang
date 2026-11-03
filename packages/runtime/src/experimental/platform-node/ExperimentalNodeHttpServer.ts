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
import { NodeHttpServer } from "@effect/platform-node"
import type * as Config from "effect/Config"
import { createServer } from "node:http"

/**
 * What `NodeHttpServer.layer` takes after `createServer`: the listen options and
 * Effect's shutdown options.
 *
 * @category models
 * @since 0.0.11
 */
export type Options = Parameters<typeof NodeHttpServer.layer>[1]

/**
 * `NodeHttpServer.layer(createServer, options)`: listens on `options`, and
 * closes the server when the layer's scope closes. Port 0 picks a free port.
 *
 * @category layers
 * @since 0.0.11
 */
export const layer = (options: Options) => NodeHttpServer.layer(createServer, options)

/**
 * `NodeHttpServer.layerConfig(createServer, options)`: reads the listen options
 * from `Config`, such as `{ port: Config.Port("PORT") }`.
 *
 * @category layers
 * @since 0.0.11
 */
export const layerConfig = (options: Config.Wrap<Options>) => NodeHttpServer.layerConfig(createServer, options)
