import assert from "node:assert/strict"
import { test } from "node:test"
import { buildContractSuites } from "../build-contract-inputs.ts"
import { readFileSync, globSync } from "node:fs"
import { rootTestGroups, rootShardName, rootTestShards, rootTestTargetName, minimizeRootTestInputs, createRootTestInputs } from "../root-test-shards.ts"
import { declarationTargets } from "./testing/package-declaration.mjs"

const groups = rootTestGroups()
test("every root suite has exactly one leaf per selected test file", () => {
  const targets = declarationTargets("PACKAGE.ts")
  for (const [group, files] of Object.entries(groups)) {
    assert.ok(Array.isArray(targets[group].tests), group + " must be a Suite")
    const shards = rootTestShards(group, files)
    const leaves = shards.map(shard => targets[shard.name])
    assert.ok(leaves.every(Boolean), group + " has a leaf for each discovered group")
    assert.equal(new Set(leaves).size, shards.length, group + " repeats no leaf")
    assert.deepEqual(shards.flatMap(shard => shard.files).sort(), [...files].sort(), group + " assigns every file exactly once")
    for (const [index, leaf] of leaves.entries()) {
      assert.ok(targets[group].tests.includes(leaf), shards[index].name + " is reachable")
      for (const file of shards[index].files)
        assert.equal(leaf.shell.split(group === "docs-tools" || file.endsWith(".ts")
          ? file.slice("docs/tools/".length) : file).length - 1, 1, file)
      assert.equal(leaf.timeout, "8m", shards[index].name)
    }
  }
})
test("new files and punctuation neighbours get unique stable leaf names", () => {
  const files = [
    ...globSync("scripts/*.test.mjs"),
    "scripts/a.b.test.mjs",
    "scripts/a_b.test.mjs",
    "scripts/a-b.test.mjs",
    "scripts/a'b.test.mjs",
    "scripts/λ.test.mjs"
  ]
  assert.equal(new Set(files.map((file) => rootShardName("release", file))).size, files.length)
  for (const [group, selected] of Object.entries(groups)) {
    const before = rootTestShards(group, selected)
    const after = rootTestShards(group, [...selected, ...files.slice(-6)])
    const owner = shards => new Map(shards.flatMap(shard => shard.files.map(file => [file, shard.name])))
    const previous = owner(before), next = owner(after)
    for (const file of selected) assert.equal(next.get(file), previous.get(file), "new files must not reshuffle " + file)
    for (const file of files.slice(-6)) assert.ok(next.has(file), "new files always get a leaf: " + file)
  }

})
test("each declaration selects one file and retains failures without a pipeline", () => {
  const targets = declarationTargets("PACKAGE.ts")
  for (const [group, files] of Object.entries(groups))
    for (const file of files) {
      const leaf = targets[rootTestTargetName(group, file)]
      assert.ok(leaf, file)
      assert.doesNotMatch(leaf.shell, /\|\||--test-shard|--test-name-pattern/)
      assert.match(leaf.shell, /(?:node --test|bun test --timeout 60000)/)
    }
})

test("file leaves preserve the previous selectors as a disjoint union", () => {
  const oldRelease = [
    ...globSync("scripts/release/*.test.mjs"),
    ...globSync("scripts/*.test.mjs").filter(
      (file) => !file.startsWith("scripts/api-identity") && !buildContractSuites.includes(file)
    ),
    ...globSync([
      "typescript/vibelang/harness.test.mjs",
      "typescript/vibelang/harness-deadlines.test.mjs",
      "typescript/vibelang/cov-ch004-twin.test.mjs",
      "typescript/vibelang/coverage-stock-twins.test.mjs",
      "typescript/vibelang/vip7-reference.test.mjs",
      "docs/redirect/*.test.mjs",
      "site/scripts/sync-spec-docs.test.mjs",
      "site/scripts/sync-user-docs.test.mjs",
      ".smithers/flows/effect-bump/test/*.test.mjs",
      ".smithers/flows/ts-bump/test/*.test.mjs",
      ".smithers/flows/ci-health/test/*.test.mjs",
      ".smithers/flows/first-bad/test/*.test.mjs",
      ".smithers/flows/test/*.test.mjs"
    ])
  ].sort()
  assert.deepEqual(groups.release, oldRelease)
  const docs = globSync("docs/tools/*.test.*")
    .filter((file) => !/^(?:site-contrast|site-spec-links|spec-lint)\.test\./.test(file.slice("docs/tools/".length)))
    .sort()
  assert.deepEqual(groups["docs-tools"], docs)
  assert.deepEqual(groups["api-identity-test"], globSync("scripts/api-identity*.test.mjs").sort())
  assert.deepEqual(groups["mapper-scripts"], globSync("scripts/mapper-*.test.mjs").sort())
  const targets = declarationTargets("PACKAGE.ts")
  for (const [group, files] of Object.entries(groups)) {
    const expected = new Set(rootTestShards(group, files).map(shard => targets[shard.name]))
    const actual = targets[group].tests.filter((leaf) => leaf.summary?.startsWith("Run "))
    assert.equal(new Set(actual).size, actual.length, group + " repeats no leaf")
    assert.deepEqual(new Set(actual), expected, group + " neither omits nor adds a file")
  }
})

