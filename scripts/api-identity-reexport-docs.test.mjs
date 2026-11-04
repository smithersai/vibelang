import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"

const ts = loadTypeScript()
const options = { compilerOptions: { lib: ["lib.es5.d.ts"], types: [] } }
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/alchemy-root-export-documentation.json", import.meta.url)))
function compare(before, after) {
  const root = mkdtempSync(join(tmpdir(), "api-root-docs-"))
  try {
    for (const [side, files] of Object.entries({ before, after })) {
      mkdirSync(join(root, side))
      for (const [file, text] of Object.entries({ ...files, "package.json": '{"types":"index.d.ts"}' }))
        writeFileSync(join(root, side, file), text)
    }
    return compareApiIdentity(ts, join(root, "before"), join(root, "after"), options)
  } finally { rmSync(root, { recursive: true, force: true }) }
}
function verify({ namespace = "Domain", forward = "named", value = false } = {}) {
  const before = { ...corpus.before }, after = { ...corpus.after }
  for (const files of [before, after]) files["index.d.ts"] = files["index.d.ts"].replaceAll("Domain", namespace)
  if (forward === "star") after["domain.d.ts"] = 'export * from "./internal.js";'
  if (value) {
    const declaration = "/** Create a definition. */\nexport declare const create: (definition: Definition) => Definition;\n"
    before["domain.d.ts"] += declaration
    after["internal.d.ts"] += declaration
    if (forward === "named") after["domain.d.ts"] = 'export { type Definition, create } from "./internal.js";'
  }
  const same = compare(before, after)
  assert.equal(same.comparisonComplete, true, JSON.stringify(same))
  assert.deepEqual(same.docDifferences, [], JSON.stringify(same))
  if (!value) assert.equal(same.identical, true, JSON.stringify(same))
  for (const [source, replacement] of [
    ["Aggregate definition.", "Changed aggregate definition."],
    ["@since 1.0", "@since 2.0"],
    ["/** Commands handled by the aggregate. */", ""],
    ["Choose events from a command.", "Changed handler documentation."],
    ["/** Aggregate definition.", "/** Duplicate. */\n/** Aggregate definition."],
    ...(value ? [["Create a definition.", "Changed factory documentation."]] : []),
  ]) {
    const changed = compare(before, { ...after, "internal.d.ts": after["internal.d.ts"].replace(source, replacement) })
    assert.equal(changed.comparisonComplete, true, JSON.stringify(changed))
    assert.equal(changed.identical, false, JSON.stringify(changed))
    assert.ok(changed.docDifferences.length, JSON.stringify(changed))
  }
  const changedType = compare(before, { ...after, "internal.d.ts": after["internal.d.ts"].replace("ReadonlyArray<string>", "ReadonlyArray<number>") })
  assert.equal(changedType.comparisonComplete, true, JSON.stringify(changedType))
  assert.ok(changedType.typeDifferences.some(item => item.export === namespace + ".Definition"), JSON.stringify(changedType))
}
test("authored documentation survives a private type re-export through a root namespace", () => verify())
test("root namespace value re-exports retain authored declaration and member documentation", () => verify({ value: true }))
test("star re-exports retain documentation while changed prose and types still fail", () => verify({ forward: "star", value: true }))
test("property: root re-export aliases preserve authored docs and expose documentation and type mutations", async () => {
  await checkProperty(fc, {
    name: "api-identity-root-reexport-documentation",
    rule: "The shared checker compares each entrypoint's exported names, strict type identity in both directions and normalized JSDoc.",
    command: "node --test scripts/api-identity-reexport-docs.test.mjs",
    arbitrary: fc.record({ namespace: fc.constantFrom("Domain", "Model", "Definitions"), forward: fc.constantFrom("named", "star"), value: fc.boolean() }),
    numRuns: 16, check: verify,
  })
})
