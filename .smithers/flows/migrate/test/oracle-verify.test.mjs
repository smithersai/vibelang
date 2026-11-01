// verify against the stock compiler's oracle (oracle.mjs): a published
// package whose batch is identical to the native baseline still fails when
// the batch migrates a module whose native declaration the oracle does not
// prove (alchemy-23).
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { makeConfig, paths, verify } from "../lib/steps.mjs"
import { slug, writeJson, must } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const declaration = "export declare const apple = 1;\n"

async function verifyWith(oracle) {
  const root = mkdtempSync(join(tmpdir(), "migrate-oracle-verify-"))
  const target = join(root, "repo")
  const run = join(root, "run")
  const pkg = "packages/fruit"
  try {
    mkdirSync(join(target, pkg, "node_modules/.bin"), { recursive: true })
    mkdirSync(join(target, "node_modules"), { recursive: true })
    symlinkSync(require.resolve("typescript/package.json").replace(/\/package.json$/, ""), join(target, "node_modules/typescript"))
    writeJson(join(target, "package.json"), { private: true })
    writeJson(join(target, pkg, "package.json"), { name: "fruit", types: "./main.d.ts" })
    writeJson(join(target, pkg, "tsconfig.json"), { compilerOptions: { rootDir: "." }, include: ["*.vibe"] })
    writeFileSync(join(target, pkg, "main.vibe"), "export const apple = 1\n")
    // A vibelang that emits main.d.ts exactly as the native baseline has it.
    writeFileSync(join(target, pkg, "node_modules/.bin/vibelang"), [
      "#!/usr/bin/env node",
      'const fs = require("node:fs"), path = require("node:path");',
      'const outIndex = process.argv.indexOf("--outDir");',
      "if (outIndex >= 0) { fs.mkdirSync(process.argv[outIndex + 1], { recursive: true }); fs.writeFileSync(path.join(process.argv[outIndex + 1], \"main.d.ts\"), " + JSON.stringify(declaration) + ") }"
    ].join("\n") + "\n", { mode: 0o755 })
    const p = paths(run)
    writeJson(p.config, makeConfig({ target, packages: [pkg], test: "true", vibelangVersion: "0.0.11" }))
    writeJson(p.plan, { batches: [{ files: [pkg + "/main.ts"] }] })
    writeJson(join(p.baseline, "tests.json"), { code: 0, tests: {}, total: 0, passed: 0, failed: [], skipped: 0 })
    writeJson(join(p.baseline, "compile-" + slug(pkg) + ".json"), [])
    const baseline = join(p.baseline, "dts", slug(pkg))
    mkdirSync(baseline, { recursive: true })
    writeFileSync(join(baseline, "main.d.ts"), declaration)
    writeJson(join(baseline, "public-surface.json"), { roots: ["main.d.ts"], reachable: ["main.d.ts"], unresolved: [] })
    if (oracle) writeJson(join(p.baseline, "declaration-oracle.json"), { [pkg]: oracle })
    writeFileSync(join(target, ".gitignore"), "node_modules/\n")
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost && jj commit -m baseline", { cwd: target })
    const result = await verify({ run, batch: "01" })
    assert.deepEqual(JSON.parse(readFileSync(p.verify("01"), "utf8")), result)
    return result
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("migrate-flow:declaration-gate-stock-oracle: identical to a native baseline the oracle does not prove fails verify", async () => {
  const missing = await verifyWith({ compiler: "tsrs", files: ["main.d.ts"], missing: ["main.d.ts"], extra: [], changed: [] })
  assert.equal(missing.declarations["packages/fruit"].identical, true)
  assert.deepEqual(missing.declarationOracle.unproven.map((u) => [u.file, u.declaration]), [["packages/fruit/main.vibe", "main.d.ts"]])
  assert.match(missing.declarationOracle.unproven[0].reason, /no declaration/)
  assert.equal(missing.checks.declarationOracle, false)
  assert.equal(missing.ok, false)
})

test("an oracle that proves the migrated module's declaration, or none recorded, leaves verify to the native gate", async () => {
  const proven = await verifyWith({ compiler: "tsrs", files: ["other.d.ts"], missing: [], extra: [], changed: [{ file: "other.d.ts", diff: [] }] })
  assert.equal(proven.checks.declarationOracle, true)
  assert.equal(proven.ok, true)
  const unavailable = await verifyWith({ unavailable: "no tsc, tsgo or tsrs is installed for it" })
  assert.equal(unavailable.checks.declarationOracle, true)
  assert.deepEqual(unavailable.declarationOracle.unavailable, { "packages/fruit": "no tsc, tsgo or tsrs is installed for it" })
  const none = await verifyWith(null)
  assert.match(none.declarationOracle, /not recorded/)
  assert.equal(none.ok, true)
})
