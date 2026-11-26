import { strict as assert } from "node:assert"
import { readdirSync, readFileSync } from "node:fs"
import { test } from "node:test"

// The committed property seeds are public. Each names its spec rule or the
// public symptom it reproduces, never a maintainer's internal work stream,
// owner or note file outside the repository.
const directories = ["property-regressions", "corpus"]
const refused = [
  [/; work stream /, "a work stream identifier"],
  [/"owner"\s*:/, "an owner field"],
  [/"(?:inbox|loop)\//, "a path to an internal note outside the repository"],
  [/\br\d+-astra-\d+\b/, "a review identifier"]
]

test("committed property seeds carry no internal process text", () => {
  const found = []
  for (const directory of directories) {
    for (const name of readdirSync(new URL(`./${directory}/`, import.meta.url))) {
      if (!name.endsWith(".json")) continue
      const text = readFileSync(new URL(`./${directory}/${name}`, import.meta.url), "utf8")
      for (const [pattern, what] of refused) if (pattern.test(text)) found.push(`${directory}/${name}: ${what}`)
    }
  }
  assert.deepEqual(found, [])
})

test("the seed check refuses each kind of internal text", () => {
  for (const [pattern] of refused) {
    const samples = ['"rule": "x; work stream m5"', '"owner": "someone"', '"source": "inbox/notes.md"', '"key": "r14-astra-1"']
    assert.ok(samples.some((sample) => pattern.test(sample)), String(pattern))
  }
  assert.equal(refused.some(([pattern]) => pattern.test('"rule": "docs/design/src/007-tooling.md: include"')), false)
})

// packages/compiler/test/AGENTS.md: tests here own compiler behaviour, and
// migration scenarios live in .smithers/flows/migrate/test/. A test that
// imports the migrate or convert flow's library belongs there. The files below
// still do, each for a reason named beside it; the list may only shrink.
const flowLibraryImporters = new Map([
  // compareDeclarations is the oracle for the compiler's own declaration output.
  ["helper-reexport-declarations.property.test.mjs", "uses the declaration oracle on compiler output"],
  ["tools/vite.test.mjs", "loads React tool wiring to drive the compiler's Vite tool test"],
  ["tools/oxc.test.mjs", "loads React tool wiring to drive the compiler's Oxc tool test"]
])

function testFiles(directory, prefix = "") {
  return readdirSync(new URL(directory, import.meta.url), { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return ["corpus", "property-regressions", "node_modules", "fixtures"].includes(entry.name) ? [] : testFiles(`${directory}${entry.name}/`, `${prefix}${entry.name}/`)
    return /\.test\.mjs$/.test(entry.name) ? [prefix + entry.name] : []
  })
}

test("compiler tests import no migrate or convert flow library outside the shrinking list", () => {
  const importers = testFiles("./").filter((file) =>
    /\.smithers\/flows\/(?:migrate|convert)\/lib\//.test(readFileSync(new URL(`./${file}`, import.meta.url), "utf8")))
  assert.deepEqual(importers.filter((file) => !flowLibraryImporters.has(file)), [], "move these to .smithers/flows/migrate/test/")
  assert.deepEqual([...flowLibraryImporters.keys()].filter((file) => !importers.includes(file)), [], "remove these from the list")
})
