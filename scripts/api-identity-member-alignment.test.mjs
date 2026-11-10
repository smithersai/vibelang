import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { createEs5FixtureGuard } from "./testing/fixture-libraries.mjs"
import { checkProperty } from "./testing/property.mjs"

const es5 = createEs5FixtureGuard(loadTypeScript(), "Member-alignment documentation fixtures")
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/smithers-inferred-member-docs.json", import.meta.url), "utf8"))
function compare(beforeDoc, afterDoc = beforeDoc, { namespace = "Model", binding = "Packet", member = "fold", nested = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "api-member-alignment-"))
  try {
    for (const [side, doc, hidden] of [["before", beforeDoc, 1], ["after", afterDoc, 2]]) {
      mkdirSync(join(root, side))
      writeFileSync(join(root, side, "index.d.ts"), `export * as ${namespace} from "./model.js";\n`)
      writeFileSync(join(root, side, "model.d.ts"), `export interface Box<T> { value: T }
export declare const ${binding}: {
${doc}
${member}: <T>(input: T) => T extends Box<infer U> ? ${nested ? "{ /** The result. */ value: U }" : "U"} : never;
};
export declare const hidden: ${hidden};
`)
    }
    const entries = { ".": "index.d.ts" }
    const result = compareApiIdentity(es5.ts, join(root, "before"), join(root, "after"),
      { beforeEntrypoints: entries, afterEntrypoints: entries, compilerOptions: { lib: ["lib.es5.d.ts"], types: [] } })
    es5.assertLibraries()
    return result
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("inferred binding alignment keeps documentation on its public namespace path", () => {
  const result = compare(corpus.comment)
  assert.equal(result.comparisonComplete, true, JSON.stringify(result.environmentDiagnostics))
  assert.deepEqual(result.docDifferences, [])
  assert.deepEqual([...new Set(result.typeDifferences.map(d => d.export))], ["Model", "Model.hidden"])
})
test("inferred binding alignment still detects an authored documentation change", () => {
  const result = compare(corpus.comment, "/** Read the input. */")
  assert.equal(result.comparisonComplete, true)
  assert.ok(result.docDifferences.some(d => d.export === "Model.Packet.fold"), JSON.stringify(result.docDifferences))
})
test("property: inferred namespace members retain their prose and detect edits", async () => {
  await checkProperty(fc, {
    name: "api-identity-inferred-member-docs",
    rule: corpus.rule,
    command: "node --test scripts/api-identity-member-alignment.test.mjs",
    arbitrary: fc.record({
      namespace: fc.constantFrom("Model", "API", "Factory"),
      binding: fc.constantFrom("Packet", "Message", "Result"),
      member: fc.constantFrom("fold", "read", "create"),
      nested: fc.boolean(),
      prose: fc.array(fc.constantFrom("Fold", "the", "input", "value", "safely"), { minLength: 1, maxLength: 5 }),
    }),
    numRuns: 12,
    check: ({ prose, ...shape }) => {
      const comment = "/** " + prose.join(" ") + ". */"
      const same = compare(comment, comment, shape)
      assert.equal(same.comparisonComplete, true)
      assert.deepEqual(same.docDifferences, [])
      const changed = compare(comment, comment.replace(". */", " changed. */"), shape)
      assert.equal(changed.comparisonComplete, true)
      assert.ok(changed.docDifferences.some(d => d.export === shape.namespace + "." + shape.binding + "." + shape.member))
    },
  })
})
