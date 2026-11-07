// run-seconds: 300
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK1702` | `fork` or `join` as an `effect` function or producer expression's own name, or as a variable, parameter or label name in effect code, in the parameters of an `effect` function, arrow, method or producer, or in a plain or `async` arrow head inheriting that reservation, including one in an Effect callable's parameters; the arrow body has its own context; or a reserved `fork` or `join` as a shorthand property, `{ join }` | 17 | [Running Effects](002-running.md#fork-and-join) |
// Each reserved position reports its own EK1702: an effect function
// expression's name, a local, a label, effect function, arrow and method
// parameters, plain and async arrow heads in effect code (also in a default),
// a shorthand property and a destructured parameter binding.
import assert from "node:assert/strict"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { withProject } from "../_appb-retirement-helpers.mjs"
const here = dirname(fileURLToPath(import.meta.url))
const source = "export const named = effect function fork() { return 1 }\nexport const named2 = effect function join() { return 1 }\nexport effect function local() { const fork = 1; return 1 }\nexport effect function label() { join: for (const x of [1]) { break join } }\nexport effect function param(join: number) { return 1 }\nexport const arrowParam = effect (fork: number) => 1\nexport class C { effect method(join: number) { return 1 } }\nexport const obj = { effect method(fork: number) { return 1 } }\nexport effect function plainArrowHead() { const k = (join: number) => 1; return k }\nexport effect function asyncArrowHead() { const k = async (fork: number) => 1; return k }\nexport effect function defaultHead(g = (join: number) => 1) { return g }\nexport effect function shorthand() { const v = 1; return { join } }\nexport effect function destructured({ fork }: { fork: number }) { return 1 }\n"
const want = [
  "main.vibe(1,38): error EK1702",
  "main.vibe(2,39): error EK1702",
  "main.vibe(3,40): error EK1702",
  "main.vibe(4,34): error EK1702",
  "main.vibe(5,30): error EK1702",
  "main.vibe(6,35): error EK1702",
  "main.vibe(7,32): error EK1702",
  "main.vibe(8,36): error EK1702",
  "main.vibe(9,54): error EK1702",
  "main.vibe(10,60): error EK1702",
  "main.vibe(11,41): error EK1702",
  "main.vibe(12,60): error EK1702",
  "main.vibe(13,39): error EK1702"
]
withProject(here, { "main.vibe": source }, ({ tsc }) => {
  const got = tsc().text.split("\n").map((line) => /\bmain\.vibe\(\d+,\d+\): (?:error|warning) [A-Z]+\d+/.exec(line)?.[0]).filter(Boolean)
  assert.deepEqual(got, want)
  console.log("EK1702 reported at " + got.length + " reserved positions")
})
