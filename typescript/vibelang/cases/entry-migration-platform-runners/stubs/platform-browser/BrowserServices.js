import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"

// A FileSystem whose readFileString says which layer read the file.
export const layer = Layer.mergeAll(
  Path.layer,
  FileSystem.layerNoop({ readFileString: (file) => Effect.succeed(`${file} read through BrowserServices.layer`) })
)
