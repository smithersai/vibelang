// Loader records (opencode cold start, cache.mjs): a committed record serves a
// project's compile exactly when every input it names holds, wherever the
// checkout lives. The property changes one input or none, moves the checkout
// or not, and names the workspace with characters a path pattern would
// misread; the record must miss on every change and, unchanged, give back the
// recorded program bytes unchanged and its structured paths in the new place.
import { strict as assert } from "node:assert"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import fc from "fast-check"
import { loaderRecord, loaderRecordFile, projectCache } from "../cache.mjs"

// A file written this close to a snapshot is not recorded (cache.mjs racy).
const settle = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120)

function write(base, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(base, path)), { recursive: true })
    writeFileSync(join(base, path), text)
  }
}

// opencode's shape: a workspace with a lockfile, a package whose tsconfig
// includes src/, one .vibe module, and a dependency's declarations.
const workspace = {
  "bun.lock": "{ \"lockfileVersion\": 1 }\n",
  "packages/schema/package.json": "{\"name\":\"@demo/schema\",\"type\":\"module\"}\n",
  "packages/schema/tsconfig.json": "{\"compilerOptions\":{\"strict\":true},\"include\":[\"src/**/*\"]}\n",
  "packages/schema/src/skill.vibe": "export const Skill: string = \"skill\"\n",
  "node_modules/dep/package.json": "{\"name\":\"dep\",\"version\":\"1.0.0\"}\n",
  "node_modules/dep/index.d.ts": "export declare const dep: number\n"
}

const changes = {
  none: () => {},
  source: (base) => writeFileSync(join(base, "packages/schema/src/skill.vibe"), "export const Skill: string = \"SKILL\"\n"),
  added: (base) => writeFileSync(join(base, "packages/schema/src/extra.vibe"), "export const extra = 1\n"),
  removed: (base) => rmSync(join(base, "packages/schema/src/skill.vibe")),
  config: (base) => writeFileSync(join(base, "packages/schema/tsconfig.json"), "{\"compilerOptions\":{\"strict\":false},\"include\":[\"src/**/*\"]}\n"),
  manifest: (base) => writeFileSync(join(base, "packages/schema/package.json"), "{\"name\":\"@demo/schema\",\"type\":\"commonjs\"}\n"),
  dependency: (base) => writeFileSync(join(base, "node_modules/dep/index.d.ts"), "export declare const dep: string\n"),
  dependencyManifest: (base) => writeFileSync(join(base, "node_modules/dep/package.json"), "{\"name\":\"dep\",\"version\":\"1.0.1\"}\n"),
  lockfile: (base) => writeFileSync(join(base, "bun.lock"), "{ \"lockfileVersion\": 2 }\n"),
  newLockfile: (base) => writeFileSync(join(base, "packages/schema/bun.lock"), "{}\n"),
  compiler: (_base, compiler) => writeFileSync(compiler, "compiler 2\n")
}

const name = fc.constantFrom("ws", "a b", "ünï", "x+y", "(p)", "$d", "$&", "$$", "a.b", "[q]", "^c", "back\\slash".replace("\\", process.platform === "win32" ? "_" : "\\"))

