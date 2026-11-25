/**
 * The machine of `Sandbox.interpreter()` (VIP-67): a small POSIX-shell
 * subset over an in-memory file system. No real process exists, so it runs
 * in a browser and a Worker. It stands in for the reference engine's
 * `JustBashSandbox`, which adapts the `just-bash` package; this one needs no
 * dependency.
 *
 * Supported: words with single and double quotes and backslashes; `$NAME`,
 * `${NAME}` and `$?`; `;`, newlines, `&&`, `||` and `|`; `<`, `>`, `>>`,
 * `2>`, `2>>`, `2>&1` and `>&2`; `NAME=value` assignments and prefixes; and
 * the commands `basename`, `cat`, `cd`, `cp`, `dirname`, `echo`, `env`,
 * `exit`, `export`, `false`, `ls`, `mkdir`, `mv`, `printf`, `pwd`, `rm`,
 * `sh -c`, `sleep`, `test` and `[`, `touch`, `true` and `unset`. Anything
 * else exits 127, and syntax outside the subset exits 2.
 *
 * @internal
 */
import * as ByteSize from "effect/ByteSize"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as PlatformError from "effect/PlatformError"
import * as Stream from "effect/Stream"
import { concat, keptVariables, type Machine, resolveIn } from "./sandbox.js"

type Node = { readonly type: "file"; data: Uint8Array } | { readonly type: "dir" }

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** An in-memory POSIX tree. Paths are absolute and normalized. */
export class Disk {
  readonly nodes = new Map<string, Node>([["/", { type: "dir" }]])

  parent(path: string): string {
    const index = path.lastIndexOf("/")
    return index <= 0 ? "/" : path.slice(0, index)
  }

  get(path: string): Node | undefined {
    return this.nodes.get(path)
  }

  mkdir(path: string, recursive: boolean): "ok" | "exists" | "missing" | "notdir" {
    const node = this.nodes.get(path)
    if (node !== undefined) return recursive && node.type === "dir" ? "ok" : "exists"
    const parent = this.parent(path)
    const above = this.nodes.get(parent)
    if (above === undefined) {
      if (!recursive) return "missing"
      const made = this.mkdir(parent, true)
      if (made !== "ok") return made
    } else if (above.type !== "dir") return "notdir"
    this.nodes.set(path, { type: "dir" })
    return "ok"
  }

  write(path: string, data: Uint8Array, append: boolean): "ok" | "missing" | "isdir" {
    const parent = this.nodes.get(this.parent(path))
    if (parent === undefined || parent.type !== "dir") return "missing"
    const node = this.nodes.get(path)
    if (node?.type === "dir") return "isdir"
    this.nodes.set(path, { type: "file", data: append && node?.type === "file" ? concat([node.data, data]) : new Uint8Array(data) })
    return "ok"
  }

