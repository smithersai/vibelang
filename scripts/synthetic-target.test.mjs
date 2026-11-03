import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { stripTypeScriptTypes } from "node:module"
import { test } from "node:test"
import { runInNewContext } from "node:vm"

test("the real benchmark target requires fresh compiler/runtime inputs and cannot skip", () => {
  const source = stripTypeScriptTypes(readFileSync(new URL("bench/PACKAGE.ts", import.meta.url), "utf8"))
    .replace(/^import .*$/gm, "").replace("export const Package", "globalThis.result")
  const context = {
    Packages: new Proxy({}, { get: (_, name) => "packages." + name }),
    S: { Shell: { Test: spec => spec, Run: spec => spec }, Host: { bin: bin => bin }, file: file => file, Package: spec => spec }
  }
  runInNewContext(source, context)
  const target = context.result.targets.synthetic
  assert.equal(target.shell, "SYNTHETIC_REQUIRE=1 node --test scripts/bench/gen-synthetic.test.mjs")
  for (const input of ["packages.compiler-native", "packages.runtime-dist", "packages.runtime-published",
    "//experiments/package.json", "//experiments/bun.lock", "gen-synthetic.mjs", "gen-synthetic.test.mjs",
    "//packages/compiler/package.json", "//packages/compiler/bun.lock", "//scripts/testing/property.mjs"]) {
    assert.ok(target.data.includes(input), input)
  }
  assert.deepEqual(Array.from(target.tools), ["node"])
  assert.equal(target.exclusive, undefined, "ordinary CI must run the benchmark check")
})
