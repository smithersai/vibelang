import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { addVibeIncludes } from "../lib/wire.mjs"
import { test } from "node:test"
import { newErrors, parseDiagnostics } from "../lib/diagnostics.mjs"
import { parseVitestJson } from "../lib/tests.mjs"
import { candidates, draftPlan, isToolConfig, validatePlan } from "../lib/plan.mjs"
import { assertModuleBoundary, renameBatch, rewriteExports, rewriteImports, vibePath } from "../lib/codemod.mjs"
import { applyState, prepareState } from "../lib/codemod-state.mjs"
import { makeConfig, paths, revert } from "../lib/steps.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, quote as shellQuote, readJson, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-plan-mts.json", import.meta.url)))
const boundary = JSON.parse(readFileSync(new URL("./corpus/foldkit-durable-mts-boundary.json", import.meta.url)))
const record = path => ({ path, effect: "values", test: false, imports: [], testedBy: [], coverage: null, lines: 1 })
const quote = "Plans and codemods accept `.ts` and `.mts` modules; `.mts` requires its nearest `package.json` to declare `type: \"module\"` so the renamed `.vibe` emits ESM."

test("foldkit-19: plan accepts an .mts ES module", () => {
  const inventory = { files: [record(corpus.path)] }
  const plan = { batches: [{ files: [corpus.path], reason: "ES module" }] }
  assert.deepEqual(validatePlan(plan, inventory).errors, [])
  assert.deepEqual(candidates(inventory).map(f => f.path), [corpus.path])
  assert.deepEqual(draftPlan(inventory).batches[0].files, [corpus.path])
  assert.equal(vibePath(corpus.path), "scripts/main.vibe")
})

test("source extensions: only ordinary ts and mts sources are migration candidates", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(quote))
  fc.assert(fc.property(fc.stringMatching(/^[a-z][a-z0-9_-]{0,15}$/),
    fc.constantFrom(".ts", ".mts", ".tsx", ".cts", ".d.ts", ".d.mts", ".d.vibe.ts"), (stem, ext) => {
      const path = "src/" + stem + ext
      const accepted = ext === ".ts" || ext === ".mts"
      const inventory = { files: [record(path)] }
      const plan = { batches: [{ files: [path], reason: "extension" }] }
      assert.equal(validatePlan(plan, inventory).errors.length === 0, accepted)
      assert.equal(candidates(inventory).length, Number(accepted))
      if (accepted) assert.equal(vibePath(path), "src/" + stem + ".vibe")
      else assert.throws(() => vibePath(path))
    }), { seed: 190019, numRuns: 250 })
})