  children(path: string, recursive: boolean): Array<string> {
    const prefix = path === "/" ? "/" : `${path}/`
    const out: Array<string> = []
    for (const key of this.nodes.keys()) {
      if (key === path || !key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      if (recursive || !rest.includes("/")) out.push(rest)
    }
    return out.sort()
  }

  remove(path: string, recursive: boolean): "ok" | "missing" | "notempty" {
    if (!this.nodes.has(path)) return "missing"
    const below = this.children(path, true)
    if (below.length > 0 && !recursive) return "notempty"
    for (const child of below) this.nodes.delete(`${path === "/" ? "" : path}/${child}`)
    this.nodes.delete(path)
    return "ok"
  }

  copy(from: string, to: string): "ok" | "missing" {
    const node = this.nodes.get(from)
    if (node === undefined) return "missing"
    const moved: Array<[string, Node]> = [[to, node.type === "file" ? { type: "file", data: new Uint8Array(node.data) } : node]]
    for (const child of this.children(from, true)) {
      const original = this.nodes.get(`${from}/${child}`)!
      moved.push([`${to}/${child}`, original.type === "file" ? { type: "file", data: new Uint8Array(original.data) } : original])
    }
    for (const [key, value] of moved) this.nodes.set(key, value)
    return "ok"
  }
}

// ---------------------------------------------------------------------------
// Parsing

type Token =
  | { readonly kind: "word"; readonly parts: ReadonlyArray<{ readonly text: string; readonly expand: boolean }> }
  | { readonly kind: "op"; readonly op: string }

class SyntaxProblem extends Error {}

const operators = ["2>&1", ">&2", "2>>", "&&", "||", ">>", "2>", ";", "\n", "|", ">", "<"]

const tokenize = (source: string): Array<Token> => {
  const tokens: Array<Token> = []
  let index = 0
  while (index < source.length) {
    const char = source[index]!
    if (char === " " || char === "\t") {
      index++
      continue
    }
    if (char === "#") {
      while (index < source.length && source[index] !== "\n") index++
      continue
    }
    const op = operators.find((candidate) => source.startsWith(candidate, index))
    if (op !== undefined) {
      tokens.push({ kind: "op", op })
      index += op.length
      continue
    }
    if (char === "&" || char === "(" || char === ")" || char === "`") throw new SyntaxProblem(`unsupported syntax ${char}`)
    const parts: Array<{ text: string; expand: boolean }> = []
    while (index < source.length) {
      const current = source[index]!
      if (" \t\n;|&<>()".includes(current)) break
      if (current === "'") {
        const end = source.indexOf("'", index + 1)
        if (end < 0) throw new SyntaxProblem("unterminated quote")
        parts.push({ text: source.slice(index + 1, end), expand: false })
        index = end + 1
      } else if (current === '"') {
        let text = ""
        index++
        while (index < source.length && source[index] !== '"') {
          if (source[index] === "\\" && index + 1 < source.length && '"\\$`'.includes(source[index + 1]!)) {
            text += `\u0000${source[index + 1]}`
            index += 2
          } else {
            text += source[index]
            index++
          }
        }
        if (index >= source.length) throw new SyntaxProblem("unterminated quote")
        index++
        if (text.includes("$(") || text.includes("`")) throw new SyntaxProblem("unsupported command substitution")
        parts.push({ text, expand: true })
      } else if (current === "\\") {
        parts.push({ text: source[index + 1] ?? "", expand: false })
        index += 2
      } else {
        let text = ""
        while (index < source.length && !" \t\n;|&<>()'\"\\".includes(source[index]!)) {
          text += source[index]
          index++
        }
        if (text.includes("$(") || text.includes("`")) throw new SyntaxProblem("unsupported command substitution")
        parts.push({ text, expand: true })
      }
    }
    tokens.push({ kind: "word", parts })
  }
  return tokens
}

interface Simple {
  readonly words: Array<Extract<Token, { kind: "word" }>>
  readonly redirects: Array<{ readonly op: string; readonly target?: Extract<Token, { kind: "word" }> }>
}

type Pipeline = Array<Simple>
type List = Array<{ readonly pipeline: Pipeline; readonly next: ";" | "&&" | "||" }>

const parse = (tokens: ReadonlyArray<Token>): List => {
  const list: List = []
  let pipeline: Pipeline = []
  let simple: Simple = { words: [], redirects: [] }
  const endSimple = () => {
    if (simple.words.length === 0 && simple.redirects.length === 0) return false
    pipeline.push(simple)
    simple = { words: [], redirects: [] }
    return true
  }
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    if (token.kind === "word") {
      simple.words.push(token)
      continue
    }
    if ([">", ">>", "<", "2>", "2>>"].includes(token.op)) {
      const target = tokens[index + 1]
      if (target?.kind !== "word") throw new SyntaxProblem(`${token.op} needs a file`)
      simple.redirects.push({ op: token.op, target })
      index++
      continue
    }
    if (token.op === "2>&1" || token.op === ">&2") {
      simple.redirects.push({ op: token.op })
      continue
    }
    if (token.op === "|") {
      if (!endSimple()) throw new SyntaxProblem("| needs a command before it")
      continue
    }
    const ended = endSimple()
    if (!ended && pipeline.length > 0) throw new SyntaxProblem(`${token.op} needs a command`)
    if (pipeline.length > 0) list.push({ pipeline, next: token.op === "\n" ? ";" : token.op as ";" | "&&" | "||" })
    else if (token.op === "&&" || token.op === "||") throw new SyntaxProblem(`${token.op} needs a command before it`)
    pipeline = []
  }
  endSimple()
  if (pipeline.length > 0) list.push({ pipeline, next: ";" })
  return list
}

