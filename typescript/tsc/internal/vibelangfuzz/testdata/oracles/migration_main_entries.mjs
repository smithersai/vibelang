import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, basename } from "node:path"
import { pathToFileURL } from "node:url"
const repo = process.cwd()
const { compareDeclarations } = await import(pathToFileURL(join(repo, ".smithers/flows/migrate/lib/declarations.mjs")).href)
const ts = createRequire(join(repo, "packages/runtime/package.json"))("typescript")
const [key, rawMode] = process.argv.slice(2), mode = Number(rawMode) & 15
const expected = ["private-companion", "mts-normalization", "no-main"].includes(key)
const stem = mode & 1 ? "nested/space δ/leaf" : "leaf"
const name = mode & 4 ? "-24-call-24-ts" : "constants"
const companion = stem + ".vibe." + name + ".d.ts"
const mts = ["mts-normalization", "mts-collision"].includes(key)
const beforeLeaf = stem + (mts ? ".d.mts" : ".d.ts")
const afterLeaf = stem + ".d.ts"
const valueType = mode & 2 ? "string" : "number"
const corpusName = mts ? "t3code-main-mts-entry" : "t3code-main-private-companion"
const fixture = JSON.parse(readFileSync(join(repo, "typescript/tsc/internal/vibelangfuzz/testdata/corpus", corpusName + ".json"), "utf8"))
const parent = ((key === "doc-change" || mode & 8) ? "/** Stable value. */\n" : "") + fixture.declaration.replace(": number;", ": " + valueType + ";")
const main = fixture.mainDeclaration.replaceAll("./leaf.js", "./" + stem + ".js")
const beforeFiles = { "main.d.ts": main, [beforeLeaf]: parent }
const afterFiles = { "main.d.ts": main, [afterLeaf]: parent }
let companions = []
if (["private-companion", "no-main", "authored-entry", "reexport"].includes(key)) {
 afterFiles[companion] = "export declare const hiddenValue: number;\n"
 if (key !== "authored-entry") companions = [companion]
 if (key === "reexport") afterFiles[afterLeaf] += 'export { hiddenValue } from "./' + basename(companion).replace(/\.d\.ts$/, ".js") + '";\n'
}
if (key === "type-change") afterFiles[afterLeaf] = parent.replace(": " + valueType + ";", ": " + (valueType === "number" ? "string" : "number") + ";")
if (key === "doc-change") afterFiles[afterLeaf] = parent.replace("Stable value.", "Changed value.")
if (key === "mts-collision") beforeFiles[afterLeaf] = "export declare const collision: boolean;\n"
mkdirSync(join(repo, ".cache"), { recursive: true })
const root = mkdtempSync(join(repo, ".cache/main-entry-model-"))
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, mode & 8 ? text.replaceAll("\n", "\r\n") : text) }
function snapshot(side, files, source, leaf, internals) {
 const dir = join(root, side), stored = Object.keys(files).sort()
 const aliases = {}
 for (const file of stored) {
  put(join(dir, file), files[file])
  aliases[file === "main.d.ts" ? "main.ts" : file === leaf ? source : file] = file
 }
 const manifest = { name: "fixture", ...fixture.manifest }; if (key === "no-main") delete manifest.main
 put(join(dir, "public-surface.json"), JSON.stringify({
  roots: stored, reachable: stored, unresolved: [], resolutions: [], snapshotVersion: 3,
  apiMetadata: { manifest, layouts: [], projectContexts: [], aliases, logicalPaths: {}, packageDir: join(root, "package"), companions: internals }
 }))
 return dir
}
try {
 const before = snapshot("before", beforeFiles, stem + (mts ? ".mts" : ".ts"), beforeLeaf, [])
 const after = snapshot("after", afterFiles, stem + ".vibe", afterLeaf, companions)
 const result = compareDeclarations(ts, before, after, { canonical: true, includePrivate: true })
 assert.equal(result.comparisonComplete, true, JSON.stringify(result))
 if (key === "type-change") assert.ok(result.typeDifferences.some(d => d.export === "value"), JSON.stringify(result))
 if (key === "doc-change") assert.ok(result.docDifferences.some(d => d.export === "value"), JSON.stringify(result))
 if (key === "reexport") assert.ok(result.nameDifferences.some(d => d.export === "hiddenValue"), JSON.stringify(result))
 console.log(JSON.stringify({ key, mode, expected, actual: result.identical, ok: result.identical === expected, comparisonComplete: result.comparisonComplete, names: result.nameDifferences, types: result.typeDifferences.map(({ entrypoint, export: name, aspect }) => ({ entrypoint, export: name, aspect })), docs: result.docDifferences }))
} finally { rmSync(root, { recursive: true, force: true }) }
