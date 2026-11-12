// run-seconds: 120
import assert from "node:assert/strict"
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { compareApiIdentity, loadTypeScript } from "../../../../scripts/api-identity.mjs"
import { port, Parser } from "./out/main.js"

const ts = loadTypeScript()
const here = dirname(fileURLToPath(import.meta.url))
const before = join(here, "typescript/out")
const after = join(here, "out")
const options = {
  strict: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext, types: [],
}
const native = ts.createProgram([join(here, "typescript/main.ts")], {
  ...options, declaration: true, emitDeclarationOnly: true, outDir: before,
})
assert.deepEqual(ts.getPreEmitDiagnostics(native).map(d => d.code), [])
assert.equal(native.emit().emitSkipped, false)
const compare = afterDir => compareApiIdentity(ts, before, afterDir, {
  compilerOptions: { lib: ["lib.es2022.d.ts"], types: [] },
  beforeEntrypoints: { ".": "main.d.ts" }, afterEntrypoints: { ".": "main.d.ts" },
})
const identical = compare(after)
assert.equal(identical.comparisonComplete, true, JSON.stringify(identical))
assert.equal(identical.identical, true, JSON.stringify(identical))
assert.notEqual(readFileSync(join(before, "main.d.ts"), "utf8"), readFileSync(join(after, "main.d.ts"), "utf8"))
assert.match(readFileSync(join(after, "main.d.ts"), "utf8"), /from "\.\/main\.vibe\.parse\.js"/)
assert.equal(port("8080"), 8080)
assert.throws(() => port("0"), RangeError)
assert.ok(new Parser() instanceof Parser)

const temp = mkdtempSync(join(tmpdir(), "module-body-api-identity-"))
try {
  const changed = join(temp, "changed")
  cpSync(after, changed, { recursive: true })
  writeFileSync(join(changed, "package.json"), '{"type":"module"}')
  const bodyPath = join(changed, "main.vibe.parse.d.ts")
  const body = readFileSync(bodyPath, "utf8")
  assert.ok(body.includes("port(raw: string): number"))
  writeFileSync(bodyPath, body.replace("port(raw: string): number", "port(raw: string): string"))
  const different = compare(changed)
  assert.equal(different.comparisonComplete, true, JSON.stringify(different))
  assert.equal(different.identical, false, JSON.stringify(different))
  assert.ok(different.typeDifferences.some(d => d.export === "port"), JSON.stringify(different))

  const identity = join(temp, "identity")
  cpSync(after, identity, { recursive: true })
  writeFileSync(join(identity, "package.json"), '{"type":"module"}')
  const consumer = join(identity, "consumer.ts")
  writeFileSync(consumer, 'import type { Parser as Public } from "./main.js";\nimport type { Parser as Body } from "./main.vibe.parse.js";\ndeclare let publicParser: Public; declare let bodyParser: Body;\npublicParser = bodyParser; bodyParser = publicParser;\n')
  const program = ts.createProgram([consumer], { ...options, noEmit: true })
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [], "owner and body retain one nominal class identity")
} finally {
  rmSync(temp, { recursive: true, force: true })
}
console.log("module body re-exports preserve API and nominal identity; changed types fail")
