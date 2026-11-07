// run-seconds: 300
// A throw expression with a JSX operand is allowed exactly where a throw
// statement is: each synchronous VibeLang site reports EK0401 for both, and an
// effect body admits both.
// rule-evidence: docs/design/vips/0039-vibex.md#670260082f1173ac
// "It is allowed where a throw statement is: synchronous VibeLang code cannot throw, so a throw expression there is `EK0401` (VIP-4, amended 2026-10-31)."
import assert from "node:assert/strict"
import { project, check, codes } from "../../tests/coverage-tooling.mjs"

const prelude = [
  "export error Missing { id: string }",
  "declare global { namespace JSX { type Element = Missing; interface IntrinsicElements { missing: { id: string } } } }",
  "declare function h(tag: \"missing\", props: { id: string }): Missing",
  "declare function find(id: string): string | undefined",
].join("\n") + "\n"
const expression = "find(id) ?? throw <missing id={id} />"
const statement = "{ const found = find(id); if (found === undefined) throw <missing id={id} />; return found }"
// [site, body for a throw expression, body for a throw statement, rejected]
const sites = [
  ["plain function", `export function f(id: string) { return ${expression} }`, `export function f(id: string) ${statement}`, true],
  ["plain arrow", `export const f = (id: string) => ${expression}`, `export const f = (id: string) => ${statement}`, true],
  ["plain method", `export class C { f(id: string) { return ${expression} } }`, `export class C { f(id: string) ${statement} }`, true],
  ["plain callback in an effect", `export effect function f(id: string) { return [id].map((id) => ${expression}) }`, `export effect function f(id: string) { return [id].map((id) => ${statement}) }`, true],
  ["eager parameter default", `export effect function f(id: string, value: string = ${expression}) { return value }`, `export effect function f(id: string, value: string = (() => ${statement})()) { return value }`, true],
  ["effect function", `export effect function f(id: string) { return ${expression} }`, `export effect function f(id: string) ${statement}`, false],
  ["effect arrow", `export const f = effect (id: string) => ${expression}`, `export const f = effect (id: string) => ${statement}`, false],
]
const compilerOptions = { jsx: "react", jsxFactory: "h", noEmit: true }
let cells = 0
for (const [site, withExpression, withStatement, rejected] of sites) {
  const results = [withExpression, withStatement].map((body, i) => {
    const key = site.replace(/ /g, "-") + (i ? "-statement" : "-expression")
    const p = project(import.meta.url, key, { "main.vibex": prelude + body + "\n" }, { compilerOptions })
    return check(p)
  })
  const [fromExpression, fromStatement] = results.map(r => codes(r.output))
  assert.deepEqual(fromExpression, rejected ? ["EK0401"] : [], site + "\n" + results[0].output)
  assert.deepEqual(fromExpression, fromStatement, site + ": the throw statement decides the expression\n" + results[1].output)
  cells++
}
assert.equal(cells, sites.length)
console.log("vibex throw expressions follow throw statements")
