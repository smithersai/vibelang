import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { test } from "node:test"
import { renameBatch, rewriteImports } from "../lib/codemod.mjs"
import { makeConfig, paths, revert } from "../lib/steps.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, writeJson } from "../lib/util.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-reference-free-revert.json", import.meta.url)))

async function witness({ directory, configured, extension, targetApi = true }) {
  const root = mkdtempSync(join(tmpdir(), "reference-free-revert-"))
  const target = join(root, "repo"), run = join(root, "run"), toolchain = join(root, "unavailable-toolchain")
  const put = (file, bytes) => {
    mkdirSync(dirname(join(target, file)), { recursive: true })
    writeFileSync(join(target, file), bytes)
  }
  try {
    put("package.json", '{"type":"module"}\n')
    put(".gitignore", "node_modules/\n")
    const files = Object.fromEntries(Object.entries(corpus.files).map(([name, text]) =>
      [directory + "/" + name.replace(/\.ts$/, extension), text.replaceAll(".ts", extension)]))
    for (const [file, text] of Object.entries(files)) put(file, text)
    put("output/keep.js", corpus.preservedOutput)
    if (configured) {
      put("tsconfig.json", JSON.stringify({ compilerOptions: { rootDir: ".", types: [] }, include: [directory] }))
      if (targetApi) {
        mkdirSync(join(target, "node_modules"))
        symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"))
      }
    }
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    await Jj.commit(target, "original source")
    const file = directory + "/value" + extension
    const p = paths(run), renames = renameBatch(target, [file])
    writeJson(p.config, makeConfig({ target, test: "true", toolchain }))
    writeJson(p.plan, { batches: [{ files: [file] }] })
    writeJson(p.codemod("01"), { renames,
      importEdits: rewriteImports(target, [directory + "/main" + extension, renames[0].to]) })
    const result = await revert({ run, batch: "01", file: renames[0].to, reason: "restore original source" })
    for (const [file, text] of Object.entries(files)) assert.equal(readFileSync(join(target, file), "utf8"), text)
    assert.equal(existsSync(join(target, renames[0].to)), false)
    assert.equal(existsSync(toolchain), false)
    assert.equal(readFileSync(join(target, "output/keep.js"), "utf8"), corpus.preservedOutput)
    assert.equal(result.referenceRefresh.state, "not-needed")
    assert.deepEqual(result.referenceRefresh.projects, [])
    assert.deepEqual(result.referenceRefresh.outputs, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("reference-free rollback restores the minimized importer without a toolchain", async () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(corpus.rule))
  for (const configured of [false, true]) for (const targetApi of [false, true])
    await witness({ directory: "src", configured, targetApi, extension: ".ts" })
})

test("reference-free rollback preserves generated paths and native extensions with an unavailable compiler", async () => {
  await fc.assert(fc.asyncProperty(fc.record({
    directory: fc.constantFrom("src", "nested/src", "with space", "café"),
    configured: fc.boolean(),
    targetApi: fc.boolean(),
    extension: fc.constantFrom(".ts", ".mts"),
  }), witness), { numRuns: 12, seed: 515152 })
})
