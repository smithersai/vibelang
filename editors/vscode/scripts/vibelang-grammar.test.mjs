import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { createHighlighter } from "shiki"
import { addVibeLangSyntax } from "./vibelang-grammar.mjs"

// Exercise the generator through the same TextMate engine used by editors.
const grammar = addVibeLangSyntax(JSON.parse(readFileSync(new URL("../syntaxes/VibeLang.tmLanguage.json", import.meta.url), "utf8")))
// Shiki computes scopes and colors in separate passes. Its 500 ms default
// can truncate one cold pass on a loaded build host, leaving explanations
// misaligned. Keep a bounded budget and report early termination explicitly.
function tokenize(highlighter, source, options) {
  const budget = 10_000
  const grammar = highlighter.getLanguage(options.lang)
  let stack
  for (const line of source.split(/\r?\n/)) {
    const start = performance.now()
    const result = grammar.tokenizeLine(line, stack, budget)
    assert.equal(result.stoppedEarly, false,
      "TextMate scope pass stopped early: lang=" + options.lang +
      " chars=" + line.length + " elapsed_ms=" + Math.round(performance.now() - start) +
      " budget_ms=" + budget)
    stack = result.ruleStack
  }
  return highlighter.codeToTokens(source, { ...options, tokenizeTimeLimit: budget })
}

const highlighter = await createHighlighter({ themes: ["github-light"], langs: [grammar, "typescript"] })
function keyword(source, word) {
  const { tokens } = tokenize(highlighter, source, { lang: "VibeLang", theme: "github-light", includeExplanation: "scopeName" })
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
  const { tokens } = tokenize(highlighter, source, { lang: "VibeLang", theme: "github-light", includeExplanation: "scopeName" })
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
  assert.ok(has("task FetchIssues { effect call(repo: string): number!string { return 1 } }", "FetchIssues", "entity.name.type.class.ts"))
  assert.ok(has("export workflow Triage { effect call(repo: string) { return 1 } }", "Triage", "entity.name.type.class.ts"))
  assert.ok(has("task FetchIssues { effect call(repo: string): number!string { return 1 } }", "task", "storage.type.class.ts"))
  assert.ok(!has("task as Job", "task", "storage.type.class.ts"))
  // No VIP adds layer declarations or the service class spelling.
  assert.ok(!has("layer UsersLive: Users { }", "layer", "storage.type.class.ts"))
  assert.ok(!has("service class Users { }", "class", "storage.type.class.ts"))
  assert.ok(has("error NotFound { id: string }", "NotFound", "entity.name.type.class.ts"))
  assert.ok(has("schema error FsError { method: string }", "FsError", "entity.name.type.class.ts"))
  assert.ok(has("schema User { id: string }", "User", "entity.name.type.class.ts"))
  assert.ok(has("data Delivery { Waiting; Sent { tracking: string } }", "Sent", "variable.other.enummember.ts"))
})


// VIP-39: JSX is TypeScript JSX; VibeLang forms apply inside containers.
test("VIP-39: .vibex uses TSX scopes and confines VibeLang forms to code", async () => {
  const jsx = JSON.parse(readFileSync(new URL("../syntaxes/VibeLangReact.tmLanguage.json", import.meta.url), "utf8"))
  assert.equal(jsx.scopeName, "source.vibex")
  const h = await createHighlighter({ themes: ["github-light"], langs: [jsx, "typescript"] })
  try {
    const parts = source => tokenize(h, source, { lang: jsx.name, theme: "github-light", includeExplanation: "scopeName" })
      .tokens.flat().flatMap(t => t.explanation)
    const code = "const view = <Box title={effect () => { return try load() }}>{value |> f(%)}</Box>"
    const tokens = parts(code)
    for (const [word, scope] of [["Box", "entity.name.tag.tsx"], ["effect", "storage.modifier.async.tsx"], ["try", "keyword.control.trycatch.ts"], ["|>", "keyword.operator.pipe.ts"], ["%", "variable.language.topic.ts"]]) {
      assert.ok(tokens.some(t => t.content.trim() === word && t.scopes.some(s => s.scopeName === scope)), word + ": " + JSON.stringify(tokens))
    }
    for (const source of ['const v = <p>effect try match fork join % ! |&gt; &amp;</p>', 'const v = <p title="effect try match fork join % !"/>']) {
      assert.ok(!parts(source).some(t => t.scopes.some(s => /(?:\.ts$|^storage\.modifier\.async\.tsx$)/.test(s.scopeName))), source)
    }
  } finally { h.dispose() }
})

