import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { repository } from "./spec-rules.mjs"
import { diagnostics, examples, verdict } from "./spec-examples.mjs"

function compile(source, fn) {
  mkdirSync(join(repository, ".cache"), { recursive: true })
  const dir = mkdtempSync(join(repository, ".cache/vip-compiler-"))
  try {
    mkdirSync(join(dir, "node_modules"))
    symlinkSync(join(repository, "experiments/node_modules/effect"), join(dir, "node_modules/effect"))
    symlinkSync(join(repository, "packages/runtime"), join(dir, "node_modules/vibelang-runtime"))
    writeFileSync(join(dir, "main.vibe"), source)
    writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }))
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ESNext", module: "NodeNext", skipLibCheck: true, noEmit: true, types: [] }, files: ["main.vibe"] }))
    fn(spawnSync(join(repository, "packages/compiler/native/vibelang"), ["--pretty", "false", "-p", join(dir, "tsconfig.json")], { cwd: dir, encoding: "utf8", timeout: 120000 }))
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
test("the compiler rejects a value catch handler and accepts a literal handler", { timeout: 150000 }, () => {
  const broken = 'import { Effect } from "effect"; effect function load() { const guest = 0; return Effect.fail(1) catch guest }\n'
  compile(broken, result => {
    assert.notEqual(result.status, 0)
    assert.ok(diagnostics(result.stdout + result.stderr).some(d => d.category === "error" && d.code === "EK0509"), result.stdout + result.stderr)
  })
  const fixed = broken.replace("catch guest", "catch () => guest")
  compile(fixed, result => assert.equal(result.status, 0, result.stdout + result.stderr))
})
test("actual compiler checks a marked negative example by its diagnostic code", { timeout: 150000 }, () => {
  const source = "// expect-error: EK0502\neffect function load() { return try 1 }\n"
  compile(source, result => {
    const example = examples("\`\`\`vibe\n" + source + "\`\`\`\n")[0]
    assert.equal(verdict(example, result).filter(f => f.severity === "error").length, 0, result.stdout + result.stderr)
    assert.ok(verdict({ ...example, expected: ["EK9999"] }, result).some(f => f.message.includes("expected EK9999")))
  })
})
