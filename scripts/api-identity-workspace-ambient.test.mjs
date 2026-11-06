// A frozen original tree reaches a workspace package as source; the candidate
// tree reaches its declaration. Their ambient contributions must still pair.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"

const ts = loadTypeScript()
const form = "export interface Form {\n  readonly hidden?: boolean | undefined;\n}\n"
const block = 'declare module "base" {\n  namespace Annotations {\n    interface Annotations {\n      /** Shown in the form. */\n      readonly form?: Form | undefined;\n    }\n  }\n}\n'
const settings = "export interface Settings {\n  readonly name: string;\n}\n"
const source = (parts = {}) => (parts.form ?? form) + (parts.block ?? block) + settings + "export const helper = (): number => 1;\n"
const declaration = (parts = {}) => (parts.form ?? form).replaceAll("  ", "    ") + (parts.block ?? block) + settings + "/** @throws {never} */\nexport declare const helper: () => number;\n"

function put(root, file, text) {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

function tree(root, file, text) {
  put(root, "node_modules/base/package.json", JSON.stringify({ name: "base", version: "1.0.0", types: "index.d.ts" }))
  put(root, "node_modules/base/index.d.ts", "export declare namespace Annotations {\n  interface Annotations {\n    readonly title?: string;\n  }\n}\n")
  put(root, "packages/contracts/package.json", JSON.stringify({ name: "@x/contracts", version: "0.0.0", types: file }))
  put(root, join("packages/contracts", file), text)
  put(root, "packages/importer/package.json", JSON.stringify({ name: "importer", type: "module", types: "./index.d.ts", exports: { ".": "./index.d.ts" } }))
  put(root, "packages/importer/index.d.ts", 'import type { Settings } from "@x/contracts";\nexport declare const settings: Settings;\n')
  put(root, "packages/importer/tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [], target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", skipLibCheck: true }, files: ["index.d.ts"] }))
  mkdirSync(join(root, "packages/importer/node_modules/@x"), { recursive: true })
  symlinkSync("../../../contracts", join(root, "packages/importer/node_modules/@x/contracts"), "dir")
}

function compare(after = declaration()) {
  const root = mkdtempSync(join(tmpdir(), "api-identity-workspace-ambient-"))
  try {
    tree(join(root, "repo"), "src/settings.ts", source())
    tree(root, "src/settings.d.ts", after)
    return compareApiIdentity(ts, join(root, "repo/packages/importer"), join(root, "packages/importer"), {})
  } finally { rmSync(root, { recursive: true, force: true }) }
}

const refused = (result, start) => {
  assert.equal(result.comparisonComplete, false, JSON.stringify(result))
  assert.ok(result.environmentDiagnostics.some(d => d.diagnostic.startsWith(start)), JSON.stringify(result))
}

test("a workspace package's ambient block pairs across source and declaration", () => {
  const result = compare()
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, true, JSON.stringify(result))
})

test("a changed ambient block refuses", () => {
  refused(compare(declaration({ block: block.replace("Form | undefined", "string | undefined") })), "Ambient declaration closures differ")
})

test("a changed comment in an ambient block refuses", () => {
  refused(compare(declaration({ block: block.replace("Shown in the form", "Hidden from the form") })), "Ambient declaration closures differ")
})

test("a changed local declaration the block reaches refuses", () => {
  refused(compare(declaration({ form: form.replace("boolean", "string") })), "Ambient declaration closures differ")
})

function compareOwned(after) {
  const root = mkdtempSync(join(tmpdir(), "api-identity-owned-ambient-"))
  try {
    for (const [side, text] of [["before", settingsDeclaration], ["after", after]]) {
      const dir = join(root, side)
      put(dir, "node_modules/base/package.json", JSON.stringify({ name: "base", version: "1.0.0", types: "index.d.ts" }))
      put(dir, "node_modules/base/index.d.ts", "export declare namespace Annotations {\n  interface Annotations {\n    readonly title?: string;\n  }\n}\n")
      put(dir, "package.json", JSON.stringify({ name: "contracts", type: "module", types: "./settings.d.ts", exports: { ".": "./settings.d.ts" } }))
      put(dir, "settings.d.ts", text)
      put(dir, "tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [], target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", skipLibCheck: true }, files: ["settings.d.ts"] }))
    }
    return compareApiIdentity(ts, join(root, "before"), join(root, "after"), {})
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const settingsDeclaration = form + block + 'export declare function helper(): number;\n'

test("a snapshot's own ambient block pairs across other syntax that keeps the API", () => {
  const result = compareOwned(form + block + "declare function helper(): number;\nexport { helper };\n")
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, true, JSON.stringify(result))
})

test("a snapshot's changed ambient block refuses", () => {
  refused(compareOwned(form + block.replace("Form | undefined", "string | undefined") + "/** @throws {never} */\nexport declare function helper(): number;\n"), "Ambient declaration closures differ")
})
