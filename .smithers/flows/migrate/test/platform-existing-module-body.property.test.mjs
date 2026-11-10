import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, symlinkSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { splitBatchPlatform } from "../lib/platform.mjs"
import { compareDeclarations, emitDeclarations, emitPackageJs, recordDeclarationSurface } from "../lib/declarations.mjs"
import { routeEmittedExports } from "../lib/emitted-exports.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check"), tsc = require.resolve("typescript/bin/tsc")
const modules = fileURLToPath(new URL("../../../../packages/runtime/node_modules", import.meta.url))
const binary = process.env.VIBELANG_BINARY ?? fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-existing-platform-module-body.json", import.meta.url), "utf8"))
function mapped({ source = corpus.source, existing = true, enabled = true, directory = "src", isPrivate = true } = {}) {
  const file = directory + "/host.ts", sibling = directory + "/host.platform.ts"
  const files = { "package.json": JSON.stringify({ private: isPrivate, exports: { "./*": "./" + directory + "/*.ts" } }),
    [file]: source, ...(existing ? { [sibling]: corpus.existing } : {}) }
  const before = structuredClone(files), writes = []
  const result = splitBatchPlatform(".", [file], ts, { moduleBodies: enabled, globalsOf: () => ["process"],
    exists: f => Object.hasOwn(files, f), read: f => files[f], write: (f, text) => { writes.push(f); files[f] = text } })
  return { file, sibling, files, before, writes, ...result }
}
test("existing platform siblings quote the preserving rewrite contract", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(corpus.quote))
})
test("a body-only platform split preserves its existing public sibling", () => {
  const absent = mapped({ existing: false }), present = mapped()
  assert.equal(absent.splits.length, 1); assert.equal(absent.splits[0].platform, null)
  assert.deepEqual(present.refused, []); assert.equal(present.splits.length, 1)
  assert.equal(present.splits[0].platform, null)
  assert.equal(present.files[present.file], absent.files[absent.file])
  assert.equal(present.files[present.sibling], present.before[present.sibling])
  assert.equal(present.files["package.json"], present.before["package.json"])
  assert.deepEqual(present.writes, [present.file])
})
test("a disabled body route retains the sibling collision refusal without writes", () => {
  const result = mapped({ enabled: false })
  assert.equal(result.splits.length, 0); assert.match(result.refused.join(" "), /already exists/)
  assert.deepEqual(result.files, result.before); assert.deepEqual(result.writes, [])
})
const metadataExpressions = ["import.meta", "import.meta.url", "import.meta.dirname", "import.meta.filename",
  'import.meta["dirname"]', 'import.meta.resolve("./input")', "import.meta.env.MODE", "import.meta.hot",
  'import.meta.glob("./*.md")']
