import { writeProbeAwareCompiler } from "./fake-vibelang.mjs"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { codemod, makeConfig, paths } from "../lib/steps.mjs"
import { writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-ts6059-partial-emits.json", import.meta.url), "utf8"))
const native = process.env.VIBELANG_BINARY

test("partial emit routing follows the documented output contract", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes('Native runtime entries route only to package-owned JavaScript files the emit actually wrote, even when the compiler reports errors.'))
})

async function fixture({ code = 2, emitted = true, compiler } = {}) {
  const root = mkdtempSync(join(tmpdir(), "opencode-partial-emit-"))
  try {
    const target = join(root, "repo"), run = join(root, "run")
    for (const [file, text] of Object.entries(corpus.files)) {
      mkdirSync(dirname(join(target, file)), { recursive: true })
      writeFileSync(join(target, file), text)
    }
    mkdirSync(join(target, "node_modules"), { recursive: true })
    symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"))
    const bin = join(target, "packages/cli/node_modules/.bin/vibelang")
    mkdirSync(dirname(bin), { recursive: true })
    if (compiler) symlinkSync(compiler, bin)
    else writeProbeAwareCompiler(bin, [
      "#!/usr/bin/env node",
      'const fs = require("node:fs"), path = require("node:path")',
      'const at = process.argv.indexOf("--outDir"), out = process.argv[at + 1]',
      'if (' + emitted + ') {',
      'const file = path.join(out, "src/index.js"); fs.mkdirSync(path.dirname(file), { recursive: true });',
      'fs.writeFileSync(file, "export const answer = 42;\\n"); console.log("TSFILE: " + file)',
      '}',
      'if (' + code + ' !== 0) console.log("test/index.ts(1,1): error TS6059: File ../core/test/fixture/git.ts is not under rootDir.")',
      'process.exitCode = ' + code
    ].join("\n") + "\n", { mode: 0o755 })
    const init = spawnSync("jj", ["git", "init", "--colocate", target], { encoding: "utf8" })
    assert.equal(init.status, 0, init.stderr)
    writeJson(paths(run).config, makeConfig({ target, packages: ["packages/cli"], test: "true", vibelangVersion: "0.0.11" }))
    writeJson(paths(run).plan, { batches: [{ files: [] }] })
    const result = await codemod({ run, batch: "01" })
    const receipt = result.emittedJs[0]
    const manifest = JSON.parse(readFileSync(join(target, "packages/cli/package.json"), "utf8"))
    assert.deepEqual(manifest.exports["."], compiler || emitted
      ? { types: "./src/index.ts", "vibelang-source": "./src/index.ts", default: "./.vibelang/js/src/index.js" }
      : "./src/index.ts")
    assert.equal(receipt.code, compiler ? 2 : code)
    assert.equal(receipt.exportsChanged, compiler ? true : emitted)
    assert.equal(receipt.files > 0, compiler ? true : emitted)
    if (!compiler) assert.equal(manifest.exports["./missing"], "./src/missing.ts")
    assert.equal(receipt.diagnostics.some(d => d.code === "TS6059"), (compiler ? 2 : code) !== 0)
    assert.deepEqual(JSON.parse(readFileSync(paths(run).codemod("01"), "utf8")).emittedJs, result.emittedJs)
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("opencode-55: codemod routes written JavaScript despite TS6059 and records the error", async () => fixture())
// docs/design/src/900-appendices.md#ac3dfee9be206986 — Chapter 900: export routing requires an actual emitted package-owned file.
test("partial emit routing follows actual outputs across successful and unsuccessful exit codes", async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom(0, 1, 2), fc.boolean(), async (code, emitted) => fixture({ code, emitted })), { seed: 550055, numRuns: 100 })
})
test("opencode's minimized cross-package fixture emits TS6059 and still routes native entries", { skip: !native && "set VIBELANG_BINARY" }, async () => fixture({ compiler: native }))
