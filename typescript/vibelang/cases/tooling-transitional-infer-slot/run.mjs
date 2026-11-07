// EK4857: an immediate written infer channel of an eligible Effect return
// annotation is an error (native TS1338 elsewhere); the repair writes the
// checker's channel types, removes the annotation only on an effect-marked
// callable whose channels are all infer, and keeps declaration types and Exits.
import assert from "node:assert/strict"
import { project, baseOptions } from "../_tooling-witness.mjs"

const at = text => text.split("\n").filter(line => /^\S+\(\d+,\d+\): (error|warning) /.test(line)).map(line => line.replace(/^(\S+?)\.(vibe|ts)\((\d+),\d+\): (\w+) (\w+):.*$/, "$1:$3 $4 $5"))
const source = `export function p(): Effect.Effect<number, infer E> { return Effect.succeed(1) }
export const a = (): number!(infer E) => Effect.succeed(1)
export class C { effect m(): Effect.Effect<number, infer E, never> { return 1 } }
export type F = () => Effect.Effect<number, infer E>
export function q(): number { return 1 }
export effect function all(id: string): infer A!infer E!infer R { if (id === "") throw "empty" as const; return id.length }
export effect function partial(id: string): number!infer E { if (id === "") throw "empty" as const; return 3 }
export function unmarked(): Effect.Effect<infer A, infer E, infer R> { return Effect.succeed(2) }
`
// Lines that stay TS1338 or have no written infer channel keep their text.
const repaired = {
  1: "export function p(): Effect.Effect<number, never> { return Effect.succeed(1) }",
  3: "export class C { effect m(): Effect.Effect<number, never, never> { return 1 } }",
  6: 'export effect function all(id: string) { if (id === "") throw "empty" as const; return id.length }',
  7: 'export effect function partial(id: string): number!"empty" { if (id === "") throw "empty" as const; return 3 }',
}
const observe = `import { Effect } from "effect"
const m = await import("./out/main.js")
const run = async e => { const x = await Effect.runPromiseExit(e); return x._tag === "Success" ? ["ok", x.value] : ["fail", x.cause.toJSON?.() ?? String(x.cause)] }
console.log(JSON.stringify([await run(m.p()), await run(new m.C().m()), await run(m.all("")), await run(m.all("abc")), await run(m.partial("")), await run(m.partial("x"))]))
`
const sameTypes = `import type * as Before from "./before/main.js"
import type * as After from "./out/main.js"
type Same<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false
export const p: Same<typeof Before.p, typeof After.p> = true
export const m: Same<Before.C["m"], After.C["m"]> = true
export const all: Same<typeof Before.all, typeof After.all> = true
export const partial: Same<typeof Before.partial, typeof After.partial> = true
export const unmarked: Same<typeof Before.unmarked, typeof After.unmarked> = true
`
for (const scope of [["--fix", "--fix-migration-only"], ["--fix"]]) {
  project(({ put, read, invoke, stock, run }) => {
    put("tsconfig.json", { compilerOptions: { ...baseOptions(), declaration: true }, include: ["main.vibe"] })
    put("main.vibe", source)
    put("observe.mjs", observe)
    const before = invoke("-p", ".", "--pretty", "false")
    const listed = at(before.text)
    // The source-position table of the legacy return-slot set, one row per line.
    assert.deepEqual(listed.filter(d => /EK4857|TS1338/.test(d)), [
      "main:1 error EK4857", "main:2 error TS1338", "main:3 error EK4857", "main:4 error TS1338",
      "main:6 error EK4857", "main:7 error EK4857", "main:8 error EK4857",
    ], before.text)
    put("before/main.d.ts", read("out/main.d.ts"))
    const exits = run(process.execPath, ["observe.mjs"])
    assert.equal(exits.status, 0, exits.text)

    const fixed = invoke(...scope, "-p", ".", "--pretty", "false")
    assert.ok(!at(fixed.text).some(d => d.endsWith("EK4857")), fixed.text)
    assert.deepEqual(at(fixed.text).filter(d => d.endsWith("TS1338")), ["main:2 error TS1338", "main:4 error TS1338"])
    const lines = read("main.vibe").split("\n"), original = source.split("\n")
    for (let i = 0; i < original.length; i++) {
      const written = repaired[i + 1]
      if (i + 1 === 8) continue
      if (written === undefined) assert.equal(lines[i], original[i], "line " + (i + 1))
      else if (scope.length === 2) assert.equal(lines[i], written, "line " + (i + 1))
      else assert.notEqual(lines[i], original[i], "line " + (i + 1))
    }
    // Every channel infer, but unmarked: the repair writes types and keeps the annotation.
    assert.match(lines[7], /^export function unmarked\(\): \S.* \{ return Effect\.succeed\(2\) \}$/)
    assert.doesNotMatch(lines[7], /infer/)
    // Ordinary --fix may restyle Effect.Effect as the shorthand, never the meaning.
    assert.doesNotMatch(lines[5], /\): /)
    assert.match(lines[6], /^export effect function partial\(id: string\): (number!"empty"|Effect\.Effect<number, "empty">) \{/)

    put("check/tsconfig.json", { compilerOptions: { strict: true, noEmit: true, types: [], skipLibCheck: true, module: "NodeNext", target: "ES2022" }, files: ["../same.ts"] })
    put("same.ts", sameTypes)
    const same = stock("-p", "check/tsconfig.json", "--pretty", "false")
    assert.equal(same.status, 0, same.text)
    const after = run(process.execPath, ["observe.mjs"])
    assert.equal(after.status, 0, after.text)
    assert.equal(after.stdout, exits.stdout)
  })
}
console.log("EK4857 is an error whose repair writes checker-proved channel types")
