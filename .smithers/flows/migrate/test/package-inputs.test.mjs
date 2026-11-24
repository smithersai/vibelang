// The migrate-test shards in packages/PACKAGE.ts must declare every
// repository file outside the flow and every host program their tests read,
// or a change to that input reuses a cached pass (#639, #640, #641).
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, posix } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const tests = fileURLToPath(new URL(".", import.meta.url))
const sources = readdirSync(tests).filter(name => name.endsWith(".mjs")).map(name => [name, readFileSync(join(tests, name), "utf8")])
const pkg = readFileSync(join(repo, "packages/PACKAGE.ts"), "utf8")

// The text of `const <name> = [...]` or `const <name> = Object.fromEntries(...)` up to the next top-level const.
function declaration(name) {
  const start = pkg.indexOf(`const ${name} =`)
  assert.ok(start >= 0, `packages/PACKAGE.ts declares ${name}`)
  const end = pkg.indexOf("\nconst ", start + 1)
  return pkg.slice(start, end < 0 ? undefined : end)
}

const data = declaration("migrateTestData") + declaration("migrateTestTargets")
const named = new Set([...data.matchAll(/S\.file\("\/\/([^"]+)"\)/g)].map(m => m[1]))
const spreads = new Map([
  ["experimentInstall", ["experiments/package.json", "experiments/bun.lock"]]
])
for (const [name, files] of spreads) if (new RegExp(`\\.\\.\\.${name}\\b`).test(data)) for (const file of files) named.add(file)

// Repository paths outside the flow sources that a test reads. A read of an
// install (`.smithers`, `experiments/node_modules`) stands for its lockfile.
function readPaths(text) {
  const found = new Set()
  for (const m of text.matchAll(/new URL\("((?:\.\.\/){4}[^"]+)", import\.meta\.url\)/g)) found.add(m[1].slice(12))
  for (const m of text.matchAll(/SpecPath\("([^"]+)"\)/g)) found.add(posix.normalize("docs/design/src/" + m[1]))
  for (const m of text.matchAll(/join\(repo, ?"((?:docs|\.smithers|experiments)(?:\/[^"]*)?)"/g)) found.add(m[1])
  for (const path of [...found]) {
    const install = /^(\.smithers|experiments)(?:\/node_modules\b.*|\/package\.json)?$/.exec(path)
    if (install) { found.delete(path); found.add(install[1] + "/package.json"); found.add(install[1] + "/bun.lock") }
  }
  return [...found].filter(path =>
    /^(?:docs\/|\.smithers\/(?!flows\/(?:migrate|convert)\/)|experiments\/)/.test(path) &&
    /\.(?:md|json|lock)$/.test(path) && existsSync(join(repo, path)))
}

test("migrate-test declares every repository document and lockfile its tests read", () => {
  const missing = []
  for (const [name, text] of sources)
    for (const path of readPaths(text)) if (!named.has(path)) missing.push(`${path} (read by ${name})`)
  assert.deepEqual([...new Set(missing)].sort(), [])
})

test("migrate-test declares every host program its tests spawn", () => {
  const tools = new Set([...declaration("migrateTestTargets").matchAll(/S\.Host\.bin\("([^"]+)"\)/g)].map(m => m[1]))
  const spawned = new Set()
  for (const [, text] of sources)
    for (const m of text.matchAll(/(?:spawn|spawnSync|execFileSync|invoke)\((?:[A-Za-z]+, ?)?"(pnpm|npm|git|tar|patch|jj|bun)", ?\[/g)) spawned.add(m[1])
  assert.deepEqual([...spawned].filter(tool => !tools.has(tool)).sort(), [])
})

test("the scan finds the inputs it guards", () => {
  const all = new Set(sources.flatMap(([, text]) => readPaths(text)))
  for (const path of [".smithers/package.json", ".smithers/bun.lock", "experiments/bun.lock", "docs/design/src/003-failures.md", "docs/user/src/setup/developer-tools.md"])
    assert.ok(all.has(path), path)
})
