import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { compileProjectSync, findCompiler, formatDiagnostic, moduleDeclarationSource, nearestProject, parseExplainFiles, parseOutput, projectBackend, projectImports, projects } from "../project.mjs"

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

test("diagnostic parsing preserves multiline detail, CRLF, global messages and dependency files", () => {
  const root = resolve("project with spaces")
  const input = [
    "src/main.vibe(2,17): error TS2322: Type 'string' is not assignable.",
    "  Type detail", "    Nested detail", "warning EK2004: unreachable catch",
    join(root, "src/main.vibe"), join(root, "src/type-only.ts"), "", "ordinary banner"
  ].join("\r\n")
  assert.deepEqual(parseOutput(input, root), {
    diagnostics: [
      { file: join(root, "src/main.vibe"), line: 2, column: 17, category: "error", code: "TS2322", text: "Type 'string' is not assignable.\n  Type detail\n    Nested detail" },
      { category: "warning", code: "EK2004", text: "unreachable catch" }
    ], files: [join(root, "src/main.vibe"), join(root, "src/type-only.ts")]
  })
})

test("wide diagnostic coordinates and messages survive parsing and formatting", () => {
  const root = resolve("project")
  for (let i = 1; i <= 300; i++) {
    const file = `source ${i}.vibe`, line = i * 19, column = i * 31
    const category = i % 2 ? "error" : "warning", code = i % 2 ? "TS2322" : "EK2004"
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
  // Each module holds one warning (EK2004), which a check of that module reports.
  // Checking every imported package in each project's compile checked a
  // package once per project that imports it.
  const { root, app, compiler, compiles } = workspace(t)
  const unreachable = (name) => `export function ${name}(): number {\n  try { return 1 } catch (e) { return 2 }\n}\n`
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
  assert.deepEqual(warnings(main), [[join(app, "src/main.vibe"), "EK2004"]])
  assert.match(main.outputs.get(join(app, "src/main.vibe")).code, /shout\("app"\)/)
  assert.ok(main.inputs.includes(join(root, "dep/src/lib.vibe")), "the package's source still supplies its types")
  const lib = await compile(join(root, "dep"))
  assert.deepEqual(lib.errors, [])
  assert.deepEqual(warnings(lib), [[join(root, "dep/src/lib.vibe"), "EK2004"]])
  assert.deepEqual(compiles(), [join(app, "tsconfig.json"), join(root, "dep/tsconfig.json")])
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
    "   Imported via \"effect\" from file 'src/b.vibe' with packageId 'effect/dist/index.d.ts@4.1.0'",
    "   Imported via \"effect\" from file 'src/b.vibe' with packageId 'effect/dist/index.d.ts@4.1.0' to import 'jsx' and 'jsxs' factory functions",
    "src/a.ts",
    "   Matched by include pattern 'src/**/*' in 'tsconfig.json'",
    "   File is ECMAScript module because 'package.json' has field \"type\" with value \"module\"",
    "tsconfig.json(3,5): error TS5023: Unknown compiler option 'nope'.",
    "  detail of the option error"
  ].join("\r\n")
  assert.deepEqual(parseExplainFiles(input, root), {
    files: [join(root, "src/b.vibe"), resolve(root, "../node_modules/effect/dist/index.d.ts"), join(root, "src/a.ts")],
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
