import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const root = fileURLToPath(new URL("../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(root, "packages/compiler/native/vibelang")
const modules = process.env.EFFECT_NODE_MODULES || join(root, "experiments/node_modules")

test("each fork form the shipped skill teaches compiles with the release compiler", {
  skip: !existsSync(native) || !existsSync(join(modules, "effect"))
}, t => {
  const skill = readFileSync(join(root, "packages/compiler/skills/vibelang/SKILL.md"), "utf8")
  const row = skill.split("\n").find(line => line.startsWith("| `Effect.forkChild(w)`"))
  assert.ok(row, "the skill must retain its fork comparison")
  const forms = [...row.split("|")[2].matchAll(/`([^`]+)`/g)].map(match => match[1])
  assert.ok(forms.length > 0, "the fork comparison must teach a form")
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "release-skill-fork-")))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, "node_modules"))
  symlinkSync(realpathSync(join(modules, "effect")), join(dir, "node_modules/effect"))
  symlinkSync(join(root, "packages/runtime"), join(dir, "node_modules/vibelang-runtime"))
  writeFileSync(join(dir, "package.json"), "{\"type\":\"module\"}\n")
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "es2022", module: "nodenext", strict: true, skipLibCheck: true, types: [], noEmit: true },
    include: ["*.vibe"]
  }))
  // Compile the taught operands with single-line and multiline bodies. Each
  // function keeps its fiber local, so scope-escape diagnostics cannot hide a
  // parser or type error in the form itself.
  for (const [i, form] of forms.entries()) {
    for (const [j, separator] of [" ", "\n", " /* fork form */\n"].entries()) {
      writeFileSync(join(dir, `form-${i}-${j}.vibe`),
        `export {}\neffect function w() { return 1 }\neffect function check(scope: Scope.Scope) {${separator}const fiber = ${form};${separator}try Fiber.join(fiber)${separator}}\n`)
    }
  }
  const result = spawnSync(native, ["-p", join(dir, "tsconfig.json"), "--pretty", "false"], { encoding: "utf8", timeout: 60_000 })
  assert.equal(result.status, 0, result.stdout + result.stderr + String(result.error || ""))
})
