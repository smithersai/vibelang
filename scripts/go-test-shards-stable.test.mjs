import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { test } from "node:test"

// A label such as //:go-vibelang-shard-17 is one GO_TEST_SLICE of a package's names. The merge queue compares a red
// label on a candidate with the same label on its base, so a label must hold the same existing tests on both trees:
// adding or removing one test may move that test only (2026-11-14, innocent entries rejected).
const script = new URL("./go-test-shards.sh", import.meta.url).pathname

// A stand-in test binary: -test.list prints $STABLE_NAMES; a run appends its -test.run selector, or ALL.
const binary = `#!/bin/sh
for a in "$@"; do case $a in -test.list) cat "$STABLE_NAMES"; exit 0 ;; esac; done
for a in "$@"; do case $a in -test.run=*) printf '%s\\n' "\${a#-test.run=}" >> "$STABLE_RUNS"; exit 0 ;; esac; done
echo ALL >> "$STABLE_RUNS"
`

// The 32-bit FNV-1a hash of a name's UTF-8 bytes, the key of a name testdata/shard-slices.txt does not list.
function fnv1a(name) {
  let hash = 0x811c9dc5
  for (const byte of Buffer.from(name, "utf8")) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0
  return hash
}

function fixture(t, { weights = "", slices } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "go shard stable-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const sub of ["testdata", "tmp", "bin"]) mkdirSync(join(dir, sub))
  // A copy, so a host-local scripts/go-test-slice beside the real launcher slices nothing here.
  writeFileSync(join(dir, "shards.sh"), readFileSync(script), { mode: 0o700 })
  writeFileSync(join(dir, "pkg.test"), binary, { mode: 0o700 })
  writeFileSync(join(dir, "testdata/shard-seconds.txt"), weights)
  if (slices !== undefined) writeFileSync(join(dir, "testdata/shard-slices.txt"), slices)
  const launch = (names, env) => {
    writeFileSync(join(dir, "names"), names.map(name => name + "\n").join(""))
    writeFileSync(join(dir, "runs"), "")
    const result = spawnSync("sh", [join(dir, "shards.sh"), join(dir, "pkg.test"), "-test.v"], {
      cwd: dir, encoding: "utf8", timeout: 15_000,
      env: { ...process.env, TMPDIR: join(dir, "tmp"), GO_TEST_SHARDS: "2", GO_TEST_SLICE_REBALANCE: "",
        STABLE_NAMES: join(dir, "names"), STABLE_RUNS: join(dir, "runs"), ...env }
    })
    assert.equal(result.error, undefined)
    const runs = readFileSync(join(dir, "runs"), "utf8").split("\n").filter(Boolean)
    return { ...result, runs }
  }
  return {
    dir,
    launch,
    // The slice (1..n) of every name, from n runs of the launcher.
    deal(names, n, env = {}) {
      const at = new Map()
      for (let i = 1; i <= n; i++) {
        const r = launch(names, { GO_TEST_SLICE: i + "/" + n, ...env })
        assert.equal(r.status, 0, i + "/" + n + ": " + r.stdout + r.stderr)
        for (const run of r.runs) {
          assert.notEqual(run, "ALL", i + "/" + n + " ran the whole package")
          for (const name of run.slice(2, -2).split("|")) {
            assert.ok(!at.has(name), name + " ran in slices " + at.get(name) + " and " + i)
            at.set(name, i)
          }
        }
      }
      assert.deepEqual([...at.keys()].sort(), [...names].sort(), "every name runs in exactly one of " + n + " slices")
      return at
    }
  }
}

// Mixed weights, as the real packages have: some names measured, most counting 1 s.
const names = Array.from({ length: 160 }, (_, i) => ["Test", "Fuzz", "Example"][i % 3] + "Stable" + String(i).padStart(3, "0"))
const weights = names.filter((_, i) => i % 7 === 0).map((name, i) => (300 - i * 9) + " " + name).join("\n") + "\n"
const recorded = n => "# keys\n" + names.map((name, i) => (i * 5) % n + " " + name).join("\n") + "\n"
const moved = (before, after) => [...before].filter(([name, slice]) => after.has(name) && after.get(name) !== slice)

