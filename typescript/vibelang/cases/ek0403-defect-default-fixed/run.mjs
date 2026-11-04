import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Cause, Effect, Exit } from "effect"

// rule-evidence: docs/design/src/003-failures.md#plain-code-never-throws
// Proxy ruling, 2026-11-04: the default fix keeps the Effect.gen defect Exit.
const here = dirname(fileURLToPath(import.meta.url))
const dir = mkdtempSync(join(here, ".defect-default-"))
try {
  symlinkSync(join(here, "node_modules"), join(dir, "node_modules"), "dir")
  for (const name of ["helpers.ts", "package.json", "tsconfig.json"]) {
    writeFileSync(join(dir, name), readFileSync(join(here, name)))
  }
  const helper = readFileSync(join(dir, "helpers.ts"), "utf8")
  const fixed = readFileSync(join(here, "main.vibe"), "utf8")
  const original = fixed.replaceAll(/\(try Effect\.orDie\(Effect\.try\(\{ try: \(\) => (.*?), catch: \(e\) => e \}\)\)\)/g, "$1")
  assert.notEqual(original, fixed)
  writeFileSync(join(dir, "main.vibe"), original)
  const compile = (...args) => execFileSync(process.env.VIBELANG_BINARY, ["-p", dir, "--pretty", "false", ...args], { encoding: "utf8" })
  compile("--fix")
  assert.equal(readFileSync(join(dir, "main.vibe"), "utf8"), fixed)
  assert.equal(readFileSync(join(dir, "helpers.ts"), "utf8"), helper, "throwing helpers must not receive a never annotation")
  assert.equal(compile(), "", "applied bridge must compile with zero diagnostics")
  compile("--fix")
  assert.equal(readFileSync(join(dir, "main.vibe"), "utf8"), fixed)

  const { diff } = await import(pathToFileURL(join(dir, "out/main.js")).href)
  const { isResolved, havePropsChanged } = await import(pathToFileURL(join(dir, "out/helpers.js")).href)
  const twin = (news, olds) => Effect.gen(function* () {
    if (!isResolved(news)) return undefined
    return havePropsChanged(olds, news) ? "update" : "noop"
  })
  const thrown = { marker: "getter defect" }
  const getter = Object.defineProperty({}, "value", { enumerable: true, get() { throw thrown } })
  const actual = Effect.runSyncExit(diff(getter, {}))
  assert.deepEqual(actual, Exit.failCause(Cause.die(thrown)))
  assert.deepEqual(actual, Effect.runSyncExit(twin(getter, {})))

  // Fuzz oracle: bridge Exit equals the gen twin for throwing and non-throwing callees.
  // Generate ordinary values, throwing getters/Proxy traps, deferred input and BigInt.
  for (let seed = 0; seed < 256; seed++) {
    const defect = { seed }
    const news = seed % 5 === 0 ? { value: seed } :
      seed % 5 === 1 ? Object.defineProperty({}, "value", { enumerable: true, get() { throw defect } }) :
      seed % 5 === 2 ? { value: BigInt(seed) } :
      seed % 5 === 3 ? { deferred: () => ({ value: seed }) } :
      new Proxy({}, { ownKeys() { throw defect } })
    const a = Effect.runSyncExit(diff(news, {}))
    const b = Effect.runSyncExit(twin(news, {}))
    // Native TypeErrors have different stacks at the two call sites.
    const normalize = exit => JSON.parse(JSON.stringify(exit, (key, value) =>
      key === "stack" ? undefined : value instanceof Error ? { name: value.name, message: value.message } : value))
    assert.deepEqual(normalize(a), normalize(b))
    if (seed % 5 === 1 || seed % 5 === 4) assert.deepEqual(a, Exit.failCause(Cause.die(defect)))
    if (seed % 5 === 2) {
      assert(Exit.isFailure(a))
      assert.equal(a.cause.reasons[0]._tag, "Die")
      assert(a.cause.reasons[0].defect instanceof TypeError)
    }
  }
  console.log("defect default: zero diagnostics; 256 Exit twins")
} finally {
  rmSync(dir, { recursive: true, force: true })
}
