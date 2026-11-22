import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, globSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const root = fileURLToPath(new URL("../../", import.meta.url))
const read = path => readFileSync(resolve(root, path), "utf8")
const buildPath = "docs/maintainers/build.md"
const fuzzPath = "docs/research/fuzzing.md"
const admissionPath = "docs/research/grammar-admission.md"

test("the build guide names declared graph targets", () => {
  const cli = resolve(root, ".smithers/node_modules/.bin/smthrs")
  const graph = spawnSync(cli, ["graph", "//...", "--workspace", root, "--format", "json"], {
    cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024
  })
  assert.ifError(graph.error)
  assert.equal(graph.status, 0, graph.stderr)
  const { targets, edges } = JSON.parse(graph.stdout)
  const labels = new Set(targets.map(target => target.label))
  const label = /(?<![\w/])\/\/(?:[\w.-]+\/)*[\w.-]*:[\w-]+/g
  const guide = read(buildPath)
  const guideLabels = new Set(guide.match(label))
  assert.ok(guideLabels.has("//:spec-tests") && guideLabels.has("//typescript/vibelang:await-ops"))
  assert.deepEqual([...guideLabels].filter(name => !labels.has(name)).sort(), [])

  const specSection = guide.split("## Specification contracts\n")[1]
  assert.ok(specSection, "the guide documents the specification contracts")
  const members = new Set(specSection.trimStart().split("\n\n")[0].match(label))
  assert.ok(members.delete("//:forms"))
  assert.ok(members.delete("//:docs-tools"))
  assert.ok(members.delete("//:spec-lint"))
  assert.deepEqual([...members].sort(), edges.filter(edge => edge.from === "//:spec-lint").map(edge => edge.to).sort())
})

test("the maintainer guides reserve automatic-fix language for the retirement notice", () => {
  const retired = /--fix\b|\brepair(?:s|ed|ing)?\b|\bquick[- ]fix(?:es)?\b|\bcompareRewrite\b|\bNODE_COMPILE_CACHE\b/i
  const guide = read(buildPath).replace(/^## Retirement admission\n[\s\S]*?(?=^## |(?![\s\S]))/m,
    section => section.replace(/[^\n]/g, " "))
  const live = guide.split("\n").flatMap((line, index) =>
    retired.test(line.replace(/\/\/:[\w-]+/g, "")) ? [buildPath + ":" + (index + 1) + ": " + line] : [])
  assert.deepEqual(live, [])
  for (const path of [fuzzPath, admissionPath]) assert.doesNotMatch(read(path), /--fix\b/)
})

test("the fuzz guide's active Go tests and fuzz targets exist", () => {
  const declarations = new Set()
  for (const path of globSync("typescript/tsc/internal/**/*_test.go", { cwd: root })) {
    for (const [, name] of read(path).matchAll(/^func ((?:Test|Fuzz)[A-Z]\w*)\(/gm)) declarations.add(name)
  }
  const missing = read(fuzzPath).split("\n").flatMap((line, index) => {
    if (/^\| [^|]+ \| Retired \|/.test(line)) return []
    return [...line.matchAll(/`((?:Test|Fuzz)[A-Z]\w*)`/g)]
      .filter(([, name]) => !declarations.has(name))
      .map(([, name]) => fuzzPath + ":" + (index + 1) + ": " + name)
  })
  assert.deepEqual(missing, [])
})

test("maintainer guides keep one copy of each paragraph and table entry", () => {
  for (const path of [buildPath, fuzzPath, admissionPath]) {
    const seen = new Set()
    for (const paragraph of read(path).trim().split(/\n\s*\n/)) {
      const normalized = paragraph.replace(/\s+/g, " ").trim()
      if (normalized.length <= 200) continue
      assert.ok(!seen.has(normalized), path + ": " + normalized.slice(0, 100))
      seen.add(normalized)
    }
  }
  for (const path of [buildPath, fuzzPath]) {
    for (const block of read(path).split(/\n\s*\n/)) {
      const names = [...block.matchAll(/^\| `((?:\/\/|Fuzz|Test)[^|`]+)` \|/gm)].map(([, name]) => name)
      assert.equal(new Set(names).size, names.length, path + ": table repeating " + names.filter((name, i) => names.indexOf(name) !== i).join(", "))
    }
  }
  const results = read(fuzzPath).split("## Results\n")[1]
  assert.ok(results, "the fuzz guide has a results section")
  const table = results.trimStart().split("\n\n").find(block => block.startsWith("| Target | Campaign |"))
  assert.ok(table, "the results section has a campaign table")
  const campaigns = table.split("\n").slice(2)
  assert.ok(campaigns.length > 0)
  for (const row of campaigns) {
    assert.match(row, /^\| [^|]+ \| \d[^|]* \| (?:seeds only|(?:about )?\d[\d,]*(?: corpus inputs)?) \| [^|]+ \|$/, row)
  }
})

test("grammar admission points to the registry and regeneration command", () => {
  const guide = read(admissionPath)
  assert.ok(guide.includes("typescript/tsc/internal/vibelangfuzz/testdata/grammar_admission.tsv"))
  assert.ok(guide.includes("docs/design/registry/grammar-admission.tsv"))
  assert.ok(guide.includes("node scripts/generate-grammar-admission.mjs"))
})

test("grammar admission status claims match the pending ledger", () => {
  const pending = new Set()
  for (const path of globSync("typescript/tsc/internal/vibelangfuzz/testdata/pending/*.txt", { cwd: root })) {
    for (const [, key] of read(path).matchAll(/^FuzzGrammarAdmission (admission:[\w-]+)\s/gm)) pending.add(key)
  }
  assert.ok(pending.size > 0)
  const guide = read(admissionPath).replace(/\s+/g, " ")
  const contradictions = []
  for (const [, key] of guide.matchAll(/\bpending (?:as|under|key,?) `(admission:[\w-]+)`/g)) {
    if (!pending.has(key)) contradictions.push(key + " is missing from the pending ledger")
  }
  for (const [, key, closed] of guide.matchAll(/`(admission:[\w-]+)` (?:family |gap )?(?:is |are |stays |remains )(no longer )?pending\b/g)) {
    if (pending.has(key) === Boolean(closed)) contradictions.push(key + " disagrees with the pending ledger")
  }
  assert.deepEqual(contradictions, [])
})

test("the compiler case suite's shared local files exist", () => {
  const path = "typescript/vibelang/PACKAGE.ts"
  const shared = read(path).match(/^const shared = \[([\s\S]*?)^\]/m)
  assert.ok(shared, path + " declares shared case inputs")
  const inputs = [...shared[1].matchAll(/S\.file\("([^/][^"]*)"\)/g)].map(([, file]) => file)
  assert.ok(inputs.includes("harness.mjs"))
  assert.deepEqual(inputs.filter(file => !existsSync(resolve(root, "typescript/vibelang", file))), [])
})

test("the build guide's kernel laws budget matches the Bun command", () => {
  const source = read("packages/PACKAGE.ts")
  const millis = source.match(/bun test --timeout (\d+) tests\/kernel\.property\.test\.ts/)?.[1]
  assert.ok(millis, "the kernel laws use a bounded Bun test command")
  assert.match(read(buildPath), new RegExp("kernel laws " + Number(millis) / 1000 + " s\\b"))
})
