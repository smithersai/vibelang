// Shared fixture for the cache tests: a real project compiled by the native
// compiler through a recording wrapper, with its own cache directory.
//
// compile() runs compileProjectSync, the loaders' compile, so every entry the
// tests look at holds what the compiler really read. compiles() counts the
// wrapper's runs: an unchanged count after compile() is a cache hit. listed()
// asks the compiler itself which files the project holds (--listFilesOnly),
// the oracle the cache's directory scan must agree with.
import { requireOrSkip } from "./prerequisites.mjs"
import { spawnSync } from "node:child_process"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { projectCache } from "../cache.mjs"
import { loaderScope } from "../loader-scope.mjs"
import { compileProjectSync } from "../project.mjs"

export const native = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../native/vibelang", import.meta.url))
export const skip = requireOrSkip(!existsSync(native) && `missing ${native}`)

// An explicit cache directory is not enough when the environment turns the
// cache off everywhere.
delete process.env.VIBELANG_DISABLE_CACHE

export const compilerOptions = {
  target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true,
  noEmit: true, resolveJsonModule: true
}

// cache.mjs refuses to store a file whose newest stamp is within 50 ms of a
// compile's start, or within 2 s when the filesystem keeps whole seconds.
// ctime cannot be set, so wait until each file's own observed stamp is past
// that window instead of sleeping a guessed margin.
const fineMargin = 50
const coarseMargin = 2000
export async function pastRacyWindow(paths, deadline = 10000) {
  const limit = Date.now() + deadline
  for (;;) {
    let due = 0
    for (const path of paths) {
      const stat = statSync(path, { throwIfNoEntry: false })
      if (stat === undefined) continue
      const coarse = stat.mtimeMs % 1000 === 0 && stat.ctimeMs % 1000 === 0
      due = Math.max(due, Math.max(stat.mtimeMs, stat.ctimeMs) + (coarse ? coarseMargin : fineMargin) + 1)
    }
    const now = Date.now()
    if (due <= now) return
    if (due > limit) throw new Error(`a stamp stays inside the cache's race window until ${new Date(due).toISOString()}`)
    await sleep(due - now)
  }
}

// Every file and directory under path. A symbolic link is listed, not followed.
export function tree(path) {
  const found = [path]
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) found.push(...tree(child))
    else found.push(child)
  }
  return found
}

// A time well in the past, in whole seconds so that every filesystem keeps it.
export const past = (seconds = 60) => new Date((Math.floor(Date.now() / 1000) - seconds) * 1000)

// Moves every directory's mtime into the past, so that an addition always
// changes it, even on a filesystem with whole-second stamps.
export function ageDirectories(path) {
  const old = past()
  for (const entry of tree(path)) if (lstatSync(entry).isDirectory()) utimesSync(entry, old, old)
}

// A compiler that records each run, then runs the native one.
export const recorder = (calls, after = "") => `import { appendFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
appendFileSync(${JSON.stringify(calls)}, "compile\\n")
const status = spawnSync(${JSON.stringify(native)}, process.argv.slice(2), { stdio: "inherit" }).status ?? 1
${after}
process.exit(status)
`

/**
 * A project under a new temporary directory, removed after the test. files
 * maps paths relative to the project directory to their text; config is the
 * tsconfig.json, which gets compilerOptions unless it sets its own. after is
 * code the compiler wrapper runs once the native compile has finished. loader
 * compiles as vibelang/register does, checking only the project's own sources.
 */
export function cacheProject(t, files, config = { include: ["src"] }, { after = "", loader = false } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-cache-real-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const app = join(root, "app")
  const project = join(app, "tsconfig.json")
  const directory = join(root, "cache")
  const calls = join(root, "calls.jsonl")
  const compiler = join(root, "compiler.mjs")
  writeFileSync(compiler, recorder(calls, after))
  const write = (name, text) => {
    const path = join(app, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
    return path
  }
  mkdirSync(app, { recursive: true })
  write("tsconfig.json", JSON.stringify({ compilerOptions, ...config }))
  for (const [name, text] of Object.entries(files)) write(name, text)
  const compiles = () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").length : 0
  const handle = (extra = {}) => projectCache({ project, root: app, compiler, cache: { directory }, scope: loader ? "loader" : "project", ...extra })
  return {
    root, app, project, compiler, cacheDirectory: directory, write, compiles,
    /** The cache entry compile() writes and reads. */
    entry: handle(),
    /** Compiles as a loader does; { result, messages, compiled }. */
    compile() {
      const before = compiles()
      const messages = []
      const result = compileProjectSync({ project, root: app, compiler, cache: { directory }, debug: (line) => messages.push(line), [loaderScope]: loader })
      return { result, messages, compiled: compiles() > before }
    },
    /** The project's files as the compiler lists them, bundled libraries aside. */
    listed() {
      const run = spawnSync(native, ["--project", project, "--pretty", "false", "--listFilesOnly"], { cwd: app, encoding: "utf8" })
      if (run.status !== 0) throw new Error(`--listFilesOnly exited ${run.status}\n${run.stdout}${run.stderr}`)
      return new Set(run.stdout.split("\n").filter((line) => line && !line.startsWith("bundled:")))
    },
    /** Runs `vibelang -p`, which writes declaration sidecars and native declarations. */
    build(args = []) {
      const run = spawnSync(native, ["-p", project, "--pretty", "false", "--noEmit", "false", "--outDir", join(root, "out"), ...args], { cwd: app, encoding: "utf8" })
      if (run.status !== 0) throw new Error(`vibelang -p exited ${run.status}\n${run.stdout}${run.stderr}`)
    },
    /** Waits until no file in the project is too recent to cache. */
    settle: () => pastRacyWindow(tree(root))
  }
}
