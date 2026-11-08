// run-seconds: 120
// rule-evidence: docs/design/src/008-runtime.md#runtime-guarantees | Emitted `.vibe` and `.vibex` modules that use the key request the runtime initialization dependency first, before every other import or re-export dependency, independently of the Effect prelude switches.
// rule-evidence: docs/design/src/008-runtime.md#runtime-guarantees | TypeScript modules (`.ts`, `.tsx` and VIP-40 bodies) retain ordinary dependency order and arrange initialization before using the key, normally with `import "vibelang-runtime"` first.
// rule-evidence: docs/design/src/008-runtime.md#runtime-guarantees | Without prior host or runtime initialization, `Symbol.customMatcher` can be `undefined` even when its ambient type is visible.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const specifiers = (file) => [...fs.readFileSync(file, "utf8").matchAll(/^(?:import|export)\b[^\n]*?\bfrom\s+"([^"]+)"|^import\s+"([^"]+)"/gm)].map((m) => m[1] ?? m[2])

// Each observation runs in a fresh Node, where Symbol.customMatcher is absent.
function fresh(file, expression) {
  const url = pathToFileURL(path.join(here, file)).href
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `const m = await import(${JSON.stringify(url)}); console.log(JSON.stringify(${expression}))`], { cwd: here, encoding: "utf8", timeout: 30_000 })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  return JSON.parse(r.stdout)
}

// The switch-off build compiles the same sources with both prelude switches false.
const compiler = process.env.VIBELANG_BINARY
const build = spawnSync(compiler, ["--pretty", "false", "-p", path.join(here, "tsconfig.switches.json")], { cwd: here, encoding: "utf8", timeout: 60_000 })
assert.equal(build.status, 0, build.stdout + build.stderr)

for (const out of ["out", "out/switches"]) {
  const uses = specifiers(path.join(here, out, "uses.js"))
  assert.match(uses[0], /^vibelang-runtime(?:\/|$)/, out + "/uses.js requests the runtime first: " + uses)
  assert.deepEqual(uses.filter((s) => s.startsWith(".")), ["./probe-a.js", "./probe-b.js", "./plain.js"], out + "/uses.js keeps source order")
  const usesx = specifiers(path.join(here, out, "usesx.js"))
  assert.match(usesx[0], /^vibelang-runtime(?:\/|$)/, out + "/usesx.js requests the runtime first: " + usesx)
  assert.deepEqual(usesx.filter((s) => s.startsWith(".")), ["./probe-x.js", "./plain.js"])
  assert.deepEqual(fresh(out + "/uses.js", "[m.seen, m.reexported, m.even(2), m.even(3)]"), ["symbol", "symbol", true, false])
  assert.deepEqual(fresh(out + "/usesx.js", "[m.seen, typeof m.key, m.other]"), ["symbol", "symbol", 2])

  // TypeScript modules keep their written order and get no runtime import.
  assert.deepEqual(specifiers(path.join(here, out, "native.js")), ["./probe-c.js", "vibelang-runtime", "./probe-d.js"])
  assert.deepEqual(fresh(out + "/native.js", "[...m.order, typeof m.key, m.key === Symbol.for('Symbol.customMatcher')]"), ["undefined", "symbol", "symbol", true])
  assert.deepEqual(specifiers(path.join(here, out, "bare.js")), [])
  assert.deepEqual(fresh(out + "/bare.js", "[m.kind, m.key === undefined]"), ["undefined", true])
}
console.log("vibe modules initialize the key first; TypeScript modules keep their order")
// Stable rule ids: docs/design/src/008-runtime.md#77fff9f8c6321568 docs/design/src/008-runtime.md#893a8957e409f88f docs/design/src/008-runtime.md#2437126e62e206be
