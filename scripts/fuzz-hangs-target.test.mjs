import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { stripTypeScriptTypes } from "node:module"
import { test } from "node:test"
import { runInNewContext } from "node:vm"

function targets(env = {}) {
  const source = stripTypeScriptTypes(readFileSync(new URL("../PACKAGE.ts", import.meta.url), "utf8"))
    .replace(/^import .*$/gm, "")
    .replace("export const Package", "globalThis.result")
  const group = prefix => new Proxy({}, { get: (_, name) => prefix + "." + name })
  const context = {
    fuzzTopics: new Map([["prelude", ["FuzzPreludeGlobalMember", "FuzzPreludeShadowed"]]]),
    vibelangTopics: new Map([["fix", ["TestFixReachesFixedPoint", "TestFixArguments"]]]),
    process: { env },
    migrationSources: { migrationSources: true },
    S: { Filegroup: spec => spec, glob: glob => glob, file: file => file,
      Shell: { Test: spec => spec }, Host: { bin: bin => bin }, Package: spec => spec },
    Tsc: group("tsc"), Packages: group("packages"), Typescript: group("typescript"), Vibelang: group("vibelang")
  }
  runInNewContext(source, context)
  return context.result.targets
}

test("the pending merge gate requires real hang probes", () => {
  const graph = targets()
  const hangs = graph["go-vibelangfuzz-hangs"]
  assert.ok(hangs, "hang marker validity needs its own executable target")
  assert.ok(graph["go-vibelangfuzz-pending"].data.includes(hangs),
    "the existing merge-gate label must require hang validation")
  assert.match(hangs.shell, /-run '\^\(TestPendingHangs\|TestHangProbeDiagnosticSummary\)\$'/)
  assert.match(hangs.shell, /-v(?: |$)/, "keep each probe's termination diagnostics")
  assert.match(hangs.shell, /-count=1(?: |$)/)
  assert.match(hangs.shell, /VIBELANG_FUZZ_REQUIRE=1/)
  assert.doesNotMatch(hangs.shell, /VIBELANG_FUZZ_HANG_PROBE=1/,
    "the parent must run rather than skip as a child probe")
})

test("hang validation declares the source, corpus and runtime it reads", () => {
  const graph = targets()
  const hangs = graph["go-vibelangfuzz-hangs"]
  assert.ok(hangs, "hang marker validity needs a cached target")
  for (const input of [graph.tree, "tsc.srcs", "tsc.vibelangfuzz-files", "packages.runtime-dist"]) {
    assert.ok(hangs.data.includes(input), "missing hang-probe input: " + input)
  }
  assert.ok(hangs.tools.includes("go"))
  assert.ok(hangs.tools.includes("node"))
  assert.equal(hangs.sandbox, "none")
})

test("each fuzz topic runs its Fuzz functions over their seeds", () => {
  const prelude = targets()["go-vibelangfuzz-topic-prelude"]
  assert.ok(prelude, "the merge gate selects //:go-vibelangfuzz-topic-<topic> (ls/gate-cases.sh)")
  assert.match(prelude.shell, /go test -short -count=1 .*-run '\^\(FuzzPreludeGlobalMember\|FuzzPreludeShadowed\)\$' \.\/internal\/vibelangfuzz\/$/)
  assert.match(prelude.shell, /VIBELANG_FUZZ_REQUIRE=1/)
  assert.ok(prelude.data.includes("tsc.vibelangfuzz-files"))
})

test("the fuzz topics name every Fuzz and Test function by its file's first word", async () => {
  const { fuzzTopics } = await import("../fuzz-topics.ts")
  assert.ok(fuzzTopics.get("prelude").includes("FuzzPreludeGlobalMember"), "prelude_global_member_fuzz_test.go")
  assert.ok(fuzzTopics.get("fix").includes("FuzzFix"), "fix_fuzz_test.go")
  // A topic's Test functions break main as its oracles do: both turned 2519454b6513 RED post-merge.
  assert.ok(fuzzTopics.get("declaration").includes("TestDeclarationIdentityCanonicalization"), "declaration_identity_fuzz_test.go")
  assert.ok(fuzzTopics.get("data").includes("TestDataCounterpartFoldkit"), "data_counterpart_fuzz_test.go")
  // A file whose first word names no Fuzz function makes no topic: imported_codes_test.go has only tests.
  assert.equal(fuzzTopics.has("imported"), false)
  for (const [topic, names] of fuzzTopics) {
    assert.match(topic, /^[a-z0-9]+$/)
    assert.ok(names.some((name) => name.startsWith("Fuzz")), topic + " has no Fuzz function")
    assert.equal(new Set(names).size, names.length, topic + " names a function twice")
    for (const name of names) assert.match(name, /^(Fuzz|Test)[A-Za-z0-9_]+$/)
  }
})

test("each internal/vibelang test topic runs its Test functions", () => {
  const fix = targets()["go-vibelang-topic-fix"]
  assert.ok(fix, "the merge gate selects //:go-vibelang-topic-<topic> (ls/gate-cases.sh)")
  assert.match(fix.shell, /go test -count=1 .*-run '\^\(TestFixReachesFixedPoint\|TestFixArguments\)\$' \.\/internal\/vibelang\/$/)
  assert.ok(fix.data.includes("tsc.vibelang-files"))
})

test("the internal/vibelang topics name every Test function by its file's first word", async () => {
  const { vibelangTopics } = await import("../vibelang-topics.ts")
  assert.ok(vibelangTopics.get("fix").includes("TestFixReachesFixedPoint"), "fix_fixedpoint_test.go")
  assert.ok(vibelangTopics.get("tsforms").includes("TestTypeScriptFormCasesFix"), "tsforms_test.go")
  for (const [topic, names] of vibelangTopics) {
    assert.match(topic, /^[a-z0-9]+$/)
    for (const name of names) assert.match(name, /^Test[A-Za-z0-9_]+$/)
  }
})


for (const path of ["", "/tmp/fuzz budget.tsv"]) {
  test("short-seed targets declare the optional CPU budget log: " + JSON.stringify(path), () => {
    const graph = targets(path ? { VIBELANG_FUZZ_BUDGET_LOG: path } : {})
    for (const name of ["go-vibelangfuzz", "go-vibelangfuzz-pending",
      "go-vibelangfuzz-editor", "go-vibelangfuzz-compile", "go-vibelangfuzz-config", "go-vibelangfuzz-hangs"]) {
      assert.equal(graph[name].env?.VIBELANG_FUZZ_BUDGET_LOG, path, name)
    }
  })
}