test("static specification commands stay reachable exactly once", () => {
  const targets = declarationTargets("PACKAGE.ts")
  for (const family of ["spec-catch-diagnostics", "spec-pipe-arrows"]) {
    assert.equal(targets[family].tests.length, 2)
    assert.equal(new Set(targets[family].tests).size, 2)
    assert.match(targets[family].tests[0].shell, /node docs\/tools\/spec-.*\.mjs$/)
    assert.match(targets[family].tests[1].shell, /node --test docs\/tools\/spec-.*\.test\.mjs$/)
  }
})

test("the site audit preserves its existing command and input", () => {
  const targets = declarationTargets("PACKAGE.ts")
  const site = targets["site-contrast"]
  assert.equal(site.shell, "cd docs/tools && bun test --timeout 60000 site-contrast.test.ts")
  assert.equal(site.timeout, "30m")
  assert.equal(site.data.length, 1)
  assert.ok(site.data[0].srcs.includes("**"))
  assert.deepEqual(Array.from(site.tools), ["bun", "node"])
  assert.ok(!Object.keys(targets).some(name => name.startsWith("site-ci-")))
})

test("the historical specification linter files remain members", () => {
  assert.deepEqual(
    [...groups["spec-linters-test"]].sort(),
    [
      "docs/tools/spec-rules.test.mjs",
      "docs/tools/spec-examples-compiler.test.mjs",
      "docs/tools/spec-rules-import-grammar.test.mjs",
      "docs/tools/diagnostic-identity.test.mjs",
      "docs/tools/diagnostic-examples.test.mjs",
      "docs/tools/diagnostic-archive-examples.test.mjs",
      "docs/tools/diagnostic-native-projects.test.mjs",
      "docs/tools/factory-diagnostic-retirement.test.mjs",
      "docs/tools/spec-lint.test.ts",
      "docs/tools/spec-native-source-resolution.test.ts"
    ].sort()
  )
})

test("dynamic fixture contracts name selected files and stay inside the repository", () => {
  const fixtures = JSON.parse(readFileSync(new URL("../root-test-fixtures.json", import.meta.url)))
  const files = new Set(Object.values(groups).flat())
  for (const [file, patterns] of Object.entries(fixtures)) {
    assert.ok(files.has(file), "retired fixture owner: " + file)
    assert.ok(patterns.length > 0, file)
    for (const pattern of patterns) {
      assert.ok(!pattern.startsWith("/") && !pattern.split("/").includes(".."), pattern)
      assert.ok(!pattern.includes("node_modules") && !pattern.startsWith(".cache/"), pattern)
    }
  }
})

test("API input mutation groups cover each original probe exactly once", async () => {
  const { apiInputProbes } = await import("../.smithers/flows/test/api-inputs-fixture.mjs")
  const indices = []
  for (const file of globSync(".smithers/flows/test/api-inputs-key*.test.mjs")) {
    const source = readFileSync(file, "utf8")
    const slice = /apiInputProbes\.slice\((\d+), (\d+)\)/.exec(source)
    assert.ok(slice, file + " declares its probe interval")
    for (let i = Number(slice[1]); i < Number(slice[2]); i++) indices.push(i)
  }
  assert.deepEqual(indices.sort((a, b) => a - b), apiInputProbes.map((_, i) => i),
    "a probe must belong to exactly one mutation file")
})

test("the API cache alias preserves its three original test files", () => {
  const targets = declarationTargets("PACKAGE.ts")
  assert.deepEqual(new Set(targets["api-inputs-cache"].tests), new Set(
    ["closure", "cache", "coverage"].map(name => targets[rootTestTargetName("release",
      ".smithers/flows/test/api-inputs-" + name + ".test.mjs")])
  ))
})

