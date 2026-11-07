// rule-evidence: docs/design/src/008-runtime.md#runtime-guarantees | They implement only the specified adaptations: defining `Symbol.customMatcher` where absent (below); generated error matchers; the class tests below and the pinned snapshot's extraction rules, without installing matcher methods on built-in globals; and the retained fixed checks for Effect's `Option`, `Exit`, `Result` and tagged errors (VIP-7).
//
// A fresh Node or Bun process records every own key and descriptor of the
// built-in globals, their prototypes and Effect's runtime objects, imports the
// runtime, and records them again. Only Symbol gains customMatcher; no
// built-in or Effect object gains a matcher method or any other property.
import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = mkdtempSync(join(tmpdir(), "vibelang-adaptations-"))
mkdirSync(join(root, "node_modules"))
symlinkSync(join(import.meta.dir, ".."), join(root, "node_modules", "vibelang-runtime"))
symlinkSync(join(import.meta.dir, "..", "node_modules", "effect"), join(root, "node_modules", "effect"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const probe = `
import { Cause, Data, Effect, Exit, Option, Result, Schema } from "effect"
class Tagged extends Data.TaggedError("Tagged") {}
class SchemaTagged extends Schema.TaggedError()("SchemaTagged", {}) {}
const roots = {
  globalThis, Object, Function, Array, String, Number, Boolean, Symbol, BigInt, Date, RegExp, Error, TypeError, RangeError,
  Promise, Map, Set, WeakMap, WeakSet, ArrayBuffer, Uint8Array, DataView, JSON, Math, Reflect, Proxy,
  Effect, Option, Exit, Result, Data, Schema, Cause,
  some: Option.some(1), none: Option.none(), success: Exit.succeed(1), failure: Exit.fail("e"),
  ok: Result.succeed(1), err: Result.fail("e"), program: Effect.succeed(1), tagged: new Tagged(), schemaTagged: new SchemaTagged({}),
  Tagged, SchemaTagged,
}
function snapshot() {
  const seen = new Map(), out = {}
  for (const [name, value] of Object.entries(roots)) {
    let o = value, depth = 0
    while ((typeof o === "object" || typeof o === "function") && o !== null && depth < 8) {
      if (!seen.has(o)) {
        seen.set(o, name + "^" + depth)
        // Node's fetch implementation installs its own undici dispatcher
        // symbols on globalThis when first reached; they are the host's.
        out[name + "^" + depth] = Reflect.ownKeys(o).filter((k) => !(typeof k === "symbol" && k.description?.startsWith("undici."))).map((k) => {
          const d = Object.getOwnPropertyDescriptor(o, k)
          const kind = "value" in d ? typeof d.value : "accessor"
          return String(k) + ":" + kind + ":" + d.writable + d.enumerable + d.configurable
        }).sort()
      }
      o = Object.getPrototypeOf(o); depth++
    }
  }
  return out
}
const before = snapshot()
const runtime = await import("vibelang-runtime")
const after = snapshot()
const changed = Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
const matcherHolders = Object.keys(after).filter((k) => after[k].some((e) => e.startsWith("Symbol(Symbol.customMatcher)")))
console.log(JSON.stringify({
  changed,
  added: changed.map((k) => after[k].filter((e) => !(before[k] ?? []).includes(e))),
  matcherHolders,
  exportIsKey: runtime.customMatcher === Symbol.customMatcher,
}))
`

for (const [name, executable] of [["Node", "node"], ["Bun", process.execPath]] as const) {
  test(`runtime helpers add only Symbol.customMatcher and install no matcher on built-in globals or Effect values (${name})`, () => {
    const file = join(root, `probe-${name}.mjs`)
    writeFileSync(file, probe)
    const result = Bun.spawnSync([executable, file], { cwd: root, timeout: 20_000 })
    expect(result.stderr.toString()).toBe("")
    expect(result.exitCode).toBe(0)
    const observed = JSON.parse(result.stdout.toString())
    expect(observed.changed).toEqual(["Symbol^0"])
    expect(observed.added).toEqual([["customMatcher:symbol:falsefalsefalse"]])
    expect(observed.matcherHolders).toEqual([])
    expect(observed.exportIsKey).toBe(true)
  }, 30_000)
}
// Stable rule id: docs/design/src/008-runtime.md#b05a6679e547376d
