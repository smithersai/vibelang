import { expect, test } from "bun:test"
import { lint, loadSpec, rules, type Spec } from "./spec-lint"

const spec = loadSpec()
const rule = (name: string) => {
  const found = rules.find(r => r.name === name)
  if (!found) throw new Error(`no rule ${name}`)
  return [found]
}
// The specification with one file's text changed: `edit` gets the current text.
function withEdit(file: string, edit: (text: string) => string): Spec {
  const copy = new Map(spec)
  const before = copy.get(file)!
  const after = edit(before)
  if (after === before) throw new Error(`the edit to ${file} changed nothing`)
  copy.set(file, after)
  return copy
}
const insertAfter = (anchor: string, added: string) => (text: string) => {
  if (!text.includes(anchor)) throw new Error(`anchor not found: ${anchor}`)
  return text.replace(anchor, anchor + added)
}

test("the specification passes every rule", () => {
  expect(lint(spec).map(v => `${v.file}:${v.line} [${v.rule}] ${v.message}`)).toEqual([])
})

test("resolution-claims rejects round 14 OPUS-1's `./x.ts` to `x.vibe` sentence", () => {
  const defect = withEdit("src/007-tooling.md", insertAfter(
    "including `./helper.ts` ([VIP-27](../vips/0027-declaration-output.md#decision), amended).",
    " A relative `./x.ts` that resolves to `x.vibe`, as an import written before `x.ts` became `x.vibe` does, is checked and emitted as it is for `x.ts`: `rewriteRelativeImportExtensions` rewrites it to `./x.js`, and a declaration keeps `./x.ts`."
  ))
  expect(lint(defect, rule("resolution-claims")).map(v => v.message)).toEqual([
    expect.stringContaining("`./x.ts` resolving to `x.vibe` is not in VIP-39's resolution table")
  ])
})

test("resolution-claims accepts a claim the table lists and rejects a table that drifts from VIP-39", () => {
  const listed = withEdit("src/007-tooling.md", insertAfter("## JSX source files: `.vibex`\n", "\nA `./App.jsx` that resolves to `App.vibex` is checked as `.tsx`.\n"))
  expect(lint(listed, rule("resolution-claims"))).toEqual([])
  const drift = withEdit("src/007-tooling.md", text => text.replace("| `./App.vibe` | `App.vibe`, `App.d.ts` |", "| `./App.vibe` | `App.vibe`, `App.ts`, `App.d.ts` |"))
  expect(lint(drift, rule("resolution-claims")).map(v => v.message)).toEqual(["the resolution table differs from VIP-39's"])
})

const opus3 = "Root `vibelang.declarationImportStyle`, or `compilerOptions.vibelang.declarationImportStyle`, is `\".js\"` (the default), `\"extensionless\"` or `\".ts\"`. It decides how an emitted declaration spells a relative import of a `.vibe` module ([Declaration output](001-functions.md#declaration-output)). Any other value is a configuration error (`TS6046`). It sits in the legacy `vibelang` section with `trustedPackages` and `tracing`, so a child config's own `vibelang` section replaces an inherited one as a whole."

test("config-keys rejects round 14 OPUS-3's paragraph: a second path, two keys and a TypeScript code with no VIP", () => {
  const defect = withEdit("src/007-tooling.md", text => text.replace(/^Root `vibelang\.declarationImportStyle`.*$/m, opus3))
  expect(lint(defect, rule("config-keys")).map(v => v.message)).toEqual([
    "`compilerOptions.vibelang.declarationImportStyle` appears in no accepted VIP",
    "a VibeLang configuration error is given TypeScript's `TS6046`",
    "`vibelang.trustedPackages` appears in no accepted VIP",
    "`vibelang.tracing` appears in no accepted VIP"
  ])
})

test("config-keys rejects a chapter key once no accepted VIP publishes it", () => {
  const unpublished: Spec = new Map([...spec].map(([file, text]) =>
    [file, file.startsWith("vips/") ? text.replaceAll("vibelang.declarationImportStyle", "vibelang.removed") : text]))
  expect(lint(unpublished, rule("config-keys")).map(v => v.message)).toContain("`vibelang.declarationImportStyle` appears in no accepted VIP")
  expect(lint(spec, rule("config-keys"))).toEqual([])
})

test("declaration-import-style-scope rejects round 14 ASTRA-1's unscoped option and missing VIP-27 amendment", () => {
  const astra1 = "A package whose sources spell relative imports another way keeps that spelling with the project setting `vibelang.declarationImportStyle`: `\"extensionless\"` declares `./user`, `\".ts\"` declares `./user.ts`, and `\".js\"` is the default."
  const defect: Spec = new Map(spec)
  defect.set("src/001-functions.md", spec.get("src/001-functions.md")!.replace(/A package whose sources spell relative imports another way[^\n]*?is the default\.[^\n]*?(?= Under every setting)/, astra1))
  defect.set("vips/0027-declaration-output.md", spec.get("vips/0027-declaration-output.md")!.replace(/\n- \*\*Amended 2026-11-02: declaration import spelling\.\*\*[^\n]*\n/, "\n"))
  expect(defect.get("src/001-functions.md")).not.toBe(spec.get("src/001-functions.md"))
  // The `.vibex` half of the rule (OPUS-5) also fires on this bullet; this test is about sidecars.
  expect(lint(defect, rule("declaration-import-style-scope")).map(v => `${v.file} ${v.message}`).filter(m => !m.includes(".vibex"))).toEqual([
    "src/001-functions.md a paragraph naming `declarationImportStyle` does not say that source-adjacent sidecars keep their spelling",
    "vips/0027-declaration-output.md the VIP does not publish `vibelang.declarationImportStyle`, as decided detail 263 asks"
  ])
})

test("declaration-import-style-scope rejects round 14 OPUS-5's `.vibe`-only declaration spelling", () => {
  const defect = withEdit("src/007-tooling.md", text => text.replace(/(It decides how a package declaration in the output directory spells a relative import of a `\.vibe`)[^(]*( module)/, "$1$2").replace(/ A relative `\.\/x\.vibex` [^\n]*?(?= It sits in the legacy)/, ""))
  expect(lint(defect, rule("declaration-import-style-scope")).map(v => `${v.file}:${v.line} ${v.message}`)).toEqual([
    expect.stringMatching(/^src\/007-tooling\.md:\d+ a chapter paragraph naming `declarationImportStyle` states no rule for a `\.\/x\.vibex` import$/)
  ])
})

test("declaration-import-form rejects round 14 OPUS-4's `import type` beside `import` for the same added import", () => {
  const defect = withEdit("src/001-functions.md", text => text
    .replace("each root module as `import { Effect, Stream } from \"effect\"`", "each root module as `import type { Effect, Stream } from \"effect\"`")
    .replace("// load.d.vibe.ts\nimport { Effect, Stream } from \"effect\"", "// load.d.vibe.ts\nimport type { Effect, Stream } from \"effect\""))
  expect(lint(defect, rule("declaration-import-form")).map(v => v.message)).toEqual([
    expect.stringContaining("`import type { Effect, Stream } from \"effect\"` disagrees"),
    expect.stringContaining("`import type { Effect, Stream } from \"effect\"` disagrees")
  ])
})