// ---------------------------------------------------------------------------
// Running

interface Shell {
  cwd: string
  vars: Record<string, string>
  status: number
  exited: boolean
}

interface Outcome {
  readonly stdout: Uint8Array
  readonly stderr: Uint8Array
  readonly code: number
}

const expandText = (text: string, shell: Shell): string =>
  text.replace(/\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*)|(\?))/g, (_, braced, bare, status) =>
    status !== undefined ? String(shell.status) : shell.vars[braced ?? bare] ?? ""
  ).replaceAll("\u0000", "")

const expandWord = (word: Extract<Token, { kind: "word" }>, shell: Shell): string =>
  word.parts.map((part) => part.expand ? expandText(part.text, shell) : part.text).join("")

const text = (value: string) => encoder.encode(value)

const formatPrintf = (format: string, args: ReadonlyArray<string>): string => {
  const escape = (value: string) =>
    value.replace(/\\(n|t|\\|r)/g, (_, char) => (char === "n" ? "\n" : char === "t" ? "\t" : char === "r" ? "\r" : "\\"))
  let out = ""
  let next = 0
  do {
    out += escape(format).replace(/%([sd%])/g, (_, kind) => {
      if (kind === "%") return "%"
      const value = args[next++] ?? ""
      return kind === "d" ? String(Number.parseInt(value, 10) || 0) : value
    })
  } while (next < args.length && /%[sd]/.test(format))
  return out
}

/** Runs `source` on `disk`. Interruptible: `sleep` is an Effect sleep. */
export const interpret = (
  disk: Disk,
  source: string,
  options: { readonly cwd: string; readonly env: Readonly<Record<string, string>>; readonly stdin?: Uint8Array | undefined }
): Effect.Effect<Outcome> =>
  Effect.gen(function*() {
    const shell: Shell = { cwd: options.cwd, vars: { ...options.env, PWD: options.cwd }, status: 0, exited: false }
    const stdout: Array<Uint8Array> = []
    const stderr: Array<Uint8Array> = []
    let list: List
    try {
      list = parse(tokenize(source))
    } catch (error) {
      return { stdout: new Uint8Array(0), stderr: text(`sh: ${(error as Error).message}\n`), code: 2 }
    }
    let skip: "&&" | "||" | undefined
    for (const { pipeline, next } of list) {
      if (shell.exited) break
      const run = skip === undefined || (skip === "&&" ? shell.status === 0 : shell.status !== 0)
      if (run) {
        let input = options.stdin ?? new Uint8Array(0)
        for (const [index, simple] of pipeline.entries()) {
          const last = index === pipeline.length - 1
          const outcome = yield* runSimple(disk, shell, simple, input)
          stderr.push(outcome.stderr)
          if (last) {
            stdout.push(outcome.stdout)
            shell.status = outcome.code
          } else input = outcome.stdout
          if (shell.exited) break
        }
      }
      skip = next === ";" ? undefined : next
    }
    return { stdout: concat(stdout), stderr: concat(stderr), code: shell.status }
  })

