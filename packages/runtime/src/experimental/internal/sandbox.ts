/**
 * The machine seam of `Experimental.Sandbox` (VIP-67), and the platform
 * services derived from it: a `ChildProcessSpawner`, a `FileSystem` and a
 * `Path` that act on the machine a provider holds. Ported from the
 * reference engine's `RemoteChildProcessSpawner.layer`, `Sandbox.layerHost`
 * and `Sandbox.fileSystem`.
 *
 * A provider adapts its SDK to one of two seams:
 *
 * - a command runner, {@link commandMachine}: something that runs one
 *   `/bin/sh` script with whole standard input. Every other operation,
 *   files included, is derived from it;
 * - a full machine, {@link Machine}: spawn, and optionally its own files.
 *
 * @internal
 */
import * as ByteSize from "effect/ByteSize"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as PlatformError from "effect/PlatformError"
import * as Redacted from "effect/Redacted"
import * as Result from "effect/Result"
import type * as Scope from "effect/Scope"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"
import type * as ChildProcess from "effect/process/ChildProcess"
import {
  ChildProcessSpawner,
  ExitCode,
  make as makeSpawner,
  makeHandle,
  ProcessId
} from "effect/process/ChildProcessSpawner"
import type { ChildProcessHandle } from "effect/process/ChildProcessSpawner"
import * as CommandLine from "effect/process/CommandLine"

/**
 * Why a machine failed: `unavailable` when it cannot be reached or opened,
 * `spawn_error` when a command could not start, `not_found` for a missing
 * image, pod or program, `timeout`, `aborted`, `cleanup` when its teardown
 * failed, `unhealthy` when supervision retired it, and `unknown`.
 */
export type SandboxErrorCode =
  | "aborted"
  | "timeout"
  | "unavailable"
  | "not_found"
  | "spawn_error"
  | "cleanup"
  | "unhealthy"
  | "unknown"

export class SandboxError extends Data.TaggedError("SandboxError")<{
  readonly code: SandboxErrorCode
  readonly provider: string
  readonly reason: string
  readonly cause?: unknown
}> {
  override get message(): string {
    return `sandbox ${this.provider}: ${this.code}: ${this.reason}`
  }
}

/** One command on the machine. */
export interface RemoteProcess {
  readonly stdout: Stream.Stream<Uint8Array, SandboxError>
  readonly stderr: Stream.Stream<Uint8Array, SandboxError>
  readonly exitCode: Effect.Effect<number, SandboxError>
}

export interface SpawnOptions {
  /** An absolute guest path. */
  readonly cwd: string
  /** The variables the caller declared. The machine adds only the kept ambient ones. */
  readonly env: Readonly<Record<string, string>>
  /** Standard input, delivered whole. */
  readonly stdin?: Uint8Array | undefined
}

/** A machine a provider holds for the life of a scope. */
export interface Machine {
  /** The provider's name, for messages. */
  readonly provider: string
  /** The machine's own id: a container id, a pod name, a directory. */
  readonly id: string
  /** The absolute guest directory relative paths resolve against. */
  readonly workdir: string
  /** Runs `command`, a POSIX shell command line, on the machine. */
  readonly spawn: (command: string, options: SpawnOptions) => Effect.Effect<RemoteProcess, SandboxError, Scope.Scope>
  /** The machine's own file system, when it has one. Otherwise one is derived from `spawn`. */
  readonly files?: FileSystem.FileSystem | undefined
}

/**
 * The ambient variables a child keeps (VIP-67 rule 3), with what the caller
 * declares. Everything else in the machine's environment is dropped.
 */
export const keptVariables: ReadonlyArray<string> = [
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "TERM",
  "TMPDIR",
  "SHELL",
  "LC_ALL",
  "LC_CTYPE",
  "LC_COLLATE",
  "LC_MESSAGES",
  "LC_MONETARY",
  "LC_NUMERIC",
  "LC_TIME"
]

/** Variables a POSIX shell sets for itself, whatever its environment. */
export const shellVariables: ReadonlyArray<string> = ["PWD", "OLDPWD", "SHLVL", "_"]

