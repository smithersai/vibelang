import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { compileProjectSync, findCompiler, findProject, formatDiagnostic, moduleDeclarationSource, nearestProject, packageRoot, parseExplainFiles, parseOutput, projectBackend, projectImports, projects, workspaceProject } from "../project.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
const missing = [native, effect, join(runtime, "dist/index.js")].find((path) => !existsSync(path))
const skip = missing !== undefined && `run typescript/vibelang/smoke.sh first; missing ${missing}`

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-project-test-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test("compiler selection prefers explicit options, then environment, then installed package", (t) => {
  const root = fixture(t)
  const previous = process.env.VIBELANG_BINARY
  t.after(() => { if (previous === undefined) delete process.env.VIBELANG_BINARY; else process.env.VIBELANG_BINARY = previous })
  process.env.VIBELANG_BINARY = "environment/compiler"
  assert.equal(findCompiler(root, "configured/compiler"), join(root, "configured/compiler"))
  assert.equal(findCompiler(root), join(root, "environment/compiler"))
  delete process.env.VIBELANG_BINARY
  const installed = join(root, "node_modules/vibelang")
  mkdirSync(installed, { recursive: true })
  writeFileSync(join(installed, "package.json"), '{"name":"vibelang"}')
  assert.equal(findCompiler(root), join(installed, "bin/vibelang"))
})

test("a relative path finds the same project and compiler as an absolute one", (t) => {
  // Metro hands a transformer a filename relative to the project root.
  const root = fixture(t)
  const app = join(root, "app")
  const installed = join(app, "node_modules/vibelang")
  mkdirSync(join(app, "src"), { recursive: true })
  mkdirSync(installed, { recursive: true })
  writeFileSync(join(app, "tsconfig.json"), "{}")
  writeFileSync(join(installed, "package.json"), '{"name":"vibelang"}')
  const previous = { cwd: process.cwd(), binary: process.env.VIBELANG_BINARY }
  t.after(() => {
    process.chdir(previous.cwd)
    if (previous.binary === undefined) delete process.env.VIBELANG_BINARY
    else process.env.VIBELANG_BINARY = previous.binary
  })
  delete process.env.VIBELANG_BINARY
  process.chdir(join(app, "src"))
  const here = realpathSync(".")
  assert.equal(nearestProject("../src/main.vibe"), join(dirname(here), "tsconfig.json"))
  assert.equal(findCompiler(".."), join(dirname(here), "node_modules/vibelang/bin/vibelang"))
})

test("diagnostic parsing preserves multiline detail, CRLF, global messages and dependency files", () => {
  const root = resolve("project with spaces")
  const input = [
    "src/main.vibe(2,17): error TS2322: Type 'string' is not assignable.",
    "  Type detail", "    Nested detail", "warning EK9204: unreachable catch",
    join(root, "src/main.vibe"), join(root, "src/type-only.ts"), "", "ordinary banner"
  ].join("\r\n")
  assert.deepEqual(parseOutput(input, root), {
    diagnostics: [
      { file: join(root, "src/main.vibe"), line: 2, column: 17, category: "error", code: "TS2322", text: "Type 'string' is not assignable.\n  Type detail\n    Nested detail" },
      { category: "warning", code: "EK9204", text: "unreachable catch" }
    ], files: [join(root, "src/main.vibe"), join(root, "src/type-only.ts")]
  })
})

test("wide diagnostic coordinates and messages survive parsing and formatting", () => {
  const root = resolve("project")
  for (let i = 1; i <= 300; i++) {
    const file = `source ${i}.vibe`, line = i * 19, column = i * 31
    const category = i % 2 ? "error" : "warning", code = i % 2 ? "TS2322" : "EK9204"
    const text = `message ${i}: punctuation (x,y), unicode λ, trailing space `
    const result = parseOutput(`${file}(${line},${column}): ${category} ${code}: ${text}\n`, root)
    const expected = { file: join(root, file), line, column, category, code, text }
    assert.deepEqual(result.diagnostics, [expected])
    assert.equal(formatDiagnostic(expected), `${expected.file}:${line}:${column} - ${category} ${code}: ${text}`)
  }
  assert.equal(formatDiagnostic({ category: "error", code: "TS5058", text: "no config" }), "error TS5058: no config")
})

test("a compiler crash without diagnostics reports its output and never returns stale modules", async (t) => {
  const root = fixture(t)
  const compiler = join(root, "crash.mjs")
  writeFileSync(compiler, 'console.error("compiler stopped unexpectedly"); process.exit(17)\n')
  const result = await projectBackend({ root, compiler }).compile(join(root, "tsconfig.json"))
  assert.deepEqual([...result.outputs], [])
  assert.deepEqual(result.errors, [{ category: "error", code: "vibelang", text: "compiler stopped unexpectedly" }])
  assert.deepEqual(result.warnings, [])
})

test("a silent compiler crash reports its exit status", async (t) => {
  const root = fixture(t)
  const compiler = join(root, "silent.mjs")
  writeFileSync(compiler, 'process.exit(19)\n')
  const result = await projectBackend({ root, compiler }).compile(join(root, "tsconfig.json"))
  assert.deepEqual(result.errors, [{ category: "error", code: "vibelang", text: "exited with 19" }])
})

test("a missing compiler reports the command that failed to spawn", async (t) => {
  const root = fixture(t)
  const compiler = join(root, "missing")
  await assert.rejects(projectBackend({ root, compiler }).compile(join(root, "tsconfig.json")), (error) => {
    assert.ok(error.message.includes(`Compiler: ${compiler}`))
    assert.match(error.message, /ENOENT/)
    return true
  })
})

