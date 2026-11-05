import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import fc from "fast-check"
import { Linter } from "eslint"
import vibelang from "../../eslint.mjs"

function lint(source, rules = { "no-unreachable": "error" }) {
  return new Linter().verify(source, [{
    files: ["**/*.vibe"], languageOptions: { parser: vibelang }, rules,
  }], { filename: "concurrent.vibe" })
}

test("concurrent head bindings and following statements are reachable", () => {
  for (const limit of ["", "(2)", "(limit(1))"]) {
    for (const binding of ["const n", "let n", "const { n }", "const [n]"]) {
      for (const context of ["effect function f() { BODY }", "export const f = effect { BODY }"]) {
        const source = context.replace("BODY", `for concurrent${limit} (${binding} of items) { use(n) } after();`)
        assert.deepEqual(lint(source), [], source)
      }
    }
  }
})

test("concurrent projection preserves written unreachable statements", () => {
  for (const source of [
    "function f() { return 1; missing(); }",
    "effect function f() { for concurrent (const n of items) { if (n) { continue; missing(); } use(n) } after(); }",
    "effect function f() { for concurrent (const n of items) { use(n) } return; missing(); }",
  ]) {
    const messages = lint(source)
    assert.equal(messages.length, 1, JSON.stringify(messages) + "\n" + source)
    assert.equal(messages[0].ruleId, "no-unreachable")
    assert.equal(messages[0].column, source.indexOf("missing()") + 1)
  }
})

test("concurrent iterable closures retain the head scope while limits read the outer scope", () => {
  const source = "const n = 2; effect function f(items, use) { for concurrent(n) (const n of items(() => n)) { use(n) } } f([], x => x)"
  assert.deepEqual(lint(source, { "no-unused-vars": "error", "no-undef": "error" }), [])
  const unusedOuter = source.replace("concurrent(n)", "concurrent(2)")
  assert.deepEqual(lint(unusedOuter, { "no-unused-vars": "error" }).map(({ message }) => message), [
    "'n' is assigned a value but never used.",
  ])
})

const toolingRule = "linters, Knip, bundlers and test runners read `.vibe`"

test("concurrent reachability oracle quotes the tooling specification", () => {
  assert.ok(readFileSync(new URL("../../../../docs/design/src/007-tooling.md", import.meta.url), "utf8").includes(toolingRule))
})

test("t3code concurrent binding corpus remains reachable", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-concurrent-bindings.json", import.meta.url), "utf8"))
  for (const source of corpus.sources) assert.deepEqual(lint(source), [], source)
})

test("property: concurrent head scope bookkeeping never invents unreachable bindings", () => {
  fc.assert(fc.property(
    fc.constantFrom("", "(2)", "(limit(1))"),
    fc.constantFrom("const n", "let n", "const {n}", "const [n]", "let {x: n = 1}", "const [n, ...rest]"),
    fc.constantFrom(" ", "\n", "/* gap */"),
    fc.boolean(),
    (limit, binding, gap, dead) => {
      const tail = dead ? "return; missing();" : "after();"
      const source = `export const f = effect { for${gap}concurrent${limit} (${binding} of items) { use(n) } ${tail} }`
      const messages = lint(source)
      assert.equal(messages.length, dead ? 1 : 0, JSON.stringify(messages) + "\n" + source)
      if (dead) {
        assert.equal(messages[0].ruleId, "no-unreachable")
        assert.equal(messages[0].column, source.slice(source.lastIndexOf("\n") + 1).indexOf("missing()") + 1)
      }
    }
  ), { seed: 1906, numRuns: 120 })
})
