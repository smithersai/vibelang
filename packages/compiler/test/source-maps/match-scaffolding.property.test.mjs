import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { test } from "node:test"
import fc from "fast-check"
import { plugin, project, run } from "./helpers.mjs"

const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-match-scaffolding-coverage.json", import.meta.url)))
const vitest = join(dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs")
const quote = "A function or statement no source stands for starts with a segment that has no source position"

test("match scaffolding coverage quotes the generated-code mapping contract", () => {
  const contract = readFileSync(new URL("../../../../docs/maintainers/source-maps.md", import.meta.url), "utf8")
  assert.ok(contract.includes(quote))
})

async function check(t, { kind, prefix = "", newline = "\n", label, id = 0 }) {
  const name = "read_" + id
  let source = corpus[kind].replace(/\bread\b/g, name)
  let exercise = kind === "plain"
    ? 'expect(read({tag:"ready",value:17})).toBe(17);expect(read({tag:"idle"})).toBe(0)'
    : 'expect((await Effect.runPromiseExit(read({_tag:"ConfigError"})))._tag).toBe("Failure");expect((await Effect.runPromiseExit(read({_tag:"Other"})))._tag).toBe("Failure")'
  if (label) {
    const original = kind === "plain" ? "ready" : "ConfigError"
    source = source.replaceAll(original, label)
    exercise = exercise.replaceAll(original, label)
  }
  source = prefix + source.replaceAll("\n", newline)
  const missedLine = source.split(/\r?\n/).findIndex(line => line.includes("export function notCalled")) + 1
  const root = project(t, {
    "src/main.vibe": source,
    "vitest.config.ts": 'import {defineConfig} from "vitest/config";import vibelang from ' + JSON.stringify(plugin("vite/src/index.js")) + ';export default defineConfig({plugins:[vibelang()],test:{include:["test/*.test.mjs"],coverage:{enabled:true,provider:"v8",include:["src/**"],reporter:["json"]}}})',
    "test/main.test.mjs": 'import {test,expect} from "vitest";import {Effect} from "effect";import {' + name + ' as read} from "../src/main.vibe";test("all authored arms",async()=>{' + exercise + '})'
  })
  const result = await run(process.execPath, [vitest, "run"], { cwd: root })
  assert.equal(result.code, 0, result.output)
  const coverage = JSON.parse(readFileSync(join(root, "coverage/coverage-final.json"), "utf8"))
  const file = coverage[join(root, "src/main.vibe")]
  assert.ok(file, JSON.stringify(Object.keys(coverage)))
  const uncovered = Object.entries(file.s).filter(([, count]) => count === 0).map(([id]) => file.statementMap[id])
  assert.ok(uncovered.some(span => span.start.line === missedLine), "an unvisited authored statement stays uncovered")
  assert.deepEqual(uncovered.filter(span => span.start.line < missedLine), [], JSON.stringify({ kind, uncovered }))
  const missed = Object.entries(file.fnMap).find(([, fn]) => fn.name === "notCalled")
  assert.ok(missed, "the source function stays in coverage")
  assert.equal(file.f[missed[0]], 0)
}

for (const kind of ["plain", "effect"]) {
  test("Smithers match scaffolding coverage retains only authored statements: " + kind, async t => {
    await check(t, { kind })
  })
}

test("property: match scaffolding coverage preserves tags, comments, Unicode and line endings", async t => {
  await fc.assert(fc.asyncProperty(
    fc.constantFrom("plain", "effect"), fc.nat(10000),
    fc.constantFrom("", "// café 😀\n", "/* 😀 */\r\n"),
    fc.constantFrom("\n", "\r\n"),
    async (kind, id, prefix, newline) => check(t, { kind, id, prefix, newline, label: "Case" + id })
  ), { seed: 811087, numRuns: 4 })
})
