// The pending gate runs as parallel groups (fuzz-pending-units.ts). These
// tests fail when a pending unit runs in no group or in two, when the scan and
// pending.sh disagree, or when the groups together run a different set of
// test selections than one whole pending.sh run.
import { declarationTargets } from "./testing/package-declaration.mjs"
import { pendingGroups, pendingUnits, pendingGroupCount } from "../fuzz-pending-units.ts"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const tsc = path.join(root, "typescript/tsc")
const graph = declarationTargets("PACKAGE.ts", { bindings: { pendingGroups } })
const suite = graph["go-vibelangfuzz-pending"]
const leaves = Object.entries(graph).filter(([label]) => /^go-vibelangfuzz-pending-group-\d+$/.test(label))
const unitsOf = (shell) => {
  const match = /VIBELANG_PENDING_UNITS='([^']*)'/.exec(shell)
  assert.ok(match, "a pending leaf selects its units: " + shell)
  return match[1].split(" ")
}

// selections runs pending.sh with a stand-in go whose test binary records its
// -test.run argument, and returns every (test function, subtest pattern) pair
// one run selects, a whole run's pattern being "".
function selections(env, cwd = tsc) {
  const work = mkdtempSync(path.join(tmpdir(), "pending-groups-"))
  try {
    const record = path.join(work, "runs.txt")
    const probe = path.join(work, "probe")
    writeFileSync(probe, '#!/bin/sh\nprevious=\nfor arg in "$@"; do [ "$previous" != -test.run ] || printf "%s\\n" "$arg" >> "$PENDING_RECORD"; previous=$arg; done\n',
      { mode: 0o755 })
    mkdirSync(path.join(work, "bin"))
    writeFileSync(path.join(work, "bin/go"), '#!/bin/sh\nout=\nprevious=\nfor arg in "$@"; do [ "$previous" != -o ] || out=$arg; previous=$arg; done\n' +
      'cp "$PENDING_PROBE" "$out" && chmod +x "$out"\n', { mode: 0o755 })
    const run = spawnSync("sh", ["internal/vibelangfuzz/pending.sh"], {
      cwd, encoding: "utf8", timeout: 30000,
      env: { PATH: path.join(work, "bin") + ":" + process.env.PATH, TMPDIR: work, PENDING_PROBE: probe, PENDING_RECORD: record, ...env }
    })
    assert.equal(run.status, 0, run.stderr)
    const pairs = []
    for (const pattern of readFileSync(record, "utf8").split("\n").filter(Boolean)) {
      const match = /^\^\(([^)]*)\)\$(?:\/(.*))?$/.exec(pattern)
      assert.ok(match, "unexpected -test.run " + pattern)
      for (const name of match[1].split("|")) pairs.push(name + "\t" + (match[2] ?? ""))
    }
    return pairs.sort()
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

test("the scan names exactly the units pending.sh runs", () => {
  const run = spawnSync("sh", ["internal/vibelangfuzz/pending.sh", "--units"], { cwd: tsc, encoding: "utf8" })
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(pendingUnits(), run.stdout.split("\n").filter(Boolean).sort())
  for (const probe of ["probe:TestDataSpecRules", "probe:TestVIPConstructs"]) assert.ok(pendingUnits().includes(probe))
})

test("every pending unit runs in exactly one group", () => {
  const owners = new Map()
  for (const [label, leaf] of leaves) for (const unit of unitsOf(leaf.shell)) {
    assert.ok(!owners.has(unit), unit + " runs in " + owners.get(unit) + " and " + label)
    owners.set(unit, label)
  }
  assert.deepEqual([...owners.keys()].sort(), pendingUnits())
  assert.equal(leaves.length, pendingGroupCount)
  assert.deepEqual(new Set(suite.tests), new Set(leaves.map(([, leaf]) => leaf)),
    "//:go-vibelangfuzz-pending runs every group")
})

test("a unit a new pending line adds lands in a group", () => {
  const units = [...pendingUnits(), "FuzzAddedLater"].sort()
  const groups = pendingGroups(units)
  assert.equal(groups.flat().filter((unit) => unit === "FuzzAddedLater").length, 1)
  assert.deepEqual(groups.flat().sort(), units)
})

test("the groups together select exactly what one whole run selects", () => {
  const whole = selections({})
  const split = leaves.flatMap(([, leaf]) => selections({ VIBELANG_PENDING_UNITS: unitsOf(leaf.shell).join(" ") })).sort()
  assert.deepEqual([...new Set(whole.map((pair) => pair.split("\t")[0]))].sort(),
    pendingUnits().map((unit) => unit.replace(/^probe:/, "")).sort(), "the whole run selects every unit")
  assert.deepEqual(split, whole)
})

test("a selected unit no pending line names fails", () => {
  const run = spawnSync("sh", ["internal/vibelangfuzz/pending.sh"], {
    cwd: tsc, encoding: "utf8", env: { ...process.env, VIBELANG_PENDING_UNITS: "probe:TestDataSpecRules FuzzNoSuchPendingTarget" }
  })
  assert.equal(run.status, 2)
  assert.match(run.stderr, /no pending line names unit FuzzNoSuchPendingTarget/)
})

test("each pending group keeps the gate's inputs, environment and limit", () => {
  const hangs = graph["go-vibelangfuzz-hangs"]
  for (const [label, leaf] of leaves) {
    assert.match(leaf.shell, /CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s /, label)
    assert.match(leaf.shell, /sh internal\/vibelangfuzz\/pending\.sh$/, label)
    assert.ok(leaf.data.includes(hangs), label + " requires the hang probes")
    for (const input of [graph.tree, "tsc.srcs", "tsc.vibelangfuzz-files", "packages.runtime-dist", "packages.compiler-native"])
      assert.ok(leaf.data.includes(input), label + " reads " + input)
    assert.ok(leaf.data.some((input) => input?.migrationSources === true), label + " reads the migration sources")
    assert.equal(leaf.timeout, "10m", label)
  }
})
