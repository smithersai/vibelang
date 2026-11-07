import { Effect, FileSystem, Layer, Path } from "effect"

const layer = Layer.mergeAll(FileSystem.layerNoop({}), Path.layer)

export const main = () => Effect.provide(Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  return { exists: typeof fs.exists, joined: path.join("a", "b") }
}), layer)

// Yielding the namespace type-checks only through a cast, and dies at run time.
export const namespaces = [FileSystem, Path].map((namespace) =>
  Effect.provide(Effect.gen(function* () { return yield* (namespace as unknown as Effect.Effect<unknown>) }), layer))
