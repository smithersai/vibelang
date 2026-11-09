import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { test } from "node:test"
import fc from "fast-check"
import { plugin, project, run } from "./helpers.mjs"

const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-provide-return-coverage.json", import.meta.url)))
const vitest = join(dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs")
test("provide return coverage quotes the generated-code mapping contract", () => {
  const contract = readFileSync(new URL("../../../../docs/maintainers/source-maps.md", import.meta.url), "utf8")
  assert.ok(contract.includes(corpus.rule))
})
async function check(t, { prefix = "", newline = "\n", value = 1, kind = "return" } = {}) {
  const inputs = kind === "return" ? corpus : corpus[kind]
  const expected = kind === "continue" ? value * 2 : value
  const render = source => prefix + source.replaceAll("Counter = 1", "Counter = " + value)
    .replaceAll("Counter, 1", "Counter, " + value).replaceAll("\n", newline)
  const negative = "\nexport function uncalled() { return 99 }\n"
  const root = project(t, {
    "src/service.ts": corpus.service,
    "src/native.vibe": render(inputs.native) + negative,
    "src/original.ts": render(inputs.reference) + negative,
    "tsconfig.json": JSON.stringify({ compilerOptions: {
      target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
      skipLibCheck: true, allowImportingTsExtensions: true, noEmit: true, types: []
    }, include: ["src"] }),
    "vitest.config.ts": 'import {defineConfig} from "vitest/config";import vibelang from ' + JSON.stringify(plugin("vite/src/index.js")) + ';export default defineConfig({plugins:[vibelang()],test:{include:["test/*.test.mjs"],coverage:{enabled:true,provider:"v8",include:["src/native.vibe","src/original.ts"],reporter:["json"]}}})',
    "test/main.test.mjs": 'import {test,expect} from "vitest";import {Effect} from "effect";import {run as native} from "../src/native.vibe";import {run as original} from "../src/original.ts";test("provided return",async()=>{for(const run of [native,original]){expect(await Effect.runPromise(run())).toBe(' + expected + ');expect(await Effect.runPromise(run())).toBe(' + expected + ');}})'
  })
  const result = await run(process.execPath, [vitest, "run"], { cwd: root })
  assert.equal(result.code, 0, result.output)
  const coverage = JSON.parse(readFileSync(join(root, "coverage/coverage-final.json"), "utf8"))
  for (const source of ["native.vibe", "original.ts"]) {
    const file = coverage[join(root, "src", source)]
    assert.ok(file, source + " stays in coverage")
    const uncoveredBranches = Object.entries(file.b).filter(([, hits]) => hits.some(count => count === 0))
      .map(([id, hits]) => ({ hits, branch: file.branchMap[id] }))
    assert.deepEqual(uncoveredBranches, [], JSON.stringify({ source, uncoveredBranches }))
    const body = render(source === "native.vibe" ? inputs.native : inputs.reference)
    const authoredLine = body.split(/\r?\n/).findIndex(line => line.includes(kind === "return" ? (source === "native.vibe" ? "return try effect" : "export const run") : "return result")) + 1
    assert.ok(Object.entries(file.statementMap).some(([id, span]) => span.start.line === authoredLine && file.s[id] > 0),
      "the executed authored return stays mapped")
    const missed = Object.entries(file.fnMap).find(([, fn]) => fn.name === "uncalled")
    assert.ok(missed, "an unvisited authored function stays in coverage")
    assert.equal(file.f[missed[0]], 0)
  }
}
for (const kind of ["return", "break", "continue"]) {
  test("Smithers provided returns do not add uncovered synthetic branches: " + kind, async t => check(t, { kind }))
}
test("property: provide coverage retains Unicode, line endings and values", async t => {
  await fc.assert(fc.asyncProperty(
    fc.constantFrom("", "// café 😀\n", "/* 😀 */\r\n"), fc.constantFrom("\n", "\r\n"), fc.integer({ min: -100, max: 100 }), fc.constantFrom("return", "break", "continue"),
    (prefix, newline, value, kind) => check(t, { prefix, newline, value, kind })
  ), { seed: 811091, numRuns: 6 })
})
