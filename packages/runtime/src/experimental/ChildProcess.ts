/**
 * Inherited child execution with synchronous, non-waiting cancellation.
 *
 * Effect's `ChildProcessSpawner` owns ordinary commands, pipelines and stdio
 * streams. Its release waits for exit. This capability preserves an inherited,
 * non-detached child's callback contract when cancellation must send one default
 * signal and return immediately, without unreferencing or escalating.
 *
 * Layers: `ExperimentalNodeChildProcess.layer` and
 * `ExperimentalBunChildProcess.layer`, also in their experimental bundles.
 *
 * @experimental
 * @since 0.0.11
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

/**
 * @category type ids
 * @since 0.0.11
 */
export type TypeId = "~vibelang/experimental/ChildProcess"

/**
 * @category type ids
 * @since 0.0.11
 */
export const TypeId: TypeId = "~vibelang/experimental/ChildProcess"

/**
 * The native options this operation supports; stdio always inherits.
 * @category models
 * @since 0.0.11
 */
export interface Options {
  readonly cwd: string
  readonly shell?: boolean | undefined
}

/**
 * The native handle slice used for completion and cancellation.
 * @category models
 * @since 0.0.11
 */
export interface ChildProcessLike {
  readonly exitCode: number | null
  readonly killed: boolean
  readonly on: {
    (event: "error", listener: (error: Error) => void): unknown
    (event: "exit", listener: (code: number | null) => void): unknown
  }
  readonly kill: () => boolean
}

/**
 * The injectable native spawn capability.
 * @category models
 * @since 0.0.11
 */
export interface Host {
  readonly spawn: (
    command: string,
    args: ReadonlyArray<string>,
    options: { readonly cwd: string; readonly shell: boolean; readonly stdio: "inherit" }
  ) => ChildProcessLike
}

/**
 * @category models
 * @since 0.0.11
 */
export interface ChildProcess {
  readonly [TypeId]: TypeId
  /**
   * Starts on execution and returns the exit event's code, or fails with the
   * exact native asynchronous Error. A null code means signal termination.
   * The caller decides how to report a nonzero or nullable status.
   *
   * Interrupting the pending Effect calls the child's argument-free `kill()`
   * once iff `exitCode === null && !killed`. It does not wait, escalate, unref,
   * or signal a process group. Native construction exceptions are defects.
   */
  readonly runInherited: (
    command: string,
    args: ReadonlyArray<string>,
    options: Options
  ) => Effect.Effect<number | null, Error>
}

/**
 * @category services
 * @since 0.0.11
 */
export const ChildProcess: Context.Service<ChildProcess, ChildProcess> = /* @__PURE__ */ Context.Service<ChildProcess>(
  "vibelang/experimental/ChildProcess"
)

/**
 * Builds over a native spawner or a fake, without starting a process.
 * @category constructors
 * @since 0.0.11
 */
export const make = (host: Host): ChildProcess => ({
  [TypeId]: TypeId,
  runInherited: (command, args, options) => Effect.callback<number | null, Error>((resume) => {
    const child = host.spawn(command, [...args], { cwd: options.cwd, shell: options.shell ?? false, stdio: "inherit" })
    child.on("error", error => resume(Effect.fail(error)))
    child.on("exit", code => resume(Effect.succeed(code)))
    return Effect.sync(() => {
      if (child.exitCode === null && !child.killed) child.kill()
    })
  })
})

/**
 * Provides exit0 without a process. Override the operation for a test.
 * @category layers
 * @since 0.0.11
 */
export const layerTest = (impl: Partial<Omit<ChildProcess, TypeId>> = {}): Layer.Layer<ChildProcess> =>
  Layer.succeed(ChildProcess, { [TypeId]: TypeId, runInherited: () => Effect.succeed(0), ...impl })
