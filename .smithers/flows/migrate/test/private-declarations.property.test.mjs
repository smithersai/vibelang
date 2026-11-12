import { assertPropertySlice } from "../../../../scripts/testing/property-slice.mjs"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { packRepository } from "../lib/pack-policy.mjs"
import { recordDeclarationSurface } from "../lib/declarations.mjs"
import { makeConfig, paths, verify } from "../lib/steps.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, slug, writeJson } from "../lib/util.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-private-declarations.json", import.meta.url), "utf8"))
const t3code = JSON.parse(readFileSync(new URL("./corpus/t3code-private-workspace-declarations.json", import.meta.url), "utf8"))

// foldkit agent's accepted 18:45Z ruling: "Declaration identity applies to published packages only."
async function fixture(manifest, { before = corpus.before, after = corpus.after, diagnostic = "", command = "true", includePrivate = false, emitDiagnostic = "", extraDeclaration = true } = {}) {
  manifest = { version: "1.0.0", ...manifest }
  const root = mkdtempSync(join(tmpdir(), "migrate-private-dts-"))
  const target = join(root, "repo")
  const run = join(root, "run")
  const pkg = "examples/snake"
  try {
    mkdirSync(join(target, pkg, "node_modules/.bin"), { recursive: true })
    mkdirSync(join(target, "node_modules"), { recursive: true })
    symlinkSync(require.resolve("typescript/package.json").replace(/\/package.json$/, ""), join(target, "node_modules/typescript"))
    writeJson(join(target, "package.json"), { private: true })
    writeJson(join(target, pkg, "package.json"), manifest)
    writeJson(join(target, pkg, "tsconfig.json"), { compilerOptions: { rootDir: "." }, include: ["*.vibe"] })
    writeFileSync(join(target, pkg, "main.vibe"), "export const apple = 1\n")
    const tool = join(target, pkg, "node_modules/.bin/vibelang")
    writeFileSync(tool, [
      "#!/usr/bin/env node",
      'const fs = require("node:fs"), path = require("node:path");',
      'const outIndex = process.argv.indexOf("--outDir");',
      'if (outIndex >= 0) {',
      '  const out = process.argv[outIndex + 1];',
      '  fs.mkdirSync(out, { recursive: true });',
      '  fs.writeFileSync(path.join(out, "main.d.ts"), ' + JSON.stringify(after) + ');',
      '  if (' + JSON.stringify(extraDeclaration) + ') fs.writeFileSync(path.join(out, "keyboardTarget.d.ts"), ' + JSON.stringify(corpus.added) + ');',
      '  if (' + JSON.stringify(emitDiagnostic) + ') { console.log(' + JSON.stringify(emitDiagnostic) + '); process.exitCode = 2; }',
      '}',
      'if (' + JSON.stringify(diagnostic) + ') { console.log(' + JSON.stringify(diagnostic) + '); process.exitCode = 2; }'
    ].join("\n") + "\n", { mode: 0o755 })
    const p = paths(run)
    const config = makeConfig({ target, packages: [pkg], test: command, vibelangVersion: "0.0.11", includePrivateDeclarations: includePrivate })
    writeJson(p.config, config)
    writeJson(p.plan, { batches: [{ files: [pkg + "/main.ts"] }] })
    writeJson(join(p.baseline, "tests.json"), { code: 0, tests: {}, total: 0, passed: 0, failed: [], skipped: 0 })
    writeJson(join(p.baseline, "compile-" + slug(pkg) + ".json"), [])
    // A package held to declaration identity needs setup's stock oracle
    // (bd3e60eb7c13); a private one held by the opt-in needs it as a published
    // one does. This fixture isolates identity with a matching stock baseline.
    if (includePrivate) writeJson(join(p.baseline, "declaration-oracle.json"), { [pkg]: { compiler: "fixture-stock", files: [], missing: [], extra: [], changed: [] } })
    const baseline = join(p.baseline, "dts", slug(pkg))
    mkdirSync(baseline, { recursive: true })
    writeFileSync(join(baseline, "main.d.ts"), before)
    // Also usable with the public-surface gate, without manufacturing a setup commit.
    recordDeclarationSurface(require("typescript"), baseline, join(target, pkg),
      [{ tsconfig: "tsconfig.json", prefix: "." }], manifest)
    // verify now proves test identity against real pinned jj trees as well.
    writeFileSync(join(target, ".gitignore"), "node_modules/\n")
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    await Jj.commit(target, "declaration fixture baseline")
    writeJson(join(p.baseline, "upstream-packs.json"), await packRepository(config, join(p.baseline, "upstream-packs")))
    const result = await verify({ run, batch: "01" })
    assert.equal(result.checks.packs, true, JSON.stringify(result.packs))
    // Optional undefined fields have no representation in a JSON receipt.
    assert.deepEqual(JSON.parse(readFileSync(p.verify("01"), "utf8")), JSON.parse(JSON.stringify(result)))
    return result
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("foldkit private example declarations are reported as not published", async () => {
  const result = await fixture(corpus.manifest)
  assert.equal(result.declarations["examples/snake"], "not published")
  assert.equal(result.ok, true)
})

test("private declarations never mask compiler errors or failing tests", async () => {
  for (const options of [
    { diagnostic: "main.vibe(1,1): error TS2322: Wrong type." },
    { command: "false" }
  ]) {
    const result = await fixture(corpus.manifest, options)
    assert.equal(result.declarations["examples/snake"], "not published")
    assert.equal(result.ok, false)
    assert.equal(options.diagnostic ? result.checks.batchErrors : result.checks.tests, false)
  }
})

test("only the boolean private true exempts declaration identity across declaration changes", async () => {
  await assertPropertySlice(fc, fc.asyncProperty(
    fc.constantFrom(true, false, undefined, "true", 1, null),
    fc.stringMatching(/^[a-z][a-z0-9]{0,10}$/),
    async (privateValue, name) => {
      const manifest = { name, types: "./main.d.ts", ...(privateValue === undefined ? {} : { private: privateValue }) }
      const result = await fixture(manifest, {
        extraDeclaration: false,
        before: 'export declare const ' + name + ': string;\n',
        after: 'export declare const ' + name + ': number;\n'
      })
      assert.equal(result.ok, privateValue === true)
      if (privateValue === true) assert.equal(result.declarations["examples/snake"], "not published")
      else assert.equal(result.declarations["examples/snake"].identical, false)
    }), { seed: 183145, numRuns: 60 })
})

// t3code (drive-t3code, 2026-10-31T23:50Z): all 27 packages in packages/contracts'
// dependency closure are private workspace packages, and the apps consume their
// exported APIs. The published-only default stays; a run opts in with
// --include-private-declarations, and then a private package's declarations are
// held to the identity a published package's are.
test("a run that includes private declarations holds a private package's API to identity", async () => {
  const changed = await fixture(t3code.manifest, { includePrivate: true, extraDeclaration: false, before: t3code.before, after: t3code.changed })
  assert.equal(changed.declarations["examples/snake"].identical, false)
  assert.equal(changed.checks.declarations, false)
  assert.ok(changed.declarations["examples/snake"].typeDifferences.length, JSON.stringify(changed.declarations["examples/snake"]))
  assert.equal(changed.ok, false)
  const unchanged = await fixture(t3code.manifest, { includePrivate: true, extraDeclaration: false, before: t3code.before, after: t3code.before })
  assert.equal(unchanged.declarations["examples/snake"].identical, true, JSON.stringify(unchanged.declarations["examples/snake"]))
  assert.equal(unchanged.ok, true)
})

test("a run that includes private declarations fails a private package's emit error in a migrated file", async () => {
  const result = await fixture(corpus.manifest, {
    includePrivate: true,
    extraDeclaration: false,
    before: t3code.before,
    after: t3code.before,
    emitDiagnostic: t3code.emitDiagnostic
  })
  assert.equal(result.declarations["examples/snake"].identical, true, JSON.stringify(result.declarations["examples/snake"]))
  assert.equal(result.checks.declarationEmit, false)
  assert.equal(result.ok, false)
})

test("property: with private declarations included, any exported type change in a private package fails verify", async () => {
  await assertPropertySlice(fc, fc.asyncProperty(
    fc.stringMatching(/^[a-z][a-z0-9]{0,10}$/),
    fc.constantFrom(["string", "number"], ["number", "boolean"], ["readonly string[]", "string[]"]),
    async (name, [from, to]) => {
      const result = await fixture({ name, private: true, types: "./main.d.ts" }, {
        includePrivate: true,
        extraDeclaration: false,
        before: "export declare const " + name + ": " + from + ";\n",
        after: "export declare const " + name + ": " + to + ";\n"
      })
      assert.equal(result.checks.declarations, false)
      assert.equal(result.ok, false)
    }), { seed: 103123, numRuns: 12 })
})


const inventoryQuote = "Declaration output is API-identical to what `tsc` writes for the Effect TypeScript twin: the same exported names"
test("private declaration inventory quotes the API identity contract", () => {
  assert.ok(readFileSync(SpecPath("001-functions.md"), "utf8").includes(inventoryQuote))
})

test("private API opt-in rejects an added shipped declaration", async () => {
  const result = await fixture(t3code.manifest, { includePrivate: true, before: t3code.before, after: t3code.before, extraDeclaration: true })
  const api = result.declarations["examples/snake"]
  assert.equal(api.comparisonComplete, true, JSON.stringify(api))
  assert.equal(api.identical, false, JSON.stringify(api))
  assert.ok(api.nameDifferences.some(d => d.entrypoint === "./keyboardTarget.js" && d.side === "after"), JSON.stringify(api))
  assert.equal(result.ok, false)
})

test("private API opt-in keeps an unexported declaration private", async () => {
  const result = await fixture({ ...t3code.manifest, exports: { ".": "./main.d.ts" } }, { includePrivate: true, before: t3code.before, after: t3code.before, extraDeclaration: true })
  assert.equal(result.declarations["examples/snake"].identical, true, JSON.stringify(result.declarations))
  assert.equal(result.ok, true)
})

test("t3code-private-declaration-inventory: only selected added exports change an opted-in API", async () => {
  let models = 0
  await assertPropertySlice(fc, fc.asyncProperty(fc.boolean(), fc.boolean(), fc.boolean(), async (includePrivate, extraDeclaration, closed) => {
    models++
    const result = await fixture({ ...t3code.manifest, ...(closed ? { exports: { ".": "./main.d.ts" } } : {}) }, {
      includePrivate, extraDeclaration, before: t3code.before, after: t3code.before
    })
    assert.equal(result.ok, !includePrivate || !extraDeclaration || closed, JSON.stringify(result.declarations))
  }), { seed: 170176, numRuns: 16, examples: [[true, false, false]] })
  console.log("private declaration inventory models=" + models)
})
