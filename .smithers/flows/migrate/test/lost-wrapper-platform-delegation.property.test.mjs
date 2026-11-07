// dp-smithers-02 lost-wrapper:platform-delegation: the platform split keeps an
// export as a wrapper that calls the moved function of its name in
// `<Name>.platform.ts`, `export const load = () => $platform.load()`. The
// check counted a program handed back through that call as no Effect and
// flagged every such wrapper (build-cli FactoryProjectionExec discoverFlows,
// TargetExecution runTarget, build/targets NewPackage scaffold). The moved
// function is the original's, so the wrapper now pairs through it, as a VIP-40
// body's function does; a wrapper that does anything else is still compared.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"
import { lostWrapperCheck, lostWrappers } from "../lib/lost-wrapper.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")

const original = 'import { Effect } from "effect"\nexport const load = (): Effect.Effect<number> => Effect.sync(() => 1)\n'
const companion = 'import { Effect } from "effect"\nexport const load = () => Effect.sync(() => 1)\n'
const wrapper = (body) => `import * as platform from "./load.platform.js"\nexport const load = () => ${body}\n`

// The batch check over one module, reading the sibling the emitted module imports.
function check(emitted, sibling = companion) {
  return lostWrapperCheck({
    ts, files: ["src/load.vibe"],
    original: () => ({ path: "src/load.ts", text: original }),
    emitted: () => ({ path: "pkg/.vibelang/js/src/load.js", text: emitted }),
    read: (path) => (path === "pkg/.vibelang/js/src/load.platform.js" ? sibling : null),
  })
}

test("dp-smithers-02: a wrapper that calls its moved function in the platform sibling pairs through it", () => {
  const result = check(wrapper("platform.load()"))
  assert.deepEqual(result.blocking, [])
  assert.deepEqual(result.unpaired, [])
  // The wrapper and the callback it handed to Effect.sync both pair through the sibling.
  assert.equal(result.paired, 2)
})

test("a wrapper that does anything but call its own moved function is still compared", () => {
  // Hands back a value of its own.
  assert.deepEqual(check(wrapper("1")).blocking.map((f) => f.function), ["/load"])
  // Calls another member of the sibling.
  assert.deepEqual(check(wrapper("platform.other()"), companion + "export const other = () => 1\n").blocking.map((f) => f.function), ["/load"])
  // The moved function itself lost the wrapper.
  assert.deepEqual(check(wrapper("platform.load()"), 'export const load = () => 1\n').blocking.map((f) => f.function), ["/load"])
})

// Neighbourhood: the property suite's result shapes, each moved into the
// sibling behind a wrapper written as a concise arrow, a block arrow or a
// function declaration, with its result's wrapper kept or dropped. The check
// over the wrapper and its sibling agrees with the check over the moved code
// in the module.
const wrapped = (i) => `Effect.succeed(${i})`
const bare = (i) => `${i}`
const armsOf = (count, at, lost) => Array.from({ length: count }, (_, i) => (i === at && lost ? bare(i) : wrapped(i)))
const shapes = {
  concise: (results) => `(n) => ${results.reduceRight((rest, r) => (rest === null ? r : `n === ${results.indexOf(r)} ? ${r} : ${rest}`), null)}`,
  block: (results) => `(n) => { ${results.map((r, i) => `if (n === ${i}) return ${r};`).join(" ")} return Effect.never; }`,
  temporary: (results) => `(n) => { let $do1; ${results.map((r, i) => `if (n === ${i}) { const seen = n; $do1 = ${r}; }`).join(" ")} return $do1; }`,
}
const wrappers = {
  concise: "export const target = (n) => $platform.target(n)\n",
  block: "export const target = (n) => { return $platform.target(n) }\n",
  declaration: "export function target(n) { return $platform.target(n) }\n",
}
const prefix = 'import * as Effect from "effect/Effect";\n'

test("code moved behind a delegating wrapper checks as the same code in the module", () => {
  const cases = fc.record({ shape: fc.constantFrom(...Object.keys(shapes)), wrapper: fc.constantFrom(...Object.keys(wrappers)), count: fc.integer({ min: 1, max: 5 }), at: fc.nat(4), lost: fc.boolean() })
  fc.assert(fc.property(cases, (c) => {
    const at = c.at % c.count
    const text = (lost) => prefix + `export const target = ${shapes[c.shape](armsOf(c.count, at, lost))}\n`
    const direct = lostWrappers({ ts, original: text(false), emitted: text(c.lost) })
    const moved = lostWrappers({ ts, original: text(false), emitted: 'import * as $platform from "./m.platform.js";\n' + wrappers[c.wrapper], companions: [{ path: "m.platform.js", text: text(c.lost) }] })
    assert.deepEqual(moved.flags, direct.flags)
    assert.deepEqual(moved.unpaired, direct.unpaired)
    assert.equal(moved.paired, direct.paired)
    assert.equal(direct.flags.length > 0, c.lost)
  }), { numRuns: 200, seed: 90090 })
})
