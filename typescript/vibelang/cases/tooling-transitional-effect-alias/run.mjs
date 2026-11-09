// EK4856: the retired global Effect alias warns, its repair writes the
// shorthand or Effect.Effect without new parentheses, keeps written slots and
// parentheses, leaves declarations byte-identical, ignores local and imported
// types named Effect, and refuses where the Effect namespace is shadowed.
import assert from "node:assert/strict"
import { project, baseOptions, diagnostics } from "../_tooling-witness.mjs"

const options = { compilerOptions: { ...baseOptions(), declaration: true }, include: ["*.vibe", "*.ts"] }
const at = text => text.split("\n").filter(line => /^\S+\(\d+,\d+\): (error|warning) /.test(line)).map(line => line.replace(/^(\S+?)\.(vibe|ts)\((\d+,\d+)\): (\w+) (\w+):.*$/, "$1($3) $4 $5"))

// [legacy spelling, migration-only repair]
const positions = [
  ["export let v: Effect<number>", "export let v: number!!"],
  ["export let e: Effect<string, Error>", "export let e: string!Error"],
  ["export let d: Effect<string, never>", "export let d: string!never"],
  ["export let n: Effect<string, never, never>", "export let n: string!never!never"],
  ["export let p: (Effect<number>)", "export let p: (Effect.Effect<number>)"],
  ["export let a: Effect<number, Error>[]", "export let a: Effect.Effect<number, Error>[]"],
  ["export let u: Effect<number | string>", "export let u: Effect.Effect<number | string>"],
  ["export let m: Effect<number> | undefined", "export let m: Effect.Effect<number> | undefined"],
  ["export let f: () => Effect<number, Error>", "export let f: () => number!Error"],
  ["export let r: readonly Effect<number>[]", "export let r: readonly Effect.Effect<number>[]"],
  ["export let g: Array<Effect<number>>", "export let g: Array<number!!>"],
  ["export interface I extends Effect<number> {}", "export interface I extends Effect.Effect<number> {}"],
  ["export type Out<T> = T extends Effect<infer A> ? A : never", "export type Out<T> = T extends Effect.Effect<infer A> ? A : never"],
]
const source = positions.map(([legacy]) => legacy).join("\n") + "\n"
for (const scope of [[], []]) {
  project(({ put, read, invoke }) => {
    put("tsconfig.json", options)
    put("main.vibe", source)
    const before = invoke("-p", ".", "--pretty", "false")
    assert.equal(before.status, 0, before.text)
    assert.deepEqual(at(before.text), positions.map((_, i) => `main(${i + 1},${positions[i][0].indexOf("Effect<") + 1}) warning EK4856`))
    const declarations = read("out/main.d.ts")
    assert.equal((declarations.match(/Effect\.Effect</g) ?? []).length, positions.length)
  })
}

// Local and imported types named Effect keep their TypeScript meaning: no
// EK4856, the stock diagnostics of the .ts twin, and no rewrite.
const selection = {
  local: "type Effect<A> = { value: A }\nexport const local: Effect<number> = { value: 1 }\n",
  imported: 'import type { Effect } from "./types.js"\nexport const imported: Effect<number> = { box: 1 }\n',
  namespace: "namespace Effect { export type Effect<A> = { inner: A } }\nexport let s: Effect<number> | undefined\n",
  parameter: "export function id<Effect>(x: Effect): Effect { return x }\n",
}
const types = "export interface Effect<A> { box: A }\n"
const expected = []
project(({ put, stock }) => {
  put("tsconfig.json", { compilerOptions: { ...baseOptions(), noEmit: true }, include: ["*.ts"] })
  put("types.ts", types)
  for (const [name, text] of Object.entries(selection)) put(name + ".ts", text)
  expected.push(...at(stock("-p", ".", "--pretty", "false").text))
})
assert.deepEqual(expected, ["namespace(2,15) error TS2709"])
for (const scope of [[], []]) {
  project(({ put, read, invoke }) => {
    put("tsconfig.json", { compilerOptions: { ...baseOptions(), noEmit: true }, include: ["*.vibe", "*.ts"] })
    put("types.ts", types)
    for (const [name, text] of Object.entries(selection)) put(name + ".vibe", text)
    assert.deepEqual(at(invoke("-p", ".", "--pretty", "false").text), expected)
  })
}

// The legacy alias under a shadowing Effect namespace: the warning explains
// why no repair applies, and neither scope edits the file.
const shadowed = `export namespace N {
  export namespace Effect { export const z = 1 }
  export let u: Effect<number | string> | undefined
}
export let outer: Effect<number> | undefined
`
for (const scope of [[], []]) {
  project(({ put, read, invoke }) => {
    put("tsconfig.json", { compilerOptions: { ...baseOptions(), noEmit: true }, include: ["*.vibe"] })
    put("main.vibe", shadowed)
    const before = invoke("-p", ".", "--pretty", "false")
    assert.deepEqual(at(before.text), ["main(3,17) warning EK4856", "main(5,19) warning EK4856"])
    assert.match(before.text, /main\.vibe\(3,17\): warning EK4856: [^\n]*\n  The Effect namespace is shadowed here/)
  })
}
console.log("EK4856 repairs the resolved legacy alias only, and refuses under a shadowed namespace")
