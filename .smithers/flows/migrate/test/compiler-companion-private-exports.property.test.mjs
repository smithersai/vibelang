import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, symlinkSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { compilerCompanionMarker, fixToFixedPoint, restoreExports } from "../lib/codemod.mjs"
import { compareDeclarations, emitDeclarations, recordDeclarationSurface } from "../lib/declarations.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check"), tsc = require.resolve("typescript/bin/tsc")
const modules = fileURLToPath(new URL("../../../../packages/runtime/node_modules", import.meta.url))
const binary = process.env.VIBELANG_BINARY ?? fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-compiler-platform-private-export.json", import.meta.url), "utf8"))

function fixture({ directory = "src", alias = "Effect", collision = false, crlf = false, existing = false, marked = false } = {}) {
  const parent = mkdtempSync(join(tmpdir(), "compiler-private-export-")), root = join(parent, "pkg")
  mkdirSync(join(root, directory), { recursive: true })
  symlinkSync(modules, join(root, "node_modules"), "dir")
  const from = directory + "/model.ts", file = directory + "/model.vibe", companion = directory + "/model.platform.ts"
  let source = corpus.source.replace("import * as Effect from", "import * as " + alias + " from").replaceAll("Effect.", alias + ".")
  if (collision) source = "export const $platform = 1;\n" + source
  if (crlf) source = source.replaceAll("\n", "\r\n")
  const manifest = structuredClone(corpus.manifest)
  manifest.exports = { "./*": "./" + directory + "/*.ts" }
  writeFileSync(join(root, from), source)
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest))
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    strict: true, module: "NodeNext", moduleResolution: "NodeNext", target: "ESNext", lib: ["ESNext", "DOM"],
    types: [], skipLibCheck: true, rootDir: ".", declaration: true,
  }, vibe: { effectGlobals: false, effectModules: false }, include: [directory] }))
  const authored = (marked ? compilerCompanionMarker : "") + "export const authored = 7;\n"
  if (existing) writeFileSync(join(root, companion), authored)
  return { parent, root, from, file, companion, manifest, source, authored }
}
function cli(f, compiler, args) {
  const result = spawnSync(compiler, args, { cwd: f.root, encoding: "utf8", timeout: 90_000 })
  assert.equal(result.error, undefined, String(result.error)); assert.equal(result.signal, null)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result
}
function stock(f, output) {
  return cli(f, process.execPath, [tsc, "-p", "tsconfig.json", ...(output
    ? ["--noEmit", "false", "--declaration", "false", "--outDir", output] : ["--noEmit"])])
}
async function snapshot(f, name) {
  const dir = join(f.parent, name)
  const result = await emitDeclarations({ compiler: binary, tsconfig: "tsconfig.json", cwd: f.root,
    root: f.root, outDir: dir, log: join(f.parent, name + ".log"), typescript: ts })
  assert.equal(result.code, 0, JSON.stringify(result))
  recordDeclarationSurface(ts, dir, f.root, [{ tsconfig: "tsconfig.json", prefix: "." }],
    undefined, { emitDiagnostics: result.diagnostics })
  return dir
}
async function fix(f, { enabled = true, onPrivateCompanion } = {}) {
  renameSync(join(f.root, f.from), join(f.root, f.file))
  const fixed = await fixToFixedPoint({ compiler: binary, tsconfig: "tsconfig.json", cwd: f.root,
    root: f.root, only: [f.file], privateCompanions: enabled, onPrivateCompanion, log: join(f.parent, "fix.log") })
  assert.equal(fixed.settled, true)
  return fixed
}
const json = f => JSON.parse(readFileSync(join(f.root, "package.json"), "utf8"))