const runSimple = (disk: Disk, shell: Shell, simple: Simple, stdin: Uint8Array): Effect.Effect<Outcome> =>
  Effect.gen(function*() {
    const resolve = resolveIn(shell.cwd)
    const words = simple.words.map((word) => expandWord(word, shell))
    const assignments: Record<string, string> = {}
    while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!)) {
      const word = words.shift()!
      const at = word.indexOf("=")
      assignments[word.slice(0, at)] = word.slice(at + 1)
    }
    let input = stdin
    for (const redirect of simple.redirects) {
      if (redirect.op !== "<") continue
      const node = disk.get(resolve(expandWord(redirect.target!, shell)))
      if (node?.type !== "file") return { stdout: new Uint8Array(0), stderr: text("sh: cannot open input\n"), code: 1 }
      input = node.data
    }
    let outcome: Outcome
    if (words.length === 0) {
      Object.assign(shell.vars, assignments)
      outcome = { stdout: new Uint8Array(0), stderr: new Uint8Array(0), code: 0 }
    } else {
      const env = { ...shell.vars, ...assignments }
      outcome = yield* command(disk, shell, words[0]!, words.slice(1), input, env)
    }
    let out = outcome.stdout
    let err = outcome.stderr
    for (const redirect of simple.redirects) {
      if (redirect.op === "2>&1") {
        out = concat([out, err])
        err = new Uint8Array(0)
      } else if (redirect.op === ">&2") {
        err = concat([err, out])
        out = new Uint8Array(0)
      } else if (redirect.op !== "<") {
        const target = expandWord(redirect.target!, shell)
        const data = redirect.op.startsWith("2") ? err : out
        if (target !== "/dev/null") {
          const written = disk.write(resolve(target), data, redirect.op.endsWith(">>"))
          if (written !== "ok") return { stdout: out, stderr: text(`sh: cannot create ${target}\n`), code: 1 }
        }
        if (redirect.op.startsWith("2")) err = new Uint8Array(0)
        else out = new Uint8Array(0)
      }
    }
    return { stdout: out, stderr: err, code: outcome.code }
  })

