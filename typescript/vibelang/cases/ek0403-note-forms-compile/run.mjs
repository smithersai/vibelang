// run-seconds: 120
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Cause, Effect, Exit } from "effect"

// rule-evidence: docs/design/src/003-failures.md#calls-in-effect-code
// rule-evidence: docs/design/vips/0004-throw.md#retirement-of-the-empty-legacy-trust-wrapper
// EK0403's note and its quick fix must agree with the checker: every bridge
// form the note names, and the --fix output, compiles with zero diagnostics
// for an unannotated TypeScript function. The note once named
// trusted(f, [Errors]), which is EK0402 for such a function.
const here = dirname(fileURLToPath(import.meta.url))
const bridge = "try Effect.orDie(Effect.try({ try: () => evaluate(x), catch: (e) => e }))"
const fixed = readFileSync(join(here, "main.vibe"), "utf8")
const original = fixed.replace(bridge, "evaluate(x)")
assert.notEqual(original, fixed)

function project(source) {
  const dir = mkdtempSync(join(here, ".note-forms-"))
  symlinkSync(join(here, "node_modules"), join(dir, "node_modules"), "dir")
  for (const name of ["probe_foreign.ts", "package.json", "tsconfig.json"]) writeFileSync(join(dir, name), readFileSync(join(here, name)))
  writeFileSync(join(dir, "main.vibe"), source)
  return dir
}
function compile(dir, ...args) {
  try {
    return execFileSync(process.env.VIBELANG_BINARY, ["-p", dir, "--pretty", "false", ...args], { encoding: "utf8" })
  } catch (error) {
    return error.stdout
  }
}
async function outcomes(dir) {
  const { use } = await import(pathToFileURL(join(dir, "out/main.js")).href)
  const ok = await Effect.runPromiseExit(use(2))
  const thrown = await Effect.runPromiseExit(use(-1))
  assert.deepEqual(ok, Exit.succeed(2))
  assert(Exit.isFailure(thrown))
  const defect = Cause.squash(thrown.cause)
  return Cause.hasDies(thrown.cause) ? `dies with ${defect.message}` : `fails with ${defect.constructor.name}`
}

const dirs = []
try {
  const witness = project(original)
  dirs.push(witness)
  const diagnostics = compile(witness)
  const note = /Call it through (.+?), or keep its exceptions as defects with (.+?)\.\n/.exec(diagnostics)
  assert(note, diagnostics)
  assert(!diagnostics.includes("trusted("), diagnostics)
  assert.equal(note[2], bridge)
  for (const [name, form] of [["the note's Effect.try form", note[1]], ["the note's defect bridge", note[2]]]) {
    const dir = project(original.replace("evaluate(x)", form))
    dirs.push(dir)
    assert.equal(compile(dir), "", `${name} ${form} must compile with zero diagnostics`)
    console.log(`${name}: zero diagnostics; ${await outcomes(dir)}`)
  }
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
}
