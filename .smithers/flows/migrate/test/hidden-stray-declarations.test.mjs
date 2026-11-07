import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { emitDeclarations } from "../lib/declarations.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = require("typescript")
const tsc = require.resolve("typescript/lib/tsc.js")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-hidden-source-declarations.json", import.meta.url), "utf8"))

async function probe(folder, present, extension = ".ts", crlf = false) {
  const root = mkdtempSync(join(tmpdir(), "declaration-preservation-"))
  try {
    const dependency = join(root, folder)
    mkdirSync(dependency, { recursive: true })
    mkdirSync(join(root, "src"))
    writeFileSync(join(root, "package.json"), JSON.stringify({ private: true, type: "module" }))
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { rootDir: "src", module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022", allowImportingTsExtensions: true, types: [], skipLibCheck: true },
      files: ["src/main.ts"]
    }))
    writeFileSync(join(root, "src/main.ts"), `export { value } from ${JSON.stringify("../" + folder + "/value" + extension)}\n`)
    writeFileSync(join(dependency, "value" + extension), "export const value = 1\n")
    const declaration = join(dependency, "value.d" + extension)
    const original = Buffer.from("\uFEFF/** Authored input. */\nexport declare const preserved: unique symbol;\n".replaceAll("\n", crlf ? "\r\n" : "\n"))
    if (present) writeFileSync(declaration, original)
    const compiler = join(root, process.platform === "win32" ? "compiler.cmd" : "compiler.mjs")
    writeFileSync(compiler, process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "${tsc}" %*\r\n`
      : `#!/usr/bin/env node\nimport { spawnSync } from "node:child_process"\nconst child = spawnSync(process.execPath, [${JSON.stringify(tsc)}, ...process.argv.slice(2)], { stdio: "inherit" })\nprocess.exit(child.status ?? 1)\n`)
    chmodSync(compiler, 0o755)
    const log = join(root, "emit.log")
    const result = await emitDeclarations({ compiler, tsconfig: "tsconfig.json", cwd: root, outDir: join(root, "out"), root, log, typescript: ts })
    assert.equal(result.code, 2)
    assert.equal(result.files, 1)
    assert.ok(readFileSync(log, "utf8").replaceAll("\\", "/").includes("TSFILE: " + declaration.replaceAll("\\", "/")), "real TypeScript must reach the outside-root output")
    if (present) {
      assert.ok(existsSync(declaration), "existing source declaration was removed: " + folder)
      assert.deepEqual(readFileSync(declaration), original, "preserve exact authored bytes")
    } else {
      assert.equal(existsSync(declaration), false, "remove only the newly emitted outside-root file")
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const folder of corpus.directories) {
  test("real declaration emission preserves existing source in " + folder, () => probe(folder, true))
  test("real declaration emission removes newly created output in " + folder, () => probe(folder, false))
}

test("hidden declaration restoration preserves extension, quoting and exact line endings", async () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(corpus.contract))
  await fc.assert(fc.asyncProperty(fc.constantFrom(...corpus.directories), fc.boolean(), fc.constantFrom(".ts", ".mts", ".cts"), fc.boolean(),
    (folder, present, extension, crlf) => probe(folder, present, extension, crlf)),
  { seed: corpus.seed, numRuns: 12, examples: [[".private/with space", true, ".mts", true], ["nested/.private/café", true, ".cts", false]] })
})