const command = (
  disk: Disk,
  shell: Shell,
  name: string,
  args: Array<string>,
  stdin: Uint8Array,
  env: Record<string, string>
): Effect.Effect<Outcome> =>
  Effect.suspend((): Effect.Effect<Outcome> => {
    const resolve = resolveIn(shell.cwd)
    const ok = (stdout: string | Uint8Array = "") =>
      Effect.succeed({ stdout: typeof stdout === "string" ? text(stdout) : stdout, stderr: new Uint8Array(0), code: 0 })
    const fail = (message: string, code = 1) =>
      Effect.succeed({ stdout: new Uint8Array(0), stderr: text(`${name}: ${message}\n`), code })
    const flags = (allowed: string) => {
      const set = new Set<string>()
      while (args.length > 0 && /^-[A-Za-z]+$/.test(args[0]!) && [...args[0]!.slice(1)].every((flag) => allowed.includes(flag))) {
        for (const flag of args.shift()!.slice(1)) set.add(flag)
      }
      if (args[0] === "--") args.shift()
      return set
    }
    switch (name) {
      case "true":
        return ok()
      case "false":
        return Effect.succeed({ stdout: new Uint8Array(0), stderr: new Uint8Array(0), code: 1 })
      case "echo": {
        const noNewline = args[0] === "-n"
        if (noNewline) args.shift()
        return ok(args.join(" ") + (noNewline ? "" : "\n"))
      }
      case "printf":
        return args.length === 0 ? fail("usage: printf format [arguments]", 2) : ok(formatPrintf(args[0]!, args.slice(1)))
      case "pwd":
        return ok(`${shell.cwd}\n`)
      case "cd": {
        const target = resolve(args[0] ?? env["HOME"] ?? "/")
        if (disk.get(target)?.type !== "dir") return fail(`${args[0]}: no such directory`)
        shell.cwd = target
        shell.vars["PWD"] = target
        return ok()
      }
      case "env":
        return ok(Object.entries(env).map(([key, value]) => `${key}=${value}\n`).join(""))
      case "export":
        for (const arg of args) {
          const at = arg.indexOf("=")
          if (at > 0) shell.vars[arg.slice(0, at)] = arg.slice(at + 1)
        }
        return ok()
      case "unset":
        for (const arg of args) delete shell.vars[arg]
        return ok()
      case "exit":
        shell.exited = true
        return Effect.succeed({ stdout: new Uint8Array(0), stderr: new Uint8Array(0), code: Number.parseInt(args[0] ?? String(shell.status), 10) & 255 })
      case "sleep": {
        const seconds = Number(args[0] ?? "0")
        if (!Number.isFinite(seconds) || seconds < 0) return fail("invalid time interval")
        return Effect.as(Effect.sleep(`${Math.round(seconds * 1000)} millis`), { stdout: new Uint8Array(0), stderr: new Uint8Array(0), code: 0 })
      }
      case "cat": {
        if (args.length === 0) return ok(stdin)
        const parts: Array<Uint8Array> = []
        for (const arg of args) {
          if (arg === "-") {
            parts.push(stdin)
            continue
          }
          const node = disk.get(resolve(arg))
          if (node === undefined) return fail(`${arg}: No such file or directory`)
          if (node.type === "dir") return fail(`${arg}: Is a directory`)
          parts.push(node.data)
        }
        return ok(concat(parts))
      }
      case "ls": {
        const options = flags("a1l")
        const targets = args.length === 0 ? ["."] : args
        const lines: Array<string> = []
        for (const target of targets) {
          const path = resolve(target)
          const node = disk.get(path)
          if (node === undefined) return fail(`${target}: No such file or directory`, 2)
          if (node.type === "file") lines.push(target)
          else lines.push(...disk.children(path, false).filter((child) => options.has("a") || !child.startsWith(".")))
        }
        return ok(lines.map((line) => `${line}\n`).join(""))
      }
      case "mkdir": {
        const options = flags("p")
        for (const arg of args) {
          const made = disk.mkdir(resolve(arg), options.has("p"))
          if (made === "exists") return fail(`${arg}: File exists`)
          if (made !== "ok") return fail(`${arg}: No such file or directory`)
        }
        return ok()
      }
      case "touch":
        for (const arg of args) {
          const path = resolve(arg)
          if (disk.get(path) === undefined && disk.write(path, new Uint8Array(0), false) !== "ok") {
            return fail(`${arg}: No such file or directory`)
          }
        }
        return ok()
      case "rm": {
        const options = flags("rRf")
        for (const arg of args) {
          const path = resolve(arg)
          const node = disk.get(path)
          if (node === undefined) {
            if (options.has("f")) continue
            return fail(`${arg}: No such file or directory`)
          }
          if (node.type === "dir" && !options.has("r") && !options.has("R")) return fail(`${arg}: is a directory`)
          disk.remove(path, true)
        }
        return ok()
      }
      case "mv":
      case "cp": {
        const options = flags("rR")
        if (args.length !== 2) return fail("expects a source and a destination", 2)
        const from = resolve(args[0]!)
        let to = resolve(args[1]!)
        const node = disk.get(from)
        if (node === undefined) return fail(`${args[0]}: No such file or directory`)
        if (disk.get(to)?.type === "dir") to = `${to === "/" ? "" : to}/${from.slice(from.lastIndexOf("/") + 1)}`
        if (name === "cp" && node.type === "dir" && !options.has("r") && !options.has("R")) return fail(`${args[0]} is a directory`)
        if (disk.get(disk.parent(to))?.type !== "dir") return fail(`${args[1]}: No such file or directory`)
        disk.copy(from, to)
        if (name === "mv") disk.remove(from, true)
        return ok()
      }
      case "basename":
        return ok(`${(args[0] ?? "").replace(/\/+$/, "").split("/").pop() ?? ""}\n`)
      case "dirname": {
        const path = (args[0] ?? ".").replace(/\/+$/, "")
        const at = path.lastIndexOf("/")
        return ok(`${at < 0 ? "." : at === 0 ? "/" : path.slice(0, at)}\n`)
      }
      case "test":
      case "[": {
        const operands = name === "[" ? args.slice(0, args[args.length - 1] === "]" ? -1 : args.length) : args
        if (name === "[" && args[args.length - 1] !== "]") return fail("missing ]", 2)
        let negate = false
        if (operands[0] === "!") {
          negate = true
          operands.shift()
        }
        let result: boolean
        if (operands.length === 1) result = operands[0] !== ""
        else if (operands.length === 2) {
          const [op, operand] = operands as [string, string]
          const node = disk.get(resolve(operand))
          result = op === "-e" ? node !== undefined
            : op === "-f" ? node?.type === "file"
            : op === "-d" ? node?.type === "dir"
            : op === "-h" || op === "-L" ? false
            : op === "-z" ? operand === ""
            : op === "-n" ? operand !== ""
            : false
        } else if (operands.length === 3) {
          const [left, op, right] = operands as [string, string, string]
          result = op === "=" ? left === right : op === "!=" ? left !== right : false
        } else result = false
        return Effect.succeed({ stdout: new Uint8Array(0), stderr: new Uint8Array(0), code: result !== negate ? 0 : 1 })
      }
      case "sh":
      case "/bin/sh": {
        if (args[0] !== "-c" || args[1] === undefined) return fail("only sh -c is supported", 2)
        return interpret(disk, args[1], { cwd: shell.cwd, env, stdin })
      }
      default:
        return fail("command not found", 127)
    }
  })

