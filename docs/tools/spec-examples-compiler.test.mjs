import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { repository } from "./spec-rules.mjs"
import { block, chapter } from "./spec-witness.mjs"
import { diagnostics, examples, verdict } from "./spec-examples.mjs"

function compile(source, fn, { noEmit = true } = {}) {
  mkdirSync(join(repository, ".cache"), { recursive: true })
  const dir = mkdtempSync(join(repository, ".cache/vip-compiler-"))
  try {
    mkdirSync(join(dir, "node_modules"))
    symlinkSync(join(repository, "experiments/node_modules/effect"), join(dir, "node_modules/effect"))
    symlinkSync(join(repository, "packages/runtime"), join(dir, "node_modules/vibelang-runtime"))
    writeFileSync(join(dir, "main.vibe"), source)
    writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }))
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ESNext", module: "NodeNext", skipLibCheck: true, noEmit, types: [] }, files: ["main.vibe"] }))
    fn(spawnSync(join(repository, "packages/compiler/native/vibelang"), ["--pretty", "false", "-p", join(dir, "tsconfig.json")], { cwd: dir, encoding: "utf8", timeout: 120000 }), dir)
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

test("the compiled advisory example and its TypeScript counterpart preserve child and parent exits", { timeout: 150000 }, () => {
  const text = chapter("007-tooling")
  const source = block(text, "effect function demo(", "vibe es")
  const reference = block(text, "function demo(e: Effect.Effect<")
  compile(source + "\nexport { demo }\n", (result, dir) => {
    assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr)
    writeFileSync(join(dir, "reference.ts"), reference + "\nexport { demo }\n")
    const observeExits = `
import { Effect, Exit, Fiber } from "effect"
const show = (exit) => Exit.isSuccess(exit)
  ? { success: exit.value }
  : { failure: exit.cause.reasons.map((r) => r._tag === "Fail" ? ["Fail", r.error] : [r._tag]) }
const observe = (e) => Effect.gen(function* () {
  const exit = yield* Effect.exit(demo(e, () => Effect.succeed(7)))
  if (Exit.isFailure(exit)) return show(exit)
  const [child, failedChild, both] = exit.value
  return { success: [show(yield* Fiber.await(child)), show(yield* Fiber.await(failedChild)), both] }
})
console.log(JSON.stringify(await Effect.runPromise(Effect.all([observe(Effect.fail("e")), observe(Effect.succeed(2))]))))
`
    for (const module of ["./main.js", "./reference.ts"]) {
      const runner = join(dir, "observe.ts")
      writeFileSync(runner, `import { demo } from "${module}"\n` + observeExits)
      const observed = spawnSync("bun", ["run", runner], { cwd: dir, encoding: "utf8", timeout: 30000 })
      assert.equal(observed.status, 0, observed.error?.message || observed.stderr)
      assert.deepEqual(JSON.parse(observed.stdout), [
        { failure: [["Fail", "e"]] },
        { success: [{ success: 2 }, { failure: [["Fail", "boom"]] }, [1, 2]] }
      ], module)
    }
  }, { noEmit: false })
})
