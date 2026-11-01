import { strict as assert } from "node:assert"
import { spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync,
  statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { compileProjectSync, projects } from "../project.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const register = fileURLToPath(new URL("../register.mjs", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
const missing = [native, effect, join(runtime, "dist/index.js")].find((path) => !existsSync(path))
const skip = missing !== undefined && `run typescript/vibelang/smoke.sh first; missing ${missing}`

const options = {
  target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true,
  allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, noEmit: true
}
const tsconfig = (extra = {}) => JSON.stringify({ compilerOptions: options, include: ["src/**/*"], ...extra })

// A source file's timestamp near a compile's start keeps the compile out of the
// cache (it may have changed while the compiler read it). Wait past that.
const settle = () => sleep(120)

const sources = {
  "package.json": '{"type":"module"}',
  "tsconfig.json": tsconfig(),
  "src/helper.ts": "export const suffix = \"!\"\n",
  "src/shout.vibe": "import { suffix } from \"./helper.ts\"\n\nexport function shout(text: string): string {\n  return text.toUpperCase() + suffix\n}\n",
  "src/fail.vibe": "error Refused { reason: string }\n\nexport effect function refuse(reason: string) {\n  throw new Refused({ reason })\n}\n",
  "src/main.ts": [
    "import { Effect } from \"effect\"",
    "import { refuse } from \"./fail.vibe\"",
    "import { shout } from \"./shout.vibe\"",
    "const failure = Effect.runSync(Effect.flip(refuse(\"no\")))",
    "console.log(JSON.stringify({ text: shout(\"hi\"), mapped: /fail\\.vibe:4/.test(String(failure.stack)) }))",
    ""
  ].join("\n")
}

// A project, a compiler that records each compile in calls.jsonl, and a cache
// directory of its own.
async function fixture(t, files = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-cache-test-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const app = join(root, "app")
  mkdirSync(join(app, "node_modules"), { recursive: true })
  symlinkSync(realpathSync(effect), join(app, "node_modules/effect"))
  symlinkSync(runtime, join(app, "node_modules/vibelang-runtime"))
  const calls = join(root, "calls.jsonl")
  const compiler = join(root, "compiler.mjs")
  writeFileSync(compiler, recorder(calls, ""))
  const cache = join(root, "cache")
  write(app, { ...sources, ...files })
  await settle()
  const environment = (env) => ({
    ...process.env, VIBELANG_BINARY: compiler, VIBELANG_CACHE_DIR: cache, VIBELANG_PROJECT: "",
    VIBELANG_DISABLE_CACHE: "", VIBELANG_REGISTER_DEBUG: "1", ...env
  })
  const run = (entry = "src/main.ts", env = {}) =>
    spawnSync(process.execPath, ["--enable-source-maps", "--import", register, entry], {
      cwd: app, encoding: "utf8", env: environment(env)
    })
  const start = (entry = "src/main.ts", env = {}) => {
    const child = spawn(process.execPath, ["--enable-source-maps", "--import", register, entry], {
      cwd: app, env: environment(env)
    })
    let stdout = "", stderr = ""
    child.stdout.on("data", (data) => { stdout += data })
    child.stderr.on("data", (data) => { stderr += data })
    return once(child, "close").then(([status]) => ({ status, stdout, stderr }))
  }
  const compiles = () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").length : 0
  return { root, app, cache, compiler, calls, run, start, compiles }
}

// A compiler that records its call, then runs the native one. `after` is code
// that runs once the native compile has finished.
const recorder = (calls, after) => `import { appendFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
appendFileSync(${JSON.stringify(calls)}, "compile\\n")
const status = spawnSync(${JSON.stringify(native)}, process.argv.slice(2), { stdio: "inherit" }).status ?? 1
${after}
process.exit(status)
`

function write(base, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(base, path)), { recursive: true })
    writeFileSync(join(base, path), text)
  }
}

const ok = (result) => {
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout.trim().split("\n").at(-1))
}