test("mts codemod and revert preserve exports, .mjs importers, source contents and extension", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-mts-"))
  const target = join(root, "repo")
  const run = join(root, "run")
  try {
    mkdirSync(join(target, "scripts"), { recursive: true })
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    writeJson(join(target, "package.json"), corpus.manifest)
    writeFileSync(join(target, corpus.path), corpus.source)
    writeFileSync(join(target, "consumer.ts"), 'import { answer } from "./scripts/main.mjs"\n')
    await Jj.commit(target, "base")
    writeJson(paths(run).config, makeConfig({ target, test: "true", toolchain: join(root, "toolchain") }))
    writeJson(paths(run).plan, { batches: [{ files: [corpus.path] }] })
    const renames = renameBatch(target, [corpus.path])
    assert.deepEqual(renames, [{ from: corpus.path, to: "scripts/main.vibe" }])
    const exportEdits = rewriteExports(target, renames)
    const importEdits = rewriteImports(target, ["consumer.ts", "scripts/main.vibe"])
    assert.equal(readFileSync(join(target, "consumer.ts"), "utf8"), 'import { answer } from "./scripts/main.vibe"\n')
    assert.deepEqual(readJson(join(target, "package.json")).exports, { types: "./scripts/main.d.vibe.ts", "vibelang-source": "./scripts/main.vibe", default: "./.vibelang/js/scripts/main.js" })
    writeJson(paths(run).codemod("01"), { exportEdits, importEdits })
    writeFileSync(join(target, "scripts/main.d.vibe.ts"), "export declare const answer: number;\n")
    const result = await revert({ run, batch: "01", file: "scripts/main.vibe", reason: "test the inverse" })
    assert.equal(result.file, corpus.path)
    assert.equal(readFileSync(join(target, corpus.path), "utf8"), corpus.source)
    assert.equal(readFileSync(join(target, "consumer.ts"), "utf8"), 'import { answer } from "./scripts/main.mjs"\n')
    assert.deepEqual(readJson(join(target, "package.json")), corpus.manifest)
    assert.equal(existsSync(join(target, "scripts/main.d.vibe.ts")), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("mts refuses a CommonJS boundary before renaming any file", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-mts-cjs-"))
  try {
    writeJson(join(root, "package.json"), { type: "commonjs" })
    writeFileSync(join(root, "plain.ts"), "export const value = 1\n")
    writeFileSync(join(root, "main.mts"), corpus.source)
    assert.throws(() => renameBatch(root, ["plain.ts", "main.mts"]), /type.*module|ESM/)
    assert.equal(existsSync(join(root, "plain.ts")), true)
    assert.equal(existsSync(join(root, "main.mts")), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("mts includes gain native includes without admitting declarations", () => {
  const ts = require("typescript")
  fc.assert(fc.property(fc.stringMatching(/^[a-z][a-z0-9_-]{0,12}$/), stem => {
    const text = JSON.stringify({ include: [stem + "/**/*.mts", stem + "/**/*.d.mts"] })
    const after = addVibeIncludes(text, ts)
    assert.deepEqual(JSON.parse(after).include, [stem + "/**/*.mts", stem + "/**/*.d.mts", stem + "/**/*.vibe"])
    assert.equal(addVibeIncludes(after, ts), after)
  }), { seed: 190020, numRuns: 100 })
})

const compiler = process.env.VIBELANG_COMPILER ?? fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
test("renamed mts emits runnable ESM under NodeNext", { skip: !existsSync(compiler) && "build the native compiler with scripts/build-vibelang.sh" }, async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-mts-emit-"))
  try {
    writeJson(join(root, "package.json"), { type: "module" })
    writeJson(join(root, "tsconfig.json"), {
      compilerOptions: { target: "ES2022", module: "NodeNext", outDir: "out", types: [], skipLibCheck: true },
      vibe: { effectGlobals: false, effectModules: false }, include: ["*.vibe"]
    })
    // This checks the module boundary independently of Promise migration.
    writeFileSync(join(root, "main.mts"), "export const answer = 42\n")
    renameBatch(root, ["main.mts"])
    await must(shellQuote(compiler) + " -p tsconfig.json --pretty false", { cwd: root })
    const output = readFileSync(join(root, "out/main.js"), "utf8")
    assert.match(output, /export const answer/)
    const result = await must("node --input-type=module -e " + shellQuote('import("./out/main.js").then(m => console.log(m.answer))'), { cwd: root })
    assert.equal(result.stdout.trim(), "42")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("mts baseline diagnostics and test names keep their identity after rename", () => {
  const before = parseDiagnostics("scripts/main.mts(1,1): error TS2322: Wrong type.\n")
  const after = parseDiagnostics("scripts/main.vibe(1,1): error TS2322: Wrong type.\n")
  assert.deepEqual(newErrors(before, after), [])
  const report = ext => ({ testResults: [{ name: "/repo/scripts/main" + ext, assertionResults: [{ fullName: "runs", status: "passed" }] }] })
  assert.deepEqual(parseVitestJson(report(".mts"), "/repo"), parseVitestJson(report(".vibe"), "/repo"))
})

test("tool configurations retain their filenames across both ts and mts candidates", () => {
  fc.assert(fc.property(fc.stringMatching(/^[a-z][a-z0-9_-]{0,12}$/), fc.constantFrom(".ts", ".mts"), (stem, extension) => {
    const path = "tools/" + stem + ".config" + extension
    const inventory = { files: [record(path), record("tools/" + stem + "Config" + extension)] }
    assert.equal(isToolConfig(path), true)
    assert.deepEqual(candidates(inventory).map(f => f.path), ["tools/" + stem + "Config" + extension])
    const result = validatePlan({ batches: [{ files: [path], reason: "config" }] }, inventory)
    assert.ok(result.errors.some(error => error.includes("tool's config")), result.errors.join("\n"))
  }), { seed: 190021, numRuns: 100 })
})

// tc-foldkit 23:24Z: the durable codemod state (foldkit-74) prepared and replayed
// a .mts rename that renameBatch refused, because only renameBatch checked the
// package boundary. Both paths now share assertModuleBoundary.
function boundaryFixture({ mode, ext, nested, stem = "entry" }) {
  const root = mkdtempSync(join(tmpdir(), "migrate-mts-boundary-"))
  mkdirSync(join(root, "src"))
  const manifest = { ...(nested ? { type: "module" } : mode === "absent" ? {} : { type: mode }), exports: { "./*": "./src/*" + ext } }
  writeJson(join(root, "package.json"), manifest)
  if (nested) writeJson(join(root, "src/package.json"), mode === "absent" ? {} : { type: mode })
  const file = "src/" + stem + ext
  writeFileSync(join(root, file), "export const answer = 42\n")
  writeFileSync(join(root, "consumer.ts"), 'export { answer } from "./src/' + stem + (ext === ".mts" ? ".mjs" : ".js") + '"\n')
  return { root, file, native: "src/" + stem + ".vibe" }
}

function observe(kind, shape) {
  const f = boundaryFixture(shape)
  try {
    let error = null
    try {
      if (kind === "legacy") renameBatch(f.root, [f.file])
      else applyState(f.root, prepareState(f.root, [f.file], [f.file, "consumer.ts"]))
    } catch (e) { error = e.message }
    return { error, sourceExists: existsSync(join(f.root, f.file)), nativeExists: existsSync(join(f.root, f.native)) }
  } finally { rmSync(f.root, { recursive: true, force: true }) }
}

test("foldkit-74 replay keeps the mts ESM boundary that renameBatch enforces", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(quote))
  const minimized = observe("durable", boundary.minimized)
  assert.match(minimized.error, /type.*module|ESM/)
  assert.deepEqual([minimized.sourceExists, minimized.nativeExists], [true, false])
  const f = boundaryFixture(boundary.minimized)
  try { assert.throws(() => assertModuleBoundary(f.root, f.file), /ESM/) } finally { rmSync(f.root, { recursive: true, force: true }) }
  for (const mode of boundary.modes) for (const ext of boundary.extensions) for (const nested of [false, true]) {
    const expectedReject = ext === ".mts" && mode !== "module"
    const control = observe("legacy", { mode, ext, nested }), durable = observe("durable", { mode, ext, nested })
    assert.equal(Boolean(control.error), expectedReject, `legacy ${mode} ${ext} nested=${nested}`)
    assert.equal(Boolean(durable.error), expectedReject, `durable ${mode} ${ext} nested=${nested}: ${durable.error}`)
    assert.deepEqual([durable.sourceExists, durable.nativeExists], [expectedReject, !expectedReject])
  }
})

test("durable preparation rejects exactly the boundaries the legacy rename rejects", () => {
  fc.assert(fc.property(fc.constantFrom(...boundary.modes), fc.constantFrom(...boundary.extensions), fc.boolean(), fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/), (mode, ext, nested, stem) => {
    const expectedReject = ext === ".mts" && mode !== "module"
    const r = observe("durable", { mode, ext, nested, stem })
    assert.equal(Boolean(r.error), expectedReject, r.error ?? "accepted")
    assert.deepEqual([r.sourceExists, r.nativeExists], [expectedReject, !expectedReject])
  }), { seed: boundary.seed, numRuns: 120 })
})
