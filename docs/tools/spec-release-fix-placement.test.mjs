import assert from "node:assert/strict"
import test from "node:test"
import {readFileSync} from "node:fs"
const notes=readFileSync(new URL("../user/src/setup/release-notes.md",import.meta.url),"utf8")
const fixes=[
  "- The platform guide put `Intl` in the web allowlist and suggested a nonexistent `Path.fromFileUrl` shortcut; it now identifies `Intl` as an ECMAScript global and shows access through the `Path.Path` service.",
  "- The pattern documentation omitted an `is` comparison and its binding scope; it now shows the Boolean test, explains block visibility and TDZ, and distinguishes skipped initialization from a later failed guard.",
  "- The declaration reference omitted diagnostic codes for direct default `schema` and `data` exports and for schema type parameters; it now assigns `EK1501`, `EK1603` and `EK1502` and shows named exports and generic factories as repairs.",
  "- The accepted schema example still gave writable source fields readonly TypeScript types; its counterpart now uses `Schema.mutableKey`, and the public schema VIPs record the conservative checks for conflicting referenced-schema modifiers.",
  "- The public service decision omitted the recursive `Shape` binding and outer-generic capture rule; it now records the private recursive alias, its type-only projection and the generic-service rejection for a shape that would specialize one key through erased outer type arguments.",
  "- The schema-error reference could admit a reserved `_tag` key hidden by a generic, enum or brand; it now requires proof over the runtime key domain and preserves the generated discriminant without a runtime guard.",
  "- The public pattern decision omitted the binding-cell lifetime rules; it now records shared `or` cells, fresh loop-condition cells and the initial `do` body's TDZ, with checked closure witnesses."
]
test("these fixes belong to the release after 0.0.11, rather than the published 0.0.11 history",()=>{
 const start=notes.indexOf("### Bugs fixed since 0.0.11\n")
 const end=notes.indexOf("### Bugs fixed since 0.0.10\n",start)
 assert.ok(start>=0&&end>start)
 const section=notes.slice(start,end)
 for(const fix of fixes){assert.ok(section.includes(fix),fix);assert.equal(notes.split(fix).length-1,1,fix)}
})
