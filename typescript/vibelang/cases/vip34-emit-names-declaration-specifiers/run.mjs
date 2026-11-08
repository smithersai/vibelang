// run-seconds: 120
// rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#decision
// rule-evidence: docs/design/vips/0027-declaration-output.md#prior-art
// Compiles one VibeLang project and its all-TypeScript twin (user.ts, App.tsx,
// main.ts) with the tested compiler and compares their outputs. TypeScript
// 5.9.3 emits the same twin main.js and main.d.ts bytes for the rewrite
// configuration.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "VIBELANG_BINARY must name the tested compiler")
const local = fileURLToPath(new URL(".", import.meta.url))
const root = realpathSync(mkdtempSync(join(tmpdir(), "vip34-emit-names-")))
const main = [
  'import { user } from "./user.vibe"',
  'export { user } from "./user.vibe"',
  'export type { User } from "./user.js"',
  'export * as Users from "./user"',
  'export { title } from "./App.vibex"',
  'export { title as jsxTitle } from "./App.jsx"',
  'export { plain } from "./plain.ts"',
  'export type Later = typeof import("./user.vibe")',
  'export const make = () => user("a")',
  ""
].join("\n")
const sources = {
  vibe: { "main.vibe": main, "user.vibe": "", "App.vibex": "", "plain.ts": "" },
  ts: { "main.ts": main.replaceAll("./user.vibe", "./user.ts").replaceAll("./App.vibex", "./App.tsx"), "user.ts": "", "App.tsx": "", "plain.ts": "" }
}
for (const files of Object.values(sources)) {
  for (const name of Object.keys(files)) {
    if (name.startsWith("user.")) files[name] = "export type User = { readonly name: string }\nexport const user = (name: string): User => ({ name })\n"
    if (name.startsWith("App.")) files[name] = 'export const title = "app"\n'
    if (name === "plain.ts") files[name] = "export const plain = 1\n"
  }
}
const list = dir => existsSync(dir) ? readdirSync(dir).sort() : []
const read = (dir, name) => readFileSync(join(dir, name), "utf8")
// VIP-27 adds a generated never contract to make's declaration; the twin has none.
const contract = text => text.replaceAll("/** @throws {never} */\n", "")
const compile = (kind, options, vibe = {}) => {
  const dir = join(root, kind)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, "node_modules"), { recursive: true })
  symlinkSync(realpathSync(join(local, "node_modules/effect")), join(dir, "node_modules/effect"))
  writeFileSync(join(dir, "package.json"), '{"type":"module"}')
  for (const [name, text] of Object.entries(sources[kind])) writeFileSync(join(dir, name), text)
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "es2022", module: "esnext", moduleResolution: "bundler", strict: true, types: [], skipLibCheck: true,
      jsx: "preserve", declaration: true, outDir: "out", rootDir: ".", ...options
    },
    ...(kind === "vibe" ? { vibe } : {})
  }))
  const r = spawnSync(binary, ["-p", ".", "--pretty", "false"], { cwd: dir, encoding: "utf8", timeout: 30000 })
  assert.ifError(r.error)
  assert.equal(r.status, 0, kind + " " + JSON.stringify(options) + "\n" + r.stdout + r.stderr)
  return { dir, out: join(dir, "out"), files: list(join(dir, "out")) }
}
let checks = 0
try {
  const flags = [
    { allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true },
    { rewriteRelativeImportExtensions: true },
    { allowImportingTsExtensions: true, emitDeclarationOnly: true }
  ]
  for (const options of flags) {
    const label = JSON.stringify(options)
    const vibe = compile("vibe", options)
    const twin = compile("ts", options)
    const js = !options.emitDeclarationOnly

    // rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#f031af47c59ef051 | **Amended 2026-10-30, clarified 2026-11-03: emit names mirror TypeScript.** `x.vibe` compiles to `x.js` beside `x.d.ts` in `outDir`.
    assert.deepEqual(vibe.files, twin.files, label)
    assert.deepEqual(vibe.files, js
      ? ["App.d.ts", "App.jsx", "main.d.ts", "main.js", "plain.d.ts", "plain.js", "user.d.ts", "user.js"]
      : ["App.d.ts", "main.d.ts", "plain.d.ts", "user.d.ts"], label)
    checks++

    // rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#dfb078b3e764e1eb | **Amended 2026-11-03: declaration import spelling follows TypeScript.** Ordinary package declarations use the native twin’s relative specifiers: `./user.vibe` is declared as `./user.ts` and `./App.vibex` as `./App.tsx`; written `./user.js`, `./App.jsx`, `./user` and native `./plain.ts` keep their spelling.
    const declared = read(vibe.out, "main.d.ts")
    assert.equal(contract(declared), read(twin.out, "main.d.ts"), label)
    for (const spelling of ['from "./user.ts"', 'from "./App.tsx"', 'from "./user.js"', 'from "./App.jsx"', 'from "./user"', 'from "./plain.ts"', 'import("./user.ts")'])
      assert.ok(declared.includes(spelling), label + " lacks " + spelling + "\n" + declared)
    assert.doesNotMatch(declared, /\.vibex?["']/, label)
    checks++

    // rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#1a67a43edea75cde | Neither `allowImportingTsExtensions` nor `rewriteRelativeImportExtensions` rewrites declaration specifiers; JavaScript output rewriting is separate.
    // The declaration above keeps ./user.ts and ./plain.ts under every flag set;
    // only the JavaScript is rewritten, and only with rewriteRelativeImportExtensions.
    if (js) {
      const emitted = read(vibe.out, "main.js")
      assert.equal(emitted, read(twin.out, "main.js"), label)
      for (const spelling of ['from "./user.js"', 'from "./App.jsx"', 'from "./plain.js"'])
        assert.ok(emitted.includes(spelling), label + " lacks " + spelling + "\n" + emitted)
      assert.doesNotMatch(emitted, /\.(vibex?|tsx?)["']/, label)
    }
    checks++

    // rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#83b28e1d15dc1f66 | Compatibility sidecars instead keep VibeLang source references such as `./user.vibe` and `./App.vibex`, relocated to the selected compatibility declaration when necessary, to preserve source identity.
    const sidecar = read(vibe.dir, "main.d.vibe.ts")
    // Written ./user.js, ./user and ./App.jsx name the same sources there.
    for (const spelling of ['export { user } from "./user.vibe"', 'export type { User } from "./user.vibe"', 'export * as Users from "./user.vibe"',
      'export { title } from "./App.vibex"', 'export { title as jsxTitle } from "./App.vibex"', 'typeof import("./user.vibe")'])
      assert.ok(sidecar.includes(spelling), label + " sidecar lacks " + spelling + "\n" + sidecar)
    assert.doesNotMatch(sidecar, /\.\/(user\.ts|App\.tsx)["']/, label)
    assert.ok(existsSync(join(vibe.dir, "user.d.vibe.ts")) && existsSync(join(vibe.dir, "App.d.vibex.ts")), label)
    checks++
  }
  // The same references in sidecars relocated under vibe.sidecarDir, while the
  // ordinary declaration is unchanged.
  const options = flags[0]
  const relocated = compile("vibe", { ...options, rootDirs: [".", ".vibe/declarations"] }, { sidecarDir: ".vibe/declarations" })
  const twin = compile("ts", options)
  const mirrored = join(relocated.dir, ".vibe/declarations")
  assert.ok(!existsSync(join(relocated.dir, "main.d.vibe.ts")))
  const sidecar = read(mirrored, "main.d.vibe.ts")
  for (const spelling of ['export { user } from "./user.vibe"', 'export { title } from "./App.vibex"', 'export { title as jsxTitle } from "./App.vibex"'])
    assert.ok(sidecar.includes(spelling), "relocated sidecar lacks " + spelling + "\n" + sidecar)
  assert.ok(existsSync(join(mirrored, "user.d.vibe.ts")) && existsSync(join(mirrored, "App.d.vibex.ts")))
  assert.equal(contract(read(relocated.out, "main.d.ts")), read(twin.out, "main.d.ts"))
  checks++
} finally { rmSync(root, { recursive: true, force: true }) }
assert.equal(checks, 13)
console.log("VIP-34 emit names and declaration specifiers: 13 checks passed")
