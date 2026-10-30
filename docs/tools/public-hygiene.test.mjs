import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { lstatSync, readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { publicHygiene } from "./public-hygiene.mjs"

const root = process.env.VIBELANG_HYGIENE_ROOT ?? fileURLToPath(new URL("../../", import.meta.url))
const files = process.env.VIBELANG_HYGIENE_ROOT
  ? readdirSync(root, { recursive: true })
  : execFileSync("jj", ["file", "list"], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trimEnd().split("\n")
const findings = files.flatMap(file => {
  const path = resolve(root, file)
  if (!lstatSync(path).isFile()) return []
  const bytes = readFileSync(path)
  if (bytes.includes(0)) return []
  return publicHygiene(file, bytes.toString("utf8")).map(problem => file + ": " + problem)
})

test("the public tree contains no retired hosted service or client", () => {
  assert.deepEqual(findings.filter(p => p.endsWith("a removed hosted compile service")), [])
})

test("the hygiene check rejects references as well as service files", () => {
  const retired = ["converter", "worker"].join("-")
  assert.equal(publicHygiene("packages/" + retired + "/README.md", "").length, 1)
  assert.equal(publicHygiene("scripts/check.mjs", "import '../packages/" + retired + "/compile.mjs'").length, 1)
  assert.deepEqual(publicHygiene("packages/compiler/index.mjs", "export const version = '0.0.9'"), [])
})

test("the public tree contains no review artifacts or scratch paths", () => {
  assert.deepEqual(findings.filter(p => p.endsWith("a removed review artifact or scratch path")), [])
})

test("the public spec keeps rationale without internal author or review provenance", () => {
  assert.deepEqual(findings.filter(p => p.endsWith("internal decision or review provenance")), [])
})

test("review provenance checks handle capitalization without rejecting ordinary future tense", () => {
  const file = "docs/design/src/example.md"
  for (const text of ["Review probe " + "R9", "Prototype finding " + "19", "finding " + "1"]) {
    assert.ok(publicHygiene(file, text).includes("internal decision or review provenance"), text)
  }
  assert.deepEqual(publicHygiene(file, "The runtime will preserve the continuation."), [])
})

test("contributor commands use portable checkout paths and plain setup instructions", () => {
  assert.deepEqual(findings.filter(p => p.endsWith("a private checkout default") || p.endsWith("an internal setup instruction")), [])
})

test("the compiler notes describe verified behavior and measured performance", () => {
  assert.deepEqual(findings.filter(p => p.endsWith("a stale compiler limitation or unmeasured complexity claim")), [])
})

test("retired scratch rules preserve path, content and prefix boundaries", () => {
  const reason = "a removed review artifact or scratch path"
  const roots = ["review-codex", "review-fable", "agent-a", "abstract-services"].map(name => "scratch-" + name)
  const paths = ["docs/" + "reviews/", ...roots.map(name => "experiments/" + name + "/"),
    "artifacts/" + "effeck-" + "design-space.html"] // brand-gate: allow
  for (const path of paths) {
    assert.deepEqual(publicHygiene(path + "note.md", ""), [reason], path)
    assert.deepEqual(publicHygiene("README.md", "See " + path + "note.md"), [reason], path)
    assert.deepEqual(publicHygiene("prefix/" + path + "note.md", ""), [], path)
  }
  for (const root of roots) {
    assert.deepEqual(publicHygiene("README.md", root + "/note.md"), [reason], root)
    assert.deepEqual(publicHygiene("README.md", root), [], root)
  }
  assert.deepEqual(publicHygiene("packages/compiler/README.md", "Ordinary public documentation."), [])
})