// ---------------------------------------------------------------------------
// The machine

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

const diskFileSystem = (disk: Disk, workdir: string): FileSystem.FileSystem => {
  const resolve = resolveIn(workdir)
  const error = (tag: PlatformError.SystemErrorTag, method: string, path: string, description: string) =>
    PlatformError.systemError({ _tag: tag, module: "FileSystem", method, description: `${path}: ${description}`, pathOrDescriptor: path })
  const unsupported = (method: string) => (path: string) =>
    Effect.fail(PlatformError.badArgument({ module: "FileSystem", method, description: `${path}: ${method} is not supported by the interpreter` }))
  const stat = (raw: string) =>
    Effect.suspend(() => {
      const path = resolve(raw)
      const node = disk.get(path)
      if (node === undefined) return Effect.fail(error("NotFound", "stat", path, "no such file or directory"))
      return Effect.succeed({
        ...emptyInfo,
        type: node.type === "dir" ? "Directory" : "File",
        size: ByteSize.bytes(BigInt(node.type === "file" ? node.data.length : 0))
      } as unknown as FileSystem.File.Info)
    })
  const readFile = (raw: string) =>
    Effect.suspend(() => {
      const path = resolve(raw)
      const node = disk.get(path)
      if (node === undefined) return Effect.fail(error("NotFound", "readFile", path, "no such file or directory"))
      if (node.type === "dir") return Effect.fail(error("BadResource", "readFile", path, "is a directory"))
      return Effect.succeed(new Uint8Array(node.data))
    })
  const writeFile = (raw: string, data: Uint8Array, options?: { readonly flag?: string }) =>
    Effect.suspend(() => {
      const path = resolve(raw)
      const written = disk.write(path, data, options?.flag === "a")
      return written === "ok"
        ? Effect.void
        : Effect.fail(error(written === "missing" ? "NotFound" : "BadResource", "writeFile", path, written === "missing" ? "no such directory" : "is a directory"))
    })
  let temp = 0
  const makeTempDirectory = (options?: { readonly prefix?: string | undefined; readonly directory?: string | undefined }) =>
    Effect.sync(() => {
      const parent = resolve(options?.directory ?? "/tmp")
      disk.mkdir(parent, true)
      const path = `${parent === "/" ? "" : parent}/${(options?.prefix ?? "vibe").replace(/[^A-Za-z0-9._-]/g, "")}${(temp++).toString(36)}`
      disk.mkdir(path, true)
      return path
    })
  return FileSystem.makeNoop({
    access: unsupported("access"),
    chmod: () => Effect.void,
    chown: unsupported("chown"),
    copy: (from, to) =>
      Effect.suspend(() => disk.copy(resolve(from), resolve(to)) === "ok" ? Effect.void : Effect.fail(error("NotFound", "copy", resolve(from), "no such file or directory"))),
    copyFile: (from, to) =>
      Effect.suspend(() => disk.copy(resolve(from), resolve(to)) === "ok" ? Effect.void : Effect.fail(error("NotFound", "copyFile", resolve(from), "no such file or directory"))),
    exists: (raw) => Effect.sync(() => disk.get(resolve(raw)) !== undefined),
    link: unsupported("link"),
    lstat: stat,
    stat,
    makeDirectory: (raw, options) =>
      Effect.suspend(() => {
        const path = resolve(raw)
        const made = disk.mkdir(path, options?.recursive === true)
        return made === "ok"
          ? Effect.void
          : Effect.fail(error(made === "exists" ? "AlreadyExists" : "NotFound", "makeDirectory", path, made === "exists" ? "already exists" : "no such directory"))
      }),
    makeTempDirectory,
    makeTempDirectoryScoped: (options) =>
      Effect.acquireRelease(makeTempDirectory(options), (path) => Effect.sync(() => void disk.remove(path, true))),
    makeTempFile: unsupported("makeTempFile") as never,
    makeTempFileScoped: unsupported("makeTempFileScoped") as never,
    open: unsupported("open") as never,
    readDirectory: (raw, options) =>
      Effect.suspend(() => {
        const path = resolve(raw)
        const node = disk.get(path)
        if (node === undefined) return Effect.fail(error("NotFound", "readDirectory", path, "no such directory"))
        if (node.type !== "dir") return Effect.fail(error("BadResource", "readDirectory", path, "is not a directory"))
        return Effect.succeed(disk.children(path, options?.recursive === true))
      }),
    readFile,
    readFileString: (path) => Effect.map(readFile(path), (bytes) => decoder.decode(bytes)),
    readLink: unsupported("readLink"),
    realPath: (raw) =>
      Effect.suspend(() => {
        const path = resolve(raw)
        return disk.get(path) === undefined ? Effect.fail(error("NotFound", "realPath", path, "no such file or directory")) : Effect.succeed(path)
      }),
    remove: (raw, options) =>
      Effect.suspend(() => {
        const path = resolve(raw)
        const removed = disk.remove(path, options?.recursive === true)
        if (removed === "ok" || (removed === "missing" && options?.force === true)) return Effect.void
        return Effect.fail(error(removed === "missing" ? "NotFound" : "BadResource", "remove", path, removed === "missing" ? "no such file or directory" : "directory not empty"))
      }),
    rename: (from, to) =>
      Effect.suspend(() => {
        if (disk.copy(resolve(from), resolve(to)) !== "ok") return Effect.fail(error("NotFound", "rename", resolve(from), "no such file or directory"))
        disk.remove(resolve(from), true)
        return Effect.void
      }),
    symlink: unsupported("symlink"),
    truncate: unsupported("truncate"),
    utimes: () => Effect.void,
    watch: (path) =>
      Stream.fail(PlatformError.badArgument({ module: "FileSystem", method: "watch", description: `${path}: watch is not supported by the interpreter` })),
    writeFile,
    writeFileString: (path, data, options) => writeFile(path, encoder.encode(data), options)
  })
}

