// opencode cold start (corpus/opencode-standalone-cold-emitted-js.json): a
// workspace package names its committed .vibelang/js as its `default`
// export, and the loaders run its .vibe source in its place. Before loader
// records every cold process compiled that package's whole project; with the
// record the emit step writes, a cold process compiles nothing while every
// input holds, in place or in a moved checkout, and an edit compiles again.
import { requireOrSkip } from "./prerequisites.mjs"
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { performance } from "node:perf_hooks"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { loaderRecordFile } from "../cache.mjs"
import { loaderScope } from "../loader-scope.mjs"
import { checkLoaderRecord, compileProjectSync, writeLoaderRecord } from "../project.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compilerPackage = fileURLToPath(new URL("../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
const hasBun = spawnSync("bun", ["--version"]).status === 0
const missing = [native, effect, join(runtime, "dist/index.js")].find((path) => !existsSync(path))
const skip = requireOrSkip(missing !== undefined && `run typescript/vibelang/smoke.sh first; missing ${missing}`)
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-standalone-cold-emitted-js.json", import.meta.url), "utf8"))

// A file written this close to a compile keeps it out of the cache and the record.
const settle = () => sleep(120)

test("a loader record retains hidden includes and notices a new hidden source", { skip }, async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-hidden-record-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const project = join(root, "tsconfig.json")
  mkdirSync(join(root, "src"))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(effect, join(root, "node_modules/effect"), "junction")
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"), "junction")
  writeFileSync(project, JSON.stringify({
    compilerOptions: { target: "es2022", module: "nodenext", types: [], skipLibCheck: true },
    include: ["src/**/*", "src/**/.*"]
  }))
  writeFileSync(join(root, "src/main.vibe"), "export const main = 1\n")
  const hidden = join(root, "src/.hidden.vibe")
  writeFileSync(hidden, "export const hidden = 2\n")
  await settle()
  const options = { project, compiler: native }
  assert.equal(writeLoaderRecord(options).modules, 2)
  assert.deepEqual(checkLoaderRecord(options), { modules: 2 })
  rmSync(hidden)
  assert.match(checkLoaderRecord(options).miss, /gained or lost a file/)
  assert.equal(writeLoaderRecord(options).modules, 1)
  assert.deepEqual(checkLoaderRecord(options), { modules: 1 })
  writeFileSync(hidden, "export const hidden = 2\n")
  assert.match(checkLoaderRecord(options).miss, /gained or lost a file/)
})

