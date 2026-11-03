import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import { Linter } from "eslint"
import tseslint from "typescript-eslint"
import vibelang from "../../eslint.mjs"

const filename = new URL("./effect-block.vibe", import.meta.url).pathname
const selector = "CallExpression[callee.property.name=/^catchCause/] > :matches(ArrowFunctionExpression, FunctionExpression)[params.length=0]"
const lint = (code) => new Linter({ configType: "flat", cwd: "/" }).verify(code, [{
  files: ["**/*.vibe"],
  languageOptions: { parser: vibelang },
  rules: {
    "no-restricted-syntax": ["error", { selector, message: "handler ignores the cause" }],
    "no-undef": "error",
    "no-unreachable": "error"
  }
}], { filename })

test("a program block is not a catchCause handler, and real handlers retain their arity", () => {
  fc.assert(fc.property(fc.integer({ min: -100, max: 100 }), fc.boolean(), (value, ignored) => {
    const handler = ignored ? "effect () => 0" : "effect (cause) => cause"
    const code = `import { Effect } from "effect"
export const p = Effect.catchCause(effect { return ${value} }, ${handler})`
    assert.deepEqual(lint(code).map(({ ruleId }) => ruleId), ignored ? ["no-restricted-syntax"] : [], code)
    const nativeHandler = ignored ? "() => Effect.succeed(0)" : "(cause) => Effect.succeed(cause)"
    const native = `import { Effect } from "effect"
export const p = Effect.catchCause(Effect.gen(function* () { return ${value} }), ${nativeHandler})`
    const nativeMessages = new Linter({ configType: "flat", cwd: "/" }).verify(native, [{
      files: ["**/*.ts"], languageOptions: { parser: tseslint.parser },
      rules: { "no-restricted-syntax": ["error", { selector, message: "handler ignores the cause" }] }
    }], { filename: filename.replace(/\.vibe$/, ".ts") })
    assert.deepEqual(lint(code).map(({ ruleId }) => ruleId), nativeMessages.map(({ ruleId }) => ruleId), native)

  }), { seed: 473, numRuns: 100 })
})

test("program blocks retain captures, nested function code paths, and undefined-name checks", () => {
  const code = `import { Effect } from "effect"
export function make(value) {
  const p = Effect.catchCause(effect { return value }, effect (cause) => cause)
  const q = effect { return missing }
  return { p, q }
}`
  assert.deepEqual(lint(code).map(({ ruleId, message }) => ({ ruleId, message })), [
    { ruleId: "no-undef", message: "'missing' is not defined." }
  ])
})

test("the minimized Smithers Egress program block does not trigger swallowedCause", () => {
  const code = readFileSync(new URL("./fixtures/smithers-catch-cause-effect-block.vibe", import.meta.url), "utf8")
  assert.deepEqual(lint(code), [])
})

test("synthetic builder references never read author bindings or hide missing source reads", () => {
  const lintUnused = (code) => new Linter({ configType: "flat", cwd: "/" }).verify(code, [{
    files: ["**/*.vibe"], languageOptions: { parser: vibelang },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: { "@typescript-eslint/no-unused-vars": "error", "no-undef": "error" }
  }], { filename })
  for (const name of ["$effect", "$try", "effect"]) {
    const unused = `const ${name} = 1; export const p = effect { return 2 }`
    assert.deepEqual(lintUnused(unused).map(({ ruleId }) => ruleId), ["@typescript-eslint/no-unused-vars"], unused)
    const used = `const ${name} = 1; export const p = effect { return ${name} }`
    assert.deepEqual(lintUnused(used), [], used)
  }
  assert.deepEqual(lintUnused("export const p = effect { return $effect }").map(({ ruleId, message }) => ({ ruleId, message })), [
    { ruleId: "no-undef", message: "'$effect' is not defined." }
  ])
})
