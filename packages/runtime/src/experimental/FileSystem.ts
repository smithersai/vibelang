/**
 * Experimental: Effect's `FileSystem` service plus `access` with
 * `executable`, `open` with `nonBlocking`, and `File.chmod` (D313). Effect
 * 4.0.6 added `lstat` itself.
 *
 * The service has its own key and identity, and its implementation,
 * `Service`, is a superset of Effect's interface. The
 * layers in `vibelang-runtime/experimental/platform-node` and `-bun` provide
 * it and Effect's `FileSystem` from one implementation: Effect's own, plus the
 * three additions. Browsers have no file system layer, as in Effect. When
 * Effect releases these members, this module re-exports Effect's.
 *
 * @since 0.0.11
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as EffectFileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as PlatformError from "effect/PlatformError"
import type { Scope } from "effect/Scope"

/**
 * An open file: Effect's `FileSystem.File` plus `chmod`.
 *
 * @since 0.0.11
 */
export interface File extends EffectFileSystem.File {
  /**
   * Changes the open file's permissions (`fchmod`). Unlike `chmod` on its
   * path, it changes the file this handle opened even after the path was
   * renamed or replaced.
   */
  readonly chmod: (mode: number) => Effect.Effect<void, PlatformError.PlatformError>
}

/**
 * The implementation: Effect's `FileSystem` plus
 * `access(path, { executable })`, `open(path, { nonBlocking })` and
 * `File.chmod`.
 *
 * @since 0.0.11
 */
export interface Service extends EffectFileSystem.FileSystem {
  /**
   * Checks whether a file can be accessed. `executable` also checks that the
   * caller may run it (`X_OK`); on Windows it checks only that the file
   * exists, as Node's `X_OK` does.
   */
  readonly access: (
    path: string,
    options?: {
      readonly ok?: boolean | undefined
      readonly readable?: boolean | undefined
      readonly writable?: boolean | undefined
      readonly executable?: boolean | undefined
    }
  ) => Effect.Effect<void, PlatformError.PlatformError>
  /**
   * Opens a file, closed when the scope closes. `nonBlocking` opens it with
   * `O_NONBLOCK`, so opening a FIFO or a device returns at once instead of
   * waiting for the other end; with `noFollow`, it opens a path that another
   * process may replace without following a link or hanging on a FIFO.
   * Platforms without `O_NONBLOCK`, including Windows, fail with
   * `BadArgument`, as `noFollow` does.
   */
  readonly open: (
    path: string,
    options?: {
      readonly flag?: EffectFileSystem.OpenFlag | undefined
      readonly mode?: number | undefined
      readonly noFollow?: boolean | undefined
      readonly nonBlocking?: boolean | undefined
    }
  ) => Effect.Effect<File, PlatformError.PlatformError, Scope>
}

/**
 * The service key, declared as Effect declares a class service: the type
 * `FileSystem` is the requirement, whose identity is its key, distinct from
 * Effect's `FileSystem.FileSystem`, and `Service` is the implementation.
 * `Service` extends Effect's interface and `FileSystem` does not, so a layer
 * of Effect's `FileSystem` never satisfies a requirement for this one.
 *
 * @since 0.0.11
 */
export class FileSystem
  extends /* @__PURE__ */ Context.Service<FileSystem, Service>()("vibelang/experimental/FileSystem")
{}

/**
 * Extends an Effect `FileSystem` with a platform's implementation of the
 * experimental members. Every other member stays the given service's.
 *
 * @since 0.0.11
 */
export const make = (
  fileSystem: EffectFileSystem.FileSystem,
  impl: Pick<Service, "access" | "open">
): Service => FileSystem.of({ ...fileSystem, ...impl })

const notFound = (method: string, path: string) =>
  PlatformError.systemError({
    module: "FileSystem",
    method,
    _tag: "NotFound",
    description: "No such file or directory",
    pathOrDescriptor: path
  })

/**
 * A stub for tests: Effect's `FileSystem.makeNoop`, with `open` failing with
 * `NotFound` unless given, as it does there.
 *
 * @since 0.0.11
 */
export const makeNoop = (fileSystem: Partial<Service>): Service => {
  const { open, ...rest } = fileSystem
  const noop = EffectFileSystem.makeNoop(rest)
  return make(noop, {
    access: noop.access,
    open: open ?? ((path) => Effect.fail(notFound("open", path)))
  })
}

/**
 * A layer of `makeNoop` that provides this service and Effect's
 * `FileSystem` from the same stub.
 *
 * @since 0.0.11
 */
export const layerNoop = (
  fileSystem: Partial<Service>
): Layer.Layer<FileSystem | EffectFileSystem.FileSystem> => {
  const noop = makeNoop(fileSystem)
  return Layer.mergeAll(Layer.succeed(FileSystem, noop), Layer.succeed(EffectFileSystem.FileSystem, noop))
}