test("a module declaration's output names its .vibe file; other paths name none (D403)", () => {
  assert.equal(moduleDeclarationSource("/app/src/main.vibe.text.js"), "/app/src/main.vibe")
  assert.equal(moduleDeclarationSource("C:\\app\\main.vibe.tools.js"), "C:\\app\\main.vibe")
  for (const path of ["/app/src/main.vibe", "/app/src/main.js", "/app/src/main.vibe.js", "/app/src/main.vibe.a.b.js", "/app/main.vibe/text.js", "/app/src/main.vibe.text.ts"]) {
    assert.equal(moduleDeclarationSource(path), undefined, path)
  }
})

test("the nearest project is the closest tsconfig.json above a file, or none", (t) => {
  const root = fixture(t)
  mkdirSync(join(root, "app/src/nested"), { recursive: true })
  writeFileSync(join(root, "app/tsconfig.json"), "{}")
  assert.equal(nearestProject(join(root, "app/src/nested/main.vibe")), join(root, "app/tsconfig.json"))
  assert.equal(nearestProject(join(root, "elsewhere.vibe")), undefined)
})

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true,
    allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, noEmit: true
  },
  include: ["src/**/*"]
})

// A workspace: an app and a package beside it, each with its own project, and
// a compiler that records each compile's --project in calls.jsonl.
function workspace(t) {
  const root = fixture(t)
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  const calls = join(root, "calls.jsonl")
  const compiler = join(root, "compiler.mjs")
  writeFileSync(compiler, `import { appendFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
const args = process.argv.slice(2)
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args[args.indexOf("--project") + 1]) + "\\n")
process.exit(spawnSync(${JSON.stringify(native)}, args, { stdio: "inherit" }).status ?? 1)
`)
  for (const [path, text] of Object.entries({
    "app/package.json": '{"type":"module"}',
    "app/tsconfig.json": tsconfig,
    "app/src/main.vibe": "export const fromApp: string = \"app\"\n",
    "dep/package.json": '{"type":"module"}',
    "dep/tsconfig.json": tsconfig,
    "dep/src/lib.vibe": "export function shout(text: string): string { return text.toUpperCase() }\n",
    "dep/stray.vibe": "export const stray: number = 1\n",
    // A workspace package nested inside the app's directory, as packages/a/b
    // sits inside packages/a, with its own project.
    "app/packages/inner/package.json": '{"type":"module"}',
    "app/packages/inner/tsconfig.json": tsconfig,
    "app/packages/inner/src/inner.vibe": "export const fromInner: string = \"inner\"\n",
    // A nested package without a tsconfig.json of its own, such as a test fixture.
    "app/fixtures/plain/package.json": '{"type":"module"}'
  })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
    // A source newer than a compile's start makes it compile again (a save
    // during the compile); keep the fixture older than every compile.
    utimesSync(join(root, path), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
  }
  const app = join(root, "app")
  const compiles = () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : []
  return { root, app, compiler, compiles }
}

test("a compile runs the native compiler the vibelang launcher would run, without starting Node for the launcher", { skip: skip || (process.platform === "win32" && "the native stand-in is a shell script") }, async (t) => {
  const { app } = workspace(t)
  const previous = process.env.VIBELANG_BINARY
  t.after(() => { if (previous === undefined) delete process.env.VIBELANG_BINARY; else process.env.VIBELANG_BINARY = previous })
  delete process.env.VIBELANG_BINARY
  // An installed vibelang package whose launcher and native compiler each record a run.
  const runs = join(app, "runs.txt")
  const launcher = join(app, "node_modules/vibelang/bin/vibelang")
  const binary = join(app, "node_modules/vibelang/native/vibelang")
  mkdirSync(dirname(launcher), { recursive: true })
  mkdirSync(dirname(binary), { recursive: true })
  writeFileSync(join(app, "node_modules/vibelang/package.json"), '{"name":"vibelang","type":"module"}')
  writeFileSync(launcher, `#!/usr/bin/env node
import { appendFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
appendFileSync(${JSON.stringify(runs)}, "launcher\\n")
process.exit(spawnSync(${JSON.stringify(binary)}, process.argv.slice(2), { stdio: "inherit" }).status ?? 1)
`)
  writeFileSync(binary, `#!/bin/sh\necho native >> '${runs}'\nexec '${native}' "$@"\n`)
  chmodSync(launcher, 0o755)
  chmodSync(binary, 0o755)
  const compiler = findCompiler(app)
  assert.equal(compiler, launcher)
  const result = compileProjectSync({ project: join(app, "tsconfig.json"), compiler, cache: false })
  assert.deepEqual(result.errors, [])
  assert.match(result.outputs.get(join(app, "src/main.vibe")).code, /fromApp = "app"/)
  assert.equal(readFileSync(runs, "utf8"), "native\n")
})

test("a module outside root compiles with its own package's project, once per revision", { skip }, async (t) => {
  const { root, app, compiler, compiles } = workspace(t)
  const modules = projects({ root: app, project: join(app, "tsconfig.json"), compiler, cache: false })
  const main = await modules.load(join(app, "src/main.vibe"))
  const lib = await modules.load(join(root, "dep/src/lib.vibe"))
  assert.equal(main.project, join(app, "tsconfig.json"))
  assert.equal(lib.project, join(root, "dep/tsconfig.json"))
  assert.match(main.code, /fromApp = "app"/)
  assert.match(lib.code, /toUpperCase/)
  assert.deepEqual([main.errors, main.error, lib.errors, lib.error], [[], false, [], false])
  assert.ok(lib.map.sources.includes(join(root, "dep/src/lib.vibe")))
  await modules.load(join(root, "dep/src/lib.vibe"))
  assert.deepEqual(compiles(), [join(app, "tsconfig.json"), join(root, "dep/tsconfig.json")])
  modules.invalidate()
  await modules.load(join(root, "dep/src/lib.vibe"))
  assert.deepEqual(compiles().slice(2), [join(root, "dep/tsconfig.json")], "a new revision compiles only the project asked for")
})

test("a project's compile checks its own files; an imported workspace package's source only supplies types", { skip }, async (t) => {
  // Each module holds one warning (EK4833), which a check of that module reports.
  // Checking every imported package in each project's compile checked a
  // package once per project that imports it.
  const { root, app, compiler, compiles } = workspace(t)
  const unreachable = (name) => `import { Effect } from "effect"\nexport const ${name}: Effect.Effect<number> = Effect.succeed(1)\n`
  for (const [path, text] of Object.entries({
    "dep/src/lib.vibe": unreachable("fromLib") + "export function shout(text: string): string { return text.toUpperCase() }\n",
    "app/src/main.vibe": "import { shout } from \"../../dep/src/lib.vibe\"\n" + unreachable("fromMain") + "export const fromApp: string = shout(\"app\")\n"
  })) {
    writeFileSync(join(root, path), text)
    utimesSync(join(root, path), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
  }
  const compile = (dir) => projectBackend({ root: dir, compiler, cache: false }).compile(join(dir, "tsconfig.json"))
  const warnings = (result) => result.warnings.map(({ file, code }) => [file, code])
  const main = await compile(app)
  assert.deepEqual(main.errors, [])
  assert.deepEqual(warnings(main), [[join(app, "src/main.vibe"), "EK4833"]])
  assert.match(main.outputs.get(join(app, "src/main.vibe")).code, /shout\("app"\)/)
  assert.ok(main.inputs.includes(join(root, "dep/src/lib.vibe")), "the package's source still supplies its types")
  const lib = await compile(join(root, "dep"))
  assert.deepEqual(lib.errors, [])
  assert.deepEqual(warnings(lib), [[join(root, "dep/src/lib.vibe"), "EK4833"]])
  assert.deepEqual(compiles(), [join(app, "tsconfig.json"), join(root, "dep/tsconfig.json")])
})

// A package with several tsconfigs and no package.json in each, as Smithers'
// apps/mvp: the app's own, the worker's (which also includes ../db), and others.
function siblings(t, files) {
  const root = fixture(t)
  const options = {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true,
    allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, noEmit: true
  }
  const old = new Date(Date.now() - 60_000)
  for (const [path, value] of Object.entries({ "package.json": '{"type":"module"}', ...files })) {
    const text = typeof value === "string" ? value : JSON.stringify({ compilerOptions: options, ...value })
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
    utimesSync(join(root, path), old, old)
  }
  const modules = projects({ root, project: join(root, "tsconfig.json"), compiler: native, cache: false })
  t.after(() => modules.close())
  return { root, modules }
}

const value = "export const value: number = 1\n"

test("smithers-mvp: a module only a sibling tsconfig includes compiles under that tsconfig", { skip }, async (t) => {
  const { root, modules } = siblings(t, {
    "tsconfig.json": { include: ["src"] },
    "src/app.vibe": "export const app: string = \"app\"\n",
    "worker/tsconfig.json": { include: [".", "../db"] },
    "worker/main.vibe": "import { x } from \"../db/x.vibe\"\nexport const worker: number = x + 1\n",
    "db/x.vibe": "export const x: number = 41\n"
  })
  const db = await modules.load(join(root, "db/x.vibe"))
  assert.deepEqual([db.project, db.errors, db.error], [join(root, "worker/tsconfig.json"), [], false])
  assert.match(db.code, /x = 41/)
  const worker = await modules.load(join(root, "worker/main.vibe"))
  assert.deepEqual([worker.project, worker.errors, worker.error], [join(root, "worker/tsconfig.json"), [], false])
  const app = await modules.load(join(root, "src/app.vibe"))
  assert.deepEqual([app.project, app.errors, app.error], [join(root, "tsconfig.json"), [], false])
  assert.equal(modules.projectOf(join(root, "db/x.vibe")), join(root, "worker/tsconfig.json"))
})

test("smithers-mvp: sibling project selection preserves worker ambient types", { skip }, async (t) => {
  const { root, modules } = siblings(t, {
    "tsconfig.json": { include: ["src"] },
    "src/app.vibe": value,
    "src/env.d.ts": 'type HostKind = "client"\n',
    "worker/tsconfig.json": { include: [".", "../db"] },
    "worker/env.d.ts": 'type HostKind = "worker"\n',
    "db/x.vibe": 'export const host: HostKind = "worker"\n'
  })
  const loaded = await modules.load(join(root, "db/x.vibe"))
  assert.deepEqual([loaded.project, loaded.errors, loaded.error], [join(root, "worker/tsconfig.json"), [], false])
  assert.match(loaded.code, /host = "worker"/)
})

test("a root project with nothing to compile does not hide a sibling tsconfig's module (TS18003)", { skip }, async (t) => {
  const { root, modules } = siblings(t, {
    "tsconfig.json": { include: ["src"] },
    "worker/tsconfig.json": { include: [".", "../db"] },
    "db/x.vibe": "export const x: number = 41\n"
  })
  const db = await modules.load(join(root, "db/x.vibe"))
  assert.deepEqual([db.project, db.errors, db.error], [join(root, "worker/tsconfig.json"), [], false])
})

test("a module two tsconfigs include compiles under the nearest, as TypeScript's language service picks", { skip }, async (t) => {
  const { root, modules } = siblings(t, {
    "tsconfig.json": { include: ["."] },
    "worker/tsconfig.json": { include: ["."] },
    "worker/a.vibe": value,
    "src/b.vibe": value
  })
  assert.equal((await modules.load(join(root, "worker/a.vibe"))).project, join(root, "worker/tsconfig.json"))
  assert.equal((await modules.load(join(root, "src/b.vibe"))).project, join(root, "tsconfig.json"))
})

test("an imported module of the nearest project stays there, even when a sibling includes it", { skip }, async (t) => {
  const { root, modules } = siblings(t, {
    "tsconfig.json": { include: ["src"] },
    "src/app.vibe": "import { value } from \"../db/x.vibe\"\nexport const app: number = value\n",
    "worker/tsconfig.json": { include: ["../db"] },
    "db/x.vibe": value
  })
  assert.equal((await modules.load(join(root, "db/x.vibe"))).project, join(root, "tsconfig.json"))
})

test("of siblings, the first by path that includes a module wins; one that only imports it loses", { skip }, async (t) => {
  const { root, modules } = siblings(t, {
    "tsconfig.json": { include: ["src"] },
    "src/app.vibe": value,
    // First by path, but it only imports the module, as evals/ imports ../db in apps/mvp.
    "a/tsconfig.json": { include: ["."] },
    "a/main.vibe": "import { value } from \"../db/x.vibe\"\nexport const main: number = value\n",
    "m/tsconfig.json": { include: ["../db"] },
    "z/tsconfig.json": { include: ["../db"] },
    "db/x.vibe": value
  })
  assert.equal((await modules.load(join(root, "db/x.vibe"))).project, join(root, "m/tsconfig.json"))
})

test("a sibling that only imports a module serves it when no tsconfig includes it", { skip }, async (t) => {
  const { root, modules } = siblings(t, {
    "tsconfig.json": { include: ["src"] },
    "src/app.vibe": value,
    "b/tsconfig.json": { include: ["."] },
    "b/main.vibe": "import { value } from \"../db/x.vibe\"\nexport const main: number = value\n",
    "db/x.vibe": value
  })
  assert.equal((await modules.load(join(root, "db/x.vibe"))).project, join(root, "b/tsconfig.json"))
})

test("references come before other tsconfigs, in the order they are written, as tsc -b reads them", { skip }, async (t) => {
  const { root, modules } = siblings(t, {
    "tsconfig.json": { files: [], references: [{ path: "./z" }, { path: "./m/tsconfig.json" }] },
    "a/tsconfig.json": { include: ["../db"] },
    "m/tsconfig.json": { include: ["../db"] },
    "z/tsconfig.json": { include: ["../db"] },
    "db/x.vibe": value
  })
  assert.equal((await modules.load(join(root, "db/x.vibe"))).project, join(root, "z/tsconfig.json"))
})

test("a module no tsconfig includes is an error that names every tsconfig asked", { skip }, async (t) => {
  const { root, modules } = siblings(t, {
    "tsconfig.json": { include: ["src"] },
    "src/app.vibe": value,
    "worker/tsconfig.json": { include: ["."] },
    "worker/main.vibe": value,
    "tests/orphan.vibe": value
  })
  const orphan = await modules.load(join(root, "tests/orphan.vibe"))
  assert.equal(orphan.error.id, join(root, "tests/orphan.vibe"))
  assert.match(orphan.error.message, /orphan\.vibe is not part of .*\/tsconfig\.json or .*\/worker\/tsconfig\.json\. Add it to the tsconfig's include\./)
  assert.match(orphan.code, /did not compile/)
})

test("a custom-named tsconfig and a nested package's tsconfig are never asked", { skip }, async (t) => {
  const { root, modules } = siblings(t, {
    "tsconfig.json": { include: ["src"] },
    "src/app.vibe": value,
    "tsconfig.tools.json": { include: ["db"] },
    "tools/tsconfig.tools.json": { include: ["../db"] },
    "inner/package.json": '{"type":"module"}',
    "inner/tsconfig.json": { include: ["../db"] },
    "db/x.vibe": value
  })
  const db = await modules.load(join(root, "db/x.vibe"))
  assert.match(db.error.message, /x\.vibe is not part of [^ ]*\/tsconfig\.json\. Add it/)
})

test("a saved tsconfig moves a module on the next revision", { skip }, async (t) => {
  const { root, modules } = siblings(t, {
    "tsconfig.json": { include: ["src"] },
    "src/app.vibe": value,
    "a/tsconfig.json": { include: ["../db"] },
    "b/tsconfig.json": { include: ["."] },
    "b/main.vibe": value,
    "db/x.vibe": value
  })
  const file = join(root, "db/x.vibe")
  assert.equal((await modules.load(file)).project, join(root, "a/tsconfig.json"))
  const config = JSON.parse(readFileSync(join(root, "a/tsconfig.json"), "utf8"))
  writeFileSync(join(root, "a/tsconfig.json"), JSON.stringify({ ...config, include: ["."] }))
  writeFileSync(join(root, "a/main.vibe"), value)
  writeFileSync(join(root, "b/tsconfig.json"), JSON.stringify({ ...config, include: [".", "../db"] }))
  modules.invalidate()
  assert.equal((await modules.load(file)).project, join(root, "b/tsconfig.json"))
})

test("workspaceProject starts at the nearest config; a nested package without one stays in the project asked for", (t) => {
  const root = fixture(t)
  for (const path of ["tsconfig.json", "worker/tsconfig.json", "plain/package.json", "plain/deep/x.txt"]) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), "{}")
  }
  const project = join(root, "tsconfig.json")
  assert.equal(workspaceProject(join(root, "worker/deep/a.vibe"), root, project), join(root, "worker/tsconfig.json"))
  assert.equal(workspaceProject(join(root, "db/a.vibe"), root, project), project)
  assert.equal(workspaceProject(join(root, "plain/deep/a.vibe"), root, project), project)
})