/** The ambient environment of the interpreter's machine. */
export const ambient: Readonly<Record<string, string>> = {
  PATH: "/usr/bin:/bin",
  HOME: "/workspace",
  USER: "sandbox",
  LANG: "C.UTF-8",
  TERM: "dumb",
  TMPDIR: "/tmp",
  SHELL: "/bin/sh"
}

/** An interpreter machine over a fresh disk with `/workspace` and `/tmp`. */
export const interpreterMachine = (options?: { readonly workdir?: string | undefined }): Machine => {
  const disk = new Disk()
  const workdir = resolveIn("/")(options?.workdir ?? "/workspace")
  disk.mkdir(workdir, true)
  disk.mkdir("/tmp", true)
  const kept = Object.fromEntries(Object.entries(ambient).filter(([name]) => keptVariables.includes(name)))
  return {
    provider: "interpreter",
    id: "interpreter",
    workdir,
    files: diskFileSystem(disk, workdir),
    spawn: (line, spawn) =>
      Effect.gen(function*() {
        const done = yield* Deferred.make<Outcome>()
        yield* Effect.forkScoped(
          Deferred.into(interpret(disk, line, { cwd: spawn.cwd, env: { ...kept, ...spawn.env }, stdin: spawn.stdin }), done)
        )
        const after = (pick: (outcome: Outcome) => Uint8Array) =>
          Stream.flatMap(Stream.fromEffect(Deferred.await(done)), (outcome) => {
            const bytes = pick(outcome)
            return bytes.length === 0 ? Stream.empty : Stream.make(bytes)
          })
        return {
          stdout: after((outcome) => outcome.stdout),
          stderr: after((outcome) => outcome.stderr),
          exitCode: Effect.map(Deferred.await(done), (outcome) => outcome.code)
        }
      })
  }
}
