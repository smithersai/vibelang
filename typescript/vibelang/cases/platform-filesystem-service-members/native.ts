import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"

export const fixed = FileSystem.makeNoop({
  readFileString: (path) => Effect.succeed("read:" + path)
})
export const expected = Effect.provide(Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  return yield* fileSystem.readFileString("fixture")
}), Layer.succeed(FileSystem.FileSystem, fixed))