test("a package root is the nearest package.json's directory, else the path's own", (t) => {
  const root = fixture(t)
  mkdirSync(join(root, "app/worker"), { recursive: true })
  writeFileSync(join(root, "app/package.json"), "{}")
  assert.equal(packageRoot(join(root, "app/worker/tsconfig.json")), join(root, "app"))
  assert.equal(packageRoot(join(root, "other/tsconfig.json")), join(root, "other"))
})

test("findProject reports the configs it asked and keeps each listing for the next module", { skip }, (t) => {
  const { root } = siblings(t, {
    "tsconfig.json": { include: ["src"] },
    "src/app.vibe": value,
    "worker/tsconfig.json": { include: ["../db"] },
    "db/x.vibe": value,
    "db/y.vibe": value
  })
  const programs = new Map()
  const tried = join(root, "tsconfig.json")
  const found = findProject(join(root, "db/x.vibe"), { tried, compiler: native, programs })
  assert.deepEqual(found, { project: join(root, "worker/tsconfig.json"), searched: [join(root, "worker/tsconfig.json")] })
  assert.deepEqual([...programs.keys()], [join(root, "worker/tsconfig.json")])
  const listing = programs.get(join(root, "worker/tsconfig.json"))
  assert.equal(findProject(join(root, "db/y.vibe"), { tried, compiler: native, programs }).project, join(root, "worker/tsconfig.json"))
  assert.equal(programs.get(join(root, "worker/tsconfig.json")), listing)
  // A module declaration's output asks for its .vibe file.
  assert.equal(findProject(join(root, "db/x.vibe.text.js"), { tried, compiler: native, programs }).project, join(root, "worker/tsconfig.json"))
})