export const quote = (word: string): string => {
  if (word !== "" && /^[A-Za-z0-9_@%+=:,./-]+$/.test(word)) return word
  return `'${word.replaceAll("'", `'\\''`)}'`
}

/** The script a command runner gets for one command: its directory, its environment, and the command. */
export const script = (command: string, options: SpawnOptions): string => {
  const kept = keptVariables.map((name) => `\${${name}+${name}="\$${name}"}`).join(" ")
  const declared = Object.entries(options.env).map(([name, value]) => quote(`${name}=${value}`)).join(" ")
  return `cd -- ${quote(options.cwd)} || exit 127\nexec env -i ${kept}${declared === "" ? "" : ` ${declared}`} /bin/sh -c ${
    quote(command)
  }`
}

/** A process from a host child, for a command runner over the host's spawner. */
export const fromHandle = (provider: string, handle: ChildProcessHandle): RemoteProcess => {
  const failed = (reason: string) => (cause: unknown) => new SandboxError({ code: "unknown", provider, reason, cause })
  return {
    stdout: Stream.mapError(handle.stdout, failed("the command's standard output broke off")),
    stderr: Stream.mapError(handle.stderr, failed("the command's standard error broke off")),
    exitCode: Effect.mapError(Effect.map(handle.exitCode, Number), failed("the command's exit could not be read"))
  }
}

/**
 * A machine over a command runner: `run` executes one `/bin/sh` script on
 * the machine with whole standard input.
 */
export const commandMachine = (options: {
  readonly provider: string
  readonly id: string
  readonly workdir: string
  readonly run: (script: string, stdin: Uint8Array | undefined) => Effect.Effect<RemoteProcess, SandboxError, Scope.Scope>
}): Machine => ({
  provider: options.provider,
  id: options.id,
  workdir: options.workdir,
  spawn: (command, spawn) => options.run(script(command, spawn), spawn.stdin)
})

// ---------------------------------------------------------------------------
// Paths

const posix = (): Path.Path => Effect.runSync(Effect.provide(Effect.service(Path.Path), Path.layer))

/** `path` resolved against `workdir`, in the guest's POSIX dialect. */
export const resolveIn = (workdir: string) => {
  const base = posix()
  return (path: string): string => {
    const joined = path.startsWith("/") ? path : `${workdir.replace(/\/+$/, "")}/${path}`
    const normal = base.normalize(joined)
    return normal.length > 1 && normal.endsWith("/") ? normal.slice(0, -1) : normal
  }
}

/** A `Path` whose `resolve` starts at the machine's directory. */
export const guestPath = (workdir: string): Path.Path => {
  const base = posix()
  const resolve = (...segments: ReadonlyArray<string>) =>
    segments.reduce((path, segment) => resolveIn(path)(segment), resolveIn(workdir)("."))
  return {
    ...base,
    resolve,
    relative: (from, to) => base.relative(resolve(from), resolve(to)),
    toFileUrl: (path) => base.toFileUrl(resolve(path))
  }
}

// ---------------------------------------------------------------------------
// The spawner

const MODULE = "ChildProcess"

const reasonTag: Record<SandboxErrorCode, PlatformError.SystemErrorTag> = {
  aborted: "Unknown",
  timeout: "TimedOut",
  unavailable: "Unknown",
  not_found: "NotFound",
  spawn_error: "Unknown",
  cleanup: "Unknown",
  unhealthy: "Unknown",
  unknown: "Unknown"
}

export const platformFailure = (module: string, method: string, subject: string) => (error: SandboxError) =>
  PlatformError.systemError({
    _tag: reasonTag[error.code],
    module,
    method,
    description: `${subject}: ${error.message}`,
    cause: error
  })

const rejected = (method: string, description: string): PlatformError.PlatformError =>
  PlatformError.badArgument({ module: MODULE, method, description })

const unwrap = (word: CommandLine.Word): string => Redacted.isRedacted(word) ? Redacted.value(word) : word

const standardParts = (command: ChildProcess.Command): ReadonlyArray<ChildProcess.StandardCommand> =>
  command._tag === "StandardCommand" ? [command] : [...standardParts(command.left), ...standardParts(command.right)]

const stdinStream = (options: ChildProcess.CommandOptions): Stream.Stream<Uint8Array, unknown> | undefined => {
  const stdin = options.stdin
  if (stdin === undefined || typeof stdin === "string") return undefined
  if (Stream.isStream(stdin)) return stdin
  return Stream.isStream(stdin.stream) ? stdin.stream : undefined
}

const stdinMode = (options: ChildProcess.CommandOptions): string | undefined => {
  const stdin = options.stdin
  if (typeof stdin === "string") return stdin
  if (stdin !== undefined && !Stream.isStream(stdin) && typeof stdin.stream === "string") return stdin.stream
  return undefined
}

const variableName = /^[A-Za-z_][A-Za-z0-9_]*$/

const declaredEnv = (
  options: ChildProcess.CommandOptions
): Result.Result<Record<string, string>, PlatformError.PlatformError> => {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) continue
    if (!variableName.test(name)) return Result.fail(rejected("spawn", `a sandbox cannot set the variable ${JSON.stringify(name)}`))
    env[name] = unwrap(value)
  }
  return Result.succeed(env)
}

interface Planned {
  readonly line: string
  readonly cwd: string | undefined
  readonly env: Record<string, string>
  readonly input: Stream.Stream<Uint8Array, unknown> | undefined
  readonly last: ChildProcess.CommandOptions
}

/**
 * The one command line a command becomes, or the `BadArgument` that says
 * why it cannot run on a machine (VIP-67 rule 4).
 */
export const plan = (command: ChildProcess.Command): Result.Result<Planned, PlatformError.PlatformError> => {
  const pipes: Array<ChildProcess.PipeOptions> = []
  const collect = (node: ChildProcess.Command) => {
    if (node._tag === "PipedCommand") {
      pipes.push(node.options)
      collect(node.left)
      collect(node.right)
    }
  }
  collect(command)
  for (const pipe of pipes) {
    if (pipe.from !== undefined && pipe.from !== "stdout") {
      return Result.fail(rejected("spawn", `a sandbox cannot pipe from ${pipe.from}`))
    }
    if (pipe.to !== undefined && pipe.to !== "stdin") return Result.fail(rejected("spawn", `a sandbox cannot pipe to ${pipe.to}`))
  }
  const parts = standardParts(command)
  const first = parts[0]!
  const words: Array<string> = []
  let cwd: string | undefined
  let env: Record<string, string> | undefined
  for (const [index, part] of parts.entries()) {
    const options = part.options
    if (options.additionalFds !== undefined && Object.keys(options.additionalFds).length > 0) {
      return Result.fail(rejected("spawn", "a sandbox cannot configure additional file descriptors"))
    }
    if (typeof options.shell === "string") {
      return Result.fail(rejected("spawn", `a sandbox runs /bin/sh and cannot select the shell ${options.shell}`))
    }
    if (options.detached === true) {
      return Result.fail(rejected("spawn", "a sandbox cannot detach a command; use Sandbox.job for work that outlives its caller"))
    }
    // A later stage reads the pipe, so only the first stage's input can be inherited.
    if (index === 0 && stdinMode(options) === "inherit") {
      return Result.fail(rejected("spawn", "a sandbox cannot inherit this process's standard input"))
    }
    if (index > 0 && stdinStream(options) !== undefined) {
      return Result.fail(rejected("spawn", "a sandbox feeds standard input to the first command of a pipeline only"))
    }
    const declared = declaredEnv(options)
    if (Result.isFailure(declared)) return Result.fail(declared.failure)
    if (index === 0) {
      cwd = options.cwd
      env = declared.success
    } else if (options.cwd !== cwd || JSON.stringify(declared.success) !== JSON.stringify(env)) {
      return Result.fail(rejected("spawn", "a sandbox runs a pipeline in one directory with one environment"))
    }
    if (options.shell === true) {
      words.push([part.command, ...part.args.map(unwrap)].join(" "))
      continue
    }
    const joined = CommandLine.join([part.command, ...part.args])
    if (Result.isFailure(joined)) return Result.fail(rejected("spawn", "the command line cannot be quoted for /bin/sh"))
    words.push(joined.success)
  }
  return Result.succeed({
    line: words.join(" | "),
    cwd,
    env: env ?? {},
    input: stdinStream(first.options),
    last: parts[parts.length - 1]!.options
  })
}

export const maxStdinBytes = 16 * 1024 * 1024

const collectStdin = (stream: Stream.Stream<Uint8Array, unknown>): Effect.Effect<Uint8Array, PlatformError.PlatformError> =>
  Effect.suspend(() => {
    const chunks: Array<Uint8Array> = []
    let length = 0
    return Stream.runForEach(
      Stream.mapError(stream, (cause) =>
        PlatformError.systemError({
          _tag: "Unknown",
          module: MODULE,
          method: "spawn",
          description: "the standard input could not be read, so the command was not started",
          cause
        })),
      (part) =>
        Effect.suspend(() => {
          if (length + part.length > maxStdinBytes) {
            return Effect.fail(rejected("spawn", `standard input over ${maxStdinBytes} bytes is refused before the spawn`))
          }
          chunks.push(new Uint8Array(part))
          length += part.length
          return Effect.void
        })
    ).pipe(Effect.map(() => concat(chunks)))
  })

export const concat = (parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  let length = 0
  for (const part of parts) length += part.length
  const joined = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    joined.set(part, offset)
    offset += part.length
  }
  return joined
}

const outputStream = (
  stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
  option: ChildProcess.CommandOptions["stdout"]
): Stream.Stream<Uint8Array, PlatformError.PlatformError> => {
  const handling = option === undefined || typeof option === "string" || Sink.isSink(option) ? option : option.stream
  if (handling === undefined || handling === "pipe" || handling === "overlapped") return stream
  if (Sink.isSink(handling)) return Stream.transduce(stream, handling)
  return Stream.empty
}

/** A `ChildProcessSpawner` whose every command runs on `machine`. */
export const spawnerOf = (machine: Machine): ChildProcessSpawner["Service"] => {
  let nextPid = 1
  const resolve = resolveIn(machine.workdir)
  return makeSpawner(Effect.fnUntraced(function*(command: ChildProcess.Command) {
    const planned = plan(command)
    if (Result.isFailure(planned)) return yield* Effect.fail(planned.failure)
    const { line, cwd, env, input, last } = planned.success
    const stdin = input === undefined ? undefined : yield* collectStdin(input)
    const started = yield* machine.spawn(line, { cwd: resolve(cwd ?? "."), env, stdin }).pipe(
      Effect.mapError(platformFailure(MODULE, "spawn", "the command could not start"))
    )
    let running = true
    const completed = yield* Deferred.make<ExitCode, PlatformError.PlatformError>()
    yield* Effect.forkScoped(Deferred.into(
      started.exitCode.pipe(
        Effect.map((code) => ExitCode(code)),
        Effect.mapError(platformFailure(MODULE, "exitCode", "the command's exit could not be read")),
        Effect.ensuring(Effect.sync(() => {
          running = false
        }))
      ),
      completed
    ))
    const stdout = outputStream(
      Stream.mapError(started.stdout, platformFailure(MODULE, "stdout", "standard output")),
      last.stdout
    )
    const stderr = outputStream(
      Stream.mapError(started.stderr, platformFailure(MODULE, "stderr", "standard error")),
      last.stderr
    )
    return makeHandle({
      pid: ProcessId(nextPid++),
      exitCode: Deferred.await(completed),
      isRunning: Effect.sync(() => running),
      kill: () => Effect.fail(rejected("kill", "a sandbox ends a command by closing its scope")),
      stdin: Sink.fail(rejected("stdin", "a sandbox takes standard input whole, as the command's stdin option")),
      stdout,
      stderr,
      all: Stream.merge(stdout, stderr),
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty,
      unref: Effect.succeed(Effect.void)
    })
  }))
}

// ---------------------------------------------------------------------------
// The file system

const decoder = new TextDecoder()
const encoder = new TextEncoder()

const absentExit = 9
const alreadyExistsExit = 10
const badResourceExit = 11

interface Probe {
  readonly code: number
  readonly stdout: Uint8Array
  readonly stderr: string
}

const emptyInfo = {
  mtime: Option.none<Date>(),
  atime: Option.none<Date>(),
  birthtime: Option.none<Date>(),
  dev: 0,
  ino: Option.none<number>(),
  mode: 0,
  nlink: Option.none<number>(),
  uid: Option.none<number>(),
  gid: Option.none<number>(),
  rdev: Option.none<number>(),
  blksize: Option.none<ByteSize.ByteSize>(),
  blocks: Option.none<number>()
}

const fileTypes: Record<string, FileSystem.File.Info["type"]> = {
  Directory: "Directory",
  File: "File",
  SymbolicLink: "SymbolicLink",
  Unknown: "Unknown"
}

/**
 * A `FileSystem` for `machine`: its own, or one derived from `spawn` with
 * POSIX `sh` commands. Relative paths resolve against the machine's
 * directory.
 */
export const fileSystemOf = (machine: Machine): FileSystem.FileSystem => {
  if (machine.files !== undefined) return machine.files
  const resolve = resolveIn(machine.workdir)
  const refused = (tag: PlatformError.SystemErrorTag, method: string, path: string, description: string) =>
    PlatformError.systemError({ _tag: tag, module: "FileSystem", method, description, pathOrDescriptor: path })
  const notFound = (method: string, path: string) =>
    refused("NotFound", method, path, `${path} does not exist in the sandbox`)
  const failed = (method: string, path: string, result: Probe) =>
    refused(
      /denied/i.test(result.stderr) ? "PermissionDenied" : "Unknown",
      method,
      path,
      `${path}: ${result.stderr.trim() === "" ? `the probe exited ${result.code}` : result.stderr.trim().slice(0, 512)}`
    )
  const probe = (method: string, path: string, command: string, stdin?: Uint8Array) =>
    Effect.scoped(Effect.gen(function*() {
      const process = yield* machine.spawn(command, { cwd: machine.workdir, env: {}, stdin })
      const [stdout, stderr, code] = yield* Effect.all([
        Stream.runCollect(process.stdout).pipe(Effect.map((chunks) => concat(Array.from(chunks)))),
        Stream.mkString(Stream.decodeText(process.stderr)),
        process.exitCode
      ], { concurrency: "unbounded" })
      return { code, stdout, stderr } satisfies Probe
    })).pipe(Effect.mapError(platformFailure("FileSystem", method, path)))
  const unsupported = (method: string) => (path: string) =>
    Effect.fail(PlatformError.badArgument({ module: "FileSystem", method, description: `${path}: ${method} is not supported in a sandbox` }))
  const simple = (method: string, path: string, command: string) =>
    Effect.flatMap(probe(method, path, command), (result) =>
      result.code === 0
        ? Effect.void
        : result.code === absentExit
        ? Effect.fail(notFound(method, path))
        : result.code === alreadyExistsExit
        ? Effect.fail(refused("AlreadyExists", method, path, `${path} already exists in the sandbox`))
        : Effect.fail(failed(method, path, result)))
  const stat = (raw: string) =>
    Effect.gen(function*() {
      const path = resolve(raw)
      const target = quote(path)
      const result = yield* probe(
        "stat",
        path,
        `if [ -d ${target} ]; then t=Directory; elif [ -f ${target} ]; then t=File; ` +
          `elif [ -h ${target} ]; then t=SymbolicLink; elif [ -e ${target} ]; then t=Unknown; ` +
          `else exit ${absentExit}; fi; s=0; if [ "$t" = File ]; then s=$(wc -c < ${target} | tr -d ' ') || exit 1; fi; ` +
          `printf '%s %s' "$t" "$s"`
      )
      if (result.code === absentExit) return yield* Effect.fail(notFound("stat", path))
      if (result.code !== 0) return yield* Effect.fail(failed("stat", path, result))
      const [type, size] = decoder.decode(result.stdout).trim().split(/\s+/)
      return {
        ...emptyInfo,
        type: fileTypes[type ?? ""] ?? "Unknown",
        size: ByteSize.bytes(BigInt(/^\d+$/.test(size ?? "") ? size! : "0"))
      } as unknown as FileSystem.File.Info
    })
  const readFile = (raw: string) =>
    Effect.gen(function*() {
      const path = resolve(raw)
      const target = quote(path)
      const result = yield* probe(
        "readFile",
        path,
        `if [ -d ${target} ]; then exit ${badResourceExit}; elif [ ! -e ${target} ]; then exit ${absentExit}; fi; cat -- ${target}`
      )
      if (result.code === absentExit) return yield* Effect.fail(notFound("readFile", path))
      if (result.code === badResourceExit) {
        return yield* Effect.fail(refused("BadResource", "readFile", path, `${path} is a directory in the sandbox`))
      }
      if (result.code !== 0) return yield* Effect.fail(failed("readFile", path, result))
      return result.stdout
    })
  const writeFile = (method: string, raw: string, data: Uint8Array, options?: { readonly flag?: string; readonly mode?: number }) => {
    const path = resolve(raw)
    if ((options?.flag !== undefined && options.flag !== "w" && options.flag !== "a") || options?.mode !== undefined) {
      return Effect.fail(PlatformError.badArgument({ module: "FileSystem", method, description: `${path}: only the w and a flags, and no mode, are supported in a sandbox` }))
    }
    const target = quote(path)
    return Effect.flatMap(
      probe(method, path, `if [ ! -d "$(dirname -- ${target})" ]; then exit ${absentExit}; fi; cat ${options?.flag === "a" ? ">>" : ">"} ${target}`, data),
      (result) =>
        result.code === 0
          ? Effect.void
          : result.code === absentExit
          ? Effect.fail(notFound(method, path))
          : Effect.fail(failed(method, path, result))
    )
  }
  const makeTempDirectory = (options?: { readonly prefix?: string | undefined; readonly directory?: string | undefined }) =>
    Effect.gen(function*() {
      const parent = options?.directory === undefined ? "${TMPDIR:-/tmp}" : quote(resolve(options.directory))
      const prefix = (options?.prefix ?? "vibe").replace(/[^A-Za-z0-9._-]/g, "")
      const result = yield* probe("makeTempDirectory", parent, `mktemp -d "${parent}/${prefix}XXXXXX"`)
      if (result.code !== 0) return yield* Effect.fail(failed("makeTempDirectory", parent, result))
      return decoder.decode(result.stdout).trim()
    })
  return FileSystem.makeNoop({
    access: unsupported("access"),
    chmod: (raw, mode) => simple("chmod", resolve(raw), `chmod ${mode.toString(8)} -- ${quote(resolve(raw))}`),
    chown: unsupported("chown"),
    copy: (from, to) => simple("copy", resolve(from), `cp -R -- ${quote(resolve(from))} ${quote(resolve(to))}`),
    copyFile: (from, to) => simple("copyFile", resolve(from), `cp -- ${quote(resolve(from))} ${quote(resolve(to))}`),
    exists: (raw) =>
      Effect.map(probe("exists", resolve(raw), `[ -e ${quote(resolve(raw))} ] || [ -h ${quote(resolve(raw))} ]`), (result) => result.code === 0),
    link: (from, to) => simple("link", resolve(from), `ln -- ${quote(resolve(from))} ${quote(resolve(to))}`),
    lstat: stat,
    stat,
    makeDirectory: (raw, options) => {
      const path = resolve(raw)
      const target = quote(path)
      return simple(
        "makeDirectory",
        path,
        options?.recursive === true
          ? `if [ -d ${target} ]; then exit 0; elif [ -e ${target} ]; then exit ${alreadyExistsExit}; else mkdir -p -- ${target}; fi`
          : `if [ -e ${target} ] || [ -h ${target} ]; then exit ${alreadyExistsExit}; ` +
            `elif [ ! -d "$(dirname -- ${target})" ]; then exit ${absentExit}; else mkdir -- ${target}; fi`
      )
    },
    makeTempDirectory,
    makeTempDirectoryScoped: (options) =>
      Effect.acquireRelease(makeTempDirectory(options), (path) =>
        Effect.ignore(probe("remove", path, `rm -rf -- ${quote(path)}`))),
    makeTempFile: unsupported("makeTempFile") as never,
    makeTempFileScoped: unsupported("makeTempFileScoped") as never,
    open: unsupported("open") as never,
    readDirectory: (raw, options) =>
      Effect.gen(function*() {
        const path = resolve(raw)
        const target = quote(path)
        const base = path.replace(/\/+$/, "") || "/"
        const prefix = base === "/" ? "/" : `${base}/`
        const result = yield* probe(
          "readDirectory",
          path,
          `if [ -d ${target} ]; then find ${quote(base)} -mindepth 1 ${options?.recursive === true ? "" : "-maxdepth 1 "}-print; ` +
            `elif [ -e ${target} ]; then exit ${badResourceExit}; else exit ${absentExit}; fi`
        )
        if (result.code === absentExit) return yield* Effect.fail(notFound("readDirectory", path))
        if (result.code === badResourceExit) {
          return yield* Effect.fail(refused("BadResource", "readDirectory", path, `${path} is not a directory in the sandbox`))
        }
        if (result.code !== 0) return yield* Effect.fail(failed("readDirectory", path, result))
        return decoder.decode(result.stdout).split("\n").filter((entry) => entry !== "")
          .map((entry) => entry.startsWith(prefix) ? entry.slice(prefix.length) : entry).sort()
      }),
    readFile,
    readFileString: (path) => Effect.map(readFile(path), (bytes) => decoder.decode(bytes)),
    readLink: (raw) =>
      Effect.gen(function*() {
        const path = resolve(raw)
        const result = yield* probe("readLink", path, `readlink -- ${quote(path)}`)
        if (result.code !== 0) return yield* Effect.fail(failed("readLink", path, result))
        return decoder.decode(result.stdout).replace(/\n$/, "")
      }),
    realPath: (raw) =>
      Effect.gen(function*() {
        const path = resolve(raw)
        const target = quote(path)
        const result = yield* probe(
          "realPath",
          path,
          `if [ -d ${target} ]; then cd -P -- ${target} && pwd -P; elif [ -e ${target} ]; then ` +
            `cd -P -- "$(dirname -- ${target})" && printf '%s/%s\\n' "$(pwd -P)" "$(basename -- ${target})"; else exit ${absentExit}; fi`
        )
        if (result.code === absentExit) return yield* Effect.fail(notFound("realPath", path))
        if (result.code !== 0) return yield* Effect.fail(failed("realPath", path, result))
        return decoder.decode(result.stdout).replace(/\n$/, "").replace(/^\/\//, "/")
      }),
    remove: (raw, options) => {
      const path = resolve(raw)
      const target = quote(path)
      const flags = `${options?.recursive === true ? "-r " : ""}${options?.force === true ? "-f " : ""}`
      return simple(
        "remove",
        path,
        options?.force === true
          ? `rm ${flags}-- ${target}`
          : `if [ -e ${target} ] || [ -h ${target} ]; then rm ${flags}-- ${target}; else exit ${absentExit}; fi`
      )
    },
    rename: (from, to) =>
      simple("rename", resolve(from), `if [ ! -e ${quote(resolve(from))} ]; then exit ${absentExit}; fi; mv -- ${quote(resolve(from))} ${quote(resolve(to))}`),
    symlink: (target, to) => simple("symlink", resolve(to), `ln -s -- ${quote(target)} ${quote(resolve(to))}`),
    truncate: unsupported("truncate"),
    utimes: unsupported("utimes"),
    watch: (path) =>
      Stream.fail(PlatformError.badArgument({ module: "FileSystem", method: "watch", description: `${path}: watch is not supported in a sandbox` })),
    writeFile: (path, data, options) => writeFile("writeFile", path, data, options),
    writeFileString: (path, data, options) => writeFile("writeFileString", path, encoder.encode(data), options)
  })
}

export type Host = ChildProcessSpawner | FileSystem.FileSystem | Path.Path

/** The services a machine provides. */
export const hostContext = (machine: Machine): Context.Context<Host> =>
  Context.make(ChildProcessSpawner, spawnerOf(machine)).pipe(
    Context.add(FileSystem.FileSystem, fileSystemOf(machine)),
    Context.add(Path.Path, guestPath(machine.workdir))
  )
