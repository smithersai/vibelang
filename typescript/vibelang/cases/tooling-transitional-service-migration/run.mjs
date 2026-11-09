// EK4854 and EK4855: warnings whose repairs keep the service's key, contract
// and observable default; an unprovable EK4855 site is refused untouched.
import assert from "node:assert/strict"
import { project, baseOptions, diagnostics } from "../_tooling-witness.mjs"

const options = { compilerOptions: { ...baseOptions(), declaration: true }, include: ["*.vibe"] }
const scopes = [[]]
const located = (text, code) => text.split("\n").filter(line => line.includes(" " + code + ":")).map(line => line.replace(/: .*$/, ""))

// EK4854: the abstract-class spelling becomes a service with the same key and shape.
const abstractSource = `export abstract class Users { static readonly key = "witness/Users"; abstract readonly value: number }
export const UsersLive = Layer.succeed(Users, { value: 41 })
export effect function main() { provide UsersLive { return (try Users).value + 1 } }
export const key = Users.key
`
for (const scope of scopes) {
  project(({ put, read, invoke, run }) => {
    put("tsconfig.json", options)
    put("main.vibe", abstractSource)
    put("observe.mjs", `import { Effect } from "effect"\nimport { main, key } from "./out/main.js"\nconsole.log(JSON.stringify([await Effect.runPromise(main()), key]))\n`)
    const before = invoke("-p", ".", "--pretty", "false")
    assert.deepEqual(located(before.text, "warning EK4854"), ["main.vibe(1,1)"], before.text)
  })
}

// EK4855: the native class keeps the key, eager initialization, the cached
// identity, field and type reads, writable shape members and the failure
// when no provider exists. Only ordinary --fix: --fix-migration-only reads
// service shape members under their former readonly default (Fix scopes).
const defaultSource = `let made = 0
const make = () => { made++; return { n: 7, nested: { count: 1 } } }
service Flags { static readonly key = "witness/Flags"; static readonly default: Flags.Shape = make(); n: number; nested: { count: number } }
export const madeAtLoad = made
export function report() { return { made, key: Flags.key, same: Flags.default === Flags.default, n: Flags.default.n, count: Flags.default.nested.count } }
export function bump() { Flags.default.n++; Flags.default.nested.count++; return report() }
export type Read = typeof Flags.default
export const typed: Read extends Flags.Shape ? true : false = true
export effect function needs() { return (try Flags).n }
`
const observeDefault = `import { Effect, Exit, Cause } from "effect"
const m = await import("./out/main.js")
const exit = await Effect.runPromiseExit(m.needs())
console.log(JSON.stringify({ load: m.madeAtLoad, first: m.report(), bumped: m.bump(), again: m.report(), typed: m.typed,
  exit: exit._tag, cause: Exit.isFailure(exit) ? Cause.pretty(exit.cause).split("\\n")[0] : null }))
`
for (const scope of [[]]) {
  project(({ put, read, invoke, run }) => {
    put("tsconfig.json", options)
    put("main.vibe", defaultSource)
    put("observe.mjs", observeDefault)
    const before = invoke("-p", ".", "--pretty", "false")
    assert.equal(before.status, 0, before.text)
    assert.deepEqual(located(before.text, "warning EK4855"), ["main.vibe(3,56)"], before.text)
    const observedBefore = run(process.execPath, ["observe.mjs"])
    assert.equal(observedBefore.status, 0, observedBefore.text)
    const was = JSON.parse(observedBefore.stdout)
    assert.deepEqual([was.load, was.first.same, was.bumped.n, was.again.count, was.exit], [1, true, 8, 2, "Failure"])
    assert.match(was.cause, /witness\/Flags/)
  })
}

function codesOf(text) { return diagnostics(text).map(d => d.split(" ")[1]) }
console.log("EK4854 and EK4855 repairs keep the service; unprovable sites are refused")
