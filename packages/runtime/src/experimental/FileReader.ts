/**
 * Reading a browser `Blob` or `File` as an Effect service.
 *
 * Each member reads the whole value once. Interrupting a read aborts it. A
 * read that fails while reading, the reader's `error` event, fails with a
 * `PlatformError` whose reason is a `SystemError`; a read the host refuses to
 * start, a call that throws, fails with one whose reason is `BadArgument`. Both
 * keep the host's value as `cause`, and its message as `description`.
 *
 * A load event with the wrong result type fails with InvalidData, distinct
 * from either host failure even when its cause and message are reused.
 *
 * Effect 4.1.0 has no service for `FileReader`. Effect's `FileSystem` reads
 * paths, and a browser `File` has none.
 *
 * Layers: `ExperimentalBrowserFileReader.layer` from
 * `vibelang-runtime/experimental/platform-browser`, also in its
 * `ExperimentalBrowserServices.layer`.
 *
 * @experimental
 * @since 0.0.11
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Base64 from "effect/encoding/Base64"
import * as Layer from "effect/Layer"
import * as PlatformError from "effect/PlatformError"

/**
 * @category type ids
 * @since 0.0.11
 */
export type TypeId = "~vibelang/experimental/FileReader"

/**
 * @category type ids
 * @since 0.0.11
 */
export const TypeId: TypeId = "~vibelang/experimental/FileReader"

/**
 * The slice of a host `FileReader` this service uses.
 *
 * @category models
 * @since 0.0.11
 */
export interface FileReaderLike {
  readonly result: string | ArrayBuffer | null
  readonly error: { readonly name?: string | undefined; readonly message: string } | null
  readonly addEventListener: (type: "load" | "error", listener: () => void) => void
  readonly abort: () => void
  readonly readAsText: (blob: Blob) => void
  readonly readAsDataURL: (blob: Blob) => void
  readonly readAsArrayBuffer: (blob: Blob) => void
}

/**
 * The slice of the host this service uses.
 *
 * @category models
 * @since 0.0.11
 */
export interface Host {
  readonly makeReader: () => FileReaderLike
}

/**
 * Reads a `Blob` or a `File`.
 *
 * @category models
 * @since 0.0.11
 */
export interface FileReader {
  readonly [TypeId]: TypeId
  /** The contents as UTF-8 text. */
  readonly readAsText: (blob: Blob) => Effect.Effect<string, PlatformError.PlatformError>
  /** The contents as a base64 `data:` URL. */
  readonly readAsDataUrl: (blob: Blob) => Effect.Effect<string, PlatformError.PlatformError>
  /** The contents as bytes. */
  readonly readAsArrayBuffer: (blob: Blob) => Effect.Effect<ArrayBuffer, PlatformError.PlatformError>
}

/**
 * The service key.
 *
 * @category services
 * @since 0.0.11
 */
export const FileReader: Context.Service<FileReader, FileReader> = /* @__PURE__ */ Context.Service<FileReader>(
  "vibelang/experimental/FileReader"
)

const describe = (cause: unknown): string =>
  typeof cause === "object" && cause !== null && "message" in cause ? String(cause.message) : String(cause)

// The reader's error, from its error event, as a PlatformError.
const failure = (method: string, cause: { readonly name?: string | undefined; readonly message: string } | unknown) => {
  const named = typeof cause === "object" && cause !== null ? (cause as { readonly name?: unknown }).name : undefined
  const description = describe(cause)
  return PlatformError.systemError({
    _tag: named === "NotFoundError"
      ? "NotFound"
      : named === "SecurityError"
      ? "PermissionDenied"
      : named === "NotReadableError"
      ? "BadResource"
      : "Unknown",
    module: "FileReader",
    method,
    description,
    cause
  })
}

/**
 * Builds the service over a host: a real `FileReader`, or a fake in a test.
 *
 * @category constructors
 * @since 0.0.11
 */
export const make = (host: Host): FileReader => {
  const read = <A>(
    method: "readAsText" | "readAsDataURL" | "readAsArrayBuffer",
    extract: (result: string | ArrayBuffer | null) => A | undefined
  ) =>
  (blob: Blob) =>
    Effect.callback<A, PlatformError.PlatformError>((resume, signal) => {
      const reader = host.makeReader()
      reader.addEventListener("load", () => {
        const value = extract(reader.result)
        resume(
          value === undefined
            ? Effect.fail(PlatformError.systemError({ _tag: "InvalidData", module: "FileReader", method, description: `FileReader gave an unexpected result for ${method}`, cause: new Error(`FileReader gave an unexpected result for ${method}`) }))
            : Effect.succeed(value)
        )
      })
      reader.addEventListener("error", () => resume(Effect.fail(failure(method, reader.error))))
      signal.addEventListener("abort", () => reader.abort())
      try {
        reader[method](blob)
      } catch (cause) {
        // The host refused to start the read, as for a value that is not a Blob.
        resume(Effect.fail(PlatformError.badArgument({ module: "FileReader", method, description: describe(cause), cause })))
      }
    })
  const text = (result: string | ArrayBuffer | null) => typeof result === "string" ? result : undefined
  return {
    [TypeId]: TypeId,
    readAsText: read("readAsText", text),
    readAsDataUrl: read("readAsDataURL", text),
    // Not instanceof ArrayBuffer: a page's ArrayBuffer can belong to another realm.
    readAsArrayBuffer: read("readAsArrayBuffer", (result) => typeof result === "object" && result !== null ? result : undefined)
  }
}

// What a host reader gives, from the Blob itself.
const blobRead = <A>(method: string, read: () => Promise<A>) =>
  Effect.tryPromise({ try: read, catch: (cause) => failure(method, cause) })

/**
 * Provides a reader that needs no host `FileReader`, for tests: each member
 * reads the `Blob` itself. Pass the members a test needs, such as one that
 * fails.
 *
 * @category layers
 * @since 0.0.11
 */
export const layerTest = (impl: Partial<Omit<FileReader, TypeId>> = {}): Layer.Layer<FileReader> =>
  Layer.succeed(FileReader, {
    [TypeId]: TypeId,
    readAsText: (blob) => blobRead("readAsText", () => blob.text()),
    readAsDataUrl: (blob) =>
      blobRead("readAsDataURL", async () =>
        `data:${blob.type || "application/octet-stream"};base64,${Base64.encode(new Uint8Array(await blob.arrayBuffer()))}`),
    readAsArrayBuffer: (blob) => blobRead("readAsArrayBuffer", () => blob.arrayBuffer()),
    ...impl
  })