test("a second process reuses the first one's compile, source maps included", { skip }, async (t) => {
  const { run, compiles, cache } = await fixture(t)
  const cold = run()
  assert.deepEqual(ok(cold), { text: "HI!", mapped: true })
  assert.match(cold.stderr, /compiled .*tsconfig\.json in \d+ms \(no entry\)/)
  const warm = run()
  assert.deepEqual(ok(warm), { text: "HI!", mapped: true })
  assert.match(warm.stderr, /tsconfig\.json from the cache in \d+ms/)
  assert.equal(compiles(), 1, "the warm process compiles nothing")
  const entries = readdirSync(cache)
  assert.equal(entries.length, 1)
  assert.match(entries[0], /^[\w-]{32}\.json$/, "no temporary file is left behind")
})

test("an edited source recompiles, even when the edit keeps its size and modification time", { skip }, async (t) => {
  const { app, run, compiles } = await fixture(t)
  ok(run())
  const path = join(app, "src/shout.vibe")
  const { atime, mtime } = statSync(path)
  writeFileSync(path, readFileSync(path, "utf8").replace("toUpperCase", "toLowerCase"))
  utimesSync(path, atime, mtime)
  await settle()
  const result = run()
  assert.deepEqual(ok(result), { text: "hi!", mapped: true })
  assert.match(result.stderr, /shout\.vibe changed/)
  assert.equal(compiles(), 2)
  ok(run())
  assert.equal(compiles(), 2, "the new compile is cached in turn")
})

test("rewriting a source with the same bytes keeps the cache", { skip }, async (t) => {
  const { app, run, compiles } = await fixture(t)
  ok(run())
  const path = join(app, "src/shout.vibe")
  writeFileSync(path, readFileSync(path))
  await settle()
  ok(run())
  assert.equal(compiles(), 1)
})

test("an edited TypeScript file a .vibe module imports recompiles", { skip }, async (t) => {
  const { app, run, compiles } = await fixture(t)
  ok(run())
  writeFileSync(join(app, "src/helper.ts"), "export const suffix = \"?\"\n")
  await settle()
  assert.equal(ok(run()).text, "HI?")
  assert.equal(compiles(), 2)
})

test("a file added anywhere the project includes recompiles", { skip }, async (t) => {
  const { app, run, compiles } = await fixture(t)
  ok(run())
  write(app, {
    "src/deep/er/extra.vibe": "export function extra(): string { return \"extra\" }\n",
    "src/extra.ts": "import { extra } from \"./deep/er/extra.vibe\"\nconsole.log(JSON.stringify(extra()))\n"
  })
  await settle()
  const result = run("src/extra.ts")
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, "\"extra\"\n")
  assert.match(result.stderr, /gained or lost a file/)
  assert.equal(compiles(), 2)
})

test("a file that cannot join the program does not recompile", { skip }, async (t) => {
  const { app, run, compiles } = await fixture(t)
  ok(run())
  write(app, { "src/notes.md": "# notes\n", "src/.shout.vibe.swp": "swap", "README.vibe": "outside the include\n" })
  await settle()
  ok(run())
  assert.equal(compiles(), 1)
})

test("a deleted file recompiles and reports what broke", { skip }, async (t) => {
  const { app, run, compiles } = await fixture(t)
  ok(run())
  unlinkSync(join(app, "src/helper.ts"))
  await settle()
  const result = run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /did not compile/)
  assert.match(result.stderr, /shout\.vibe:1:\d+ - error TS2307/)
  assert.equal(compiles(), 2)
})

