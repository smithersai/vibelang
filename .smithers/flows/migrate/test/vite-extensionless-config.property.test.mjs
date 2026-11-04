import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import { loadTypeScript } from "../lib/declarations.mjs"
import { wireNativeViteConfigs } from "../lib/vite-config.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = loadTypeScript([fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-vite-extensionless-contract.json", import.meta.url), "utf8"))
const write = (root, name, text) => { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), text) }
const read = (root, name) => readFileSync(join(root, name), "utf8")
const options = { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ESNext, noEmit: true, allowImportingTsExtensions: true, types: [] }

function fixture({ name = "contract", ext = ".ts", directory = false, planned = true, transitive = false, protectedHelper = false, edge = "import" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "smithers-vite-contract-"))
  const helper = name + (directory ? "/index" : "") + ext
  const clause = edge === "export" ? 'export { value } from "./' + name + '"; const value = 42;' :
    edge === "dynamic" ? 'const { value } = await import("./' + name + '");' :
    'import { value } from "./' + name + '";'
  write(root, "package.json", JSON.stringify({ type: "module", scripts: { build: "vite build" } }))
  write(root, "tsconfig.json", JSON.stringify({ compilerOptions: { module: "ESNext", moduleResolution: "Bundler", target: "ESNext", noEmit: true, allowImportingTsExtensions: true, types: [] } }))
  write(root, "vite.config.ts", !transitive && name === "contract" && edge === "import" ? corpus.config : (transitive ? 'import { value } from "./bridge.ts";' : clause) + '\nexport default { define: { value: String(value) } };\n')
  write(root, "bridge.ts", 'export { value } from "./' + name + '";\n')
  write(root, helper, corpus.helper)
  if (protectedHelper) write(root, "vendor/package.json", '{"type":"module"}')
  return { root, helper, wire: () => wireNativeViteConfigs({ root, ts, packages: [{ dir: ".", sources: planned ? ["."] : ["src"] }], configs: ["vite.config.ts"], manifests: [{ dir: "." }], specsFor: () => ({ vibelang: "0.0.11" }) }) }
}
function check(root) {
  const program = ts.createProgram([join(root, "vite.config.ts")], options)
  return ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
}