test("a module of a package nested inside root compiles with that package's own project", { skip }, async (t) => {
  const { app, compiler, compiles } = workspace(t)
  const modules = projects({ root: app, project: join(app, "tsconfig.json"), compiler, cache: false })
  const inner = await modules.load(join(app, "packages/inner/src/inner.vibe"))
  assert.equal(inner.project, join(app, "packages/inner/tsconfig.json"))
  assert.match(inner.code, /fromInner = "inner"/)
  assert.deepEqual([inner.errors, inner.error], [[], false])
  assert.ok(inner.map.sources.includes(join(app, "packages/inner/src/inner.vibe")))
  assert.deepEqual(compiles(), [join(app, "packages/inner/tsconfig.json")])
  // Root's own directories, and a nested package without a project of its own, stay in root's project.
  assert.equal(modules.projectOf(join(app, "src/deep/main.vibe")), join(app, "tsconfig.json"))
  assert.equal(modules.projectOf(join(app, "fixtures/plain/thing.vibe")), join(app, "tsconfig.json"))
})

test("a root module that imports a nested package through node_modules compiles, and so does that package's module", { skip }, async (t) => {
  const { root, app, compiler } = workspace(t)
  for (const [path, text] of Object.entries({
    "app/packages/inner/package.json": JSON.stringify({ name: "inner", type: "module", exports: { "./inner": "./src/inner.vibe" } }),
    "app/src/uses-inner.vibe": 'import { fromInner } from "inner/inner"\nexport const both: string = `${fromInner}!`\n'
  })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
    utimesSync(join(root, path), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
  }
  // A workspace link, as a package manager makes one.
  mkdirSync(join(app, "node_modules"), { recursive: true })
  symlinkSync(join(app, "packages/inner"), join(app, "node_modules/inner"), "dir")
  const modules = projects({ root: app, project: join(app, "tsconfig.json"), compiler, cache: false })
  const uses = await modules.load(join(app, "src/uses-inner.vibe"))
  assert.deepEqual([uses.errors, uses.error], [[], false])
  assert.match(uses.code, /from "inner\/inner"/)
  const inner = await modules.load(join(app, "packages/inner/src/inner.vibe"))
  assert.deepEqual([inner.errors, inner.error], [[], false])
  assert.match(inner.code, /fromInner = "inner"/)
})

test("a project whose rootDir holds sources above root compiles them, without TS6059", { skip }, async (t) => {
  const { root, app, compiler } = workspace(t)
  for (const [path, text] of Object.entries({
    "shared/clock.ts": "export const now = (): number => 7\n",
    // A test project that reaches a sibling package's source by a relative
    // path widens rootDir to their common directory.
    "app/tsconfig.test.json": JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { rootDir: ".." } }),
    "app/src/main.vibe": 'import { now } from "../../shared/clock.ts"\nexport const fromApp: number = now()\n'
  })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
    utimesSync(join(root, path), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
  }
  const modules = projects({ root: app, project: join(app, "tsconfig.test.json"), compiler, cache: false })
  const main = await modules.load(join(app, "src/main.vibe"))
  assert.deepEqual([main.errors, main.error], [[], false])
  assert.match(main.code, /fromApp = now\(\)/)
  assert.ok(main.map.sources.includes(join(app, "src/main.vibe")))
})

