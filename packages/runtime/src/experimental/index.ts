/**
 * The `Experimental` namespace (D313): VibeLang's additions where Effect
 * lacks an API, in Effect's style, until Effect ships it. One module per
 * service, named after the Effect module it extends (`FileSystem`), the
 * Effect 4.0 module it keeps (`Crypto`), or as Effect would name it
 * (`Process`, `Locks`). A `.vibe` file sees the
 * namespace without an import. Each module has its own service key; the
 * layers are in `vibelang-runtime/experimental/platform-node`, `-bun` and
 * `-browser`.
 *
 * @experimental
 * @since 0.0.11
 */
export * as Crypto from "./Crypto.js"
export * as FileSystem from "./FileSystem.js"
export * as Locks from "./Locks.js"
export * as Process from "./Process.js"