// The corpus workspace with relative links, so a copy of it is a checkout of
// its own, its emitted JavaScript, and a compiler that counts its runs.
async function workspace(t) {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-loader-record-")))
  t.after(() => rmSync(top, { recursive: true, force: true }))
  const root = join(top, "checkout")
  for (const [path, text] of Object.entries(corpus.files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  mkdirSync(join(root, "node_modules/@demo"), { recursive: true })
  symlinkSync("../../packages/protocol", join(root, "node_modules/@demo/protocol"))
  symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
  cpSync(runtime, join(root, "node_modules/vibelang-runtime"), { recursive: true, filter: (path) => !path.includes("node_modules") })
  symlinkSync(compilerPackage, join(root, "node_modules/vibelang"))
  const protocol = join(root, "packages/protocol")
  const emitted = spawnSync(native, ["-p", "tsconfig.json", "--noEmit", "false", "--declaration", "false", "--outDir", ".vibelang/js", "--rootDir", ".", "--rewriteRelativeImportExtensions", "true"], { cwd: protocol, encoding: "utf8" })
  assert.equal(emitted.status, 0, emitted.stdout + emitted.stderr)
  const calls = join(top, "calls")
  const compiler = join(top, "compiler.mjs")
  writeFileSync(compiler, `import { appendFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
appendFileSync(${JSON.stringify(calls)}, "compile\\n")
process.exit(spawnSync(${JSON.stringify(native)}, process.argv.slice(2), { stdio: "inherit" }).status ?? 1)
`)
  await settle()
  let caches = 0
  // A process with a cold cache of its own, as every CI run starts.
  const run = (at, command, args) => {
    const result = spawnSync(command, args, {
      cwd: join(at, "packages/cli"), encoding: "utf8",
      env: { ...process.env, VIBELANG_BINARY: compiler, VIBELANG_CACHE_DIR: join(top, `cache-${caches++}`), VIBELANG_PROJECT: "", VIBELANG_DISABLE_CACHE: "", VIBELANG_REGISTER_DEBUG: "1" }
    })
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout.trim().split("\n").at(-1))
  }
  const compiles = () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").length : 0
  return { top, root, protocol, compiler, run, compiles }
}

const bun = (at, run) => run(at, "bun", ["--preload", "vibelang/bun", "src/index.ts"])
const node = (at, run) => run(at, process.execPath, ["--enable-source-maps", "--import", "vibelang/register", "src/index.mjs"])

test("bun build and plain bun read the emitted JavaScript; the loaders compile its package on a cold cache without a record", { skip: requireOrSkip(skip || (!hasBun && "bun is not on PATH")) }, async (t) => {
  const { root, run, compiles } = await workspace(t)
  assert.deepEqual(run(root, "bun", ["src/index.ts"]).api, "api:pty.create,pty.connect")
  assert.equal(compiles(), 0)
  assert.equal(bun(root, run).api, "api:pty.create,pty.connect")
  assert.equal(compiles(), 1, "the cold preload compiles protocol")
})

test("with its loader record, a cold vibelang/bun or vibelang/register process compiles nothing, in place or moved", { skip: requireOrSkip(skip || (!hasBun && "bun is not on PATH")) }, async (t) => {
  const { top, root, protocol, compiler, run, compiles } = await workspace(t)
  const written = writeLoaderRecord({ project: join(protocol, "tsconfig.json"), compiler })
  assert.deepEqual(written, { file: loaderRecordFile(join(protocol, "tsconfig.json")), modules: 2 })
  const recorded = compiles()
  assert.equal(bun(root, run).api, "api:pty.create,pty.connect")
  assert.deepEqual(node(root, run), { api: "api:pty.create,pty.connect", mapped: true }, "source maps still name the .vibe line")
  assert.equal(compiles(), recorded, "no cold process compiles")

  const moved = join(top, "elsewhere/checkout")
  cpSync(root, moved, { recursive: true })
  await settle()
  assert.deepEqual(node(moved, run), { api: "api:pty.create,pty.connect", mapped: true })
  assert.equal(bun(moved, run).api, "api:pty.create,pty.connect")
  assert.equal(compiles(), recorded, "the record moves with the checkout")
})

test("an edited source, an added module or a changed config compiles again and runs the new source", { skip: requireOrSkip(skip || (!hasBun && "bun is not on PATH")) }, async (t) => {
  const { root, protocol, compiler, run, compiles } = await workspace(t)
  writeLoaderRecord({ project: join(protocol, "tsconfig.json"), compiler })
  let expected = compiles()
  const pty = join(protocol, "src/groups/pty.vibe")
  writeFileSync(pty, readFileSync(pty, "utf8").replace("pty.connect", "pty.resize"))
  await settle()
  assert.equal(bun(root, run).api, "api:pty.create,pty.resize")
  assert.equal(compiles(), ++expected)
  writeFileSync(pty, readFileSync(pty, "utf8").replace("pty.resize", "pty.connect"))
  await settle()
  assert.equal(bun(root, run).api, "api:pty.create,pty.connect")
  assert.equal(compiles(), expected, "the original source holds the record again")
  writeFileSync(join(protocol, "src/extra.vibe"), "export const extra = 1\n")
  await settle()
  assert.equal(bun(root, run).api, "api:pty.create,pty.connect")
  assert.equal(compiles(), ++expected)
  rmSync(join(protocol, "src/extra.vibe"))
  const config = join(protocol, "tsconfig.json")
  writeFileSync(config, readFileSync(config, "utf8").replace("\"strict\":true", "\"strict\":false"))
  await settle()
  assert.equal(bun(root, run).api, "api:pty.create,pty.connect")
  assert.equal(compiles(), ++expected)
})

test("a project with a type error leaves no record", { skip }, async (t) => {
  const { protocol, compiler } = await workspace(t)
  writeFileSync(join(protocol, "src/groups/pty.vibe"), "export const routes: Array<string> = [1]\n")
  await settle()
  const written = writeLoaderRecord({ project: join(protocol, "tsconfig.json"), compiler })
  assert.ok(written.errors.some((error) => error.code === "TS2322"), JSON.stringify(written))
  assert.equal(existsSync(loaderRecordFile(join(protocol, "tsconfig.json"))), false)
})


test("a source edited while a loader record is validated is not stored as a fresh cache entry", (t) => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-loader-race-")))
  t.after(() => rmSync(top, { recursive: true, force: true }))
  const root = join(top, "app")
  mkdirSync(join(root, "src"), { recursive: true })
  const project = join(root, "tsconfig.json")
  const source = join(root, "src/a.vibe")
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "race-app", type: "module" }))
  writeFileSync(project, JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", outDir: "dist" }, include: ["src/**/*.vibe"] }))
  writeFileSync(source, 'export const value = "original"\n')
  const calls = join(top, "calls")
  const compiler = join(top, "compiler.mjs")
  writeFileSync(compiler, `#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
const args = process.argv.slice(2)
appendFileSync(${JSON.stringify(calls)}, "compile\\n")
const outDir = args[args.indexOf("--outDir") + 1]
const rootDir = args[args.indexOf("--rootDir") + 1]
const src = readFileSync(${JSON.stringify(source)}, "utf8")
const out = join(outDir, relative(rootDir, ${JSON.stringify(source)}).replace(/\\.vibe$/, ".js"))
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, src + "\\n//# sourceMappingURL=a.js.map\\n")
writeFileSync(out + ".map", JSON.stringify({ version: 3, sources: [${JSON.stringify(source)}], mappings: "" }))
console.log(${JSON.stringify(source)})
`)
  chmodSync(compiler, 0o755)

  // Keep every initial file timestamp well behind our synthetic clock base so
  // recordFile accepts the files when writing the loader record and testing.
  const baseNow = Date.now() + 10_000
  const old = (baseNow - 60_000) / 1000
  for (const f of [join(root, "package.json"), project, source, compiler]) utimesSync(f, old, old)

  let fakeNow = baseNow
  let dateCalls = 0
  t.mock.method(Date, "now", () => {
    dateCalls++
    return fakeNow
  })

  const written = writeLoaderRecord({ project, root, compiler })
  assert.equal(written.modules, 1, JSON.stringify(written))
  assert.equal(readFileSync(calls, "utf8").trim().split("\n").length, 1)

  const cache = { directory: join(top, "cache") }
  dateCalls = 0
  let doneCalls = 0
  let edited = false
  const realPerfNow = performance.now.bind(performance)
  const perfMock = t.mock.method(performance, "now", () => {
    const stack = new Error().stack ?? ""
    if (!edited && stack.includes("at done (")) {
      doneCalls++
      // Edit a.vibe right after the loader-record validation stage finishes
      // (done #2 when store.begin() has not run yet; done #3 when snapshot ran
      // before record validation). Set mtime to baseNow + 100.5 and advance
      // Date.now() to baseNow + 200 so a snapshot taken after validation sees
      // the edited file as non-racy, while a snapshot taken before validation
      // sees it as racy.
      if ((doneCalls === 2 && dateCalls === 0) || doneCalls === 3) {
        edited = true
        writeFileSync(source, 'export const value = "edited"\n')
        const editTime = (baseNow + 100.5) / 1000
        utimesSync(source, editTime, editTime)
        fakeNow = baseNow + 200
      }
    }
    return realPerfNow()
  })

  const first = compileProjectSync({ project, root, compiler, cache, [loaderScope]: true })
  assert.equal(edited, true, "test hook must fire after loader record validation")
  assert.match(first.outputs.get(source).code, /original/)
  perfMock.mock.restore()

  // The loader record is now stale because a.vibe changed.
  assert.ok(checkLoaderRecord({ project, root, compiler }).miss)

  // A subsequent compile must miss the cache and compile the edited source,
  // never serving the stale output from a poisoned cache entry.
  fakeNow = baseNow + 10_000
  const second = compileProjectSync({ project, root, compiler, cache, [loaderScope]: true })
  assert.match(second.outputs.get(source).code, /edited/)
  assert.equal(readFileSync(calls, "utf8").trim().split("\n").length, 2)
})
