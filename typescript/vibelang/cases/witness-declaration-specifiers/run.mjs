// run-seconds: 120
// rule-evidence: docs/design/src/001-functions.md#declaration-output | **Specifiers.** Declaration emit follows TypeScript for the source’s `.ts`/`.tsx` twin.
// rule-evidence: docs/design/src/001-functions.md#declaration-output | Ordinary package declarations use the native twin’s relative specifiers: `./user.vibe` is declared as `./user.ts` and `./App.vibex` as `./App.tsx`; written `./user.js`, `./App.jsx`, `./user` and native `./plain.ts` keep their spelling.
// rule-evidence: docs/design/src/001-functions.md#declaration-output | Compatibility sidecars instead keep VibeLang source references such as `./user.vibe` and `./App.vibex`, relocated to the selected compatibility declaration when necessary, to preserve source identity.
// rule-evidence: docs/design/src/001-functions.md#declaration-output | Neither `allowImportingTsExtensions` nor `rewriteRelativeImportExtensions` rewrites declaration specifiers; JavaScript output rewriting is separate.
//
// Each project is compiled twice with the same compiler and tsconfig: once
// from .vibe/.vibex sources and once from their .ts/.tsx twin. The package
// declarations must be byte-identical and spell every specifier as the twin
// does; the compatibility sidecar keeps the VibeLang source references.
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const dir = fileURLToPath(new URL(".", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))

const main = [
  'import type { A } from "./user.vibe"',
  'import type { B } from "./App.vibex"',
  'import type { A as C } from "./user.js"',
  'import type { B as D } from "./App.jsx"',
  'import type { A as E } from "./user"',
  'import type { F } from "./plain.ts"',
  "export type All = [A, B, C, D, E, F]",
  'export { a } from "./user.vibe"',
  'export { b } from "./App.vibex"',
  "",
].join("\n")
const twin = main.replace('"./user.vibe"', '"./user.ts"').replace('"./App.vibex"', '"./App.tsx"')
  .replace('{ a } from "./user.vibe"', '{ a } from "./user.ts"').replace('{ b } from "./App.vibex"', '{ b } from "./App.tsx"')
const declared = [
  'import type { A } from "./user.ts";',
  'import type { B } from "./App.tsx";',
  'import type { A as C } from "./user.js";',
  'import type { B as D } from "./App.jsx";',
  'import type { A as E } from "./user";',
  'import type { F } from "./plain.ts";',
  "export type All = [A, B, C, D, E, F];",
  'export { a } from "./user.ts";',
  'export { b } from "./App.tsx";',
  "",
].join("\n")
const user = 'export interface A { readonly a: string }\nexport const a: A = { a: "a" }\n'
const app = 'export interface B { readonly b: string }\nexport const b: B = { b: "b" }\n'
const plain = "export interface F { readonly f: string }\n"

const flags = {
  rewriteRelativeImportExtensions: { rewriteRelativeImportExtensions: true },
  allowImportingTsExtensions: { allowImportingTsExtensions: true, emitDeclarationOnly: true },
}

function compile(project, files, options) {
  rmSync(project, { recursive: true, force: true })
  mkdirSync(project, { recursive: true })
  for (const [name, text] of Object.entries(files)) writeFileSync(join(project, name), text)
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "Bundler", jsx: "preserve",
      strict: true, skipLibCheck: true, types: [], declaration: true, outDir: "out", ...options,
    },
    vibe: { effectGlobals: false, effectModules: false },
  }))
  const result = spawnSync(compiler, ["-p", project, "--pretty", "false"], { encoding: "utf8", timeout: 60000 })
  assert.ifError(result.error)
  assert.equal(result.status, 0, project + "\n" + result.stdout + result.stderr)
  return (name) => readFileSync(join(project, name), "utf8")
}

for (const [flag, options] of Object.entries(flags)) {
  const root = join(dir, "out", "fixtures", flag)
  const vibe = compile(join(root, "vibe"), { "main.vibe": main, "user.vibe": user, "App.vibex": app, "plain.ts": plain }, options)
  const ts = compile(join(root, "twin"), { "main.ts": twin, "user.ts": user, "App.tsx": app, "plain.ts": plain }, options)
  // Package declarations: the twin's text, byte for byte, under either flag.
  assert.equal(ts("out/main.d.ts"), declared, flag + ": stock declaration emit of the twin")
  assert.equal(vibe("out/main.d.ts"), ts("out/main.d.ts"), flag + ": main.d.ts differs from the twin's")
  assert.equal(vibe("out/user.d.ts"), ts("out/user.d.ts"), flag + ": user.d.ts")
  assert.equal(vibe("out/App.d.ts"), ts("out/App.d.ts"), flag + ": App.d.ts")
  // The compatibility sidecar keeps the source references.
  const sidecar = vibe("main.d.vibe.ts")
  for (const line of [
    'import type { A } from "./user.vibe";',
    'import type { B } from "./App.vibex";',
    'import type { A as C } from "./user.vibe";',
    'import type { A as E } from "./user.vibe";',
    'import type { F } from "./plain.ts";',
    'export { a } from "./user.vibe";',
    'export { b } from "./App.vibex";',
  ]) assert.ok(sidecar.split("\n").includes(line), flag + ": sidecar lacks " + line + "\n" + sidecar)
  assert.ok(!sidecar.includes('"./user.ts"') && !sidecar.includes('"./App.tsx"'), flag + ": sidecar names a twin\n" + sidecar)
  if (flag === "rewriteRelativeImportExtensions") {
    // JavaScript output rewriting is separate: the same re-exports run from .js files.
    const js = vibe("out/main.js")
    assert.ok(js.includes('from "./user.js"') && js.includes('from "./App.jsx"'), js)
    assert.equal(js, ts("out/main.js"), "main.js differs from the twin's")
  }
}
console.log("declaration specifiers follow the twin")
