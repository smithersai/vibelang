import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const skip = !existsSync(binary) && "build the native compiler first"

function project(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-legacy-readonly-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "src"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, types: [],
    rootDir: "src", outDir: "out", declaration: true, emitDeclarationOnly: true
  }, include: ["src"] }))
  return root
}
function run(root, ...flags) {
  const result = spawnSync(binary, ["-p", ".", "--pretty", "false", ...flags], { cwd: root, encoding: "utf8", timeout: 30000 })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result
}

test("ordinary checking keeps native members writable", { skip }, (t) => {
  const root = project(t)
  const source = 'export interface Options { name: string }\nexport function change(o: Options): void { o.name = "next" }\n'
  writeFileSync(join(root, "src/a.vibe"), source)
  run(root)
  assert.equal(readFileSync(join(root, "src/a.vibe"), "utf8"), source)
})