async function slicesInUse() {
  const { declarationTargets } = await import("./testing/package-declaration.mjs")
  const counts = Object.values(declarationTargets("PACKAGE.ts"))
    .filter(target => /go-test-shards\.sh/.test(target?.shell ?? "") && target.env?.GO_TEST_SLICE)
    .map(target => Number(target.env.GO_TEST_SLICE.split("/")[1]))
  return [...new Set([3, ...counts])].sort((a, b) => a - b)
}

test("the slice counts in use are the ones these cases deal", async () => {
  const counts = await slicesInUse()
  assert.ok(counts.includes(32) && counts.includes(64), JSON.stringify(counts))
})

for (const n of [3, 32, 64]) {
  for (const [kind, slices] of [["no slice file", undefined], ["a recorded slice file", recorded(n)]]) {
    test(`adding one test moves no other test: ${n} slices, ${kind}`, t => {
      const f = fixture(t, { weights, slices })
      const before = f.deal(names, n)
      for (const added of ["TestAddedInTheMiddle", "FuzzStable0005Neighbour", "TestΩAdded"]) {
        const after = f.deal([...names.slice(0, 80), added, ...names.slice(80)], n)
        assert.deepEqual(moved(before, after), [], added + " moved existing tests")
        assert.equal(after.get(added), fnv1a(added) % n + 1, added + " takes its hash slice")
      }
    })
    test(`removing one test moves no other test: ${n} slices, ${kind}`, t => {
      const f = fixture(t, { weights, slices })
      const before = f.deal(names, n)
      for (const removed of [names[0], names[77], names[159]]) {
        const after = f.deal(names.filter(name => name !== removed), n)
        assert.deepEqual(moved(before, after), [], removed + " moved existing tests")
      }
    })
  }
}

test("FNV-1a matches its published vectors, and an unlisted name runs in slice hash mod n + 1", t => {
  assert.deepEqual(["", "a", "foobar"].map(fnv1a), [0x811c9dc5, 0xe40c292c, 0xbf9cf968])
  const vectors = { TestA: 3470755084, TestB: 3521087941, "TestΩ": 1747743528, "Fuzz世界": fnv1a("Fuzz世界"),
    TestFixedSpreadCallbackContracts: fnv1a("TestFixedSpreadCallbackContracts") }
  assert.deepEqual(Object.keys(vectors).slice(0, 3).map(fnv1a), [3470755084, 3521087941, 1747743528])
  const f = fixture(t)
  for (const n of [2, 32, 64]) {
    const at = f.deal(Object.keys(vectors), n)
    for (const [name, hash] of Object.entries(vectors)) assert.equal(at.get(name), hash % n + 1, name + " in " + n)
  }
})

test("a listed name runs in its recorded slice whatever its hash; a stale line is ignored", t => {
  const n = 32
  const keyOf = { TestA: 7, TestB: 7 + 32 * 3, TestC: 0, FuzzD: 31 }
  const slices = "# comment\n" + Object.entries(keyOf).map(([name, key]) => key + " " + name).join("\n") +
    "\n12 TestRemovedLongAgo\n"
  const f = fixture(t, { slices })
  const at = f.deal([...Object.keys(keyOf), "TestUnlisted"], n)
  for (const [name, key] of Object.entries(keyOf)) assert.equal(at.get(name), key % n + 1, name)
  assert.equal(at.get("TestUnlisted"), fnv1a("TestUnlisted") % n + 1)
  assert.ok(!at.has("TestRemovedLongAgo"))
})

