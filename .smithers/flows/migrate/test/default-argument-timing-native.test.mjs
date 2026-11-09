import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { test } from "node:test"
import { fixToFixedPoint } from "../lib/codemod.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const compiler = process.env.VIBELANG_BINARY ?? fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const require = createRequire(join(runtime, "package.json"))
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-effect-fn-defaults.json", import.meta.url), "utf8"))
for (const [name, body] of Object.entries(corpus)) test("real compiler migration preserves the original " + name + " default", async () => {
  const root = mkdtempSync(join(tmpdir(), "native-default-timing-"))
  try {
    const source = 'import { Effect } from "effect";\nconst state = { value: 1 };\n' + body + "\n"
    writeFileSync(join(root, "main.vibe"), source)
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, types: [], outDir: "out" }, files: ["main.vibe"] }))
    mkdirSync(join(root, "node_modules"))
    symlinkSync(dirname(require.resolve("effect/package.json")), join(root, "node_modules/effect"), "dir")
    symlinkSync(dirname(require.resolve("typescript/package.json")), join(root, "node_modules/typescript"), "dir")
    symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"), "dir")
    await assert.rejects(fixToFixedPoint({ compiler, root, cwd: root, tsconfig: "tsconfig.json", only: ["main.vibe"], timeoutMs: 60000, onProgress: null }), /Effect\.fn parameter default.*execution/)
    assert.equal(readFileSync(join(root, "main.vibe"), "utf8"), source)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