test("a changed tsconfig recompiles, including a config it extends", { skip }, async (t) => {
  const { app, run, compiles } = await fixture(t, {
    "tsconfig.base.json": `{\n  // shared options\n  "compilerOptions": ${JSON.stringify(options)},\n}\n`,
    "tsconfig.json": JSON.stringify({ extends: "./tsconfig.base", include: ["src/**/*"] }),
    "src/unused.vibe": "export function unused(): number {\n  const spare = 1\n  return 2\n}\n",
    "src/main.ts": 'import "./unused.vibe"; console.log(42)\n'
  })
  ok(run())
  ok(run())
  assert.equal(compiles(), 1, "a config with comments and trailing commas is cached")
  writeFileSync(join(app, "tsconfig.base.json"), JSON.stringify({ compilerOptions: { ...options, noUnusedLocals: true } }))
  await settle()
  const result = run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /unused\.vibe:2:\d+ - error TS6133/)
  assert.equal(compiles(), 2)
  writeFileSync(join(app, "tsconfig.base.json"), JSON.stringify({ compilerOptions: options }))
  await settle()
  ok(run())
  writeFileSync(join(app, "tsconfig.json"), JSON.stringify({ extends: "./tsconfig.base", include: ["src/**/*"], exclude: [] }))
  await settle()
  ok(run())
  assert.equal(compiles(), 4)
})

test("a changed dependency recompiles", { skip }, async (t) => {
  const asEffect = {
    "node_modules/dep/index.d.ts": "import type { Effect } from \"effect\"\nexport declare function load(): Effect.Effect<string>\n",
    "node_modules/dep/index.js": "import { Effect } from \"effect\"\nexport const load = () => Effect.succeed(\"effect\")\n"
  }
  const asPlain = {
    "node_modules/dep/index.d.ts": "export declare function load(): string\n",
    "node_modules/dep/index.js": "export const load = () => \"plain\"\n"
  }
  const { app, run, compiles } = await fixture(t, {
    "tsconfig.json": tsconfig({ vibelang: { trustedPackages: ["dep"] } }),
    "node_modules/dep/package.json": '{"name":"dep","type":"module","types":"./index.d.ts","main":"./index.js"}',
    ...asEffect,
    "src/loud.vibe": "import { load } from \"dep\"\n\nexport function loud() {\n  return load()\n}\n",
    "src/dep.ts": [
      "import { Effect } from \"effect\"",
      "import { loud } from \"./loud.vibe\"",
      "const value: unknown = loud()",
      "console.log(JSON.stringify(Effect.isEffect(value) ? Effect.runSync(value as Effect.Effect<string>) : value))",
      ""
    ].join("\n")
  })
  assert.equal(ok(run("src/dep.ts")), "effect")
  write(app, asPlain)
  await settle()
  assert.equal(ok(run("src/dep.ts")), "plain")
  assert.equal(compiles(), 2)
  writeFileSync(join(app, "package-lock.json"), "{}\n")
  await settle()
  assert.equal(ok(run("src/dep.ts")), "plain")
  assert.equal(compiles(), 3, "a lockfile change means an install")
})

test("a changed tsconfig of a workspace package whose .vibe source the project reads recompiles", { skip }, async (t) => {
  // The package's .vibe source supplies types to this project's compile with
  // the package's own settings (D297), so its tsconfig decides this compile
  // too. The package's own compile checks that source.
  const { root, app, run, compiles } = await fixture(t, {
    "src/greet.ts": "export { greeting } from \"@acme/dep\"\n",
    "src/greet-main.ts": "import { Effect } from \"effect\"\nimport { greeting } from \"./greet.ts\"\nconsole.log(Effect.runSync(greeting()))\n"
  })
  write(root, {
    "dep/package.json": JSON.stringify({ name: "@acme/dep", type: "module", exports: { ".": "./src/greeting.vibe" } }),
    "dep/tsconfig.json": tsconfig({ vibelang: { trustedPackages: ["@acme/dep"] } }),
    "dep/src/text.ts": "export const text = (): string => \"hello\"\n",
    "dep/src/greeting.vibe": "import { text } from \"./text.ts\"\n\nexport effect function greeting() {\n  return text()\n}\n"
  })
  mkdirSync(join(app, "node_modules/@acme"))
  symlinkSync(join(root, "dep"), join(app, "node_modules/@acme/dep"))
  await settle()
  ok(run())
  ok(run())
  assert.equal(compiles(), 1)
  writeFileSync(join(root, "dep/tsconfig.json"), tsconfig())
  await settle()
  const result = run()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /app\/tsconfig\.json in \d+ms \(.*dep\/tsconfig\.json changed\)/)
  assert.equal(compiles(), 2)
  const loaded = run("src/greet-main.ts")
  assert.notEqual(loaded.status, 0, "a cached compile would hide the untrusted call")
  assert.match(loaded.stderr, /greeting\.vibe:4:\d+ - error EK4401/)
  assert.equal(compiles(), 3, "the package's module compiles with the package's own project")
})

