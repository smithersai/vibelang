import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { makeConfig, paths, verify } from "../lib/steps.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, slug, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-private-declarations.json", import.meta.url), "utf8"))
const t3code = JSON.parse(readFileSync(new URL("./corpus/t3code-private-workspace-declarations.json", import.meta.url), "utf8"))

// foldkit agent's accepted 18:45Z ruling: "Declaration identity applies to published packages only."
async function fixture(manifest, { before = corpus.before, after = corpus.after, diagnostic = "", command = "true", includePrivate = false, emitDiagnostic = "" } = {}) {
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
      '  fs.writeFileSync(path.join(out, "keyboardTarget.d.ts"), ' + JSON.stringify(corpus.added) + ');',
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
    writeJson(join(baseline, "public-surface.json"), { roots: ["main.d.ts"], reachable: ["main.d.ts"], unresolved: [] })
    // verify now proves test identity against real pinned jj trees as well.
    writeFileSync(join(target, ".gitignore"), "node_modules/\n")
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    await Jj.commit(target, "declaration fixture baseline")
    const result = await verify({ run, batch: "01" })
    assert.deepEqual(JSON.parse(readFileSync(p.verify("01"), "utf8")), result)
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
  await fc.assert(fc.asyncProperty(
    fc.constantFrom(true, false, undefined, "true", 1, null),
    fc.stringMatching(/^[a-z][a-z0-9]{0,10}$/),
    async (privateValue, name) => {
      const manifest = { name, types: "./main.d.ts", ...(privateValue === undefined ? {} : { private: privateValue }) }
      const result = await fixture(manifest, {
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
  const changed = await fixture(t3code.manifest, { includePrivate: true, before: t3code.before, after: t3code.changed })
  assert.equal(changed.declarations["examples/snake"].identical, false)
  assert.equal(changed.checks.declarations, false)
  assert.equal(changed.ok, false)
  const unchanged = await fixture(t3code.manifest, { includePrivate: true, before: t3code.before, after: t3code.before })
  assert.equal(unchanged.declarations["examples/snake"].identical, true)
  assert.equal(unchanged.ok, true)
})

test("a run that includes private declarations fails a private package's emit error in a migrated file", async () => {
  const result = await fixture(corpus.manifest, {
    includePrivate: true,
    before: t3code.before,
    after: t3code.before,
    emitDiagnostic: t3code.emitDiagnostic
  })
  assert.equal(result.declarations["examples/snake"].identical, true)
  assert.equal(result.checks.declarationEmit, false)
  assert.equal(result.ok, false)
})

test("property: with private declarations included, any exported type change in a private package fails verify", async () => {
  await fc.assert(fc.asyncProperty(
    fc.stringMatching(/^[a-z][a-z0-9]{0,10}$/),
    fc.constantFrom(["string", "number"], ["number", "boolean"], ["readonly string[]", "string[]"]),
    async (name, [from, to]) => {
      const result = await fixture({ name, private: true, types: "./main.d.ts" }, {
        includePrivate: true,
        before: "export declare const " + name + ": " + from + ";\n",
        after: "export declare const " + name + ": " + to + ";\n"
      })
      assert.equal(result.checks.declarations, false)
      assert.equal(result.ok, false)
    }), { seed: 103123, numRuns: 12 })
})
