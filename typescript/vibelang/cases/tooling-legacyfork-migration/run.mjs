// Chapter 7, Legacy fork, try-statement and wire migration: vibelang --fix
// writes fork effect { … } for a bare fork block and leaves explicit Effect
// operands alone; rewrites each try statement in effect code (EK0503) into
// explicit Effect combinators; and replaces the resolved wire intrinsic with
// Layer.provideMerge composition while a local wire keeps its meaning. Each
// repair keeps what the program computes.
import assert from "node:assert/strict"
import { project, baseOptions, diagnostics } from "../_tooling-witness.mjs"

const options = { ...baseOptions(), declaration: true }
const lines = text => [...text.matchAll(/^(\w+\.vibe)\((\d+),\d+\): (error|warning) ((?:EK|TS)\d+)/gm)].map(m => `${m[1]}:${m[2]} ${m[3]} ${m[4]}`)

// Fork blocks and wire: both legacy forms still compile, so the repaired
// program must print what the legacy one printed.
const forks = `const events: string[] = []
effect function child(): number!! { events.push("call"); return 3 }
export effect function forks() {
  const a = fork { events.push("block"); return 1 }
  const b = fork {
    events.push("multi")
    return 2
  }
  const c = fork effect { events.push("written"); return 10 }
  const d = fork child()
  const e = fork Effect.succeed(100)
  const total = (try Fiber.join(a)) + (try Fiber.join(b)) + (try Fiber.join(c)) + (try Fiber.join(d)) + (try Fiber.join(e))
  return events.sort().join(",") + ":" + total
}
`
const forksFixed = forks.replace("fork { events.push(\"block\")", "fork effect { events.push(\"block\")").replace("const b = fork {", "const b = fork effect {")
const wire = `service A { static readonly key = "tooling/legacy-wire/A"; read(): number!! }
service B { static readonly key = "tooling/legacy-wire/B"; read(): number!! }
const ALive = Layer.succeed(A, { effect read() { return 7 } })
const BLive = Layer.effect(B, effect { const a = try A; return { effect read() { return (try a.read()) + 1 } } })
export const Live = wire(ALive, BLive)
export effect function both() { return (try (try A).read()) * 100 + (try (try B).read()) }
`
const local = `const wire = (a: number, b: number) => a + b
export const sum = wire(1, 2)
`
const runner = `import { Effect } from "effect"
import { forks } from "./forks.js"
import { both, Live } from "./wire.js"
import { sum } from "./local.js"
console.log(JSON.stringify({ forks: await Effect.runPromise(forks()), both: await Effect.runPromise(Effect.provide(both(), Live)), sum }))
`
project(({ put, read, invoke, stock, run }) => {
  put("tsconfig.json", { compilerOptions: options, files: ["forks.vibe", "wire.vibe", "local.vibe"] })
  put("forks.vibe", forks)
  put("wire.vibe", wire)
  put("local.vibe", local)
  assert.deepEqual(lines(invoke("-p", ".", "--pretty", "false").text), [], "legacy forms compile")
  put("out/run.mjs", runner)
  const before = run(process.execPath, ["out/run.mjs"])
  assert.equal(before.status, 0, before.text)
  assert.deepEqual(JSON.parse(before.stdout), { forks: "block,call,multi,written:116", both: 708, sum: 3 })
  // The local wire keeps its TypeScript meaning: the .ts twin checks alike.
  put("tsconfig.json", { compilerOptions: { ...options, noEmit: true }, files: ["local.ts"] })
  put("local.ts", local)
  assert.deepEqual(diagnostics(stock("-p", ".", "--pretty", "false").text), [])
  assert.deepEqual(diagnostics(invoke("-p", ".", "--pretty", "false").text), [])
})

// Try statements in effect code: each reports EK0503 at its try, the fix
// writes Effect combinators, and the program computes what JavaScript's
// try statement semantics give. A try statement in a plain function is not
// effect code and stays.
const statements = `error Bad
effect function boom(): number!Bad { throw new Bad() }
export effect function caught(): number!never {
  try {
    return try boom()
  } catch (e) {
    return 7
  }
}
const log: string[] = []
export effect function all(): string!never {
  try {
    log.push("body")
    try boom()
    log.push("unreached")
  } catch (e) {
    log.push("caught")
  } finally {
    log.push("cleanup")
  }
  return log.join(",")
}
export effect function fallthrough(): number!never {
  let n = 0
  try {
    n = 1
  } finally {
    n += 2
  }
  return n
}
const order: string[] = []
export effect function early(): string!never {
  const value = do {
    try {
      order.push("body")
      return "early:" + order.join(",")
    } finally {
      order.push("cleanup")
    }
  }
  return value
}
export function plain(): number {
  let n = 0
  try {
    n = 4
  } finally {
    n += 1
  }
  return n
}
`
const tryRunner = `import { Effect } from "effect"
import * as m from "./statements.js"
console.log(JSON.stringify({ caught: await Effect.runPromise(m.caught()), all: await Effect.runPromise(m.all()), fallthrough: await Effect.runPromise(m.fallthrough()), early: await Effect.runPromise(m.early()), plain: m.plain() }))
`
project(({ put, read, invoke, run }) => {
  put("tsconfig.json", { compilerOptions: options, files: ["statements.vibe"] })
  put("statements.vibe", statements)
  const tries = statements.split("\n").flatMap((l, i) => /^\s*try \{$/.test(l) ? [i + 1] : [])
  const plainTry = tries.find(n => n > statements.split("\n").findIndex(l => l.startsWith("export function plain")))
  assert.deepEqual(lines(invoke("-p", ".", "--pretty", "false").text), tries.filter(n => n !== plainTry).map(n => `statements.vibe:${n} error EK0503`))
})
console.log("legacy fork, try-statement and wire migration: repairs preserve results")
