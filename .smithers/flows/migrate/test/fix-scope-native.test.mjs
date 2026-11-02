import assert from "node:assert/strict"
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { fixToFixedPoint } from "../lib/codemod.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const compiler = process.env.VIBELANG_BINARY ?? fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))

for (const aliasRoot of [false, true]) test(`native compiler preserves the dependency and unrelated link with symlinked root=${aliasRoot}`, async () => {
  const directory = mkdtempSync(join(tmpdir(), "opencode-native-fix-scope-"))
  const root = join(directory, "repo")
  mkdirSync(root)
  const callerRoot = aliasRoot ? join(directory, "alias") : root
  if (aliasRoot) symlinkSync(root, callerRoot, "dir")
  try {
    const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
    const selected = "packages/a/main.vibe", dependency = "packages/b/dep.vibe"
    const retained = "export interface Info { readonly value: number }\nexport const untouched = 1\n"
    put(selected, 'import { Effect } from "effect"\nimport type { Info } from "../b/dep.vibe"\nexport const make = Effect.fn("make")(function* (input: Info) { return input.value })\n')
    put(dependency, retained)
    put("package.json", '{"type":"module"}\n')
    put("tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, types: [], lib: ["ESNext"], rewriteRelativeImportExtensions: true, jsx: "preserve" }, files: [selected] }))
    mkdirSync(join(root, "node_modules"))
    const effect = dirname(createRequire(join(runtime, "package.json")).resolve("effect/package.json"))
    symlinkSync(effect, join(root, "node_modules/effect"), "dir")
    symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"), "dir")
    symlinkSync(join(root, "missing.vibe"), join(root, "unrelated.vibe"))
    const log = join(root, "receipts", "fix")
    const result = await fixToFixedPoint({ compiler, tsconfig: "tsconfig.json", cwd: callerRoot, root: callerRoot, only: [selected], log, timeoutMs: 60000 })
    assert.equal(result.settled, true)
    assert.deepEqual(Object.keys(result.byFile), [selected])
    assert.ok(result.rounds.every(round => round.code === 0))
    assert.deepEqual(result.diagnostics.filter(d => d.category === "error"), [])
    assert.ok(readFileSync(join(root, selected), "utf8").includes("effect"))
    assert.ok(!readFileSync(join(root, selected), "utf8").includes("Effect.fn"))
    assert.equal(readFileSync(join(root, dependency), "utf8"), retained)
    assert.ok(lstatSync(join(root, "unrelated.vibe")).isSymbolicLink())
    const receipt = readFileSync(`${log}.scope.log`, "utf8")
    assert.ok(receipt.includes(join(root, selected)) || receipt.includes(join(callerRoot, selected)))
    assert.ok(receipt.includes(join(root, dependency)) || receipt.includes(join(callerRoot, dependency)))
    assert.ok(!receipt.includes(join(root, "unrelated.vibe")))
    assert.match(receipt, /"stage":"acquired"/)
    assert.match(receipt, /"stage":"released"/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test("a failed scope query never starts a writable fix", async () => {
  const root = mkdtempSync(join(tmpdir(), "opencode-fix-scope-failure-"))
  try {
    const source = join(root, "main.vibe"), fake = join(root, "compiler.mjs")
    writeFileSync(source, "export const untouched = 1\n")
    writeFileSync(fake, `#!/usr/bin/env node
import fs from "node:fs"
if (process.argv.includes("--listFilesOnly")) {
 console.log(Array.from({ length: 100 }, (_, i) => "/unrelated/module-" + i + ".d.ts").join("\\n"))
 console.error("error TS5083: Cannot read configuration.")
 process.exit(1)
}
fs.writeFileSync(${JSON.stringify(join(root, "fix-started"))}, "started")
fs.writeFileSync(${JSON.stringify(source)}, "broken")
console.log("vibelang --fix: 0 fixes in 0 files.")
`)
    chmodSync(fake, 0o755)
    await assert.rejects(fixToFixedPoint({ compiler: fake, tsconfig: "tsconfig.json", cwd: root, root, only: ["main.vibe"] }), error => {
      assert.match(error.message, /cannot determine.*fix scope.*exit 1/)
      assert.match(error.message, /TS5083: Cannot read configuration/)
      assert.ok(!error.message.includes("module-99.d.ts"))
      return true
    })
    assert.equal(readFileSync(source, "utf8"), "export const untouched = 1\n")
    assert.equal(existsSync(join(root, "fix-started")), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