test("API cache probes and comparator files remain Node-only", () => {
  const targets = declarationTargets("PACKAGE.ts")
  for (const [group, files] of Object.entries(groups))
    for (const file of files.filter(file => group === "api-identity-test" || file.startsWith(".smithers/flows/test/api-inputs-"))) {
      const leaf = targets[rootTestTargetName(group, file)]
      assert.deepEqual(Array.from(leaf.tools), ["node"], file)
      assert.ok(!leaf.data.some(input => typeof input === "string" && /compiler|runtime-dist|forms-generator/.test(input)), file)
    }
})


test("input minimization preserves positive glob matches and explicit cross-package files", async () => {
  const { matchesGlob } = await import("node:path")
  const { createRequire } = await import("node:module")
  const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
  const path = fc.array(fc.constantFrom("src", "nested", ".hidden", "one", "two", "index.ts"), {minLength: 1, maxLength: 4}).map(parts => parts.join("/"))
  fc.assert(fc.property(fc.array(fc.tuple(path, fc.boolean()), {minLength: 1, maxLength: 12}), fc.array(path, {minLength: 1, maxLength: 20}), (entries, queries) => {
    const patterns = entries.map(([name, directory]) => directory ? name + "/**" : name)
    const reduced = minimizeRootTestInputs(patterns)
    for (const file of [...queries, ...entries.map(([name]) => name + "/probe.ts")])
      assert.equal(reduced.some(pattern => matchesGlob(file, pattern)), patterns.some(pattern => matchesGlob(file, pattern)), file)
  }), {seed: 261111, numRuns: 200})
  assert.ok(minimizeRootTestInputs(["scripts/**", "scripts/fuzz-gate/map.json"]).includes("scripts/fuzz-gate/map.json"),
    "a root glob cannot cover an explicit file in a nested package")
  const S = { file: path => ({file: path}), glob: patterns => patterns.map(pattern => ({glob: pattern})), Filegroup: value => value }
  const root = {}, packages = {}, typescript = {}, tsc = {}, vibelang = {}
  const inputs = createRootTestInputs(S, ["packages/runtime/package.json", "typescript/vibelang/cases/**"],
    {"":root,packages,typescript,"typescript/tsc":tsc,"typescript/vibelang":vibelang})
  assert.ok(inputs.includes(vibelang), "a directory read uses its owning package tree")
  assert.ok(inputs.some(input => input.srcs?.some(source => source.file === "packages/runtime/package.json")),
    "exact cross-package files are explicit file inputs")
})


test("starter template leaves include the forms generator they execute", async () => {
  const { rootTestBuildNeeds } = await import("../root-test-shards.ts")
  const file = "docs/tools/starter-templates.test.ts"
  assert.equal(rootTestBuildNeeds(file).forms, true)
  const targets = declarationTargets("PACKAGE.ts")
  assert.ok(targets[rootTestTargetName("docs-tools", file)].data.includes("typescript.forms-generator"))
})

test("native forms references retain their build dependency through imported helpers", async t => {
  const { rootTestBuildNeeds } = await import("../root-test-shards.ts")
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const { createRequire } = await import("node:module")
  const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
  const root = mkdtempSync(join(tmpdir(), "root-native-inputs-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "docs/tools"), { recursive: true })
  let sequence = 0
  const directory = fc.array(fc.constantFrom("bin", "local", "tools", "nested"), { maxLength: 4 })
  fc.assert(fc.property(directory, fc.constantFrom("vibelang-forms", "vibelang-forms.exe", "forms-generator", "FORMS_BINARY"), (parts, binary) => {
    const id = sequence++
    const file = "docs/tools/probe-" + id + ".test.mjs"
    writeFileSync(join(root, "docs/tools/tool-" + id + ".mjs"),
      "export const binary = " + (binary === "FORMS_BINARY" ? "process.env.FORMS_BINARY" : JSON.stringify([...parts, binary].join("/"))) + "\n")
    writeFileSync(join(root, file), 'import "./tool-' + id + '.mjs"\n')
    assert.equal(rootTestBuildNeeds(file, root).forms, true, binary)
  }), { seed: 261113, numRuns: 64 })
  const nodeOnly = "docs/tools/node-only.test.mjs"
  writeFileSync(join(root, nodeOnly), 'export const text = "format ordinary code"\n')
  assert.equal(rootTestBuildNeeds(nodeOnly, root).forms, false)
  const api = ".smithers/flows/test/api-inputs-probe.test.mjs"
  mkdirSync(join(root, ".smithers/flows/test"), { recursive: true })
  writeFileSync(join(root, api), 'export const inspectedNames = ["vibelang-forms", "FORMS_BINARY"]\n')
  assert.deepEqual(rootTestBuildNeeds(api, root), { compiler: false, runtime: false, forms: false, mapper: false })
})
