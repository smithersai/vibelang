import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { stripTypeScriptTypes } from "node:module"
import { test } from "node:test"
import { runInNewContext } from "node:vm"

function targets() {
  const source = stripTypeScriptTypes(readFileSync(new URL("../PACKAGE.ts", import.meta.url), "utf8"))
    .replace(/^import .*$/gm, "")
    .replace("export const Package", "globalThis.result")
  const group = prefix => new Proxy({}, { get: (_, name) => prefix + "." + name })
  const context = {
    fuzzTopics: new Map([["prelude", ["FuzzPreludeGlobalMember", "FuzzPreludeShadowed"]]]),
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

test("the fuzz topics name every Fuzz function by its file's first word", async () => {
  const { fuzzTopics } = await import("../fuzz-topics.ts")
  assert.ok(fuzzTopics.get("prelude").includes("FuzzPreludeGlobalMember"), "prelude_global_member_fuzz_test.go")
  assert.ok(fuzzTopics.get("fix").includes("FuzzFix"), "fix_fuzz_test.go")
  for (const [topic, names] of fuzzTopics) {
    assert.match(topic, /^[a-z0-9]+$/)
    for (const name of names) assert.match(name, /^Fuzz[A-Za-z0-9_]+$/)
  }
})
