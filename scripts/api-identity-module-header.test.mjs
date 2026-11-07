// A module's header comment stacks onto its first declaration when declaration
// emit drops the imports between them. A converted entry that re-exports that
// declaration from a companion keeps the header at its own head. The header is
// then neither moved nor lost, while any other change to earlier blocks fails.
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"

const fc = createRequire(new URL("../packages/runtime/package.json", import.meta.url))("fast-check")
const ts = loadTypeScript()
const compilerOptions = { lib: ["lib.es5.d.ts"] }

function compare(before, after) {
  const root = mkdtempSync(join(tmpdir(), "api-module-header-"))
  try {
    for (const [side, files] of Object.entries({ before, after })) {
      for (const [file, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, side, file)), { recursive: true })
        writeFileSync(join(root, side, file), text)
      }
      const program = ts.createProgram([join(root, side, "index.d.ts")], {
        ...compilerOptions, strict: true, noEmit: true, types: [],
        module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      })
      assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [], "stock TypeScript accepts every fixture")
    }
    // The companion ships with the package but joins no exports entry.
    const entrypoints = { ".": "index.d.ts" }
    return compareApiIdentity(ts, join(root, "before"), join(root, "after"), { compilerOptions, beforeEntrypoints: entrypoints, afterEntrypoints: entrypoints })
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const header = "/**\n * The durable copy of the deployment's state.\n *\n * @since 0.1.0\n */\n"
const bucket = "/**\n * The bucket holding the state.\n *\n * @category constants\n * @since 0.1.0\n */\n"
// remote-state: the before entry declares the constant under the header; the
// converted entry keeps the header on its type import and re-exports the
// constant from the platform companion, whose declaration keeps its own block.
const beforeEntry = (head, doc) => ({ "index.d.ts": head + doc + "export declare const stateBucketName = \"state\";\n" + "/** The key. */\nexport declare const stateObjectKey = \"key\";\nexport type Stored = string;\n" })
const afterEntry = (head, doc) => ({
  "index.d.ts": head + "import type { Bucket } from \"./index.vibe.platform.js\";\nexport { stateBucketName, stateObjectKey } from \"./index.vibe.platform.js\";\nexport type Stored = Bucket;\n",
  "index.vibe.platform.d.ts": doc + "export declare const stateBucketName = \"state\";\n/** The key. */\nexport declare const stateObjectKey = \"key\";\nexport type Bucket = string;\n",
})
const docRows = result => result.docDifferences.map(row => row.export + ":" + (row.beforeDocBlocks ?? "") + "/" + (row.afterDocBlocks ?? ""))

test("remote-state: a module header kept at the head of the converted entry is not a lost block", () => {
  const result = compare(beforeEntry(header, bucket), afterEntry(header, bucket))
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.deepEqual(docRows(result), [])
  assert.equal(result.identical, true, JSON.stringify(result))
})

test("module header controls: a dropped, changed or duplicated block still fails", () => {
  const cases = [
    ["header dropped from the entry", beforeEntry(header, bucket), afterEntry("", bucket)],
    ["header changed", beforeEntry(header, bucket), afterEntry(header.replace("durable", "lasting"), bucket)],
    ["header copied onto the moved declaration", beforeEntry(header, bucket), afterEntry(header, header + bucket)],
    ["block added under the header", beforeEntry(header, bucket), afterEntry(header, "/** Added. */\n" + bucket)],
    ["declaration documentation changed", beforeEntry(header, bucket), afterEntry(header, bucket.replace("holding", "with"))],
  ]
  for (const [name, before, after] of cases) {
    const result = compare(before, after)
    assert.equal(result.comparisonComplete, true, name + " " + JSON.stringify(result))
    assert.equal(result.identical, false, name + " " + JSON.stringify(result))
    assert.ok(docRows(result).some(row => row.startsWith("stateBucketName")), name + " " + JSON.stringify(result))
  }
})

test("VIP-27 duplicated prose stays a difference beside a kept header", () => {
  // The same entry on both sides: an added duplicate block is not a header the
  // converted entry kept, even when its text matches the file head.
  const one = "/** Keeps one authored block. */\n"
  const result = compare({ "index.d.ts": one + "export declare function sample(): number;\n" },
    { "index.d.ts": "/** Keeps one authored block.\n * @throws {never} */\n" + one + "export declare function sample(): number;\n" })
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, false, JSON.stringify(result))
  const same = compare({ "index.d.ts": one + "export declare function sample(): number;\n" }, { "index.d.ts": one + one + "export declare function sample(): number;\n" })
  assert.equal(same.identical, false, JSON.stringify(same))
})

const prose = fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,20}[a-z]$/)
test("module header fuzz: only a header kept verbatim at the entry head is exempt", () => {
  fc.assert(fc.property(prose, prose, fc.constantFrom("kept", "dropped", "changed", "duplicated"), (head, doc, kind) => {
    const h = "/** " + head + ". */\n", d = "/** " + doc + ". */\n"
    const afterHead = kind === "dropped" ? "" : kind === "changed" ? "/** " + head + "! */\n" : h
    const afterDoc = kind === "duplicated" ? h + d : d
    const result = compare(beforeEntry(h, d), afterEntry(afterHead, afterDoc))
    assert.equal(result.comparisonComplete, true, JSON.stringify(result))
    assert.equal(result.identical, kind === "kept", kind + " " + JSON.stringify(result))
  }), { seed: 1107, numRuns: 24 })
})
