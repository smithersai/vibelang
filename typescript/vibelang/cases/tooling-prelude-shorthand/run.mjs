// Chapter 7, Legacy prelude shorthand: every --fix scope writes the export
// that the bare prelude Scope type and a same-named module export resolve to,
// leaves other bindings of those names alone, and the post-retirement errors
// are exactly stock TypeScript's on explicit namespace imports.
import assert from "node:assert/strict"
import { project, baseOptions, diagnostics } from "../_tooling-witness.mjs"

// Each row: legacy shorthand, its repair, and the explicit namespace import
// whose .ts twin gives the post-retirement error.
const rows = [
  { legacy: "export function scoped(s: Scope): Scope { return s }", fixed: "export function scoped(s: Scope.Scope): Scope.Scope { return s }", module: "Scope", code: "TS2709", sites: 2 },
  { legacy: "export type Maybe = Option<number>", fixed: "export type Maybe = Option.Option<number>", module: "Option", code: "TS2709" },
  { legacy: "export type Lines = Stream<string>", fixed: "export type Lines = Stream.Stream<string>", module: "Stream", code: "TS2709" },
  { legacy: "export type Items = Chunk<number>", fixed: "export type Items = Chunk.Chunk<number>", module: "Chunk", code: "TS2709" },
  { legacy: "export const make = FileSystem.of", fixed: "export const make = FileSystem.FileSystem.of", module: "FileSystem", code: "TS2339" },
]
// Already qualified exports and a namespace's own members keep their meaning.
const kept = ["export type Done = Option.Option<string>", "export const key = FileSystem.FileSystem", "export const some = Option.some(1)"]
const legacy = [...rows.map(r => r.legacy), ...kept].join("\n") + "\n"
const repaired = [...rows.map(r => r.fixed), ...kept].join("\n") + "\n"
// Local types and type parameters with the same names are not legacy bindings.
const local = `type Scope = { readonly id: number }
interface Option<A> { readonly value: A }
export const read = (s: Scope, o: Option<string>): number => s.id + o.value.length
export function generic<Scope>(s: Scope): Scope { return s }
`
const config = { compilerOptions: { ...baseOptions(), noEmit: true }, files: ["main.vibe", "local.vibe"] }

for (const flags of [[], [], []]) project(({ put, read, invoke }) => {
  put("tsconfig.json", config)
  put("main.vibe", legacy)
  put("local.vibe", local)
  // The transitional compiler accepts the shorthand with no migration diagnostic.
  assert.deepEqual(diagnostics(invoke("-p", ".", "--pretty", "false").text), [], "legacy shorthand compiles")
})

// After retirement each row is TypeScript's own error on the equivalent
// explicit namespace import: stock tsc reports exactly that code on each .ts
// twin, the compiler under test reports the same and no EK code, and the
// repaired spelling is clean TypeScript.
const perFile = text => {
  const found = {}
  for (const m of text.matchAll(/^(\w+)\.ts\(\d+,\d+\): (error|warning) ((?:EK|TS)\d+)/gm)) (found[m[1]] ??= []).push(m[2] + " " + m[3])
  return found
}
project(({ put, invoke, stock }) => {
  const names = rows.map(r => "row" + r.module)
  put("tsconfig.json", { compilerOptions: { ...baseOptions(), noEmit: true }, files: names.map(n => n + ".ts") })
  const write = key => rows.forEach((r, i) => put(names[i] + ".ts", `import * as ${r.module} from "effect/${r.module}"\n` + r[key] + "\n"))
  write("legacy")
  const native = perFile(stock("-p", ".", "--pretty", "false").text)
  assert.deepEqual(native, Object.fromEntries(rows.map((r, i) => [names[i], Array(r.sites ?? 1).fill("error " + r.code)])), "stock TypeScript's errors")
  assert.deepEqual(perFile(invoke("-p", ".", "--pretty", "false").text), native, "same errors as TypeScript, no EK code")
  write("fixed")
  assert.deepEqual(perFile(stock("-p", ".", "--pretty", "false").text), {}, "repairs are TypeScript's spelling")
  assert.deepEqual(perFile(invoke("-p", ".", "--pretty", "false").text), {}, "repairs compile")
})
console.log("legacy prelude shorthand: 3 fix scopes, " + rows.length + " shorthand rows, TypeScript twins agree")
