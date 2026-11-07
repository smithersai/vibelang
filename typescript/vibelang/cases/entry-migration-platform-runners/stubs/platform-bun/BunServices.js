import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"

// Effect's POSIX Path, and a FileSystem whose readFileString says which layer
// read the file. The case uses no other service of the bundle.
export const layer = Layer.mergeAll(
  Path.layer,
  FileSystem.layerNoop({ readFileString: (file) => Effect.succeed(`${file} read through BunServices.layer`) })
)
