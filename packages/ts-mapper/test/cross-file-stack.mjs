// Exercise Emit's imported-call boundary against the runtime built by e2e.sh.
// Keep locals live across the call, as runtime/tests/fastcalls.test.ts does:
// an eager cross-file cycle overflows far below the 100,000-call assertion.
//
// Deep recursion is written `effect`, running recursive calls with `try`
// (SKILL.md); a plain function keeps JavaScript's stack limit by design.
// The control below proves this fixture overflows when the calls are eager.
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const [mapper, work] = process.argv.slice(2)
// Any supported Node: an eager cross-file cycle overflows near 1,000 levels on each.
assert.ok(Number(process.versions.node.split(".")[0]) >= 22, "Node 22 or later")
const locals = Array.from({ length: 80 }, (_, i) => `let v${i} = n + ${i}`).join(";\n")
const sum = Array.from({ length: 80 }, (_, i) => `v${i}`).join(" + ")

// body retains all 80 locals while descending and checks every return frame.
function body(kind, name, callee, decrement) {
  return `export ${kind} ${name}(n: number) {
  if (n === 0) return 0
  ${locals}
  const r = ${kind === "function" ? "" : "try "}${callee}(n${decrement ? " - 1" : ""})
  return r + ${decrement ? 1 : 0} + (${sum}) - (${sum})
}\n`
}

// The eager control: the same cycle as plain functions overflows, so the
// effect runs below exercise the stack-safe path rather than a shallow fixture.
const cases = [
  { name: "eager", kind: "function", helpers: false },
  { name: "direct", kind: "effect function", helpers: false },
  { name: "with acyclic helpers", kind: "effect function", helpers: true },
]
for (const { name, kind, helpers } of cases) {
  const dir = path.join(work, `cross-file-${name.replaceAll(" ", "-")}`)
  fs.mkdirSync(dir, { recursive: true })
  for (const [file, own, other, target] of [["a", "f", "b", "g"], ["b", "g", "a", "f"]]) {
    const source = `import { ${target} } from "./${other}.vibe"\n` +
      body(kind, own, helpers ? `${own}Helper` : target, !helpers) +
      (helpers ? body(kind, `${own}Helper`, target, true) : "")
    const input = path.join(dir, `${file}.vibe`)
    const output = path.join(dir, `${file}.js`)
    fs.writeFileSync(input, source)
    const emitted = spawnSync(mapper, ["--emit", input, "--out", output], { encoding: "utf8" })
    assert.equal(emitted.status, 0, emitted.stdout + emitted.stderr)
    assert.equal(emitted.stderr, "", "Emit diagnostics")
  }
  const run = kind === "function"
    ? `assert.throws(() => f(100000), RangeError)`
    : `assert.equal(await Effect.runPromise(f(100000)), 100000)`
  fs.writeFileSync(path.join(dir, "run.mjs"), `
import { Effect } from "effect"
import { f } from "./a.js"
import assert from "node:assert/strict"
${run}
console.log("ok   cross-file ${name}: ${kind === "function" ? "overflows" : "100000"}")
`)
  const ran = spawnSync(process.execPath, [path.join(dir, "run.mjs")], { encoding: "utf8", timeout: 60000 })
  assert.equal(ran.status, 0, ran.stdout + ran.stderr)
  process.stdout.write(ran.stdout)
}
