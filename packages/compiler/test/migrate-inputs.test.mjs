import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const flows = [".smithers/flows/migrate", ".smithers/flows/convert"]
// Every file of the migrate and convert flows: the targets below run their tests and import their library, templates
// and corpus. A list of chosen files went stale as lanes added tests (and 10 rejections in 12 hours on 2026-11-01 were
// lanes editing that list); a `//` glob in packages/PACKAGE.ts matched no file at all.
const flowFiles = dir => readdirSync(join(root, dir), { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? (e.name === "node_modules" ? [] : flowFiles(dir + "/" + e.name)) : [dir + "/" + e.name])

// The targets that run or import the flows, by their packages/PACKAGE.ts names.
const consumers = ["compiler-test", "migrate-test", "vite-test", "compiler-tools-test"]

// The text that declares a target: its `const` up to the next top-level statement, plus the local helper it calls
// (`pluginTest("vite", ...)`). Read as text rather than through `smthrs explain`: every explain walks the whole
// workspace, and the graph runs this file while other targets create and remove directories in it (smthrs's own
// `.smthrs-mat-*` output staging, and until 61878b40 the migrate tests' fixture repositories). On 2026-11-02 that
// failed 9 hosted pre-gates with explain_failed ("Something went wrong on our side", smithers-bugs.md); the four
// target explains also took 55 s on a quiet nyc-01, against 4 s for the one explain below.
const declaration = (source, label) => {
  const name = source.match(new RegExp(`^\\s+"?${label}"?: (\\w+),?$`, "m"))?.[1]
  assert.ok(name, `packages/PACKAGE.ts: no target ${label}`)
  const body = id => source.match(new RegExp(`^const ${id} = [\\s\\S]*?(?=^(?:const|export|/[/*])|(?![\\s\\S]))`, "m"))?.[0] ?? ""
  const text = body(name)
  assert.ok(text, `packages/PACKAGE.ts: no declaration of ${name}`)
  const helper = text.match(new RegExp(`^const ${name} = (\\w+)\\(`))?.[1]
  return helper ? text + body(helper) : text
}

test("each flow consumer takes //:migration-sources", () => {
  const source = readFileSync(join(root, "packages/PACKAGE.ts"), "utf8")
  for (const label of consumers) {
    assert.match(declaration(source, label), /\bmigrationSources\b/, `//packages:${label} must list migrationSources in its data`)
  }
})

test("the declaration reader sees a target that drops //:migration-sources", () => {
  const source = readFileSync(join(root, "packages/PACKAGE.ts"), "utf8")
  const dropped = source.replace(/^(const migrateTest = [\s\S]*?)migrationSources,/m, "$1")
  assert.notEqual(dropped, source)
  assert.doesNotMatch(declaration(dropped, "migrate-test"), /\bmigrationSources\b/)
  assert.match(declaration(dropped, "vite-test"), /\bmigrationSources\b/)
})

test("//:migration-sources keys every file of the migrate and convert flows, including hidden directories", { timeout: 180000 }, () => {
  const child = spawnSync(process.execPath, [join(root, ".smithers/node_modules/.bin/smthrs"), "explain", "//:migration-sources", "--format", "json", "--verbose"],
    { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 150000 })
  assert.equal(child.status, 0, child.stderr || child.stdout)
  const files = new Map(JSON.parse(child.stdout).inputs.flatMap(input => input.files ?? []).map(f => [f.path, f.digest]))
  const required = flows.flatMap(flowFiles)
  assert.ok(required.some(f => f.startsWith(flows[0] + "/templates/")) && required.some(f => f.startsWith(flows[0] + "/test/corpus/")))
  for (const file of required) {
    assert.ok(files.has(file), "//:migration-sources: missing cache input " + file)
    assert.equal(files.get(file), createHash("sha256").update(readFileSync(join(root, file))).digest("hex"), "//:migration-sources: stale digest for " + file)
  }
})