test("a different or rebuilt compiler recompiles", { skip }, async (t) => {
  const { root, run, compiles, compiler, calls } = await fixture(t)
  ok(run())
  const other = join(root, "other-compiler.mjs")
  copyFileSync(compiler, other)
  ok(run("src/main.ts", { VIBELANG_BINARY: other }))
  assert.equal(compiles(), 2)
  writeFileSync(compiler, recorder(calls, "// rebuilt"))
  ok(run())
  assert.equal(compiles(), 3)
})

// drive-t3code-apps 22:30Z: a chmod changes a compiler's ctime, not its bytes,
// and every Vite run then recompiled each package ("compiler changed").
test("a compiler whose stamp changed but whose bytes did not keeps the cache", { skip }, async (t) => {
  const { run, compiles, compiler, calls } = await fixture(t)
  ok(run())
  chmodSync(compiler, statSync(compiler).mode & 0o777)
  ok(run())
  assert.equal(compiles(), 1)
  writeFileSync(compiler, readFileSync(compiler))
  ok(run())
  assert.equal(compiles(), 1)
  writeFileSync(compiler, recorder(calls, "// rebuilt"))
  ok(run())
  assert.equal(compiles(), 2)
})

test("a failed compile is not cached", { skip }, async (t) => {
  const { run, compiles } = await fixture(t, {
    "src/bad.vibe": "export const count: number = \"three\"\n",
    "src/count.ts": "import { count } from \"./bad.vibe\"\nconsole.log(count)\n"
  })
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = run("src/count.ts")
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /bad\.vibe:1:\d+ - error TS2322/)
  }
  assert.equal(compiles(), 2)
})

test("a source edited while the compiler runs is not cached", { skip }, async (t) => {
  const { app, run, compiles, compiler, calls } = await fixture(t)
  const path = join(app, "src/shout.vibe")
  const edited = readFileSync(path, "utf8").replace("toUpperCase", "toLowerCase")
  // The compiler reads the old source; the edit lands before the compile ends.
  writeFileSync(compiler, recorder(calls, `import { writeFileSync } from "node:fs"
writeFileSync(${JSON.stringify(path)}, ${JSON.stringify(edited)})`))
  const first = run()
  assert.match(first.stderr, /shout\.vibe changed during or too close to the compile/)
  // The process itself compiles again for the module that changed (register).
  assert.equal(ok(first).text, "hi!")
  assert.equal(compiles(), 2)
  writeFileSync(compiler, recorder(calls, ""))
  await settle()
  assert.equal(ok(run()).text, "hi!", "no entry pairs the old output with the new source")
  assert.equal(compiles(), 3)
  ok(run())
  assert.equal(compiles(), 3)
})

test("a corrupt entry is a miss that a compile replaces", { skip }, async (t) => {
  const { run, compiles, cache } = await fixture(t)
  ok(run())
  const [entry] = readdirSync(cache)
  writeFileSync(join(cache, entry), "{\"format\":")
  const result = run()
  assert.deepEqual(ok(result), { text: "HI!", mapped: true })
  assert.match(result.stderr, /unreadable entry/)
  ok(run())
  assert.equal(compiles(), 2)
})

