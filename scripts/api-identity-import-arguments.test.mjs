import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"

const ts = loadTypeScript()
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/opencode-make-event-group.json", import.meta.url)))
function fixture(before, after, run) {
  const root = mkdtempSync(join(tmpdir(), "api-identity-import-arguments-"))
  try {
    for (const [side, files] of Object.entries({ before, after })) {
      for (const [name, text] of Object.entries(files)) {
        const file = join(root, side, name)
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, text)
      }
    }
    return run(join(root, "before"), join(root, "after"))
  } finally { rmSync(root, { recursive: true, force: true }) }
}
function valid(dir) {
  const program = ts.createProgram([join(dir, "index.d.ts")], { strict: true, noEmit: true, types: [] })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  assert.equal(diagnostics.length, 0, ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: x => x, getCurrentDirectory: () => dir, getNewLine: () => "\n",
  }))
}
function identical(result) {
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, true, JSON.stringify(result))
}
function different(result) {
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, false, JSON.stringify(result))
  assert.ok(result.typeDifferences.some(item => item.export === "makeEventGroup"), JSON.stringify(result))
}

test("opencode generic function copies retain identity with literal import type arguments", () => {
  assert.equal(ts.version, "5.9.3")
  fixture(corpus.before, corpus.after, (before, after) => {
    valid(before)
    valid(after)
    identical(compareApiIdentity(ts, before, before))
    identical(compareApiIdentity(ts, before, after))
  })
})

test("a literal import type argument that resembles a module path remains an API type", () => {
  const before = { ...corpus.before,
    "index.d.ts": corpus.before["index.d.ts"].replace('"Event.ID"', '"./a"'),
    "a.d.ts": "export {};", "b.d.ts": "export {};",
  }
  const after = { ...before, "index.d.ts": before["index.d.ts"].replace('"./a"', '"./b"') }
  fixture(before, after, (before, after) => {
    valid(before)
    valid(after)
    different(compareApiIdentity(ts, before, after))
  })
})

test("property: generic self comparisons keep import arguments and detect dependency mutations", async () => {
  await checkProperty(fc, {
    name: "api-identity-import-type-arguments-self",
    rule: corpus.rule,
    command: "node --test scripts/api-identity-import-arguments.test.mjs",
    arbitrary: fc.record({
      tag: fc.constantFrom('"Event.ID"', '"./a"', "42", "true", "null", '"tag" | 42'),
      readonly: fc.boolean(), constant: fc.boolean(), tuple: fc.boolean(),
    }),
    numRuns: 24,
    check: ({ tag, readonly, constant, tuple }) => {
      const before = { ...corpus.before,
        "index.d.ts": `export declare const makeEventGroup: <${constant ? "const " : ""}T>(definitions: T) => T extends ${readonly ? "readonly " : ""}(infer Event)[] ? ${tuple ? "readonly " : ""}[Event, import("./brand").Brand<${tag}>] : never;`,
        "a.d.ts": "export {};",
      }
      const after = { ...before, "index.d.ts": before["index.d.ts"].replaceAll(";", ";\n") }
      fixture(before, after, (before, after) => {
        valid(before)
        valid(after)
        identical(compareApiIdentity(ts, before, before))
        identical(compareApiIdentity(ts, before, after))
        writeFileSync(join(after, "brand.d.ts"), "export interface Brand<Tag> { readonly tag: Tag; changed: number }")
        valid(after)
        different(compareApiIdentity(ts, before, after))
      })
    },
  })
})
