// A source .ts class with private members compares identical to itself.
// Nominal rewriting adds a brand and visibility markers to such a class; in
// a .ts file they must neither need an initializer nor read the type-only
// brand import as a value, or the self-comparison is incomplete.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"

const ts = loadTypeScript()

function compare(before, after, compilerOptions = { types: [], strict: true, target: ts.ScriptTarget.ES2022 }) {
  const root = mkdtempSync(join(tmpdir(), "api-source-class-"))
  try {
    for (const [side, files] of Object.entries({ before, after })) {
      mkdirSync(join(root, side))
      writeFileSync(join(root, side, "entry.d.ts"), 'export { Box } from "./dependency.js";\n')
      for (const [file, text] of Object.entries(files)) writeFileSync(join(root, side, file), text)
    }
    return compareApiIdentity(ts, join(root, "before"), join(root, "after"), {
      beforeEntrypoints: { entry: "entry.d.ts" }, afterEntrypoints: { entry: "entry.d.ts" }, compilerOptions
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// The reported witness compares one directory with itself.
function self(files, compilerOptions = { types: [], strict: true }) {
  const root = mkdtempSync(join(tmpdir(), "api-source-class-self-"))
  try {
    writeFileSync(join(root, "entry.d.ts"), 'export { Box } from "./dependency.js";\n')
    for (const [file, text] of Object.entries(files)) writeFileSync(join(root, file), text)
    return compareApiIdentity(ts, root, root, {
      beforeEntrypoints: { entry: "entry.d.ts" }, afterEntrypoints: { entry: "entry.d.ts" }, compilerOptions, includeComparedFiles: true
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const same = (files, options) => compare(files, files, options)
const verdict = result => JSON.stringify({ identical: result.identical, complete: result.comparisonComplete, environment: result.environmentDiagnostics })

test("t3code: a source class with a private field compares identical to itself", () => {
  const result = self({ "dependency.ts": "export class Box { private value = 1; read(): number { return this.value; } }\n" })
  assert.equal(result.comparisonComplete, true, verdict(result))
  assert.equal(result.identical, true, verdict(result))
})

const members = {
  "private field": "private value = 1",
  "definite private field": "private value!: number",
  "protected field": "protected value = 1",
  "#private field": "#value = 1",
  "private static field": "private static value = 1",
  "private readonly field": "private readonly value: number = 1",
  "private method": "private value(): number { return 1 }",
  "private accessor pair": "private get value(): number { return 1 }\n  private set value(next: number) {}",
  "parameter property": "constructor(private value: number) {}"
}
const settings = {
  strict: { types: [], strict: true, target: ts.ScriptTarget.ES2022 },
  "strict without define semantics": { types: [], strict: true, target: ts.ScriptTarget.ES2022, useDefineForClassFields: false },
  loose: { types: [], target: ts.ScriptTarget.ES2022 }
}
for (const [shape, member] of Object.entries(members)) {
  for (const [setting, options] of Object.entries(settings)) {
    test(`a source class compares identical to itself: ${shape}, ${setting}`, () => {
      const result = same({ "dependency.ts": `export class Box {\n  ${member}\n  read(): number { return 1 }\n}\n` }, options)
      assert.equal(result.comparisonComplete, true, verdict(result))
      assert.equal(result.identical, true, verdict(result))
    })
  }
}

test("a source class expression with a private field compares identical to itself", () => {
  const result = same({ "dependency.ts": "export const Box = class { private value = 1; read(): number { return this.value } }\n" })
  assert.equal(result.comparisonComplete, true, verdict(result))
  assert.equal(result.identical, true, verdict(result))
})

test("a declaration class keeps comparing identical to itself", () => {
  const result = same({ "dependency.d.ts": "export declare class Box { private value; read(): number; }\n" })
  assert.equal(result.comparisonComplete, true, verdict(result))
  assert.equal(result.identical, true, verdict(result))
})

test("a source class whose field turns public is not identical", () => {
  const result = compare(
    { "dependency.ts": "export class Box { private value = 1; read(): number { return this.value } }\n" },
    { "dependency.ts": "export class Box { value = 1; read(): number { return this.value } }\n" })
  assert.equal(result.comparisonComplete, true, verdict(result))
  assert.equal(result.identical, false, verdict(result))
})
