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
// Captured from published vibelang@0.0.8; regenerate with that release only.
const goldens = JSON.parse(readFileSync(new URL("./fixtures/smithers-native-readonly-upgrade.json", import.meta.url), "utf8"))

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

test("explicit readonly upgrade reproduces published 0.0.8 declarations exactly", { skip }, (t) => {
  const root = project(t)
  for (const [key, row] of Object.entries(goldens)) {
    writeFileSync(join(root, "src/a.vibe"), row.source)
    rmSync(join(root, "out"), { recursive: true, force: true })
    run(root, "--fix", "--fix-migration-only")
    for (const [name, expected] of Object.entries(row.declarations)) {
      assert.equal(readFileSync(join(root, "out", name), "utf8"), expected, key + "/" + name)
    }
    const fixed = readFileSync(join(root, "src/a.vibe"), "utf8")
    run(root, "--fix", "--fix-migration-only")
    assert.equal(readFileSync(join(root, "src/a.vibe"), "utf8"), fixed, key + " must reach a fixed point")
  }
})

test("ordinary checking and fixes keep native members writable", { skip }, (t) => {
  const root = project(t)
  const source = 'export interface Options { name: string }\nexport function change(o: Options): void { o.name = "next" }\n'
  writeFileSync(join(root, "src/a.vibe"), source)
  for (const flags of [[], ["--fix"], ["--fix", "--fix-vip-only"]]) {
    run(root, ...flags)
    assert.equal(readFileSync(join(root, "src/a.vibe"), "utf8"), source)
  }
})

test("explicit migration leaves plain TypeScript properties writable", { skip }, (t) => {
  const root = project(t)
  const source = 'export interface Options { name: string }\n'
  writeFileSync(join(root, "src/a.ts"), source)
  run(root, "--fix", "--fix-migration-only")
  assert.equal(readFileSync(join(root, "src/a.ts"), "utf8"), source)
})
