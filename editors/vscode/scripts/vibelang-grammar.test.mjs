import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { createHighlighter } from "shiki"
import { addVibeLangSyntax } from "./vibelang-grammar.mjs"

// Exercise the generator through the same TextMate engine used by editors.
const grammar = addVibeLangSyntax(JSON.parse(readFileSync(new URL("../syntaxes/VibeLang.tmLanguage.json", import.meta.url), "utf8")))
const highlighter = await createHighlighter({ themes: ["github-light"], langs: [grammar, "typescript"] })
function keyword(source, word) {
  const { tokens } = highlighter.codeToTokens(source, { lang: "VibeLang", theme: "github-light", includeExplanation: "scopeName" })
  return tokens.flat().filter(t => t.content.trim() === word).some(t =>
    t.explanation?.some(e => e.scopes.some(s => s.scopeName === "keyword.control.flow.ts")))
}

test("fork remains an identifier before an in operator", () => {
  assert.equal(keyword("export const hit = fork in table;", "fork"), false)
  assert.equal(keyword("export const hit = fork work();", "fork"), true)
  assert.equal(keyword("export const hit = fork inspect();", "fork"), true)
})

test("join remains an identifier before TypeScript assertions and operators", () => {
  for (const operator of ["as any", "satisfies unknown", "in table", "instanceof Fiber"]) {
    assert.equal(keyword(`export const hit = join ${operator};`, "join"), false, operator)
  }
  assert.equal(keyword("export const hit = join fiber;", "join"), true)
  assert.equal(keyword("export const hit = join assigned;", "join"), true)
})

test("interruption blocks have contextual keyword scopes", () => {
  const source = "export function f() { uninterruptible { restore { } } interruptible { } }"
  for (const word of ["uninterruptible", "restore", "interruptible"]) {
    assert.equal(keyword(source, word), true, word)
    assert.equal(keyword(`export const x = ${word} + 1;`, word), false, word)
    assert.equal(keyword(`export const x = obj.${word};`, word), false, word)
  }
})

// The scopes of the first grammar token whose text is word. Shiki merges
// neighbors of one color, such as function and *, so read its explanation.
function scopes(source, word) {
  const { tokens } = highlighter.codeToTokens(source, { lang: "VibeLang", theme: "github-light", includeExplanation: "scopeName" })
  const part = tokens.flat().flatMap(t => t.explanation).find(e => e.content.trim() === word)
  assert.ok(part, `no token ${word} in ${source}`)
  return part.scopes.map(s => s.scopeName)
}
const has = (source, word, scope) => scopes(source, word).includes(scope)

test("effect declares functions where async does, generators included (VIP-1, VIP-21, VIP-39)", () => {
  for (const source of ["export effect function load(id: string) { return id }", "effect function load() { return 1 }", "effect function* load() { yield 1 }", "async function load(url: string) { return url }"]) {
    const modifier = source.includes("async") ? "async" : "effect"
    assert.ok(has(source, modifier, "storage.modifier.async.ts"), source)
    assert.ok(has(source, "load", "entity.name.function.ts"), source)
  }
  assert.ok(has("const f = effect function (id: string) { return id }", "effect", "storage.modifier.async.ts"))
  assert.ok(has("effect function* load() { yield 1 }", "*", "keyword.generator.asterisk.ts"))
})

test("effect methods, arrows and blocks take the modifier scope; effect stays a name elsewhere (VIP-1, VIP-2)", () => {
  const live = "const UsersLive = Layer.succeed(Users, { effect find(id: string) { return id } })"
  assert.ok(has(live, "effect", "storage.modifier.async.ts"))
  assert.ok(has(live, "find", "entity.name.function.ts"))
  assert.ok(has("class Live { effect find(id: string) { return id } }", "effect", "storage.modifier.async.ts"))
  assert.ok(has("const f = effect (x: number) => x", "effect", "storage.modifier.async.ts"))
  assert.ok(has("const p = effect { return 1 }", "effect", "storage.modifier.async.ts"))
  assert.ok(!has("const effect = 1", "effect", "storage.modifier.async.ts"))
  assert.ok(!has("const live = Layer.effect(Users, make)", "effect", "storage.modifier.async.ts"))
})

test("try runs an Effect in expression position, and try.all and its siblings are operations (VIP-5, VIP-18)", () => {
  assert.ok(has("const user = try getUser(id)", "try", "keyword.control.trycatch.ts"))
  assert.ok(has("return try load()", "try", "keyword.control.trycatch.ts"))
  for (const op of ["all", "race", "any", "allSettled"]) {
    const source = `const r = try.${op} [a(), b()]`
    assert.ok(has(source, "try", "keyword.control.flow.ts"), op)
    assert.ok(has(source, op, "keyword.control.flow.ts"), op)
  }
  assert.ok(!has("const tryAgain = 1", "tryAgain", "keyword.control.trycatch.ts"))
})

test("catch takes an effect handler (VIP-5)", () => {
  const source = "const h = load() catch effect (e) => match (e) { when NotFound: 1; default: throw e }"
  assert.ok(has(source, "catch", "keyword.control.trycatch.ts"))
  assert.ok(has(source, "effect", "storage.modifier.async.ts"))
  assert.ok(has("const g = load() catch effect { return 1 }", "effect", "storage.modifier.async.ts"))
})

test("fork has its in, scoped and detached forms (VIP-17)", () => {
  for (const form of ["in", "scoped", "detached"]) {
    const source = `const f = fork.${form}${form === "in" ? "(scope)" : ""} work()`
    assert.ok(has(source, "fork", "keyword.control.flow.ts"), form)
    assert.ok(has(source, form, "keyword.control.flow.ts"), form)
  }
})

test("for try and for concurrent are loops (VIP-19, VIP-20)", () => {
  assert.ok(has("for try (const x of stream) { }", "try", "keyword.control.loop.ts"))
  assert.ok(has("for concurrent(4) (const x of xs) { try f(x) }", "concurrent", "keyword.control.loop.ts"))
})

test("the Hack pipe and its topic (VIP-23)", () => {
  const source = "const r = load() |> retry(%, policy) |> timeout(%, \"1 second\")"
  assert.ok(has(source, "|>", "keyword.operator.pipe.ts"))
  assert.ok(has(source, "%", "variable.language.topic.ts"))
  assert.ok(has("const n = load() |> %.length", "%", "variable.language.topic.ts"))
  assert.ok(!has("const m = a % b", "%", "variable.language.topic.ts"))
})

test("provide lists layers and bindings, and declarations name their types (VIP-9, VIP-12, VIP-13, VIP-15, VIP-16, VIP-29)", () => {
  assert.ok(has("provide AppLive, Users = testUsers { try main() }", "provide", "keyword.control.with.ts"))
  assert.ok(has("service Users { find(id: string): User!NotFound }", "Users", "entity.name.type.class.ts"))
  assert.ok(has("error NotFound { id: string }", "NotFound", "entity.name.type.class.ts"))
  assert.ok(has("schema error FsError { method: string }", "FsError", "entity.name.type.class.ts"))
  assert.ok(has("schema User { id: string }", "User", "entity.name.type.class.ts"))
  assert.ok(has("data Delivery { Waiting; Sent { tracking: string } }", "Sent", "variable.other.enummember.ts"))
})
