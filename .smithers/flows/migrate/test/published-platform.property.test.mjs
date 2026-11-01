import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { splitBatchPlatform, platformPath } from "../lib/platform.mjs"
import { compareDeclarations } from "../lib/declarations.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-published-platform-sibling.json", import.meta.url)))
const rule = "A platform split must not add a published module; a published package with wildcard exports or no export map keeps the platform code in TypeScript."

function fixture(manifest, file = corpus.file) {
  const root = mkdtempSync(join(tmpdir(), "alchemy-published-platform-"))
  const pkg = join(root, "packages/aws")
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, "package.json"), JSON.stringify({ private: true }))
  writeFileSync(join(pkg, "package.json"), JSON.stringify(manifest))
  writeFileSync(join(root, file), corpus.text)
  return { root, pkg, file, dispose() { rmSync(root, { recursive: true, force: true }) } }
}

test("alchemy-60: splitting a public wildcard package writes no new module or declaration", () => {
  const f = fixture(corpus.manifest)
  try {
    const result = splitBatchPlatform(f.root, [f.file], ts)
    assert.deepEqual(result.splits, [])
    assert.match(result.refused.join("\n"), /published module/)
    assert.equal(readFileSync(join(f.root, f.file), "utf8"), corpus.text)
    assert.equal(existsSync(join(f.root, platformPath(f.file))), false)
  } finally { f.dispose() }
})

test("a package boundary, not the private workspace root, controls publication", () => {
  for (const manifest of [
    { name: "public-no-exports" },
    { exports: { "./*": "./src/*.ts" } },
    { exports: { "./nested/*": { import: ["./dist/*.js", { types: "./dist/*.d.ts" }] } } }
  ]) {
    const f = fixture(manifest)
    try {
      assert.equal(splitBatchPlatform(f.root, [f.file], ts).splits.length, 0)
      assert.equal(existsSync(join(f.root, platformPath(f.file))), false)
    } finally { f.dispose() }
  }
})

test("private packages and explicit public entry points still split", () => {
  for (const manifest of [
    { private: true, exports: corpus.manifest.exports },
    { exports: { ".": { types: "./lib/index.d.ts", default: "./lib/index.js" } } },
    { exports: { "./*": null, ".": "./lib/index.js" } }
  ]) {
    const f = fixture(manifest)
    try { assert.equal(splitBatchPlatform(f.root, [f.file], ts).splits.length, 1) }
    finally { f.dispose() }
  }
})

test("wildcard platform declarations are public additions, never addedPrivate", () => {
  const f = fixture(corpus.manifest)
  try {
    for (const side of ["before", "after"]) {
      mkdirSync(join(f.root, side, "lib/EventBridge"), { recursive: true })
      mkdirSync(join(f.root, side, "lib/Bootstrap"), { recursive: true })
      writeFileSync(join(f.root, side, "lib/Bootstrap/index.d.ts"), "export {};\n")
      writeFileSync(join(f.root, side, "package.json"), JSON.stringify(corpus.manifest))
      writeFileSync(join(f.root, side, "lib/EventBridge/ToLambda.d.ts"), "export declare const createRouteId: () => string;\n")
    }
    writeFileSync(join(f.root, "after/lib/EventBridge/ToLambda.platform.d.ts"), "export declare const createRouteId: () => string;\n")
    const result = compareDeclarations(ts, join(f.root, "before"), join(f.root, "after"))
    assert.equal(result.identical, false)
    assert.deepEqual(result.publicSurface.after.unresolved, [])
    assert.ok(result.publicSurface.after.roots.includes("lib/EventBridge/ToLambda.platform.d.ts"))
    assert.deepEqual(result.added, ["lib/EventBridge/ToLambda.platform.d.ts"])
    assert.deepEqual(result.addedPrivate, [])
  } finally { f.dispose() }
})

test("generated package layouts cannot publish a platform sibling", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(rule))
  fc.assert(fc.property(
    fc.boolean(), fc.boolean(), fc.constantFrom("ts", "mts"),
    fc.array(fc.constantFrom("nested", "space dir", "Feature", "v2"), { maxLength: 4 }),
    (privatePackage, wildcard, ext, dirs) => {
      const manifest = { private: privatePackage, exports: wildcard
        ? { "./*": { types: "./lib/*.d.ts", default: "./lib/*.js" } }
        : undefined }
      const file = ["packages/aws/src", ...dirs, "Module." + ext].join("/")
      const f = fixture(manifest, file)
      try {
        const result = splitBatchPlatform(f.root, [file], ts)
        assert.equal(result.splits.length, privatePackage ? 1 : 0)
        assert.equal(existsSync(join(f.root, platformPath(file))), privatePackage)
        if (!privatePackage) assert.equal(readFileSync(join(f.root, file), "utf8"), corpus.text)
      } finally { f.dispose() }
    }), { seed: 600050, numRuns: 300 })
})

test("publication checks honor the batch's virtual read/exists/write callbacks", () => {
  for (const privatePackage of [false,true]) {
    const memory=new Map([
      ["package.json",JSON.stringify({private:privatePackage,exports:{"./*":"./src/*.ts"}})],
      ["src/Module.ts",corpus.text]
    ])
    const writes=[]
    const result=splitBatchPlatform("/virtual-alchemy",["src/Module.ts"],ts,{
      exists:file=>memory.has(file),read:file=>memory.get(file),
      write:(file,text)=>{writes.push(file);memory.set(file,text)}
    })
    assert.equal(result.splits.length,privatePackage?1:0)
    assert.deepEqual(writes,privatePackage?["src/Module.ts","src/Module.platform.ts"]:[])
  }
})
