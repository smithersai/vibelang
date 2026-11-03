// Chapter 7: "Existing tools work." Forwarding a module must
// preserve the native ESM namespace and live bindings, including export-star.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import fc from "fast-check"
import { reexportOf } from "../emitted-js.mjs"

function compare({ initial, delta, defaultKind, star }, runtime = process.execPath) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-live-exports-")))
  try {
    const model = join(root, "model.mjs"), source = join(root, "source.mjs")
    writeFileSync(model, `let current = ${initial};
export { current };
export function bump() { current += ${delta}; }
${defaultKind === "binding" ? "export { current as default };" : defaultKind === "snapshot" ? "export default current;" : ""}
`)
    writeFileSync(source, star ? `export * from "./model.mjs";\n${defaultKind === "none" ? "" : 'export { default } from "./model.mjs";'}` : `export { current, bump${defaultKind === "none" ? "" : ", default"} } from "./model.mjs";`)
    writeFileSync(join(root, "forward.mjs"), reexportOf(source, defaultKind !== "none"))
    writeFileSync(join(root, "main.mjs"), `
import * as native from "./source.mjs";
import * as forwarded from "./forward.mjs";
const observe = m => [Object.keys(m).sort(), m.current, m.default];
const before = [observe(native), observe(forwarded)];
native.bump();
const after = [observe(native), observe(forwarded)];
console.log(JSON.stringify({ before, after, same: native.bump === forwarded.bump }));
`)
    const result = spawnSync(runtime, [join(root, "main.mjs")], { encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    const { before, after, same } = JSON.parse(result.stdout)
    assert.deepEqual(before[1], before[0])
    assert.deepEqual(after[1], after[0], "the default must remain a binding")
    assert.equal(same, true)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("RD-017: live defaults, absent defaults and export-star match native ESM", () => {
  for (const defaultKind of ["binding", "none", "snapshot"]) {
    for (const star of [false, true]) compare({ initial: 0, delta: 1, defaultKind, star })
  }
})

test("RD-017 property: forwarding matches native ESM across updates and export forms", () => {
  fc.assert(fc.property(fc.record({
    initial: fc.integer({ min: -100, max: 100 }),
    delta: fc.integer({ min: -10, max: 10 }),
    defaultKind: fc.constantFrom("binding", "none", "snapshot"),
    star: fc.boolean()
  }), compare), { seed: 17017, numRuns: 60 })
})
