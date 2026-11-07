// run-seconds: 240
// rule-evidence: docs/design/src/007-tooling.md#trailing-block-migration | | `TS2345`, `TS2554`, `TS2769`, or transitional `EK1023` | A legacy Effect-dual trailing block; `EK1023` applies when appending the block type-checks with changed meaning | The versioned dual migration runs first, preserves the original data-first or curried argument position and emits no duplicate `EK1101`. |
//
// Legacy sources wrote a block after an Effect dual where the dual takes its
// program. Each site keeps TypeScript's own call error, or reports EK1023
// where the appended call type-checks with another meaning; none reports
// EK1101. vibelang --fix writes the block as an effect block in the
// program's original position: first for a data-first signature, applied
// for a curried one. The fixed project compiles cleanly.
import assert from "node:assert/strict"
import { project, check } from "../../tests/coverage-tooling.mjs"

const dual = `import { Effect } from "effect"
// A dual whose data-first form takes the program first, with a second
// two-argument form that also accepts the appended block.
export function label<A, E, R>(self: Effect.Effect<A, E, R>, name: string): Effect.Effect<A, E, R>
export function label(name: string, fallback: Effect.Effect<string>): Effect.Effect<string>
export function label(first: unknown, second: unknown): unknown {
  return typeof first === "string" ? Effect.map(second as Effect.Effect<string>, (s) => first + ":" + s) : first
}
`
const legacy = `import { label } from "./dual.ts"

effect function work() {
  try sleep("1 millis")
  return "done"
}

function spanned() {
  return withSpan("load") {
    return try work()
  }
}

function timed() {
  return timeout("1 second") {
    return try work()
  }
}

function guarded() {
  const semaphore = Semaphore.makeUnsafe(1)
  return semaphore.withPermits(1) {
    return try work()
  }
}

function labelled() {
  return label("x") {
    return "b"
  }
}

export effect function main() {
  return [try spanned(), try timed(), try guarded(), try labelled()]
}
`
const p = project(import.meta.url, "dual", { "main.vibe": legacy, "dual.ts": dual }, { compilerOptions: { allowImportingTsExtensions: true } })
const before = check(p).output
const lines = legacy.split("\n")
const sites = [...before.matchAll(/^main\.vibe\((\d+),\d+\): error ((?:TS|EK)\d+)/gm)]
  .filter(m => m[2] !== "TS1005")
  .map(m => lines[Number(m[1]) - 1].trim() + " " + m[2])
console.log("before")
for (const site of sites) console.log("  " + site)
assert.ok(!/EK1101/.test(before), "a dual site reports EK1101\n" + before)

const fixed = check(p, ["--fix"])
assert.equal(fixed.status, 0, fixed.output)
const after = p.read("main.vibe")
console.log("after")
for (const line of after.split("\n").filter(l => /^\s*return .*(?:effect \{|\}, |\}\)\(|\)\(effect)/.test(l) || /^\s*\}[,)]/.test(l))) console.log("  " + line.trim())
const clean = check(p)
assert.equal(clean.status, 0, clean.output)
const again = check(p, ["--fix"])
assert.equal(p.read("main.vibe"), after, "a second --fix changed the source")
console.log("fixed project compiles; second --fix changes nothing")
