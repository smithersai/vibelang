import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { addCompilerScripts } from "../lib/wire.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const repo = resolve(new URL("../../../../", import.meta.url).pathname)
const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const quotes = ["Fields retain their TypeScript meaning with one deliberate file-kind exception:", "Module resolution is as in TypeScript"]
test("TestBunBuildRulesQuoted", () => {
  const chapter = readFileSync(SpecPath("007-tooling.md"), "utf8")
  for (const quote of quotes) assert.ok(chapter.includes(quote), quote)
})

function check({ long, noEmit, nodeNext, depth, space }) {
  const root = mkdtempSync(join(tmpdir(), "migrate-bun-build-"))
  const put = (side, name, text) => {
    const p = join(root, side, name); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text)
  }
  const project = space ? "source project" : "project", nest = Array.from({ length: depth }, (_, i) => "d" + i).join("/")
  const stem = nest ? nest + "/leaf" : "leaf", specifier = "./" + stem + (nodeNext ? ".js" : "")
  const config = { compilerOptions: {
    strict: true, target: "ES2022", module: nodeNext ? "NodeNext" : "ESNext",
    moduleResolution: nodeNext ? "NodeNext" : "Bundler", types: [], composite: true, declaration: true,
    noEmit, rootDir: "src", outDir: "dist", skipLibCheck: false
  }, include: ["src"], vibe: { effectGlobals: false, effectModules: false, sidecarDir: ".vibe/declarations" } }
  const importer = 'import { value } from "' + specifier + '"; export const output: number = value;\n'
  try {
    for (const side of ["native", "migrated"]) {
      put(side, "package.json", '{"type":"module"}')
      put(side, project + "/tsconfig.json", JSON.stringify(config))
      put(side, project + "/src/main.ts", importer)
      put(side, project + "/src/" + stem + (side === "native" ? ".ts" : ".vibe"), "export const value = 42;\n")
    }
    const diagnostics = [], host = ts.createSolutionBuilderHost(ts.sys, undefined, d => diagnostics.push(d))
    const nativeCode = ts.createSolutionBuilder(host, [join(root, "native", project)], {}).build()
    assert.equal(nativeCode, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: x => x, getCurrentDirectory: () => root, getNewLine: () => "\n"
    }))
    const migrated = join(root, "migrated")
    mkdirSync(join(migrated, "node_modules/.bin"), { recursive: true })
    symlinkSync(compiler, join(migrated, "node_modules/.bin/vibelang"))
    const command = "bun check --no-script " + (long ? "--build" : "-b") + " '" + project + "'"
    const pkg = addCompilerScripts({ scripts: { typecheck: command } }, "unused")
    // TypeScript's build receives the project emit settings, without an
    // injected noEmit flag changing an emitting project's behavior.
    const run = () => spawnSync("sh", ["-c", pkg.scripts.typecheck + " --pretty false"], {
      cwd: migrated, encoding: "utf8", timeout: 60000,
      env: { ...process.env, PATH: join(migrated, "node_modules/.bin") + ":" + process.env.PATH, GOMAXPROCS: "2" }
    })
    const result = run()
    assert.ifError(result.error); assert.equal(result.signal, null)
    assert.equal(result.status, nativeCode, result.stdout + result.stderr + JSON.stringify({ long, noEmit, nodeNext, depth, space }))
    for (const side of ["native", "migrated"])
      assert.equal(existsSync(join(root, side, project, "dist/main.js")), !noEmit, side + " emit behavior")
    assert.equal(readFileSync(join(migrated, project, "src/main.ts"), "utf8"), importer)
    put("migrated", project + "/src/main.ts", importer.replace("output: number", "output: string"))
    const bad = run()
    assert.ifError(bad.error); assert.notEqual(bad.status, 0)
    assert.match(bad.stdout + bad.stderr, /TS2322/, "real TypeScript assignment errors remain visible")
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("opencode build-mode corpus keeps native projects, resolution and emitting/noEmit behavior", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-gui-bun-build-check.json", import.meta.url)))
  assert.equal(corpus.script, "bun check --no-script -b")
  for (const long of [false, true])
    for (const noEmit of [false, true])
      for (const nodeNext of [false, true]) check({ long, noEmit, nodeNext, depth: 1, space: true })
  console.log("stock TypeScript " + ts.version + ": 8 build-mode native twins; 8 migrated builds and TS2322 controls")
})

test("property: build checker keeps project selection through nested and quoted paths", () => {
  fc.assert(fc.property(fc.record({
    long: fc.boolean(), noEmit: fc.boolean(), nodeNext: fc.boolean(),
    depth: fc.integer({ min: 0, max: 3 }), space: fc.boolean()
  }), check), { seed: 461048, numRuns: 12 })
})

