import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

const script = process.env.VIBELANG_UNICODE_SCRIPT ?? new URL("./go-test-shards.sh", import.meta.url).pathname
const binary = `#!${process.execPath}
const names = JSON.parse(process.env.UNICODE_NAMES)
if (process.argv.includes("-test.list")) {
  console.log(names.join("\\n"))
  console.log("TestMain diagnostic with spaces")
} else {
  const selector = process.argv.find(arg => arg.startsWith("-test.run="))?.slice(10)
  for (const name of names) if (!selector || new RegExp(selector).test(name)) console.log("EXEC " + name)
}
`
function run(t, names, slice = "") {
  const dir = mkdtempSync(join(tmpdir(), "go shard unicode-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const copy = join(dir, "shards.sh"), peer = join(dir, "peer.mjs")
  writeFileSync(copy, readFileSync(script)) // isolate any host-local slice file
  writeFileSync(peer, binary, { mode: 0o700 })
  const result = spawnSync("sh", [copy, peer], {
    cwd: dir, encoding: "utf8", timeout: 15_000,
    env: { ...process.env, UNICODE_NAMES: JSON.stringify(names), GO_TEST_SHARDS: "3", GO_TEST_SLICE: slice, LC_ALL: "C" }
  })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result.stdout.split("\n").filter(line => line.startsWith("EXEC ")).map(line => line.slice(5)).sort()
}
for (const [label, names] of [
  ["Greek test", ["TestA", "TestΩ"]],
  ["accented test", ["TestA", "TestÉclair"]],
  ["CJK fuzz target", ["TestA", "Fuzz世界"]],
  ["Unicode example", ["TestA", "ExampleΠ"]],
  ["Unicode continuation", ["TestA", "TestPart_日本"]],
  ["mixed kinds", ["TestASCII", "TestΩ", "Fuzz世界", "ExampleΠ"]],
  ["Unicode-only kinds", ["TestΩ", "Fuzz世界", "ExampleΠ"]],
  ["ASCII control", ["TestA", "FuzzB", "ExampleC"]]
]) test("listed Go names execute exactly once: " + label, t => {
  assert.deepEqual(run(t, names), [...names].sort())
})
test("Unicode benchmarks remain excluded", t => {
  assert.deepEqual(run(t, ["TestA", "BenchmarkΩ"]), ["TestA"])
})
test("generated Go identifiers retain letters throughout names and across slices", t => {
  const letters = ["Ω", "Δ", "É", "Ж", "中", "字", "π", "λ", "Ա", "م", "ह", "א"]
  const names = ["TestASCII", ...Array.from({ length: 64 }, (_, i) =>
    ["Test", "Fuzz", "Example"][i % 3] + "Case_" + letters[i % letters.length] + i)]
  assert.deepEqual(run(t, names), [...names].sort())
  const slices = ["1/3", "2/3", "3/3"].flatMap(slice => run(t, names, slice))
  assert.deepEqual(slices.sort(), [...names].sort())
})
