import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { restoreExports, restoreScripts, rewriteExports, rewriteScripts } from "../lib/codemod.mjs"
import { manifestText } from "../lib/package-json-format.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")

function repository(files) {
  const root = mkdtempSync(join(tmpdir(), "migrate-manifest-format-"))
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  return root
}

// Each manifest is authored in a layout JSON.stringify(value, null, 2) + "\n" does not produce.
const manifests = {
  "tabs": '{\n\t"name": "pkg",\n\t"exports": {\n\t\t".": "./src/a.ts"\n\t},\n\t"scripts": {\n\t\t"start": "node src/a.ts"\n\t}\n}\n',
  "four spaces, no final newline": '{\n    "name": "pkg",\n    "main": "./src/a.ts",\n    "exports": {\n        ".": { "types": "./src/a.ts", "default": "./src/a.ts" },\n        "./*": "./src/*.ts"\n    },\n    "files": ["src/a.ts", "dist"],\n    "scripts": { "start": "node ./src/a.ts && echo done" }\n}',
  "escapes and CRLF": '{\r\n  "name": "pkg",\r\n  "description": "a \\u003cb\\u003e tag \\/ slash",\r\n  "exports": {\r\n    ".": ".\\/src\\/a.ts"\r\n  },\r\n  "scripts": {\r\n    "start": "node src\\/a.ts \\u003c input"\r\n  }\r\n}\r\n',
  "minified": '{"name":"pkg","exports":{".":"./src/a.ts","./*":"./src/*.ts"},"scripts":{"start":"node src/a.ts"}}',
}

for (const [layout, original] of Object.entries(manifests)) test("codemod then revert returns a " + layout + " package.json byte for byte", () => {
  const root = repository({ "package.json": original, "src/a.ts": "export const a = 1\n" })
  try {
    const renames = [{ from: "src/a.ts", to: "src/a.vibe" }]
    const exportEdits = rewriteExports(root, renames)
    const scriptEdits = rewriteScripts(root, renames)
    const migrated = readFileSync(join(root, "package.json"), "utf8")
    assert.ok(exportEdits.length && scriptEdits.length, "both rewrites edit the manifest")
    assert.match(migrated, /a\.vibe/)
    assert.equal(original.endsWith("\n"), migrated.endsWith("\n"), "the final newline stays as authored")
    assert.equal(original.includes("\r\n"), migrated.includes("\r\n"), "line endings stay as authored")
    // Only lines that name the module change: the rest of the file is the author's bytes.
    const kept = original.split("\n").filter(line => !line.includes("a.ts") && !line.includes("*.ts") && line.includes('"'))
    for (const line of kept) assert.ok(migrated.includes(line), "kept line: " + line)
    restoreExports(root, exportEdits, "src/a.ts")
    restoreScripts(root, scriptEdits, "src/a.ts")
    assert.equal(readFileSync(join(root, "package.json"), "utf8"), original)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a tab-indented manifest keeps its indentation when an export is rewritten", () => {
  const root = repository({ "package.json": manifests.tabs, "src/a.ts": "export const a = 1\n" })
  try {
    rewriteExports(root, [{ from: "src/a.ts", to: "src/a.vibe" }])
    const migrated = readFileSync(join(root, "package.json"), "utf8")
    assert.ok(!/\n {2}"/.test(migrated), migrated)
    assert.ok(migrated.includes('\t\t".": {\n\t\t\t"types": "./src/a.d.vibe.ts",\n'), migrated)
    assert.ok(migrated.startsWith('{\n\t"name": "pkg",\n\t"exports": {\n') && migrated.endsWith('\n\t\t}\n\t},\n\t"scripts": {\n\t\t"start": "node src/a.ts"\n\t}\n}\n'), migrated)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("manifestText prints the value it is given and keeps untouched text", () => {
  assert.equal(manifestText(null, { a: 1 }), '{\n  "a": 1\n}\n')
  const text = '{ "a" : 1,\n\t"b":[1,2 , 3],"c":{}\n}'
  assert.equal(manifestText(text, JSON.parse(text)), text)
  assert.equal(manifestText(text, { a: 1, b: [1, 2, 3], c: { d: [] } }), '{ "a" : 1,\n\t"b":[1,2 , 3],"c":{\n\t\t"d": []\n\t}\n}')
  assert.equal(manifestText(text, { a: 1, b: [1, 3], c: {} }), '{ "a" : 1,\n\t"b":[1 , 3],"c":{}\n}')
  assert.equal(manifestText(text, { b: [1, 2, 3], c: {} }), '{ "b":[1,2 , 3],"c":{}\n}')
  // Integer-like and duplicate keys have no single textual order: the object is printed anew, still valid.
  assert.deepEqual(JSON.parse(manifestText('{"b":1,"1":2,"b":3}', { 1: 2, b: 4 })), { 1: 2, b: 4 })
})

const json = fc.letrec(tie => ({
  value: fc.oneof({ depthSize: "small" }, fc.string(), fc.integer(), fc.boolean(), fc.constant(null), tie("array"), tie("object")),
  array: fc.array(tie("value"), { maxLength: 4 }),
  object: fc.dictionary(fc.oneof(fc.constantFrom("a", "b", "c", "1", "./x", "__proto__"), fc.string()), tie("value"), { maxKeys: 4 }),
})).object

test("property: an edited manifest always parses to the requested value, and an unchanged one keeps its bytes", () => {
  fc.assert(fc.property(json, json, fc.constantFrom(0, 2, 4, "\t"), fc.boolean(), (before, after, indent, newline) => {
    const text = JSON.stringify(before, null, indent) + (newline ? "\n" : "")
    assert.equal(manifestText(text, before), text)
    assert.deepEqual(JSON.parse(manifestText(text, after)), JSON.parse(JSON.stringify(after)))
  }), { seed: 510510, numRuns: 500 })
})

test("property: adding members and removing them again returns the original bytes", () => {
  fc.assert(fc.property(json, fc.dictionary(fc.constantFrom("added", "also", "zz"), json, { minKeys: 1, maxKeys: 3 }), fc.constantFrom(2, 4, "\t"), fc.boolean(), fc.boolean(), (before, extra, indent, newline, front) => {
    for (const key of Object.keys(extra)) delete before[key]
    const text = JSON.stringify(before, null, indent) + (newline ? "\n" : "")
    const grown = front ? { ...extra, ...before } : { ...before, ...extra }
    // Integer-like keys sort first in a JavaScript object whatever the request.
    fc.pre(JSON.stringify(Object.keys(grown).filter(key => key in before)) === JSON.stringify(Object.keys(before)))
    const edited = manifestText(text, grown)
    assert.deepEqual(JSON.parse(edited), JSON.parse(JSON.stringify(grown)))
    assert.equal(manifestText(edited, before), text)
  }), { seed: 510511, numRuns: 500 })
})
