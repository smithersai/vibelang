import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const root = process.env.SPEC_LINT_ROOT ?? fileURLToPath(new URL("../../", import.meta.url))
const read = path => readFileSync(resolve(root, path), "utf8")
const dir = "typescript/tsc/internal/vibelang"
const files = readdirSync(resolve(root, dir)).filter(name => name.endsWith(".go") && !name.endsWith("_test.go"))
const sources = files.map(name => read(dir + "/" + name)).join("\n")
const group = sources.match(/var tsFormMessages = \[\]\*Message\{([^}]+)\}/)[1]
const codes = new Set(group.match(/EK\d+/g))
for (const [, code] of sources.matchAll(/tsFormMessages = append\(tsFormMessages, (EK\d+)\)/g)) codes.add(code)
// VIP-17 has no owned-fiber escape rule, no accepted VIP adds Option methods,
// and VIP-26 removes magic main. These legacy rules are not language features.
for (const code of ["EK4838", "EK4840", "EK4843"]) codes.delete(code)
// Requirement/service migration warnings have their own compatibility inventory.
for (const code of codes) if (Number(code.slice(2)) >= 4853) codes.delete(code)
const chapter = read("docs/design/src/007-tooling.md")
const appendix = read("docs/design/src/900-appendices.md")
const rows = (text, code) => text.split("\n").filter(line => line.startsWith("| `" + code + "` |"))

test("every surviving TypeScript-form lint has a normative trigger and repair", () => {
  assert.ok(codes.size >= 8, "the compiler's TypeScript-form rule inventory must be read")
  for (const code of [...codes].sort()) {
    const found = rows(chapter, code)
    assert.equal(found.length, 1, code + " needs one chapter-007 rule")
    assert.equal(found[0].split("|").filter(cell => cell.trim()).length >= 3, true, code + " needs trigger and repair")
  }
})

test("every surviving TypeScript-form lint has one warning code in Appendix B", () => {
  for (const code of [...codes].sort()) {
    const found = rows(appendix, code)
    assert.equal(found.length, 1, code + " needs one Appendix-B assignment")
    assert.match(found[0], /\| lint warning:/, code + " stays a configurable warning")
    assert.match(found[0], /007-tooling\.md#typescript-spellings-with-vibelang-forms/, code + " links to its rule")
  }
})

test("superseded form rules do not return as specification diagnostics", () => {
  for (const code of ["EK4838", "EK4840", "EK4843"]) {
    assert.deepEqual(rows(appendix, code), [], code + " has no accepted VIP")
    assert.deepEqual(rows(chapter, code), [], code + " has no accepted VIP")
  }
})
