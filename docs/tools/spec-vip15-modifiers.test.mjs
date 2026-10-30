import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { read, repo, run, tools } from "./spec-witness.mjs"

function counterpart() {
  const vip = read("docs/design/vips/0015-schema-declarations.md")
  const match = /\/\/ exactly this Effect TS\n([\s\S]*?)```/.exec(vip)
  assert.ok(match, "the VIP has its stated Effect counterpart")
  return `import { Schema } from "effect"
const Address = Schema.Struct({ city: Schema.mutableKey(Schema.String) })
` + match[1]
}
const assignments = `
const user: User = { id: "1", role: "admin", home: { city: "NYC" } }
user.id = "2"
user.nickname = "Ada"
user.role = "member"
user.home = { city: "Paris" }
// @ts-expect-error: the required home field still must be present
const missing: User = { id: "1", role: "admin" }
`

test("VIP-15's public counterpart and reference admission preserve written modifiers", () => {
  const vip = read("docs/design/vips/0015-schema-declarations.md")
  assert.ok(vip.includes("  id: Schema.mutableKey(Schema.String),"))
  assert.ok(vip.includes("a required fixed tuple position (before or after rest)"))
  assert.ok(vip.includes("readonly `Record` value position"))
  assert.ok(vip.includes("invents no flag-reset or unwrapping API"))
  assert.ok(read("docs/design/vips/0029-schema-errors.md").includes("even when no `readonly` token is written"))
  const result = run(counterpart() + assignments + `
import assert from "node:assert/strict"
const decoded = Schema.decodeUnknownExit(User)(user)
assert.equal(decoded._tag, "Success")
assert.equal(decoded.value.id, "2")
assert.equal(decoded.value.home.city, "Paris")
`)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

const compiler = join(repo, "packages/compiler/native", process.platform === "win32" ? "vibelang.exe" : "vibelang")
test("the printed User type permits every source-writable field assignment", { skip: !existsSync(compiler), timeout: 30000 }, () => {
  const directory = mkdtempSync(join(tools, ".spec-vip15-modifiers-"))
  try {
    writeFileSync(join(directory, "witness.mts"), counterpart() + assignments)
    writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, target: "ES2022", module: "NodeNext", types: [] },
      files: ["witness.mts"]
    }))
    const result = spawnSync(compiler, ["-p", join(directory, "tsconfig.json"), "--pretty", "false"], { encoding: "utf8", timeout: 25000 })
    assert.equal(result.status, 0, result.stdout + result.stderr)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
