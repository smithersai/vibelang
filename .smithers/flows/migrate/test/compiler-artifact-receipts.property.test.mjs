import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { writeProbeAwareCompiler } from "./fake-vibelang.mjs"
import { codemod, makeConfig, paths } from "../lib/steps.mjs"
import { onePassStep } from "../lib/onepass.mjs"
import { must, readJson, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-vite-build-entry.json", import.meta.url), "utf8"))

async function recoveredEntry({ staged, onePass, stem }) {
  const root = mkdtempSync(join(tmpdir(), "migration-receipt-json-"))
  try {
    const target = join(root, "repo"), run = join(root, "run"), p = paths(run)
    mkdirSync(join(target, "src"), { recursive: true })
    mkdirSync(join(target, "node_modules/.bin"), { recursive: true })
    symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"))
    writeJson(join(target, "package.json"), { name: "receipt-fixture", private: true })
    writeFileSync(join(target, ".gitignore"), "node_modules/\n")
    writeJson(join(target, "tsconfig.json"), { compilerOptions: { noEmit: true }, include: ["src"] })
    const source = "src/" + stem + ".ts"
    writeFileSync(join(target, source), corpus.source)
    writeFileSync(join(target, "vite.config.ts"), corpus.config.replaceAll("src/entry.ts", source))
    const toolchain = join(root, "toolchain")
    const compiler = staged ? join(toolchain, "compiler") : join(target, "node_modules/.bin/vibelang")
    writeProbeAwareCompiler(compiler, '#!/bin/sh\necho "vibelang --fix: 0 fixes in 0 files."\n', { mode: 0o755 })
    if (staged) writeJson(join(toolchain, "toolchain.json"), { compiler: "compiler", commit: "fixture-producer", packages: {} })
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost && jj commit -m baseline", { cwd: target })
    writeJson(p.config, makeConfig({ target, test: "true", ...(staged ? { toolchain } : { vibelangVersion: "0.0.0" }) }))
    writeJson(p.plan, { ...(onePass ? { mode: "one-pass" } : {}), batches: [{ files: [source] }] })
    const rename = () => onePass ? onePassStep("rename", { run }) : codemod({ run, batch: "01" })
    const fresh = await rename()
    assert.deepEqual(readJson(p.codemod("01")), fresh, "persisted receipt equals the first returned receipt")
    assert.deepEqual(await rename(), fresh, "recovery returns the same receipt")
    assert.deepEqual(fresh.compilerArtifact, readJson(p.config).compilerArtifact ?? null)
    if (staged) assert.match(fresh.compilerArtifact.nativeSha256, /^[0-9a-f]{64}$/)
    assert.equal(readFileSync(join(target, source.replace(/\.ts$/, ".vibe")), "utf8"), corpus.source)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("conversion receipts round trip for installed and staged compilers in both flows", async () => {
  for (const staged of [false, true]) for (const onePass of [false, true])
    await recoveredEntry({ staged, onePass, stem: "entry" })
})

test("generated conversion receipts preserve compiler identity across JSON and recovery", async () => {
  await fc.assert(fc.asyncProperty(fc.boolean(), fc.boolean(), fc.integer({ min: 0, max: 999 }), async (staged, onePass, suffix) => {
    await recoveredEntry({ staged, onePass, stem: "entry_" + suffix })
  }), { seed: 551106, numRuns: 12 })
})
