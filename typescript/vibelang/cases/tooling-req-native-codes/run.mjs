// Native lexical, syntax and static errors in .vibe keep the TS codes stock
// TypeScript reports on the .ts twin, also when the erroneous native
// expression or type is embedded in a VibeLang production.
import assert from "node:assert/strict"
import { project, baseOptions } from "../_tooling-witness.mjs"

// Native snippets that stand alone in a module; the twin is the same text.
const lexicalAndSyntax = {
  unterminatedString: 'export const s = "abc\n',
  invalidCharacter: "export const s = 1 # 2;",
  unterminatedTemplate: "export const s = `abc",
  unterminatedComment: "export const s = 1; /* open",
  missingParen: "export const s = (1 + 2;",
  missingExpression: "export const s = ;",
  badBinding: "export const = 1;",
}
// Native expressions with one static error each.
const expressions = {
  assign: '((): number => "x")()',
  name: "missingName",
  call: '((n: number) => n)("x")',
  property: "({ a: 1 }).b",
  arity: "((n: number) => n)()",
}
// Native types with one static error each.
const types = { name: "MissingType", arity: "Array<number, string>", keyofValue: "keyof missingValue" }

// VibeLang productions that embed a native expression or type.
const expressionHosts = {
  effectBody: e => `export effect function f() { const v = ${e}; return 1 }`,
  tryOperand: e => `effect function g(n: unknown) { return n }\nexport effect function f() { return try g(${e}) }`,
  catchHandler: e => `export effect function f() { return Effect.fail("bad") catch (_e) => ${e} }`,
  matchArm: e => `export function f(x: number) { return match (x) { default: ${e}; } }`,
}
const typeHosts = {
  successSlot: t => `export type R = ${t}!never!never`,
  errorSlot: t => `export type R = number!${t}!never`,
  effectReturn: t => `export effect function f(): ${t}!! { return 1 as any }`,
  errorField: t => `export error Bad { readonly field: ${t} }`,
  serviceMember: (t, key) => `export service Users { static readonly key = "app/${key}"; readonly name: ${t} }`,
}

const header = 'import { Effect } from "effect"\n'
const cases = []
for (const [name, text] of Object.entries(lexicalAndSyntax)) cases.push({ name: "lex-" + name, vibe: text, ts: text })
for (const [host, wrap] of Object.entries(expressionHosts)) for (const [name, e] of Object.entries(expressions))
  cases.push({ name: host + "-" + name, vibe: header + wrap(e), ts: header + `export const v = ${e};` })
for (const [host, wrap] of Object.entries(typeHosts)) for (const [name, t] of Object.entries(types))
  cases.push({ name: host + "-" + name, vibe: header + wrap(t, name), ts: header + `export type R = ${t};` })

// byFile maps each file named in printed diagnostics to its sorted codes.
const byFile = (text, extension) => {
  const map = new Map()
  for (const m of text.matchAll(/^([\w-]+)\.(?:vibe|ts)\(\d+,\d+\): (error|warning) ((?:TS|EK)\d+):/gm)) {
    if (!map.has(m[1])) map.set(m[1], [])
    map.get(m[1]).push(m[2] + " " + m[3])
  }
  for (const list of map.values()) list.sort()
  return map
}

// tsc reports semantic errors only for a program without syntax errors, so
// the syntax group and the static group compile as separate projects.
const compare = group => project(({ put, invoke, stock }) => {
  for (const c of group) { put(c.name + ".vibe", c.vibe + "\n"); put("twin/" + c.name + ".ts", c.ts + "\n") }
  put("tsconfig.json", { compilerOptions: { ...baseOptions(), noEmit: true }, files: group.map(c => c.name + ".vibe") })
  put("twin/tsconfig.json", { compilerOptions: { ...baseOptions(), noEmit: true }, files: group.map(c => c.name + ".ts") })
  const vibe = byFile(invoke("-p", ".", "--pretty", "false").text)
  const twin = byFile(stock("-p", "twin", "--pretty", "false").text.replaceAll("twin/", ""))
  for (const c of group) {
    const expected = twin.get(c.name) ?? []
    // The twin really errs, and only with TypeScript errors.
    assert.ok(expected.length > 0 && expected.every(d => d.startsWith("error TS")), c.name + " twin: " + expected)
    assert.deepEqual(vibe.get(c.name) ?? [], expected, c.name)
  }
  return group.length
})
const syntax = cases.filter(c => c.name.startsWith("lex-"))
assert.equal(compare(syntax) + compare(cases.filter(c => !syntax.includes(c))), cases.length)
console.log("native lexical, syntax and static errors keep their TS codes, also embedded in VibeLang productions")
