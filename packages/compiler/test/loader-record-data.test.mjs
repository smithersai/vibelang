// RD-023: VIP-1 preserves ordinary TypeScript values, and VIP-34's loader
// consumes compiler output. A record is a pure cache of that output:
// "vibelang/register and vibelang/bun use it in place of the compile while
// every input holds" (setup/release-notes.md, loader records).
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { compileProjectSync, writeLoaderRecord } from "../project.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const settle = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120)

function movedProject(extra = [], directory = "checkout") {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-record-data-")))
  const root = join(top, directory)
  mkdirSync(join(root, "node_modules"), { recursive: true })
  symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
  symlinkSync(join(repo, "packages/runtime"), join(root, "node_modules/vibelang-runtime"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true },
    include: ["*.vibe"]
  }))
  const values = [root, root + "/file", root + "Suffix/file", "/unrelated/fixed.txt", "documentation " + root + "/help",
    ...extra.map(({ before, after }) => before + root + after)]
  const source = "export const values = " + JSON.stringify(values) + "\n"
  writeFileSync(join(root, "main.vibe"), source)
  settle()
  const written = writeLoaderRecord({ project: join(root, "tsconfig.json"), compiler })
  assert.equal(written.modules, 1, JSON.stringify(written))
  const moved = join(top, "moved", directory)
  cpSync(root, moved, { recursive: true })
  rmSync(root, { recursive: true, force: true })
  settle()
  return { top, root, moved, values, source }
}

function execute(at, command, args) {
  const run = spawnSync(command, args, {
    cwd: at, encoding: "utf8",
    env: { ...process.env, VIBELANG_BINARY: compiler, VIBELANG_PROJECT: "", VIBELANG_DISABLE_CACHE: "",
      VIBELANG_CACHE_DIR: join(at, ".cold-" + command.replaceAll("/", "_")), VIBELANG_REGISTER_DEBUG: "1" }
  })
  assert.ifError(run.error)
  assert.equal(run.status, 0, run.stdout + run.stderr)
  return { values: JSON.parse(run.stdout.trim()), stderr: run.stderr }
}

function compare(at, expected, originalSource) {
  const project = join(at, "tsconfig.json")
  assert.equal(readFileSync(join(at, "main.vibe"), "utf8"), originalSource)
  const trace = []
  const recorded = compileProjectSync({ project, compiler, cache: { directory: join(at, ".cache") }, debug: (line) => trace.push(line) })
  assert.ok(trace.some((line) => line.includes("from its loader record")), trace.join("\n"))
  const fresh = compileProjectSync({ project, compiler, cache: false })
  assert.deepEqual(fresh.errors, [])
  assert.deepEqual(recorded.errors, [])
  const source = join(at, "main.vibe")
  const output = recorded.outputs.get(source)
  const oracle = fresh.outputs.get(source)
  assert.equal(output.code, oracle.code, "recorded program bytes equal a fresh compile after the move")
  assert.deepEqual(output.map.sources, oracle.map.sources)
  assert.deepEqual(output.map.sourcesContent, [originalSource])
  mkdirSync(join(at, ".probe"), { recursive: true })
  writeFileSync(join(at, ".probe/fresh.mjs"), oracle.code)
  const actual = execute(at, process.execPath, ["--input-type=module", "-e", 'import { values } from "./.probe/fresh.mjs"; console.log(JSON.stringify(values))'])
  assert.deepEqual(actual.values, expected)
  writeFileSync(join(at, ".probe/entry.mjs"), 'import { values } from "../main.vibe"; console.log(JSON.stringify(values))')
  const loaded = execute(at, process.execPath, ["--import", join(repo, "packages/compiler/register.mjs"), ".probe/entry.mjs"])
  assert.deepEqual(loaded.values, actual.values, "the moved module has the freshly compiled module's values")
  assert.match(loaded.stderr, /from its loader record/)
}

test("RD-023: moving a loader record preserves the five-value neighbourhood under Node and Bun", () => {
  const { top, moved, values, source } = movedProject()
  try {
    compare(moved, values, source)
    const bun = execute(moved, "bun", ["--preload", join(repo, "packages/compiler/bun.mjs"), ".probe/entry.mjs"])
    assert.deepEqual(bun.values, values)
  } finally {
    rmSync(top, { recursive: true, force: true })
  }
})

test("RD-023 property: moved records and fresh compiles give identical random root-shaped string values", () => {
  const fragment = fc.string({ maxLength: 25 })
  fc.assert(fc.property(
    fc.array(fc.record({ before: fragment, after: fc.oneof(fragment, fragment.map((s) => "/" + s)) }), { minLength: 1, maxLength: 8 }),
    fc.constantFrom("checkout", "space & $", "ünï+[x]", "quote's [x]"),
    (extra, directory) => {
      const { top, moved, values, source } = movedProject(extra, directory)
      try { compare(moved, values, source) }
      finally { rmSync(top, { recursive: true, force: true }) }
    }
  ), { seed: 20261102, numRuns: 16 })
})