test("smithers extensionless config: tsc twin and Vite bundle pass; native needs the resolved helper extension", async () => {
  const f = fixture()
  try {
    assert.deepEqual(check(f.root), [])
    const tsc = () => spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", join(f.root, "tsconfig.json"), "--pretty", "false"], { encoding: "utf8" })
    const originalCheck = tsc()
    assert.equal(originalCheck.status, 0, originalCheck.stdout + originalCheck.stderr)
    const register = fileURLToPath(new URL("../../../../packages/compiler/register.mjs", import.meta.url))
    const before = spawnSync(process.execPath, ["--import", register, join(f.root, "vite.config.ts")], { encoding: "utf8" })
    assert.notEqual(before.status, 0)
    assert.match(before.stderr, /ERR_MODULE_NOT_FOUND/)
    const result = f.wire()
    assert.match(read(f.root, "vite.config.ts"), /from "\.\/contract\.ts"/)
    assert.ok(result.changed.includes("vite.config.ts"))
    assert.deepEqual(check(f.root), [])
    const rewrittenCheck = tsc()
    assert.equal(rewrittenCheck.status, 0, rewrittenCheck.stdout + rewrittenCheck.stderr)
    const after = spawnSync(process.execPath, ["--import", register, join(f.root, "vite.config.ts")], { encoding: "utf8" })
    assert.equal(after.status, 0, after.stderr)
    assert.deepEqual(f.wire().changed, [])
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("smithers extensionless config property: rewrite exactly TypeScript's resolved local runtime imports", () => {
  fc.assert(fc.property(fc.constantFrom("contract", "contract.part", "deep/helper"), fc.constantFrom(".ts", ".js"), fc.boolean(), fc.boolean(), fc.constantFrom("import", "export", "dynamic"), (name, ext, directory, transitive, edge) => {
    const f = fixture({ name, ext, directory, transitive, edge })
    try {
      const result = f.wire()
      const importer = transitive ? "bridge.ts" : "vite.config.ts"
      assert.ok(read(f.root, importer).includes('"./' + f.helper + '"'))
      assert.ok(result.changed.includes(importer))
      assert.equal(read(f.root, f.helper), corpus.helper)
      assert.deepEqual(f.wire().changed, [])
    } finally { rmSync(f.root, { recursive: true, force: true }) }
  }), { seed: 822904, numRuns: 60 })
})

test("config graphs outside planned or existing VibeLang sources keep the default loader and imports", () => {
  const f = fixture({ planned: false })
  try {
    const before = read(f.root, "vite.config.ts")
    assert.deepEqual(f.wire().changed, [])
    assert.equal(read(f.root, "vite.config.ts"), before)
    assert.equal(JSON.parse(read(f.root, "package.json")).scripts.build, "vite build")
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("native config wiring stops before changing a protected helper graph", () => {
  const f = fixture({ name: "vendor/contract", protectedHelper: true, transitive: true })
  try {
    write(f.root, f.helper, 'export { value } from "./leaf"\n')
    write(f.root, "vendor/leaf.ts", "export const value = 42\n")
    const before = ["package.json", "vite.config.ts", "bridge.ts", f.helper].map(p => read(f.root, p))
    assert.throws(f.wire, /vendor\/contract\.ts.*\.\/leaf.*native config/)
    assert.deepEqual(["package.json", "vite.config.ts", "bridge.ts", f.helper].map(p => read(f.root, p)), before)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("real Vite loads the TypeScript twin with bundle before wiring and native after wiring", { skip: !process.env.VIBELANG_VITE_ORACLE_MODULES && "set VIBELANG_VITE_ORACLE_MODULES" }, async () => {
  const f = fixture()
  try {
    const { loadConfigFromFile } = await import(pathToFileURL(join(process.env.VIBELANG_VITE_ORACLE_MODULES, "vite/dist/node/index.js")).href)
    const env = { command: "build", mode: "production" }
    assert.equal((await loadConfigFromFile(env, join(f.root, "vite.config.ts"), f.root, "silent", undefined, "bundle")).config.define.value, "42")
    await assert.rejects(() => loadConfigFromFile(env, join(f.root, "vite.config.ts"), f.root, "silent", undefined, "native"), /Cannot find module/)
    f.wire()
    assert.equal((await loadConfigFromFile(env, join(f.root, "vite.config.ts"), f.root, "silent", undefined, "native")).config.define.value, "42")
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})


test("native config graph preserves type-only and explicit imports, comments, and TypeScript resolution precedence", () => {
  const f = fixture()
  try {
    write(f.root, "contract.tsx", "export const value = 99\n")
    write(f.root, "vite.config.ts", '// import { value } from "./comment"\nimport type { Kind } from "./types";\nimport { value } from "./contract";\nimport "./explicit.ts";\nexport default { define: { value } };\n')
    write(f.root, "types.ts", "export type Kind = number\n")
    write(f.root, "explicit.ts", "export {}\n")
    f.wire()
    assert.equal(read(f.root, "vite.config.ts"), '// import { value } from "./comment"\nimport type { Kind } from "./types";\nimport { value } from "./contract.ts";\nimport "./explicit.ts";\nexport default { define: { value } };\n')
    assert.deepEqual(check(f.root), [])
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("unresolved, declaration-only and fixture-owned extensionless edges stop native setup", () => {
  for (const kind of ["missing", "declaration", "fixture"]) {
    const f = fixture({ name: kind === "fixture" ? "fixtures/contract" : "contract", transitive: true })
    try {
      if (kind === "missing") rmSync(join(f.root, f.helper))
      if (kind === "declaration") {
        rmSync(join(f.root, f.helper))
        write(f.root, "contract.d.ts", "export declare const value: number\n")
      }
      if (kind === "fixture") {
        write(f.root, f.helper, 'export { value } from "./leaf"\n')
        write(f.root, "fixtures/leaf.ts", "export const value = 42\n")
      }
      const before = read(f.root, "package.json")
      assert.throws(f.wire, /cannot wire native config loading/)
      assert.equal(read(f.root, "package.json"), before)
      assert.match(read(f.root, "bridge.ts"), kind === "fixture" ? /".\/fixtures\/contract"/ : /".\/contract"/)
    } finally { rmSync(f.root, { recursive: true, force: true }) }
  }
})


test("a helper that TypeScript does not resolve is never selected by migration fallback order", () => {
  const f = fixture({ ext: ".mts" })
  try {
    assert.ok(check(f.root).some(message => message.includes("Cannot find module './contract'")))
    const before = read(f.root, "vite.config.ts")
    assert.throws(f.wire, /contract.*no local runtime source resolved by TypeScript/)
    assert.equal(read(f.root, "vite.config.ts"), before)
    assert.equal(JSON.parse(read(f.root, "package.json")).scripts.build, "vite build")
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