for (const bad of ["x TestA", "7", "7 TestA extra", "-1 TestA", "3 TestB\n4 TestB"]) {
  test("a malformed or ambiguous slice file fails before any test runs: " + JSON.stringify(bad), t => {
    const f = fixture(t, { slices: bad + "\n" })
    const r = f.launch(["TestA", "TestB"], { GO_TEST_SLICE: "1/2" })
    assert.equal(r.status, 1, r.stdout + r.stderr)
    assert.match(r.stderr, /go-test-shards: testdata\/shard-slices\.txt:\d+: not a "<key> <name>" line/)
    assert.match(r.stderr, /go-test-shards: hashing tests failed/)
    assert.deepEqual(r.runs, [])
  })
}

test("a failed hash stage runs no test", t => {
  const f = fixture(t)
  writeFileSync(join(f.dir, "bin/od"), "#!/bin/sh\necho 'fixture od failed' >&2\nexit 3\n", { mode: 0o700 })
  const r = f.launch(["TestA", "TestB"], { GO_TEST_SLICE: "1/2", PATH: join(f.dir, "bin") + delimiter + process.env.PATH })
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stderr, /fixture od failed[\s\S]*go-test-shards: hashing tests failed/)
  assert.deepEqual(r.runs, [])
})

test("a slice that holds no test of a package with tests runs nothing, even slice 1", t => {
  // TestB keys to slice 2 of 2 (its hash is odd).
  assert.equal(fnv1a("TestB") % 2 + 1, 2)
  const f = fixture(t)
  const r = f.launch(["TestB"], { GO_TEST_SLICE: "1/2" })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.deepEqual(r.runs, [])
  assert.match(r.stdout, /^PASS$/m)
})

test("a rebalance records today's weighted deal, runs no test, and the slices then follow it", t => {
  const f = fixture(t, { weights: "9 TestSlowest\n6 FuzzSlower\n5 TestSlow\n" })
  const dealt = ["TestSlowest", "FuzzSlower", "TestSlow", "TestA", "TestB", "TestC", "ExampleD"]
  const r = f.launch(dealt, { GO_TEST_SLICE_REBALANCE: "3", GO_TEST_SLICE: "2/3" })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.deepEqual(r.runs, [], "a rebalance runs no test")
  assert.match(r.stderr, /wrote testdata\/shard-slices\.txt: 7 names, keys for 3 slices/)
  const rows = readFileSync(join(f.dir, "testdata/shard-slices.txt"), "utf8").split("\n").filter(l => l && !l.startsWith("#"))
  // Longest first onto the least-loaded slice, ties to the lowest slice, then 1 s names by name in byte order.
  assert.deepEqual(rows, ["2 ExampleD", "1 FuzzSlower", "1 TestA", "2 TestB", "1 TestC", "2 TestSlow", "0 TestSlowest"])
  const at = f.deal(dealt, 3)
  for (const row of rows) assert.equal(at.get(row.split(" ")[1]), Number(row.split(" ")[0]) + 1, row)
})

for (const [why, value, args] of [["zero slices", "0", []], ["a non-number", "x", []], ["a selector", "4", ["-test.run=^TestA$"]]]) {
  test("a rebalance refuses " + why + " and writes nothing", t => {
    const f = fixture(t)
    writeFileSync(join(f.dir, "names"), "TestA\n")
    const r = spawnSync("sh", [join(f.dir, "shards.sh"), join(f.dir, "pkg.test"), ...args], {
      cwd: f.dir, encoding: "utf8", timeout: 15_000,
      env: { ...process.env, TMPDIR: join(f.dir, "tmp"), GO_TEST_SLICE: "", GO_TEST_SLICE_REBALANCE: value,
        STABLE_NAMES: join(f.dir, "names"), STABLE_RUNS: join(f.dir, "runs") }
    })
    assert.equal(r.status, 2, r.stdout + r.stderr)
    assert.match(r.stderr, /GO_TEST_SLICE_REBALANCE/)
    assert.throws(() => readFileSync(join(f.dir, "testdata/shard-slices.txt")), { code: "ENOENT" })
  })
}