test("VIP-39: generated JSX words stay literal while container expressions get scopes", async () => {
  const jsx = JSON.parse(readFileSync(new URL("../syntaxes/VibeLangReact.tmLanguage.json", import.meta.url), "utf8"))
  const h = await createHighlighter({ themes: ["github-light"], langs: [jsx, "typescript"] })
  try {
    await checkProperty(fc, {
      name: "vibex-textmate-containers",
      rule: "VIP-39: Tag names, attribute names, attribute strings and JSX text are JSX's alone.",
      command: "node --test scripts/vibelang-grammar.test.mjs",
      numRuns: 75,
      arbitrary: fc.record({
        tag: fc.constantFrom("Box", "UI.Box", "p", "match", "try", "effect", "fork"),
        text: fc.constantFrom("try effect fork join match", "50% ! |&gt;", "// text &amp;", "hello 世界"),
        form: fc.constantFrom(["try load()", "try", "keyword.control.trycatch.ts"], ["value |> f(%)", "|>", "keyword.operator.pipe.ts"], ["effect () => 1", "effect", "storage.modifier.async.tsx"]),
        fragment: fc.boolean()
      }),
      check({ tag, text, form: [expression, word, scope], fragment }) {
        const element = '<' + tag + ' title="effect try % !">' + text + '{' + expression + '}</' + tag + '>'
        const source = "const v = " + (fragment ? "<>" + element + "</>" : element)
        const tokens = tokenize(h, source, { lang: jsx.name, theme: "github-light", includeExplanation: "scopeName" }).tokens.flat().flatMap(t => t.explanation)
        const relevant = tokens.filter(t => t.scopes.some(s => s.scopeName === scope))
        assert.ok(relevant.some(t => t.content.trim() === word), source)
        const vibeTokens = tokens.filter(t => t.scopes.some(s => /(?:\.ts$|^storage\.modifier\.async\.tsx$)/.test(s.scopeName)))
        assert.ok(vibeTokens.every(t => t.scopes.some(s => s.scopeName === "meta.embedded.expression.tsx")), JSON.stringify(vibeTokens))
      }
    })
  } finally { h.dispose() }
})

test("VIP-39: the extension registers the JSX grammar and its JSDoc injection", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  assert.deepEqual(pkg.contributes.languages.find(l => l.id === "vibex").extensions, [".vibex"])
  const grammar = pkg.contributes.grammars.find(g => g.language === "vibex")
  assert.equal(grammar.scopeName, "source.vibex")
  assert.equal(grammar.path, "./syntaxes/VibeLangReact.tmLanguage.json")
  const injection = pkg.contributes.grammars.find(g => g.scopeName === "documentation.injection.vibex")
  assert.deepEqual(injection.injectTo, ["source.vibex"])
  const text = readFileSync(new URL("../syntaxes/jsdoc.vibex.injection.tmLanguage.json", import.meta.url), "utf8")
  assert.ok(text.includes("source.vibex#docblock"))
  assert.ok(!text.includes("source.ts#docblock"))
})

test("VIP-39: Zed settings associate .vibex with TSX and the configured server", () => {
  for (const file of ["../../README.md", "../../../docs/user/src/setup/zed.md"]) {
    const text = readFileSync(new URL(file, import.meta.url), "utf8")
    const blocks = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map(m => JSON.parse(m[1]))
    const settings = blocks.find(b => b.file_types)
    assert.deepEqual(settings.file_types.TSX, ["vibex"])
    assert.ok(settings.languages.TSX.language_servers.includes("vtsls"))
  }
})

test("VIP-39: the literal-text oracle quotes the accepted rule", () => {
  const spec = readFileSync(new URL("../../../docs/design/vips/0039-vibex.md", import.meta.url), "utf8")
  assert.ok(spec.includes("Tag names, attribute names, attribute strings and JSX text are JSX's alone."))
})
