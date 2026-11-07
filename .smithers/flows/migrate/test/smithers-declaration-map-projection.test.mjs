import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { apiProjection } from "../lib/api-projection.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-declaration-map-projection.json", import.meta.url)))
const rule = "Declaration output is API-identical to what `tsc` writes for the Effect TypeScript twin"
const command = "node --test .smithers/flows/migrate/test/smithers-declaration-map-projection.test.mjs"
const logical = "dist/esm/Redaction.vibe.$throw$ts.d.ts"

function project(left, right, check = () => {}) {
  const root = mkdtempSync(join(tmpdir(), "declaration-map-projection-"))
  const snapshot = join(root, "snapshot")
  mkdirSync(snapshot)
  writeFileSync(join(snapshot, "emit.d.ts"), left)
  writeFileSync(join(snapshot, "shipped.d.ts"), right)
  const surface = { apiMetadata: { packageDir: join(root, "repo", "package"), manifest: { private: true },
    aliases: {}, layouts: [], logicalPaths: { "emit.d.ts": logical, "shipped.d.ts": logical } } }
  try {
    const projection = apiProjection(ts, snapshot, surface, ["emit.d.ts", "shipped.d.ts"])
    try { return check(projection) } finally { projection.cleanup() }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("Smithers declaration map trailers do not conflict with the emitted helper", () => {
  project(corpus.files["emit.d.ts"], corpus.files["shipped.d.ts"], projection => {
    assert.equal(readFileSync(join(projection.directory, logical), "utf8"), corpus.files["shipped.d.ts"])
    assert.equal(projection.destinations.get("emit.d.ts"), logical)
    assert.equal(projection.destinations.get("shipped.d.ts"), logical)
  })
})

test("declaration map normalization keeps changed types, comments and malformed declarations conflicting", () => {
  const body = corpus.files["emit.d.ts"], mapped = corpus.files["shipped.d.ts"]
  for (const different of [
    mapped.replace("unknown", "string"),
    "/** Different public documentation. */\n" + mapped,
    body + "/*\n//# sourceMappingURL=ordinary-comment\n*/\n",
    body + "export type Added = boolean;\n//# sourceMappingURL=extra.map\n",
    body.trimEnd() + " ",
  ]) assert.throws(() => project(body, different), /Conflicting declaration snapshot paths/)
  const tick = String.fromCharCode(96)
  assert.throws(() => project("export type X = " + tick + "unclosed\n//# sourceMappingURL=one",
    "export type X = " + tick + "unclosed\n//# sourceMappingURL=two"), /Conflicting declaration snapshot paths/)
})

test("map-looking text in template literal types and block comments keeps its identity", () => {
  const tick = String.fromCharCode(96)
  for (const [before, after] of [
    ["export type X = " + tick + "x\n//# sourceMappingURL=one" + tick + ";\n",
      "export type X = " + tick + "x\n//# sourceMappingURL=two" + tick + ";\n"],
    ["export type X = string;\n/*\n//# sourceMappingURL=one\n*/\n",
      "export type X = string;\n/*\n//# sourceMappingURL=two\n*/\n"],
  ]) assert.throws(() => project(before, after + "//# sourceMappingURL=external.map\n"),
    /Conflicting declaration snapshot paths/)
})

const bodies = {
  raise: "export declare function raise(value: unknown): never;\n",
  nominal: "export declare class Value { private brand: void; readonly message: string; }\n",
  interface: "export interface Value { readonly message: string }\n",
  template: "export type Value = " + String.fromCharCode(96) + "text\n//# sourceMappingURL=inside" + String.fromCharCode(96) + ";\n",
}
function checkGenerated(input) {
  const body = bodies[input.body].replaceAll("\n", input.eol)
  const trailer = input.at ? "//@ sourceMappingURL=" : "//# sourceMappingURL="
  const left = body + (input.leftMap ? trailer + "first-" + input.url + ".d.ts.map" + input.eol : "")
  const right = body + (input.rightMap ? trailer + "data:application/json;base64,e30=" + input.eol : "")
  project(left, right)
  assert.throws(() => project(left, right + "export type Extra = boolean;" + input.eol),
    /Conflicting declaration snapshot paths/)
  assert.throws(() => project(left, "/** Changed declaration documentation. */" + input.eol + right),
    /Conflicting declaration snapshot paths/)
}

test("property: declaration map metadata coalesces while every declaration and documentation change remains visible", async () => {
  await checkProperty(fc, {
    name: "smithers-declaration-map-projection", rule, command, numRuns: 128,
    regressions: new URL("./corpus/", import.meta.url),
    arbitrary: fc.record({
      body: fc.constantFrom(...Object.keys(bodies)),
      eol: fc.constantFrom("\n", "\r\n"),
      at: fc.boolean(),
      leftMap: fc.boolean(),
      rightMap: fc.boolean(),
      url: fc.array(fc.constantFrom("a", "z", "0", "%20", "-", "_"), { minLength: 1, maxLength: 16 }).map(parts => parts.join("")),
    }),
    check: checkGenerated,
  })
})
