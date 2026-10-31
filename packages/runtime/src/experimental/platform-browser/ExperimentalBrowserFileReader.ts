/**
 * The experimental `FileReader` service for browsers, over a host `FileReader`.
 *
 * @experimental
 * @since 0.0.11
 */
import * as Layer from "effect/Layer"
import * as FileReader from "../FileReader.js"

const makeReader = (): FileReader.FileReaderLike => {
  const host = globalThis as unknown as { readonly FileReader?: new() => FileReader.FileReaderLike }
  if (typeof host.FileReader !== "function") {
    throw new Error("The FileReader service needs window.FileReader: a browser page or worker")
  }
  return new host.FileReader()
}

/**
 * Reads the host when a member runs, never when this module is imported or the
 * layer is built. A member that runs on a host without `FileReader` is a
 * defect.
 *
 * @category layers
 * @since 0.0.11
 */
export const layer: Layer.Layer<FileReader.FileReader> = Layer.succeed(FileReader.FileReader, FileReader.make({ makeReader }))
