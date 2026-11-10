/**
 * The deterministic machine behind `Experimental.Test.host`: an in-memory
 * file system and a scripted process spawner. Nothing here reaches the
 * operating system.
 *
 * @internal
 */
import * as ByteSize from "effect/ByteSize"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as PlatformError from "effect/PlatformError"
import * as Redacted from "effect/Redacted"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"
import type { ChildProcess } from "effect/process"
import { ChildProcessSpawner } from "effect/process"

/** POSIX-normalize so `/a/b`, `/a/b/` and `/a/./b` are one key; a relative path starts at `/`. */
export const normalize = (path: string): string => {
  const parts: Array<string> = []
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue
    if (part === "..") parts.pop()
    else parts.push(part)
  }
  return `/${parts.join("/")}`
}

const parentOf = (key: string): string => key.replace(/\/[^/]*$/, "") || "/"

interface Entry {
  readonly type: "File" | "Directory"
  readonly data: Uint8Array
}

const failure = (tag: PlatformError.SystemErrorTag, method: string, path: string) =>
  Effect.fail(PlatformError.systemError({ _tag: tag, module: "FileSystem", method, pathOrDescriptor: path }))

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * A file system held in a map. Its members are the ones a program reads and
 * writes files with; the rest fail with `NotFound`, as Effect's
 * `FileSystem.makeNoop` does. File times are fixed, so metadata never makes
 * a test flaky.
 */
export const makeMemoryFileSystem = (files: Readonly<Record<string, string>>): FileSystem.FileSystem => {
  const entries = new Map<string, Entry>([["/", { type: "Directory", data: new Uint8Array() }]])
  const mkdirp = (key: string) => {
    let current = ""
    for (const part of key.split("/").filter((p) => p !== "")) {
      current = `${current}/${part}`
      if (!entries.has(current)) entries.set(current, { type: "Directory", data: new Uint8Array() })
    }
  }
  const put = (key: string, data: Uint8Array) => {
    mkdirp(parentOf(key))
    entries.set(key, { type: "File", data: data.slice() })
  }
  for (const [path, contents] of Object.entries(files)) put(normalize(path), encoder.encode(contents))

  // A path below a file names nothing, and the real host says so with
  // ENOTDIR, which Effect reads as BadResource, not as a missing path.
  const underFile = (key: string): boolean => {
    let current = parentOf(key)
    while (true) {
      if (entries.get(current)?.type === "File") return true
      if (current === "/") return false
      current = parentOf(current)
    }
  }
  const find = (path: string, method: string) =>
    Effect.suspend(() => {
      const key = normalize(path)
      return underFile(key) ? failure("BadResource", method, path) : Effect.succeed(entries.get(key))
    })
  const children = (key: string) => {
    const prefix = key === "/" ? "/" : `${key}/`
    return [...entries.keys()].filter((other) => other !== key && other.startsWith(prefix))
  }
  const readFile = (path: string) =>
    Effect.flatMap(find(path, "readFile"), (entry) => {
      if (entry === undefined) return failure("NotFound", "readFile", path)
      if (entry.type !== "File") return failure("BadResource", "readFile", path)
      return Effect.succeed(entry.data.slice())
    })
  const writeFile = (path: string, data: Uint8Array, options?: { readonly flag?: string | undefined }) =>
    Effect.suspend(() => {
      const key = normalize(path)
      if (underFile(key)) return failure("BadResource", "writeFile", path)
      const parent = entries.get(parentOf(key))
      if (parent === undefined) return failure("NotFound", "writeFile", path)
      if (parent.type !== "Directory") return failure("BadResource", "writeFile", path)
      if (entries.get(key)?.type === "Directory") return failure("BadResource", "writeFile", path)
      if (options?.flag?.includes("x") && entries.has(key)) return failure("AlreadyExists", "writeFile", path)
      const previous = options?.flag?.startsWith("a") ? entries.get(key)?.data ?? new Uint8Array() : new Uint8Array()
      const next = new Uint8Array(previous.length + data.length)
      next.set(previous)
      next.set(data, previous.length)
      put(key, next)
      return Effect.void
    })
  const info = (entry: Entry): FileSystem.File.Info => ({
    type: entry.type,
    mtime: Option.some(new Date(0)),
    atime: Option.some(new Date(0)),
    birthtime: Option.some(new Date(0)),
    dev: 0n,
    ino: Option.none(),
    mode: entry.type === "Directory" ? 0o040755 : 0o100644,
    nlink: Option.none(),
    uid: Option.none(),
    gid: Option.none(),
    rdev: Option.none(),
    size: ByteSize.bytes(entry.data.byteLength),
    blksize: Option.none(),
    blocks: Option.none()
  })

  return FileSystem.makeNoop({
    access: (path) => Effect.flatMap(find(path, "access"), (entry) => (entry === undefined ? failure("NotFound", "access", path) : Effect.void)),
    exists: (path) => Effect.map(find(path, "exists"), (entry) => entry !== undefined),
    readFile,
    readFileString: (path) => Effect.map(readFile(path), (bytes) => decoder.decode(bytes)),
    writeFile,
    writeFileString: (path, data, options) => writeFile(path, encoder.encode(data), options),
    makeDirectory: (path, options) =>
      Effect.suspend(() => {
        const key = normalize(path)
        if (underFile(key)) return failure("BadResource", "makeDirectory", path)
        if (options?.recursive === true) {
          if (entries.get(key)?.type === "File") return failure("AlreadyExists", "makeDirectory", path)
          mkdirp(key)
          return Effect.void
        }
        if (entries.has(key)) return failure("AlreadyExists", "makeDirectory", path)
        const parent = entries.get(parentOf(key))
        if (parent === undefined) return failure("NotFound", "makeDirectory", path)
        if (parent.type !== "Directory") return failure("BadResource", "makeDirectory", path)
        entries.set(key, { type: "Directory", data: new Uint8Array() })
        return Effect.void
      }),
    readDirectory: (path, options) =>
      Effect.suspend(() => {
        const key = normalize(path)
        if (underFile(key)) return failure("BadResource", "readDirectory", path)
        const entry = entries.get(key)
        if (entry === undefined) return failure("NotFound", "readDirectory", path)
        if (entry.type !== "Directory") return failure("BadResource", "readDirectory", path)
        const prefix = key === "/" ? "/" : `${key}/`
        const names = new Set<string>()
        for (const other of children(key)) {
          const rest = other.slice(prefix.length)
          names.add(options?.recursive === true ? rest : rest.split("/")[0]!)
        }
        return Effect.succeed([...names].sort())
      }),
    realPath: (path) =>
      Effect.flatMap(find(path, "realPath"), (entry) => (entry === undefined ? failure("NotFound", "realPath", path) : Effect.succeed(normalize(path)))),
    stat: (path) => Effect.flatMap(find(path, "stat"), (entry) => (entry === undefined ? failure("NotFound", "stat", path) : Effect.succeed(info(entry)))),
    remove: (path, options) =>
      Effect.suspend(() => {
        const key = normalize(path)
        // As Node's fs.rm: a path below a file fails with ENOTDIR
        // (BadResource) when recursive, and like any directory removed
        // without `recursive`, with a code Effect reads as Unknown otherwise.
        if (underFile(key)) return failure(options?.recursive === true ? "BadResource" : "Unknown", "remove", path)
        const entry = entries.get(key)
        if (entry === undefined) return options?.force === true ? Effect.void : failure("NotFound", "remove", path)
        if (entry.type === "Directory" && options?.recursive !== true) return failure("Unknown", "remove", path)
        for (const other of children(key)) entries.delete(other)
        entries.delete(key)
        return Effect.void
      }),
    rename: (from, to) =>
      Effect.suspend(() => {
        const source = normalize(from)
        const target = normalize(to)
        // rename(2) reports ENOTDIR for a file in either path before it looks for the source.
        if (underFile(source) || underFile(target)) return failure("BadResource", "rename", from)
        const entry = entries.get(source)
        if (entry === undefined) return failure("NotFound", "rename", from)
        if (!entries.has(parentOf(target))) return failure("NotFound", "rename", to)
        if (target === source) return Effect.void
        // Into itself (EINVAL), onto its own ancestor or another directory
        // that is not empty (ENOTEMPTY): codes Effect reads as Unknown. A
        // directory onto a file or a file onto a directory is ENOTDIR or
        // EISDIR, which Effect reads as BadResource.
        if (target.startsWith(`${source}/`) || source.startsWith(`${target}/`)) return failure("Unknown", "rename", from)
        const existing = entries.get(target)
        if (existing !== undefined) {
          if (entry.type !== existing.type) return failure("BadResource", "rename", to)
          if (existing.type === "Directory" && children(target).length > 0) return failure("Unknown", "rename", to)
          entries.delete(target)
        }
        const moved = [source, ...children(source)].map((key) => [key, entries.get(key)!] as const)
        for (const [key] of moved) entries.delete(key)
        for (const [key, value] of moved) entries.set(target + key.slice(source.length), value)
        return Effect.void
      }),
    copyFile: (from, to) => Effect.flatMap(readFile(from), (bytes) => writeFile(to, bytes))
  })
}