test("compiler companion exports quote the preserving rewrite contract", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(corpus.quote))
})
for (const enabled of [true, false]) test("native helper API visibility with private companions " + enabled, async () => {
  const f = fixture()
  try {
    stock(f)
    const before = await snapshot(f, "before"), fixed = await fix(f, { enabled })
    assert.deepEqual(fixed.companions, [f.companion])
    const after = await snapshot(f, "after")
    const api = compareDeclarations(ts, before, after, { canonical: true, includePrivate: true })
    assert.equal(api.comparisonComplete, true, JSON.stringify(api))
    assert.equal(api.identical, enabled, JSON.stringify(api))
    assert.deepEqual(api.typeDifferences, []); assert.deepEqual(api.docDifferences, [])
    if (enabled) {
      assert.equal(json(f).exports["./model.platform"], null); assert.equal(fixed.companionExports.length, 1)
    } else {
      assert.deepEqual(json(f), f.manifest)
      assert.deepEqual(api.nameDifferences, [{ entrypoint: "./model.platform", export: "*", side: "after" }])
    }
  } finally { rmSync(f.parent, { recursive: true, force: true }) }
})
for (const marked of [false, true]) test("an existing companion remains authored even with its compiler marker " + marked, async () => {
  const f = fixture({ existing: true, marked })
  try {
    stock(f); const fixed = await fix(f)
    assert.deepEqual(fixed.companions, []); assert.equal(fixed.companionExports?.length ?? 0, 0)
    assert.equal(readFileSync(join(f.root, f.companion), "utf8"), f.authored)
    assert.deepEqual(json(f), f.manifest)
  } finally { rmSync(f.parent, { recursive: true, force: true }) }
})
test("fresh helper privatization preserves compiler output across source layouts", async () => {
  await fc.assert(fc.asyncProperty(fc.record({
    directory: fc.constantFrom("src", "nested/src", "source with spaces", "src/δ"),
    alias: fc.constantFrom("Effect", "FX"), collision: fc.boolean(), crlf: fc.boolean(),
  }), async settings => {
    const ordinary = fixture(settings), hidden = fixture(settings)
    try {
      stock(ordinary); stock(hidden)
      await fix(ordinary, { enabled: false }); await fix(hidden)
      for (const file of [ordinary.file, ordinary.companion])
        assert.equal(readFileSync(join(ordinary.root, file), "utf8"), readFileSync(join(hidden.root, file), "utf8"))
      assert.deepEqual(Object.keys(json(hidden).exports).sort(), ["./*", "./model.platform"])
      assert.equal(json(hidden).exports["./model.platform"], null)
      cli(hidden, binary, ["-p", "tsconfig.json", "--noEmit", "--singleThreaded", "--pretty", "false"])
    } finally {
      rmSync(ordinary.parent, { recursive: true, force: true }); rmSync(hidden.parent, { recursive: true, force: true })
    }
  }), { seed: 582733, numRuns: 50 })
})
for (const mode of ["success", "throw", "reject"]) test("private helpers keep host receiver, suspension and result identity " + mode, async () => {
  const f = fixture()
  try {
    const before = join(f.root, ".cache/runtime-before"), after = join(f.root, ".cache/runtime-after")
    stock(f, before); await fix(f)
    assert.equal(json(f).exports["./model.platform"], null)
    cli(f, binary, ["-p", "tsconfig.json", "--noEmit", "false", "--declaration", "false", "--emitDeclarationOnly", "false", "--outDir", after, "--singleThreaded", "--pretty", "false"])
    const script = String.raw`
      import assert from "node:assert/strict";
      import * as Effect from "effect/Effect";
      import { pathToFileURL } from "node:url";
      const [entry,mode]=process.argv.slice(1),key={},problem={sentinel:1},value={kty:"probe"},calls=[];
      globalThis.key=key;
      const subtle={exportKey(format,input){calls.push({format,key:input===key,receiver:this===subtle});if(mode==="throw")throw problem;return mode==="reject"?Promise.reject(problem):Promise.resolve(value)}};
      const real=globalThis.crypto;
      Object.defineProperty(globalThis,"crypto",{configurable:true,value:new Proxy(real,{get(target,name){if(name==="subtle")return subtle;const v=Reflect.get(target,name,target);return typeof v==="function"?v.bind(target):v}})});
      const {program}=await import(pathToFileURL(entry));
      assert.deepEqual(calls,[]);
      const exit=await Effect.runPromiseExit(program),seen=new Set();
      function contains(v,w){if(v===w)return true;if(!v||typeof v!=="object"||seen.has(v))return false;seen.add(v);return Reflect.ownKeys(v).some(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return d&&"value"in d&&contains(d.value,w)})}
      assert.deepEqual(calls,[{format:"jwk",key:true,receiver:true}]);
      assert.equal(contains(exit,mode==="success"?value:problem),true);
      console.log(JSON.stringify({calls,tag:exit._tag,identity:true}));
    `
    const run = dir => cli(f, process.execPath, ["--input-type=module", "-e", script, join(dir, "src/model.js"), mode]).stdout.trim()
    assert.equal(run(before), run(after))
  } finally { rmSync(f.parent, { recursive: true, force: true }) }
})
test("private companion export receipts undo exactly their fresh keys", async () => {
  const f = fixture()
  try {
    stock(f); const fixed = await fix(f), edits = fixed.companionExports?.flatMap(c => c.exportEdits) ?? []
    assert.equal(edits.length, 1)
    restoreExports(f.root, edits, f.from); assert.deepEqual(json(f), f.manifest)
    restoreExports(f.root, edits, f.from); assert.deepEqual(json(f), f.manifest)
    const pkg = json(f); pkg.exports[edits[0].key] = "./authored.ts"
    writeFileSync(join(f.root, "package.json"), JSON.stringify(pkg))
    assert.throws(() => restoreExports(f.root, edits, f.from), /changed/)
    assert.equal(json(f).exports[edits[0].key], "./authored.ts")
  } finally { rmSync(f.parent, { recursive: true, force: true }) }
})
test("a private export plan is recorded before a manifest write can start", async () => {
  const f = fixture(), planned = []
  try {
    stock(f)
    await assert.rejects(fix(f, { onPrivateCompanion: record => { planned.push(record); throw new Error("interrupted before private export write") } }), /interrupted before private export write/)
    assert.equal(planned.length, 1); assert.deepEqual(json(f), f.manifest)
    restoreExports(f.root, planned.flatMap(c => c.exportEdits), f.from); assert.deepEqual(json(f), f.manifest)
  } finally { rmSync(f.parent, { recursive: true, force: true }) }
})

test("a durable private companion plan resumes an interrupted manifest write", async () => {
  const f = fixture(), planned = []
  try {
    stock(f)
    await assert.rejects(fix(f, { onPrivateCompanion: record => {
      planned.push({ file: f.from, companion: record.companion, privateExports: record.privateExports })
      throw new Error("interrupted private manifest")
    } }), /interrupted private manifest/)
    assert.deepEqual(json(f), f.manifest)
    const resume = () => fixToFixedPoint({ compiler: binary, tsconfig: "tsconfig.json", cwd: f.root,
      root: f.root, only: [f.file], privateCompanions: true, privateCompanionReceipts: planned,
      log: join(f.parent, "resume.log") })
    const fixed = await resume()
    assert.equal(fixed.settled, true)
    assert.equal(json(f).exports["./model.platform"], null)
    const installed = readFileSync(join(f.root, "package.json"), "utf8")
    assert.equal((await resume()).settled, true)
    assert.equal(readFileSync(join(f.root, "package.json"), "utf8"), installed)
    restoreExports(f.root, fixed.companionExports.flatMap(c => c.exportEdits), f.from)
    assert.deepEqual(json(f), f.manifest)
  } finally { rmSync(f.parent, { recursive: true, force: true }) }
})
