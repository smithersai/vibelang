// The "Runtime cost" table on the Effect users page states what the committed
// benchmark measured (docs/user/benchmarks/runtime-cost). A rerun rewrites
// results.json, so a page left with old numbers, ratios or versions fails here,
// and so does a result measured on an Effect other than the runtime's pin.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { tableHeader, tableRows } from "../user/benchmarks/runtime-cost/loops.mjs"

const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
const BENCHMARK = "../user/benchmarks/runtime-cost/"
const results = JSON.parse(read(BENCHMARK + "results.json"))
const page = read("../user/src/vibelang-features/114-vibelang-for-effect-users.md")
const readme = read(BENCHMARK + "README.md")

// section returns the text under "## Runtime cost", up to the next heading.
function section(text) {
  const start = text.indexOf("\n## Runtime cost\n")
  assert.ok(start >= 0, "the page keeps its Runtime cost section")
  const end = text.indexOf("\n## ", start + 1)
  return text.slice(start, end < 0 ? undefined : end)
}

const loop = id => results.loops.find(entry => entry.id === id)
const ratio = (slow, fast) => Math.round(loop(slow).medianMs / loop(fast).medianMs)
const compiler = /^VibeLang (\d+\.\d+\.\d+\S*) /.exec(results.versions.compiler)?.[1]
const node = results.versions.node.replace(/^v/, "")
const load = values => Math.round(values[0])

// The facts both the page and the README state about the run.
const facts = [
  `the ${compiler} compiler built from commit \`${results.versions.compilerCommit}\``,
  `Node ${node}`,
  `Effect ${results.versions.effect}`,
  `${results.machine.cpuModel} and ${results.machine.logicalCpus} logical CPUs`,
  `the 1-minute load average was ${load(results.machine.loadAverageStart)} at the start and ${load(results.machine.loadAverageEnd)} at the end`,
]

test("the Runtime cost table rows are the committed results", () => {
  const rows = section(page).split("\n").filter(line => line.startsWith("|"))
  assert.deepEqual(rows, [...tableHeader, ...tableRows(results)])
})

test("the Runtime cost text states the run's versions, machine, method and ratios", () => {
  const text = section(page)
  assert.ok(compiler, "results.json records the compiler version")
  const platform = `${results.machine.os.split(" ")[0]} ${results.machine.arch}`
  const stated = [
    ...facts,
    `on ${platform}`,
    `${results.method.warmupRuns} untimed warm-up runs, then ${results.method.trials} timed runs`,
    `\`Effect.fn\` generator calls took about ${ratio("effect-fn", "vibelang-try")} times as long as Effect-contracted VibeLang calls`,
    `The \`catch\` loop took about ${ratio("vibelang-catch", "effect-or-else-succeed")} times as long as the hand-written \`Effect.orElseSucceed\` loop`,
  ]
  assert.deepEqual(stated.filter(fact => !text.includes(fact)), [])
  assert.ok(text.includes("https://github.com/smithersai/vibelang/tree/main/docs/user/benchmarks/runtime-cost"), "the section links the benchmark")
})

test("the benchmark README states the same run", () => {
  assert.deepEqual(facts.filter(fact => !readme.includes(fact)), [])
})

test("the results were measured on the Effect version the runtime pins", () => {
  const pin = JSON.parse(read("../../packages/runtime/package.json")).peerDependencies.effect
  assert.equal(results.versions.effect, pin)
  assert.equal(JSON.parse(read(BENCHMARK + "package.json")).dependencies.effect, pin)
})

test("each loop's summary agrees with its recorded runs", () => {
  for (const entry of results.loops) {
    const sorted = [...entry.trialsMs].sort((a, b) => a - b)
    assert.equal(sorted.length, results.method.trials, entry.id)
    assert.equal(entry.minMs, sorted[0], entry.id)
    assert.equal(entry.maxMs, sorted.at(-1), entry.id)
    assert.ok(entry.minMs <= entry.medianMs && entry.medianMs <= entry.maxMs, entry.id)
  }
})