test("loader-record: a record serves the compile exactly when every input holds, wherever the checkout moves", () => {
  fc.assert(fc.property(name, fc.constantFrom(...Object.keys(changes)), fc.boolean(), (dir, change, move) => {
    const top = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-loader-record-")))
    try {
      const compiler = join(top, "compiler")
      writeFileSync(compiler, "compiler 1\n")
      const base = join(top, dir)
      write(base, workspace)
      settle()
      const project = join(base, "packages/schema/tsconfig.json")
      const root = dirname(project)
      const source = join(root, "src/skill.vibe")
      const record = loaderRecord({ project, root, compiler })
      const snapshot = record.begin()
      // A compile result with path-shaped program text and source-map names:
      // those are payloads; only the structured path fields relocate.
      const output = {
        code: `export const Skill = "skill"; // from ${source}\n`,
        map: { version: 3, sources: [source], sourcesContent: [readFileSync(source, "utf8")], mappings: "AAAA", names: [source, "<vibelang-record-base>"], file: source + ".js", sourceRoot: "" }
      }
      const result = {
        outputs: new Map([[source, output]]), inputs: [source], errors: [],
        warnings: [{ category: "warning", file: source, line: 1, column: 1, code: "TS6133", text: "unused " + source + " <vibelang-record-base>" }]
      }
      assert.equal(record.write(snapshot, result, [source, join(base, "node_modules/dep/index.d.ts")]), loaderRecordFile(project))
      const stored = JSON.parse(readFileSync(loaderRecordFile(project), "utf8"))
      assert.deepEqual(stored.entry.project, { relative: "packages/schema/tsconfig.json" })
      assert.equal(stored.entry.outputs[0].code, output.code, "program bytes are never encoded as paths")

      let at = base
      if (move) {
        at = join(top, "moved", dir)
        cpSync(base, at, { recursive: true })
        rmSync(base, { recursive: true, force: true })
        settle()
      }
      const movedProject = join(at, "packages/schema/tsconfig.json")
      const lookup = () => loaderRecord({ project: movedProject, root: dirname(movedProject), compiler }).lookup()
      const found = lookup()
      assert.equal(found.miss, undefined, found.miss)
      const movedSource = join(at, "packages/schema/src/skill.vibe")
      const loaded = found.result.outputs.get(movedSource)
      assert.equal(loaded.code, output.code)
      assert.deepEqual(loaded.map.sources, [movedSource])
      assert.equal(loaded.map.file, movedSource + ".js")
      assert.deepEqual(loaded.map.names, output.map.names)
      assert.equal(found.result.warnings[0].text, result.warnings[0].text)
      assert.deepEqual(loaded.map.sourcesContent, [readFileSync(movedSource, "utf8")])
      assert.deepEqual(found.result.inputs, [movedSource])
      assert.deepEqual(found.result.errors, [])
      assert.equal(found.result.warnings[0].file, movedSource)
      assert.ok(found.files.includes(join(at, "node_modules/dep/index.d.ts")))

      changes[change](at, compiler)
      const after = lookup()
      if (change === "none") assert.equal(after.miss, undefined, after.miss)
      else assert.equal(typeof after.miss, "string", `${change} must make the record miss`)
    } finally {
      rmSync(top, { recursive: true, force: true })
    }
  }), { seed: 20261102, numRuns: 60 })
})

test("a record holds only a compile with no error", () => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-loader-record-")))
  try {
    write(top, workspace)
    writeFileSync(join(top, "compiler"), "compiler 1\n")
    settle()
    const project = join(top, "packages/schema/tsconfig.json")
    const record = loaderRecord({ project, root: dirname(project), compiler: join(top, "compiler") })
    const failed = { outputs: new Map(), inputs: [], errors: [{ category: "error", code: "TS2322", text: "no" }], warnings: [] }
    assert.throws(() => record.write(record.begin(), failed, []), /did not compile/)
    assert.deepEqual(record.lookup(), { miss: "no record" })
  } finally {
    rmSync(top, { recursive: true, force: true })
  }
})

test("old loader records miss instead of replaying text substitutions", () => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-loader-record-")))
  try {
    const project = join(top, "tsconfig.json")
    const file = loaderRecordFile(project)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ format: 1, base: ".", entry: {} }))
    assert.deepEqual(loaderRecord({ project, root: top, compiler: join(top, "compiler") }).lookup(),
      { miss: "record of another format" })
  } finally {
    rmSync(top, { recursive: true, force: true })
  }
})

test("persistent caches from text-rewriting loader records are invalidated", () => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-loader-record-")))
  try {
    write(top, workspace)
    const compiler = join(top, "compiler")
    writeFileSync(compiler, "compiler 1")
    settle()
    const project = join(top, "packages/schema/tsconfig.json")
    const source = join(dirname(project), "src/skill.vibe")
    const cache = projectCache({ project, root: dirname(project), compiler, cache: { directory: join(top, ".cache") } })
    const result = { outputs: new Map([[source, { code: "export const value = 7" }]]), inputs: [source], errors: [], warnings: [] }
    cache.store(cache.begin(), result, [source])
    assert.equal(cache.lookup().miss, undefined)
    const old = JSON.parse(readFileSync(cache.file, "utf8"))
    old.format = 7
    old.outputs[0].code = "export const value = 'corrupted by an old record'"
    writeFileSync(cache.file, JSON.stringify(old))
    assert.deepEqual(cache.lookup(), { miss: "entry for another version" })
  } finally {
    rmSync(top, { recursive: true, force: true })
  }
})