test("concurrent processes share one cache directory", { skip }, async (t) => {
  const { run, start, compiles, cache } = await fixture(t)
  const cold = await Promise.all(Array.from({ length: 8 }, () => start()))
  for (const result of cold) assert.deepEqual(ok(result), { text: "HI!", mapped: true })
  const compiled = compiles()
  assert.ok(compiled >= 1 && compiled <= 8)
  const warm = await Promise.all(Array.from({ length: 8 }, () => start()))
  for (const result of warm) assert.deepEqual(ok(result), { text: "HI!", mapped: true })
  assert.equal(compiles(), compiled, "every warm process reads the entry the cold ones wrote")
  assert.deepEqual(readdirSync(cache).filter((name) => !name.endsWith(".json")), [], "no temporary file is left behind")
  ok(run())
})

test("VIBELANG_DISABLE_CACHE=1 compiles in every process and writes nothing", { skip }, async (t) => {
  const { run, compiles, cache } = await fixture(t)
  ok(run("src/main.ts", { VIBELANG_DISABLE_CACHE: "1" }))
  ok(run("src/main.ts", { VIBELANG_DISABLE_CACHE: "1" }))
  assert.equal(compiles(), 2)
  assert.equal(existsSync(cache), false)
})

test("the default cache is a private directory in the temporary directory", { skip }, async (t) => {
  const { root, run, compiles } = await fixture(t)
  const temporary = join(root, "tmp")
  mkdirSync(temporary)
  const env = { VIBELANG_CACHE_DIR: "", TMPDIR: temporary, TMP: temporary, TEMP: temporary }
  ok(run("src/main.ts", env))
  ok(run("src/main.ts", env))
  assert.equal(compiles(), 1)
  const [directory] = readdirSync(temporary)
  assert.match(directory, /^vibelang-cache-/)
  if (process.platform !== "win32") assert.equal(statSync(join(temporary, directory)).mode & 0o777, 0o700)
})

test("a default cache directory another user can write to is not used", { skip: skip || process.platform === "win32" }, async (t) => {
  const { root, run, compiles } = await fixture(t)
  const temporary = join(root, "tmp")
  mkdirSync(join(temporary, `vibelang-cache-${process.getuid()}`), { recursive: true })
  chmodSync(join(temporary, `vibelang-cache-${process.getuid()}`), 0o777)
  const env = { VIBELANG_CACHE_DIR: "", TMPDIR: temporary }
  const result = run("src/main.ts", env)
  ok(result)
  assert.match(result.stderr, /writable by others/)
  ok(run("src/main.ts", env))
  assert.equal(compiles(), 2)
  assert.deepEqual(readdirSync(join(temporary, `vibelang-cache-${process.getuid()}`)), [])
})

test("projects() and compileProjectSync share the cache, and a warm load costs under 50 ms", { skip }, async (t) => {
  const { app, cache, compiler, compiles } = await fixture(t)
  const project = join(app, "tsconfig.json")
  const cold = await projects({ root: app, project, compiler, cache: { directory: cache } }).load(join(app, "src/shout.vibe"))
  assert.match(cold.code, /toUpperCase/)
  const warm = await projects({ root: app, project, compiler, cache: { directory: cache } }).load(join(app, "src/shout.vibe"))
  assert.equal(warm.code, cold.code)
  assert.deepEqual(warm.map, cold.map)
  assert.deepEqual(warm.inputs, cold.inputs)
  assert.equal(compiles(), 1)
  const times = []
  for (let attempt = 0; attempt < 5; attempt++) {
    const started = performance.now()
    const result = compileProjectSync({ project, compiler, cache: { directory: cache } })
    times.push(performance.now() - started)
    assert.equal(result.outputs.get(join(app, "src/shout.vibe")).code, cold.code)
  }
  assert.equal(compiles(), 1)
  const median = times.sort((a, b) => a - b)[2]
  assert.ok(median < 50, `a warm load took ${median.toFixed(1)} ms`)
  assert.equal(compileProjectSync({ project, compiler, cache: false }).outputs.size, 2)
  assert.equal(compiles(), 2, "cache: false compiles")
})