test("a check-only project that imports .ts files compiles, without TS5096", { skip }, async (t) => {
  const { root, app, compiler } = workspace(t)
  for (const [path, text] of Object.entries({
    // Typechecked with `vibelang -p --noEmit`, it sets neither noEmit nor a rewrite.
    "app/tsconfig.check.json": JSON.stringify({
      extends: "./tsconfig.json",
      compilerOptions: { noEmit: false, rewriteRelativeImportExtensions: false }
    }),
    "app/src/helper.ts": "export const seven = (): number => 7\n",
    "app/src/main.vibe": 'import { seven } from "./helper.ts"\nexport const fromApp: number = seven()\n'
  })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
    utimesSync(join(root, path), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
  }
  const modules = projects({ root: app, project: join(app, "tsconfig.check.json"), compiler, cache: false })
  const main = await modules.load(join(app, "src/main.vibe"))
  assert.deepEqual([main.errors, main.error], [[], false])
  assert.match(main.code, /from "\.\/helper\.js"/)
})

// A project's references, none of them built: the loader compiles a project
// with --loader-root, so a referenced project's declaration output (lib/*.d.ts)
// does not exist until something builds it. Each shape reaches a referenced
// project's source: by a relative path, through a package whose exports name
// its source, and through a reference of a reference.
const unbuiltReferences = {
  relative: {
    "app/src/main.vibe": 'import { now } from "../../shared/src/clock.ts"\nexport const fromApp: number = now()\n'
  },
  "package exports": {
    "shared/package.json": JSON.stringify({ name: "shared", type: "module", exports: { "./clock": "./src/clock.ts" } }),
    "app/node_modules/shared": "link:shared",
    "app/src/main.vibe": 'import { now } from "shared/clock"\nexport const fromApp: number = now()\n'
  },
  transitive: {
    "base/tsconfig.json": "composite",
    "base/src/seven.ts": "export const seven = (): number => 7\n",
    "shared/tsconfig.json": "composite:../base",
    "shared/src/clock.ts": 'import { seven } from "../../base/src/seven.ts"\nexport const now = (): number => seven()\n',
    "app/src/main.vibe": 'import { now } from "../../shared/src/clock.ts"\nexport const fromApp: number = now()\n'
  }
}
for (const [shape, files] of Object.entries(unbuiltReferences)) {
  test(`a project whose referenced project is not built compiles against its source, without TS6305 (${shape})`, { skip }, async (t) => {
    const { root, app, compiler } = workspace(t)
    const composite = (...references) => JSON.stringify({
      compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, noEmit: false, composite: true, rootDir: "src", outDir: "lib", declaration: true },
      include: ["src"], references: references.map((path) => ({ path }))
    })
    for (const [path, text] of Object.entries({
      "app/tsconfig.json": JSON.stringify({ ...JSON.parse(tsconfig), references: [{ path: "../shared" }] }),
      "shared/tsconfig.json": "composite",
      "shared/src/clock.ts": "export const now = (): number => 7\n",
      ...files
    })) {
      const target = join(root, path)
      mkdirSync(dirname(target), { recursive: true })
      if (text.startsWith("link:")) { symlinkSync(join(root, text.slice(5)), target, "dir"); continue }
      writeFileSync(target, text.startsWith("composite") ? composite(...text.split(":").slice(1)) : text)
      utimesSync(target, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
    }
    const modules = projects({ root: app, project: join(app, "tsconfig.json"), compiler, cache: false })
    const main = await modules.load(join(app, "src/main.vibe"))
    assert.deepEqual([main.errors, main.error], [[], false])
    assert.match(main.code, /fromApp = now\(\)/)
    for (const project of ["shared", "base"]) assert.equal(existsSync(join(root, project, "lib")), false, `the compile builds no ${project}/lib`)
  })
}

test("a module declaration compiles to an output of its own from its file's compile, and its body is no input file (D403)", { skip }, async (t) => {
  const { app, compiler, compiles } = workspace(t)
  const main = join(app, "src/main.vibe")
  writeFileSync(main, [
    "module tools {",
    "  export function shout(text: string): string { return text.toUpperCase() }",
    "}",
    "import { shout } from tools",
    "export function fromApp() {",
    "  return sync(() => shout(\"app\"))",
    "}",
    ""
  ].join("\n"))
  utimesSync(main, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
  const modules = projects({ root: app, project: join(app, "tsconfig.json"), compiler })
  const loaded = await modules.load(main)
  assert.deepEqual([loaded.errors, loaded.error], [[], false])
  assert.match(loaded.code, /import \{ shout \} from "\.\/main\.vibe\.tools\.js"/)
  assert.doesNotMatch(loaded.code, /toUpperCase/, "the file's output does not hold the module")
  const tools = await modules.load(join(app, "src/main.vibe.tools.js"))
  assert.deepEqual([tools.errors, tools.error], [[], false])
  assert.match(tools.code, /export function shout\(text\) \{ return text\.toUpperCase\(\); \}/)
  assert.deepEqual(tools.map.sources, [main], "the module's source map names its .vibe file")
  assert.ok(loaded.inputs.includes(main))
  assert.deepEqual(loaded.inputs.filter((input) => !existsSync(input)), [], "every input is a file on disk")
  await modules.load(main)
  assert.deepEqual(compiles(), [join(app, "tsconfig.json")], "a body that is not on disk never looks changed")
})

test("a bundler loads clean modules despite baseline errors and rejects the loaded bad source", { skip }, async (t) => {
  const { root, app, compiler } = workspace(t)
  writeFileSync(join(root, "dep/src/bad.vibe"), "export const count: number = \"three\"\n")
  utimesSync(join(root, "dep/src/bad.vibe"), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
  const modules = projects({ root: app, project: join(app, "tsconfig.json"), compiler, cache: false })
  const first = await modules.load(join(root, "dep/src/lib.vibe"))
  const second = await modules.load(join(root, "dep/src/bad.vibe"))
  assert.equal(first.errors.length, 0)
  assert.ok(first.map, "the clean module has emitted JavaScript and a source map")
  assert.equal(second.errors.length, 1)
  assert.match(formatDiagnostic(second.errors[0]), /bad\.vibe:1:\d+ - error TS2322/)
  assert.deepEqual([first.first, second.first], [true, false], "first still identifies the first module of the compile")
  assert.equal((await modules.load(join(root, "dep/src/bad.vibe"))).first, false)
  assert.match(second.code, /did not compile/)
  rmSync(join(root, "dep/src/bad.vibe"))
  modules.invalidate()
  const outside = await modules.load(join(root, "dep/stray.vibe"))
  assert.match(outside.error.message, /dep\/stray\.vibe is not part of .*dep\/tsconfig\.json/)
})

test("explainFiles parsing keeps written imports with their resolved files and drops compiler-added ones", () => {
  const root = resolve("project")
  const input = [
    "bundled:///libs/lib.es5.d.ts",
    "   Library 'lib.es5.d.ts' specified in compilerOptions",
    "src/b.vibe",
    "   Matched by include pattern 'src/**/*' in 'tsconfig.json'",
    "   Imported via \"./b.vibe\" from file 'src/a.ts'",
    "   Imported via './b.vibe' from file 'src/it's.ts'",
    "../node_modules/effect/dist/index.d.ts",
    "   Imported via \"effect\" from file 'src/b.vibe' with packageId 'effect/dist/index.d.ts@4.1.1'",
    "   Imported via \"effect\" from file 'src/b.vibe' with packageId 'effect/dist/index.d.ts@4.1.1' to import 'jsx' and 'jsxs' factory functions",
    "src/a.ts",
    "   Matched by include pattern 'src/**/*' in 'tsconfig.json'",
    "   File is ECMAScript module because 'package.json' has field \"type\" with value \"module\"",
    "tsconfig.json(3,5): error TS5023: Unknown compiler option 'nope'.",
    "  detail of the option error"
  ].join("\r\n")
  assert.deepEqual(parseExplainFiles(input, root), {
    files: [join(root, "src/b.vibe"), resolve(root, "../node_modules/effect/dist/index.d.ts"), join(root, "src/a.ts")],
    roots: [join(root, "src/b.vibe"), join(root, "src/a.ts")],
    imports: [
      { importer: join(root, "src/a.ts"), specifier: "./b.vibe", file: join(root, "src/b.vibe") },
      { importer: join(root, "src/it's.ts"), specifier: "./b.vibe", file: join(root, "src/b.vibe") },
      { importer: join(root, "src/b.vibe"), specifier: "effect", file: resolve(root, "../node_modules/effect/dist/index.d.ts") }
    ],
    diagnostics: [
      { file: join(root, "tsconfig.json"), line: 3, column: 5, category: "error", code: "TS5023", text: "Unknown compiler option 'nope'.\n  detail of the option error" }
    ]
  })
})

test("a project's imports name every program file and what each import resolved to, .vibe included", { skip }, (t) => {
  const { app, compiler } = workspace(t)
  for (const [path, text] of Object.entries({
    "src/main.vibe": "import { shout } from \"./loud.ts\"\nimport type { Volume } from \"./volume.vibe\"\nexport const fromApp: string = shout(\"app\")\n",
    "src/loud.ts": "export const shout = (text: string): string => text.toUpperCase()\nexport const later = () => import(\"./main.vibe\")\n",
    "src/volume.vibe": "export type Volume = \"quiet\" | \"loud\"\n"
  })) writeFileSync(join(app, path), text)
  const { files, imports, errors } = projectImports({ project: join(app, "tsconfig.json"), compiler })
  assert.deepEqual(errors, [])
  for (const file of ["src/main.vibe", "src/loud.ts", "src/volume.vibe"]) assert.ok(files.includes(join(app, file)), file)
  const own = imports.filter(({ importer, file }) => importer.startsWith(app + "/") && file.startsWith(app + "/"))
  assert.deepEqual(own.map(({ importer, specifier, file }) => [importer.slice(app.length + 1), specifier, file.slice(app.length + 1)]).sort(), [
    ["src/loud.ts", "./main.vibe", "src/main.vibe"],
    ["src/main.vibe", "./loud.ts", "src/loud.ts"],
    ["src/main.vibe", "./volume.vibe", "src/volume.vibe"]
  ])
})

test("explainFiles parsing gives a module declaration's imports to its .vibe file, the only file", () => {
  const root = resolve("project")
  const input = [
    "src/loud.ts",
    "   Imported via \"./loud.ts\" from file 'src/main.vibe.text.ts'",
    "   Matched by include pattern 'src/**/*' in 'tsconfig.json'",
    "src/main.vibe.text.ts",
    "   Supplemental virtual file produced by the content mapper for file 'src/main.vibe'.",
    "src/main.vibe",
    "   Matched by include pattern 'src/**/*' in 'tsconfig.json'"
  ].join("\n")
  assert.deepEqual(parseExplainFiles(input, root), {
    files: [join(root, "src/loud.ts"), join(root, "src/main.vibe")],
    roots: [join(root, "src/loud.ts"), join(root, "src/main.vibe")],
    imports: [{ importer: join(root, "src/main.vibe"), specifier: "./loud.ts", file: join(root, "src/loud.ts") }],
    diagnostics: []
  })
})

test("a module declaration's imports are its .vibe file's, and its body is not a file", { skip }, (t) => {
  const { app, compiler } = workspace(t)
  for (const [path, text] of Object.entries({
    "src/main.vibe": [
      "module text {",
      "  import { shout } from \"./loud.ts\"",
      "  export const loud = (value: string): string => shout(value)",
      "}",
      "import { loud } from text",
      "export const fromApp: string = loud(\"app\")",
      ""
    ].join("\n"),
    "src/loud.ts": "export const shout = (text: string): string => text.toUpperCase()\n"
  })) writeFileSync(join(app, path), text)
  const { files, imports, errors } = projectImports({ project: join(app, "tsconfig.json"), compiler })
  assert.deepEqual(errors, [])
  const own = (file) => file.startsWith(app + "/") && !file.includes("/node_modules/")
  assert.deepEqual(files.filter(own).map((file) => file.slice(app.length + 1)).sort(), ["src/loud.ts", "src/main.vibe"])
  assert.deepEqual(
    imports.filter(({ importer, file }) => own(importer) && own(file)).map(({ importer, specifier, file }) => [importer.slice(app.length + 1), specifier, file.slice(app.length + 1)]),
    [["src/main.vibe", "./loud.ts", "src/loud.ts"]]
  )
})

test("a project the compiler cannot read reports its diagnostics instead of an empty graph", { skip }, (t) => {
  const { app, compiler } = workspace(t)
  writeFileSync(join(app, "tsconfig.json"), JSON.stringify({ compilerOptions: { notAnOption: true }, include: ["src/**/*"] }))
  const { errors } = projectImports({ project: join(app, "tsconfig.json"), compiler })
  assert.equal(errors.length, 1)
  assert.match(formatDiagnostic(errors[0]), /tsconfig\.json:\d+:\d+ - error TS5023: Unknown compiler option 'notAnOption'/)
})

// Date.now() truncates milliseconds while filesystem mtimes retain fractions.
// Model a save just before compilation, in the same integer millisecond.
test("a fractional mtime in the compile start millisecond does not trigger another compile", { skip }, async (t) => {
  const { app, compiler, compiles } = workspace(t)
  const source = join(app, "src/main.vibe")
  const seconds = (Date.now() - 1000 + 0.5) / 1000
  utimesSync(source, seconds, seconds)
  const mtime = statSync(source).mtimeMs
  assert.ok(mtime > Math.floor(mtime), "fixture needs a fractional mtime")
  t.mock.method(Date, "now", () => Math.floor(mtime), { times: 1 })
  const trace = []
  const modules = projects({ root: app, project: join(app, "tsconfig.json"), compiler, cache: false, debug: (line) => trace.push(line) })
  const loaded = await modules.load(source)
  assert.deepEqual(loaded.errors, [])
  assert.match(loaded.code, /fromApp = "app"/)
  assert.equal(compiles().length, 1, trace.join("\n"))
})

test("a source saved after the compiler reads it is compiled again before load returns", { skip }, async (t) => {
  const { root, app, compiler, compiles } = workspace(t)
  const source = join(app, "src/main.vibe")
  writeFileSync(compiler, `import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
const args = process.argv.slice(2)
const calls = ${JSON.stringify(join(root, "calls.jsonl"))}
appendFileSync(calls, JSON.stringify(args[args.indexOf("--project") + 1]) + "\\n")
const result = spawnSync(${JSON.stringify(native)}, args, { stdio: "inherit" })
if (readFileSync(calls, "utf8").trim().split("\\n").length === 1) {
  writeFileSync(${JSON.stringify(source)}, ${JSON.stringify('export const fromApp: string = "saved"\n')})
}
process.exit(result.status ?? 1)
`)
  const trace = []
  const modules = projects({ root: app, project: join(app, "tsconfig.json"), compiler, cache: false, debug: (line) => trace.push(line) })
  const loaded = await modules.load(source)
  assert.deepEqual(loaded.errors, [])
  assert.match(loaded.code, /fromApp = "saved"/)
  assert.equal(compiles().length, 2, trace.join("\n"))
  assert.ok(trace.some((line) => line.includes("changed during compile 0")), trace.join("\n"))
})

// Run from another cwd so relative paths exercise the public entry point,
// including installed-package discovery, without changing the test runner's cwd.
for (const project of ["tsconfig.json", "packages/app/tsconfig.json"]) {
  for (const configured of [false, true]) {
    test(`projectImports resolves ${project} from cwd with ${configured ? "an explicit" : "the installed"} compiler`, (t) => {
      const cwd = fixture(t)
      const root = dirname(join(cwd, project))
      mkdirSync(root, { recursive: true })
      writeFileSync(join(cwd, project), "{}")
      const pkg = join(cwd, "node_modules/vibelang")
      mkdirSync(join(pkg, "bin"), { recursive: true })
      writeFileSync(join(pkg, "package.json"), '{"name":"vibelang","type":"module"}')
      const compiler = join(pkg, "bin/vibelang")
      writeFileSync(compiler, `#!/usr/bin/env node
import { readFileSync } from "node:fs"
const args = process.argv.slice(2)
readFileSync(args[args.indexOf("--project") + 1], "utf8")
console.log("src/main.vibe")
console.log('node_modules/dep/index.d.ts')
console.log(${JSON.stringify("   Imported via \"dep\" from file 'src/main.vibe'")})
`)
      const options = { project, ...(configured ? { compiler } : {}) }
      const env = { ...process.env }
      delete env.VIBELANG_BINARY
      const run = spawnSync(process.execPath, ["--input-type=module", "-e", `
import { projectImports } from ${JSON.stringify(new URL("../project.mjs", import.meta.url).href)}
console.log(JSON.stringify(projectImports(${JSON.stringify(options)})))
`], { cwd, env, encoding: "utf8" })
      assert.equal(run.status, 0, run.stdout + run.stderr)
      assert.deepEqual(JSON.parse(run.stdout), {
        files: [join(root, "src/main.vibe"), join(root, "node_modules/dep/index.d.ts")],
        imports: [{ importer: join(root, "src/main.vibe"), specifier: "dep", file: join(root, "node_modules/dep/index.d.ts") }],
        errors: []
      })
    })
  }
}

for (const change of ["absent", "deleted", "created"]) {
  test(`a config ${change} during compilation settles with diagnostics`, async (t) => {
    const root = fixture(t)
    const project = join(root, "tsconfig.json")
    const compiler = join(root, "compiler.mjs")
    const calls = join(root, "calls")
    if (change === "deleted") writeFileSync(project, "{}")
    writeFileSync(compiler, `import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs"
const project = ${JSON.stringify(project)}
const calls = ${JSON.stringify(calls)}
const count = existsSync(calls) ? Number(readFileSync(calls, "utf8")) + 1 : 1
writeFileSync(calls, String(count))
if (count === 1 && ${JSON.stringify(change)} === "deleted") rmSync(project)
if (count === 1 && ${JSON.stringify(change)} === "created") writeFileSync(project, "{}")
console.log("error TS5058: The specified path does not exist")
process.exit(1)
`)
    const modules = projects({ root, project, compiler, cache: false, debug(line) {
      // Bound the regression without leaving a retrying child process behind.
      if (line.includes("3 started")) throw new Error("project retried indefinitely")
    } })
    const loaded = await modules.load(join(root, "main.vibe"))
    assert.equal(loaded.errors[0].code, "TS5058")
    assert.equal(Number(readFileSync(calls, "utf8")), change === "absent" ? 1 : 2)
  })
}

// Chapter 007 / project adapter nearest-directory precedence: docs/design/src/007-tooling.md#e352740c4179068c
test("config discovery uses VIP-30 precedence in the nearest directory", (t) => {
  const root = mkdtempSync(join(tmpdir(), "vibe-config-precedence-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "src"), { recursive: true })
  for (const name of ["jsconfig.json", "tsconfig.json", "vibe.config.json"]) {
    writeFileSync(join(root, name), "{}")
    assert.equal(nearestProject(join(root, "src/main.vibe")), join(root, name))
  }
  writeFileSync(join(root, "src/jsconfig.json"), "{}")
  assert.equal(nearestProject(join(root, "src/main.vibe")), join(root, "src/jsconfig.json"))
})
