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
