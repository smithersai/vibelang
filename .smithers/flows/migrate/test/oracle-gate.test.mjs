import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { makeConfig, paths, setup, verify } from "../lib/steps.mjs"
import { commitId } from "../lib/jj.mjs"
import { packRepository } from "../lib/pack-policy.mjs"
import { must, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const packCorpus = JSON.parse(readFileSync(new URL("./corpus/t3code-verify-pack-prerequisites.json", import.meta.url), "utf8"))
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-stock-oracle-builders.json", import.meta.url), "utf8"))

async function fixture(action, { identical = false, stock = true, stockExit = 0, privatePackage = false, mixed = false, custom = false, includePrivate = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "alchemy-stock-gate-"))
  const target = join(root, "repo"), run = join(root, "run")
  const put = (name, text) => {
    mkdirSync(dirname(join(target, name)), { recursive: true })
    writeFileSync(join(target, name), text)
  }
  const compiler = (name, files, exit) => {
    put("node_modules/.bin/" + name, [
      "#!/usr/bin/env node",
      'const fs = require("node:fs"), path = require("node:path")',
      'if (process.argv.includes("--version")) { console.log("fixture 0.0.11"); process.exit(0) }',
      'const at = process.argv.indexOf("--outDir")',
      'if (at >= 0) {',
      '  const out = process.argv[at + 1]',
      '  for (const [name, text] of Object.entries(' + JSON.stringify(files) + ')) {',
      '    fs.mkdirSync(path.dirname(path.join(out, name)), { recursive: true })',
      '    fs.writeFileSync(path.join(out, name), text)',
      '  }',
      '  if (' + exit + ') console.log("src/Ok.ts(1,1): error TS2322: stock source cannot be checked")',
      '  process.exitCode = ' + exit,
      '}'
    ].join("\n") + "\n")
    chmodSync(join(target, "node_modules/.bin/" + name), 0o755)
  }
  try {
    put("package.json", JSON.stringify({ ...packCorpus.publicManifest, scripts: { build: "node build.mjs", types: "tsrs --emitDeclarationOnly" }, types: "./lib/Ok.d.ts", ...(privatePackage ? { private: true } : {}) }))
    // Product preparation must succeed independently of the oracle under test.
    // Missing/failed stock compilers should reach the declaration gate.
    put("build.mjs", 'import {writeFileSync} from "node:fs"; writeFileSync("build-ready.txt", "ready")\n')
    put(".gitignore", "node_modules/\n")
    put("tsconfig.json", JSON.stringify({ compilerOptions: { rootDir: "src", outDir: "lib", strict: true }, include: ["src/**/*.ts", "src/**/*.vibe"] }))
    for (const [name, source] of Object.entries(corpus.source)) put(name, source)
    compiler("vibelang", identical ? corpus.stock : includePrivate ? { ...corpus.stock, "Ok.d.ts": "export declare const ok: (value: string) => number;\n" } : corpus.native, 0)
    if (stock) compiler(custom ? "custom-tsc" : "tsrs", corpus.stock, stockExit)
    if (mixed) put("src/Already.vibe", "export const already = 1\n")
    symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"))
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost && jj commit -m original", { cwd: target })
    const p = paths(run)
    writeJson(p.config, makeConfig({ target, test: "true", vibelangVersion: "0.0.11", wire: false, includePrivateDeclarations: includePrivate, ...(custom ? { stockCompiler: "node_modules/.bin/custom-tsc" } : {}) }))
    writeJson(p.upgrade, { jj: { initialized: true, commit: await commitId(target) }, effect: { to: "4.1.0" }, changed: [], tests: {} })
    writeJson(join(p.baseline, "upgraded-tests.json"), { code: 0, tests: {} })
    writeJson(join(p.baseline, "upstream-packs.json"), await packRepository({ target }, join(run, "upstream-packs")))
    const baseline = await setup({ run })
    assert.equal(readFileSync(join(target, "build-ready.txt"), "utf8"), "ready")
    const module = includePrivate ? "src/Ok" : "src/Pipes/builders"
    renameSync(join(target, module + ".ts"), join(target, module + ".vibe"))
    writeJson(p.plan, { batches: [{ files: [module + ".ts"] }] })
    return await action({ run, p, baseline })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}


test("alchemy-23: equal native declarations cannot hide a file the stock compiler wrote", async () => {
  await fixture(async ({ run, p, baseline }) => {
    const result = await verify({ run, batch: "01" })
    assert.equal(result.ok, false)
    assert.equal(result.checks.declarations, true)
    assert.equal(result.checks.declarationOracle, false)
    assert.deepEqual(result.declarationOracle.unproven.map(x => x.file), ["src/Pipes/builders.vibe"])
    assert.deepEqual(JSON.parse(readFileSync(join(p.baseline, "declaration-oracle.json")))["."].missing, ["Pipes/builders.d.ts"])
    assert.equal(baseline.declarationOracle["."].compiler, "tsrs")
  })
})

test("the stock gate accepts matching declarations", async () => {
  await fixture(async ({ run }) => {
    const result = await verify({ run, batch: "01" })
    assert.equal(result.ok, true)
    assert.equal(result.checks.declarationOracle, true)
  }, { identical: true })
})

test("a missing, failed or legacy stock oracle cannot certify a published migration", async () => {
  for (const options of [{ stock: false }, { stockExit: 2, identical: true }, { legacy: true, identical: true }]) await fixture(async ({ run, p }) => {
    if (options.legacy) rmSync(join(p.baseline, "declaration-oracle.json"))
    const result = await verify({ run, batch: "01" })
    assert.equal(result.ok, false)
    assert.equal(result.checks.declarations, true)
    assert.equal(result.checks.declarationOracle, false)
    assert.equal(result.declarationOracle.unproven.length, 1)
    assert.match(result.declarationOracle.unproven[0].reason, /no .*installed|failed|no stock compiler oracle|did not finish/)
  }, options)
})

test("private packages keep their published-declaration exemption", async () => {
  await fixture(async ({ run }) => {
    const result = await verify({ run, batch: "01" })
    assert.equal(result.ok, true)
    assert.equal(result.declarations["."], "not published")
  }, { privatePackage: true, stock: false })
})


test("setup records an oracle for remaining TypeScript sources in a mixed package", async () => {
  await fixture(async ({ run, baseline }) => {
    assert.equal(baseline.declarationOracle["."].compiler, "tsrs")
    const result = await verify({ run, batch: "01" })
    assert.equal(result.ok, true)
  }, { identical: true, mixed: true })
})

test("setup uses an explicitly selected stock compiler", async () => {
  await fixture(async ({ run, baseline }) => {
    assert.equal(baseline.declarationOracle["."].compiler, "custom-tsc")
    const result = await verify({ run, batch: "01" })
    assert.equal(result.ok, true)
  }, { identical: true, custom: true })
})

const fc = require("fast-check")
const t3code = JSON.parse(readFileSync(new URL("./corpus/t3code-private-stock-oracle.json", import.meta.url), "utf8"))

test("t3code: opted-in private packages record a stock API oracle; changed or unavailable APIs still fail", async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom(...t3code.variants), async options => {
    await fixture(async ({ run, baseline }) => {
      const oracle = baseline.declarationOracle["."]
      assert.ok(oracle, "setup must record the opted-in private oracle")
      const result = await verify({ run, batch: "01" })
      assert.equal(result.checks.declarationOracle, options.identical === true && options.stock !== false && !options.stockExit)
      assert.equal(result.checks.declarations, true, "candidate matches native baseline; stock identity is independently required")
      assert.equal(result.checks.packs, true, "the declaration oracle is tested with a valid upstream pack receipt")
    }, { ...options, privatePackage: true, includePrivate: true })
  }), { seed: 31103, numRuns: 6, examples: t3code.variants.map(x => [x]) })
})