/** One scripted command's result. */
export interface ScriptedCommand {
  readonly stdout?: string | undefined
  readonly stderr?: string | undefined
  readonly exitCode?: number | undefined
}

const word = (value: ChildProcess.StandardCommand["args"][number]) => (Redacted.isRedacted(value) ? Redacted.value(value) : value)

/** The command line a scripted table is keyed by: the command and its arguments, joined by spaces. */
export const commandLine = (command: ChildProcess.StandardCommand): string =>
  [command.command, ...command.args.map(word)].join(" ")

/**
 * A spawner that answers commands from a table keyed by command line. A
 * command the table does not list fails to spawn with `NotFound`, as a
 * missing binary does, so a test never depends on a tool the machine
 * happens to have.
 */
export const makeScriptedSpawner = (
  commands: Readonly<Record<string, ScriptedCommand>>
): ChildProcessSpawner.ChildProcessSpawner["Service"] => {
  let pid = 1000
  return ChildProcessSpawner.make((command) =>
    Effect.suspend(() => {
      if (command._tag !== "StandardCommand") {
        return Effect.fail(PlatformError.badArgument({
          module: "ChildProcess",
          method: "spawn",
          description: "a scripted host runs one command at a time; script each command of a pipe separately"
        }))
      }
      const line = commandLine(command)
      const scripted = Object.hasOwn(commands, line) ? commands[line] : undefined
      if (scripted === undefined) {
        return Effect.fail(PlatformError.systemError({
          _tag: "NotFound",
          module: "ChildProcess",
          method: "spawn",
          pathOrDescriptor: command.command,
          description: `the test host scripts no command ${JSON.stringify(line)}`
        }))
      }
      const stdout = Stream.make(encoder.encode(scripted.stdout ?? ""))
      const stderr = Stream.make(encoder.encode(scripted.stderr ?? ""))
      return Effect.succeed(ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(pid++),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(scripted.exitCode ?? 0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: Sink.drain,
        stdout,
        stderr,
        all: Stream.concat(stdout, stderr),
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void)
      }))
    })
  )
}
