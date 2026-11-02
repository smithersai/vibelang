import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import test from "node:test"
import { checkProperty } from "./testing/property.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const { parseDeclarationFile, normalizeTokens, sortUnions } = await import(pathToFileURL(
  process.env.PARITY_DTS_SOURCE ?? join(root, "packages/ts-mapper/test/parity/dts.ts")
))
const require = createRequire(new URL("../packages/compiler/package.json", import.meta.url))
const fc = require("fast-check")
const ctx = { effectModules: new Map(), reexports: new Map(), aliases: new Map() }

// The production comparator matches units by name, then compares their
// canonical token streams (allowing only union ordering).
function surface(text) {
  const file = parseDeclarationFile(text)
  return file.units.map((unit) => [unit.name,
    sortUnions(unit.statements.flatMap((s) => normalizeTokens(s, file.imports, ctx))).join(" ")
  ]).sort(([a], [b]) => a.localeCompare(b))
}
const declaration = (exports) => `declare const local: 42; ${exports}`

test("local export aliases remain part of the compared declaration", () => {
  assert.notDeepEqual(surface(declaration("export { local as Before };")),
    surface(declaration("export { local as After };")))
})
test("dropping a local export list cannot match the prior declaration surface", () => {
  assert.notDeepEqual(surface(declaration("export { local as Public };")),
    surface(declaration("export {};")))
})
test("changing only one of multiple local export lists is detected", () => {
  const prefix = "declare const local: 42; declare const other: 7; export { local as First };"
  assert.notDeepEqual(surface(prefix + "export { other as Second };"),
    surface(prefix + "export { other as Changed };"))
})
test("default and string-named local aliases retain their spelling", () => {
  for (const name of ["default", '"public-name"', '"type"']) {
    assert.notDeepEqual(surface(declaration(`export { local as ${name} };`)),
      surface(declaration("export { local as ordinary };")))
  }
})
test("local export tracking preserves declaration visibility and module markers", () => {
  const file = parseDeclarationFile("declare const local: 42; declare const hidden: 7; export { local as Public };")
  assert.equal(file.script, false)
  assert.equal(file.units.find((u) => u.name === "local").exported, true)
  assert.equal(file.units.find((u) => u.name === "hidden").exported, false)
  const empty = parseDeclarationFile("declare const hidden: 7; export {};")
  assert.equal(empty.script, false)
  assert.deepEqual(empty.units.map((u) => [u.name, u.exported]), [["hidden", false]])
  assert.deepEqual(surface(declaration("export { local as Public };")),
    surface("declare const local : 42 ; /* layout */ export { local as Public } ;"))
})
test("external reexports continue to retain aliases and modules", () => {
  for (const text of ['export { value as After } from "./a.js";', 'export { value as Before } from "./b.js";']) {
    assert.notDeepEqual(surface('export { value as Before } from "./a.js";'), surface(text))
  }
})
test("public export names cannot resolve through unrelated local imports", () => {
  const prefix = 'import { Symbol as Before, Symbol as After } from "origin"; declare const local: 42;'
  for (const [a, b] of [["local as Before", "local as After"], ["Before", "After"]]) {
    assert.notDeepEqual(surface(prefix + `export { ${a} };`),
      surface(prefix + `export { ${b} };`))
  }
})
test("renaming an imported local alias keeps the same public export", () => {
  assert.deepEqual(surface('import { Symbol as Left } from "origin"; export { Left as Public };'),
    surface('import { Symbol as Right } from "origin"; export { Right as Public };'))
})
test("real pinned TypeScript declaration emit detects renamed local exports", () => {
  const version = JSON.parse(readFileSync(join(root, "packages/ts-mapper/package.json"), "utf8")).devDependencies.typescript
  const stock = join(root, "packages/ts-mapper/test/.cache/typescript-" + version, "node_modules/.bin/tsc")
  const dir = mkdtempSync(join(tmpdir(), "vibelang-export-parity-"))
  try {
    writeFileSync(join(dir, "origin.ts"), "export const Symbol = 1 as const\n")
    for (const name of ["Before", "After"]) {
      writeFileSync(join(dir, name + ".ts"), `import { Symbol as Before, Symbol as After } from "./origin.js";
export type References = [typeof Before, typeof After];
const local = 42; export { local as ${name} };\n`)
    }
    const run = spawnSync(stock, ["Before.ts", "After.ts", "--declaration", "--emitDeclarationOnly",
      "--skipLibCheck", "--types", "node", "--typeRoots", join(root, "docs/tools/node_modules/@types"),
      "--module", "esnext", "--moduleResolution", "bundler", "--target", "esnext"], { cwd: dir, encoding: "utf8", timeout: 30_000 })
    assert.ifError(run.error)
    assert.equal(run.status, 0, run.stdout + run.stderr)
    const before = readFileSync(join(dir, "Before.d.ts"), "utf8")
    const after = readFileSync(join(dir, "After.d.ts"), "utf8")
    assert.match(before, /local as Before/)
    assert.match(after, /local as After/)
    assert.notDeepEqual(surface(before), surface(after))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
test("generated local alias mutations cannot disappear from parity", async () => {
  const identifier = fc.stringMatching(/^[A-Z][a-zA-Z0-9]{0,10}$/)
  await checkProperty(fc, {
    name: "mapper-parity-local-export-alias", numRuns: 80,
    rule: "Harness invariant: a changed public alias in a named local export list changes the compared declaration surface; formatting and comments do not.",
    command: "node --test scripts/mapper-parity-exports.test.mjs",
    arbitrary: fc.tuple(identifier, identifier, fc.boolean()).filter(([a, b]) => a !== b),
    check: ([a, b, multiple]) => {
      const imports = `import { Symbol as ${a}, Symbol as ${b} } from "origin";`
      const tail = multiple ? "declare const other: 7; export { other as Stable };" : ""
      const before = imports + declaration(`export { local as ${a} }; ${tail}`)
      const after = imports + declaration(`export { local as ${b} }; ${tail}`)
      assert.notDeepEqual(surface(before), surface(after))
      assert.deepEqual(surface(before), surface(before.replaceAll(";", "; /* comment */\n")))
    }
  })
})