test("declared metadata stays in the original module beside an existing platform sibling", () => {
  for (const expression of metadataExpressions) {
    const metadata = "export const metadata = " + expression + ";\n"
    const source = corpus.source + metadata
    const absent = mapped({ source, existing: false }), present = mapped({ source })
    for (const result of [absent, present]) {
      assert.deepEqual(result.refused, [])
      assert.equal(result.splits.length, 1)
      assert.equal(result.splits[0].platform, null)
      assert.ok(result.files[result.file].includes(metadata), expression)
      assert.deepEqual(result.writes, [result.file])
      assert.equal(result.files["package.json"], result.before["package.json"])
    }
    assert.equal(present.files[present.file], absent.files[absent.file])
    assert.equal(present.files[present.sibling], present.before[present.sibling])
  }
})
test("property: an existing sibling changes neither a body-only result nor the authored package", async () => {
  await checkProperty(fc, { name: corpus.key, rule: corpus.quote,
    command: "node --test .smithers/flows/migrate/test/platform-existing-module-body.property.test.mjs", numRuns: 50,
    arbitrary: fc.record({ directory: fc.constantFrom("src", "nested/src", "source with spaces", "src/δ"),
      metadata: fc.option(fc.constantFrom(...metadataExpressions)),
      collisions: fc.integer({ min: 0, max: 3 }), crlf: fc.boolean(), isPrivate: fc.boolean(), comment: fc.boolean() }),
    check: settings => {
      let source = Array.from({ length: settings.collisions }, (_, i) => "export const platform" + (i || "") + " = " + i + ";\n").join("") + corpus.source
      if (settings.metadata) source += "export const metadata = " + settings.metadata + ";\n"
      if (settings.comment) source = "/** Module documentation. */\n" + source
      if (settings.crlf) source = source.replaceAll("\n", "\r\n")
      const absent = mapped({ ...settings, source, existing: false }), present = mapped({ ...settings, source })
      assert.deepEqual(present.refused, []); assert.equal(present.splits.length, 1)
      assert.equal(present.splits[0].platform, null)
      assert.equal(present.files[present.file], absent.files[absent.file])
      assert.deepEqual(present.writes, [present.file])
      if (settings.metadata) assert.ok(present.files[present.file].includes(settings.metadata))
      assert.equal(present.files[present.sibling], present.before[present.sibling])
      assert.equal(present.files["package.json"], present.before["package.json"])
    } })
})
test("the real body conversion preserves declarations, laziness, receiver and the authored helper", async () => {
  const parent = mkdtempSync(join(tmpdir(), "existing-platform-body-")), root = join(parent, "pkg")
  const put = (file, text) => { mkdirSync(join(root, file, ".."), { recursive: true }); writeFileSync(join(root, file), text) }
  const cli = (compiler, args) => {
    const r = spawnSync(compiler, args, { cwd: root, encoding: "utf8", timeout: 90_000 })
    assert.equal(r.error, undefined, String(r.error)); assert.equal(r.signal, null)
    assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout.trim()
  }
  try {
    mkdirSync(root); symlinkSync(modules, join(root, "node_modules"), "dir")
    put("package.json", JSON.stringify({ type: "module", private: true, exports: { "./*": "./src/*.ts" } }))
    put("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext",
      types: [], skipLibCheck: true, rootDir: ".", declaration: true }, vibe: { effectGlobals: false, effectModules: false }, include: ["src"] }))
    put("src/ambient.d.ts", "declare const process: { cwd(): string };\n")
    put("src/host.ts", corpus.source)
    const existing = corpus.existing + 'throw new Error("an unrelated authored helper must stay unloaded");\n'
    put("src/host.platform.ts", existing)
    cli(process.execPath, [tsc, "-p", "tsconfig.json", "--noEmit"])
    const snapshot = async name => {
      const dir = join(parent, name), result = await emitDeclarations({ compiler: binary, tsconfig: "tsconfig.json", cwd: root,
        root, outDir: dir, log: join(parent, name + ".log"), typescript: ts })
      assert.equal(result.code, 0, JSON.stringify(result))
      recordDeclarationSurface(ts, dir, root, [{ tsconfig: "tsconfig.json", prefix: "." }], undefined, { emitDiagnostics: result.diagnostics })
      return dir
    }
    const before = await snapshot("before")
    const beforeJs = join(root, ".cache/before-js"), afterJs = join(root, ".vibelang/js")
    cli(process.execPath, [tsc, "-p", "tsconfig.json", "--declaration", "false", "--outDir", beforeJs])
    const result = splitBatchPlatform(root, ["src/host.ts"], ts, { moduleBodies: true, globalsOf: () => ["process"] })
    assert.deepEqual(result.refused, []); assert.equal(result.splits.length, 1); assert.equal(result.splits[0].platform, null)
    assert.equal(readFileSync(join(root, "src/host.platform.ts"), "utf8"), existing)
    renameSync(join(root, "src/host.ts"), join(root, "src/host.vibe"))
    const emitted = await emitPackageJs({ compiler: binary, tsconfigs: ["tsconfig.json"], packageDir: root, root, log: join(parent, "emitted.log") })
    assert.equal(emitted.code, 0, JSON.stringify(emitted.diagnostics))
    assert.equal(emitted.moduleOutputs.length, 1)
    routeEmittedExports(root, emitted.outputs, { typescript: ts, moduleOutputs: emitted.moduleOutputs })
    assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).exports["./host.vibe.platform"], null)
    const after = await snapshot("after"), api = compareDeclarations(ts, before, after, { canonical: true, includePrivate: true })
    assert.equal(api.comparisonComplete, true, JSON.stringify(api)); assert.equal(api.identical, true, JSON.stringify(api))
    const script = String.raw`
      import assert from "node:assert/strict";
      import * as Effect from "effect/Effect";
      import {pathToFileURL} from "node:url";
      const entry=process.argv[1],real=globalThis.process,calls=[];
      const wrapped=new Proxy(real,{get(target,key){if(key==="cwd")return function(){calls.push(this===wrapped);return "captured"};return Reflect.get(target,key,target)}});
      Object.defineProperty(globalThis,"process",{configurable:true,value:wrapped});
      const {program,pure}=await import(pathToFileURL(entry));
      assert.equal(pure,1);assert.deepEqual(calls,[]);
      assert.equal(Effect.runSync(program),"captured");assert.deepEqual(calls,[true]);
      console.log(JSON.stringify({pure,calls,result:"captured"}));
    `
    const run = dir => cli(process.execPath, ["--input-type=module", "-e", script, join(dir, "src/host.js")])
    assert.equal(run(beforeJs), run(afterJs))
    assert.equal(readFileSync(join(root, "src/host.platform.ts"), "utf8"), existing)
  } finally { rmSync(parent, { recursive: true, force: true }) }
})
