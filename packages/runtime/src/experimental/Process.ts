/**
 * Facts about the running process and its host, and signals to other
 * processes, as an Effect service.
 *
 * Effect 4.1.0 has no such service: `Stdio` reads the arguments,
 * `ChildProcessSpawner` signals only the children it spawned, through their
 * handles, and nothing reads the process id, the platform or the host name.
 * This module adds it in Effect's style, until Effect ships its own. The
 * user's home directory is Effect's: `UserDirectories.home` in
 * `effect/persistence/UserDirectories`.
 *
 * Every fact is an Effect, as `Stdio.args` is, so a test replaces it with
 * {@link layerTest}. `kill` and `isRunning` fail with a `PlatformError`.
 *
 * Layers: `ExperimentalNodeProcess.layer` from `vibelang-runtime/experimental/platform-node`
 * and `ExperimentalBunProcess.layer` from `vibelang-runtime/experimental/platform-bun`,
 * also in those modules' `ExperimentalNodeServices.layer` and `ExperimentalBunServices.layer`.
 * Browsers and Workers have no process to read, so they have no layer.
 *
 * @experimental
 * @since 0.0.11
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PlatformError from "effect/PlatformError"
import type { Signal } from "effect/process/ChildProcess"
import type { ProcessId } from "effect/process/ChildProcessSpawner"

/**
 * @category type ids
 * @since 0.0.11
 */
export type TypeId = "~vibelang/experimental/Process"

/**
 * @category type ids
 * @since 0.0.11
 */
export const TypeId: TypeId = "~vibelang/experimental/Process"

/**
 * The operating system a process runs on, as Node.js names it.
 *
 * @category models
 * @since 0.0.11
 */
export type Platform =
  | "aix"
  | "android"
  | "cygwin"
  | "darwin"
  | "freebsd"
  | "haiku"
  | "linux"
  | "netbsd"
  | "openbsd"
  | "sunos"
  | "win32"

/**
 * A process's memory use in bytes, as Node.js reports it.
 *
 * @category models
 * @since 0.0.11
 */
export interface MemoryUsage {
  /** Resident set size: the memory the process holds in RAM. */
  readonly rss: number
  /** The JavaScript heap's size. */
  readonly heapTotal: number
  /** The part of the JavaScript heap in use. */
  readonly heapUsed: number
  /** Memory held by objects outside the JavaScript heap. */
  readonly external: number
  /** Memory held by `ArrayBuffer`s and `SharedArrayBuffer`s, part of `external`. */
  readonly arrayBuffers: number
}

/**
 * How {@link Process.kill} signals a process.
 *
 * @category options
 * @since 0.0.11
 */
export interface KillOptions {
  /** The signal to send. Defaults to `"SIGTERM"`, as `ChildProcess.KillOptions` does. */
  readonly killSignal?: Signal | undefined
  /**
   * Signals every process in the process group whose id is `pid` instead of
   * the one process. POSIX only: a `BadArgument` on Windows.
   */
  readonly group?: boolean | undefined
}

/**
 * How {@link Process.isRunning} looks for a process.
 *
 * @category options
 * @since 0.0.11
 */
export interface IsRunningOptions {
  /**
   * Looks for any process in the process group whose id is `pid`. POSIX
   * only: a `BadArgument` on Windows.
   */
  readonly group?: boolean | undefined
}

/**
 * The running process and its host.
 *
 * @category models
 * @since 0.0.11
 */
export interface Process {
  readonly [TypeId]: TypeId
  /** This process's id. */
  readonly pid: Effect.Effect<ProcessId>
  /** The operating system. */
  readonly platform: Effect.Effect<Platform>
  /** The CPU architecture the runtime was built for: `"x64"`, `"arm64"`, ... */
  readonly arch: Effect.Effect<string>
  /** The absolute path of the runtime's executable: `node` or `bun`. */
  readonly execPath: Effect.Effect<string>
  /** The versions of the runtime and its components, by name: `{ node: "26.5.0", v8: ... }`. */
  readonly versions: Effect.Effect<Readonly<Record<string, string>>>
  /** The host's name. */
  readonly hostname: Effect.Effect<string>
  /** How many tasks the host can run in parallel: at least 1. */
  readonly availableParallelism: Effect.Effect<number>
  /** When this process started, in milliseconds since the Unix epoch, with a fraction: `performance.timeOrigin`. */
  readonly timeOrigin: Effect.Effect<number>
  /** This process's memory use now. */
  readonly memoryUsage: Effect.Effect<MemoryUsage>
  /**
   * Sends a signal to the process `pid`, or to its process group with
   * `group`. Fails with a `SystemError` `NotFound` when no such process
   * exists, `PermissionDenied` when this process may not signal it, and a
   * `BadArgument` when `pid` is not a positive integer or the platform has
   * no such signal.
   */
  readonly kill: (pid: number, options?: KillOptions) => Effect.Effect<void, PlatformError.PlatformError>
  /**
   * Whether the process `pid`, or any process of its group with `group`,
   * exists: signal 0. A process this one may not signal still exists, and a
   * child that has exited but that its parent has not yet reaped is still
   * running. Fails with a `BadArgument` when `pid` is not a positive integer.
   */
  readonly isRunning: (pid: number, options?: IsRunningOptions) => Effect.Effect<boolean, PlatformError.PlatformError>
}

/**
 * The service key.
 *
 * @category services
 * @since 0.0.11
 */
export const Process: Context.Service<Process, Process> = /* @__PURE__ */ Context.Service<Process>(
  "vibelang/experimental/Process"
)

/**
 * Builds the service from its members.
 *
 * @category constructors
 * @since 0.0.11
 */
export const make = (impl: Omit<Process, TypeId>): Process => ({ [TypeId]: TypeId, ...impl })

/**
 * Provides fixed facts and a host with no other process, for tests. Pass the
 * members a test needs: `layerTest({ platform: Effect.succeed("win32") })`.
 * Without them, `pid` is 1, `platform` is `"linux"`, `isRunning` answers
 * `false` and `kill` fails with `NotFound`.
 *
 * @category layers
 * @since 0.0.11
 */
export const layerTest = (impl: Partial<Omit<Process, TypeId>> = {}): Layer.Layer<Process> =>
  Layer.succeed(
    Process,
    make({
      pid: Effect.succeed(1 as ProcessId),
      platform: Effect.succeed("linux"),
      arch: Effect.succeed("x64"),
      execPath: Effect.succeed("/usr/local/bin/node"),
      versions: Effect.succeed({}),
      hostname: Effect.succeed("localhost"),
      availableParallelism: Effect.succeed(1),
      timeOrigin: Effect.succeed(0),
      memoryUsage: Effect.succeed({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
      kill: (pid) =>
        Effect.fail(
          PlatformError.systemError({ _tag: "NotFound", module: "Process", method: "kill", pathOrDescriptor: pid })
        ),
      isRunning: () => Effect.succeed(false),
      ...impl
    })
  )
