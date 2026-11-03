import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import ts from "typescript"
import { chapter, read, nothrowFoldPending } from "./spec-witness.mjs"

// Will, 2026-10-31 ~14:00 PDT, recorded in core-decisions.md: "Plain functions are not allowed to throw I have said
// this about 15 times." Clarification: "If you throw in vibelang itself in a sync function that's an error." The
// assertions follow the owner rules as main states them (chapter 3, VIP-4, VIP-5, VIP-27, VIP-39, Appendix B).

const vip4 = () => read("docs/design/vips/0004-throw.md")
const failures = () => chapter("003-failures")
const plainSection = () => {
  const text = failures()
  return text.slice(text.indexOf("### Plain code never throws"), text.indexOf("## Throw expressions"))
}

// Parse each fence after projecting contextual Effect modifiers to TypeScript's async syntax. Replacing an
// ordinary identifier too is harmless: the parser only recognizes async as a modifier in modifier position.
// Positions map back to the original fence so reports and expected-error comments retain their source lines.
export function plainThrows(fence) {
  const { text, origins, expectedErrors } = typescriptFence(fence)
  const source = ts.createSourceFile("fence.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const lines = fence.split("\n")
  const found = new Set()
  function visit(node, allowed = false) {
    if (ts.isModuleDeclaration(node) && /^(?:export\s+)?module\b/.test(text.slice(node.getStart(source)))) return // VIP-40.
    if (ts.isThrowStatement(node)) {
      const offset = origins[node.getStart(source)]
      const lineIndex = fence.slice(0, offset).split("\n").length - 1
      if (!allowed && !expectedErrors.has(lineIndex)) found.add(lineIndex)
    }
    if (ts.isFunctionLike(node)) {
      const modifier = ts.getModifiers(node)?.find(m => m.kind === ts.SyntaxKind.AsyncKeyword)
      const effect = modifier && fence.slice(origins[modifier.getStart(source)]).startsWith("effect")
      const asyncParameters = modifier && !effect && !node.asteriskToken
      ts.forEachChild(node, child => {
        visit(child, child === node.body ? !!modifier : node.parameters?.includes(child) ? !!asyncParameters : allowed)
      })
      return
    }
    // Initializers and static blocks run outside a surrounding fiber, including a class declared in effect code.
    if (ts.isPropertyDeclaration(node) || ts.isClassStaticBlockDeclaration(node)) allowed = false
    ts.forEachChild(node, child => visit(child, allowed))
  }
  visit(source)
  return [...found].sort((a, b) => a - b).map(i => lines[i].trim())
}

function typescriptFence(fence) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, fence)
  const tokens = []
  const expectedErrors = new Set()
  const templates = []
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind === ts.SyntaxKind.TemplateHead) templates.push(0)
    else if (templates.length && kind === ts.SyntaxKind.OpenBraceToken) templates[templates.length - 1]++
    else if (templates.length && kind === ts.SyntaxKind.CloseBraceToken) {
      if (templates.at(-1) === 0) {
        kind = scanner.reScanTemplateToken(false)
        if (kind === ts.SyntaxKind.TemplateTail) templates.pop()
      } else templates[templates.length - 1]--
    }
    if (kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) {
      if (/EK0401|EK1010/.test(scanner.getTokenText())) {
        const start = fence.slice(0, scanner.getTokenPos()).split("\n").length - 1
        const end = fence.slice(0, scanner.getTextPos()).split("\n").length - 1
        for (let line = start; line <= end; line++) expectedErrors.add(line)
      }
    }
    if (kind <= ts.SyntaxKind.LastTriviaToken) continue
    tokens.push({ kind, start: scanner.getTokenPos(), end: scanner.getTextPos(), text: scanner.getTokenText() })
  }
  const replacements = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.text === "effect" && token.kind === ts.SyntaxKind.Identifier) {
      const block = tokens[i + 1]?.kind === ts.SyntaxKind.OpenBraceToken
        && !/[\r\n]/.test(fence.slice(token.end, tokens[i + 1].start))
        && ![ts.SyntaxKind.ClassKeyword, ts.SyntaxKind.InterfaceKeyword, ts.SyntaxKind.ModuleKeyword,
          ts.SyntaxKind.NamespaceKeyword, ts.SyntaxKind.EnumKeyword].includes(tokens[i - 1]?.kind)
      replacements.push({ ...token, text: block ? "async() =>" : "async " })
    }
    if (token.kind === ts.SyntaxKind.CatchKeyword) {
      // An expression handler is an arrow, not a TypeScript catch clause. Project only that operator to a comma;
      // preserve try/catch statements, whose parameters are followed by a block rather than an arrow.
      let j = i + 1
      if (tokens[j]?.text === "effect") j++
      if (tokens[j]?.kind !== ts.SyntaxKind.OpenParenToken) continue
      let depth = 0
      for (; j < tokens.length; j++) {
        if (tokens[j].kind === ts.SyntaxKind.OpenParenToken) depth++
        if (tokens[j].kind === ts.SyntaxKind.CloseParenToken && --depth === 0) break
      }
      if (tokens[j + 1]?.kind === ts.SyntaxKind.EqualsGreaterThanToken) replacements.push({ ...token, text: "," })
    }
  }
  let text = ""
  const origins = []
  let cursor = 0
  function append(value, start, width = value.length) {
    text += value
    for (let i = 0; i < value.length; i++) origins.push(start + Math.min(i, width - 1))
  }
  for (const replacement of replacements.sort((a, b) => a.start - b.start)) {
    append(fence.slice(cursor, replacement.start), cursor)
    append(replacement.text, replacement.start, replacement.end - replacement.start)
    cursor = replacement.end
  }
  append(fence.slice(cursor), cursor)
  return { text, origins, expectedErrors }
}

const fences = (text) => [...text.matchAll(/```vibe es\n([\s\S]*?)```/g)].map(m => m[1])

test("plainThrows tells a module body and effect code from a plain function (PREVIEW-17)", () => {
  const moduleBody = "module parse {\n  export function port(raw: string) {\n    const n = Number(raw)\n    if (n < 1) throw new RangeError(`bad port: ${raw}`)\n    return n\n  }\n}\nconst p = parse.port(\"80\")"
  assert.deepEqual(plainThrows(moduleBody), [])
  const plainFunction = "export function port(raw: string) {\n  const n = Number(raw)\n  if (n < 1) throw new RangeError(`bad port: ${raw}`)\n  return n\n}"
  assert.deepEqual(plainThrows(plainFunction), ["if (n < 1) throw new RangeError(`bad port: ${raw}`)"])
  assert.deepEqual(plainThrows("effect function f() {\n  if (!x) throw new Missing()\n}"), [])
  assert.deepEqual(plainThrows("async function f() {\n  throw new Error(\"x\")\n}"), [])
  assert.deepEqual(plainThrows("effect function f() {\n  return g() catch (e) => {\n    throw e\n  }\n}"), ["throw e"])
  assert.deepEqual(plainThrows("function f() { throw new Error(\"x\") } // EK0401"), [])
  assert.deepEqual(plainThrows("module m {\n  export function f() { return 1 }\n}\nfunction g() {\n  throw new Error(\"x\")\n}"), ["throw new Error(\"x\")"])
})

test("VIP-4 records plain functions never throw", () => {
  const text = vip4()
  assert.match(text, /\*\*Amended 2026-10-31: plain functions never throw \(Will\)\.\*\*/)
  assert.match(text, /`throw` in an `async` function rejects its Promise, as in TypeScript\./)
  assert.match(text, /`throw` in any other `\.vibe` code, or a call known to throw there outside the `try` block of a `try`\/`catch` statement, is `EK0401`\./)
  assert.match(text, /A `\.vibe` callable throws `never`: nothing is inferred from a body, and a written `@throws` or `@rethrows` in a `\.vibe` file is `EK0406`\./)
  assert.match(text, /function bad\(s\) \{ if \(!s\) throw new Error\("empty"\); return s \}\s+\/\/ EK0401/)
})

test("VIP-4's decision bullets no longer let a plain function throw or infer a .vibe thrown type", () => {
  const decision = vip4().split("## Prior art")[0]
  assert.doesNotMatch(decision, /in a plain or `async` function, `throw` is JavaScript's throw/)
  assert.doesNotMatch(decision, /A `\.vibe` function's throws are inferred from its body/)
  assert.doesNotMatch(decision, /A plain function may call a function that may throw, and then may throw itself/)
  assert.doesNotMatch(decision, /^- \*\*Amended 2026-10-29: plain functions may throw/m)
})

test("chapter 3 lists the quick fixes in the foldkit migration's order", () => {
  const section = plainSection()
  const fixes = section.slice(section.indexOf("Quick fixes, in order:"))
  const order = ["make the function `effect`", "make it `effect` and write `return try die(e)`", "move the code to a `.ts` file"].map(f => fixes.indexOf(f))
  assert.ok(order.every(i => i > 0) && order[0] < order[1] && order[1] < order[2], String(order))
  assert.match(fixes, /An exported function of a published package offers the `\.ts` fix first, because `effect` changes its declaration\./)
  assert.match(fixes, /A plain handler gets `x catch effect \(e\) => \{ throw e \}` and `x catch effect \(e\) => \{ return try die\(e\) \}`/)
})

test("VIP-5 makes a throw in a plain catch handler EK0401 and retires EK0511", () => {
  const text = read("docs/design/vips/0005-try-runs-effects.md")
  assert.match(text, /\*\*Amended 2026-10-31: a `throw` in a plain handler is `EK0401`\*\* \(VIP-4\)\. A call known to throw in its parameters or body is too\. The quick fix is `catch effect`/)
  assert.match(text, /The old lint warning `EK0511` retires\./)
})

test("chapter 3 makes throw and calls known to throw EK0401 in synchronous code outside effect code", () => {
  const text = failures()
  assert.doesNotMatch(text, /`throw` is allowed everywhere/)
  assert.match(text, /\| an `async` function, arrow or method, its parameter list included, an `async` generator's body, or an `async match` \| JavaScript's `throw`: the returned Promise rejects with `e` \|/)
  assert.match(text, /\| any other `\.vibe` code \| a compile error, `EK0401` \(\[Plain code never throws\]\(#plain-code-never-throws\)\) \|/)
  assert.match(text, /\| a `\.ts` or JavaScript file, or a `module` body \(VIP-40\) \| JavaScript's `throw`/)
  const section = plainSection()
  for (const construct of ["plain functions and arrows (one nested in effect code included)", "plain methods", "constructors", "accessors",
    "plain generators", "class field initializers", "`static` blocks", "every parameter list except an ordinary `async` function's",
    "plain `catch` handlers (parameters and body)", "the module top level"]) assert.ok(section.includes(construct), construct)
  assert.match(section, /A `throw` statement is `EK0401`, even when a `try` statement in the same function catches it\./)
  assert.match(section, /unless it sits in the `try` block of a `try` statement with a `catch` clause in the same function/)
  assert.match(section, /Its callee has a written `@throws \{T\}` other than `@throws \{never\}` \(`@throws \{unknown\}` included\)/)
  assert.match(section, /A call whose throwing is unknown, such as an unannotated `\.ts` function, stays an ordinary call/)
  assert.match(section, /A function nested in that literal is its own plain code\. A `throw` statement in the literal is still `EK0401`\./)
  assert.match(section, /function orNull\(s: string\) \{ try \{ return JSON\.parse\(s\) \} catch \{ return null \} \} \/\/ allowed/)
})

test("chapter 3's admission and try-block rules cover rest positions and do expressions", { skip: nothrowFoldPending }, () => {
  const section = plainSection()
  assert.match(section, /A `do` expression is not a function, so a call in a `do` block inside that `try` block, or a `try` statement inside a `do` block, follows the same rule\./)
  assert.match(section, /admits throws \(for a rest parameter, the element type or tuple member at the argument's position\)/)
})

test("chapter 3 infers no thrown type for VibeLang callables and has no EK0405", () => {
  const text = failures()
  assert.match(text, /A callable declared in VibeLang \(`\.vibe` or `\.vibex`, outside a `module` body\) has thrown type `never`\. Nothing is inferred from a body\./)
  assert.match(text, /A written `@throws` or `@rethrows` tag there, on a function, service member or function-type signature, is `EK0406`: remove it/)
  assert.doesNotMatch(text, /Otherwise infer a plain `\.vibe` function's uncaught throws/)
  assert.doesNotMatch(text, /least fixed point of their thrown types/)
  assert.doesNotMatch(text, /`EK0405`/)
})

test("chapters 1, 2, 3, 6 and the appendices show no plain throw outside effect, async and module code", () => {
  for (const name of ["001-functions", "002-running", "003-failures", "006-data", "900-appendices"]) {
    for (const fence of fences(chapter(name))) {
      for (const line of plainThrows(fence)) assert.fail(`${name}: a plain throw without EK0401: ${line}`)
    }
  }
})

test("chapter 2 makes a plain handler's throw EK0401 and retires the EK0511 warning", () => {
  const text = chapter("002-running")
  assert.doesNotMatch(text, /`EK0511` \(lint warning\)|VIP-38 lint warning \(`EK0511`\)/)
  assert.match(text, /\| `x catch \(e\) => \{ throw e \}` \| plain function \| a compile error, `EK0401`; write `x catch effect \(e\) => \{ throw e \}` \|/)
  assert.match(text, /\| a `throw` in a plain handler, or a call known to throw in its parameters or body; the old lint warning `EK0511` retires \| `EK0401` \|/)
  assert.match(text, /A `throw` inside is `EK0401`; write `catch effect \(e\) =>` to fail again, typed/)
  assert.match(text, /fetchUser\(id\) catch \(e\) => \{ try \{ throw e \} catch \{ return 0 \} \}\s+\/\/ EK0401: even when a try statement catches it/)
})

test("the introduction makes throw the exception to TypeScript's meaning", { skip: nothrowFoldPending }, () => {
  const text = chapter("000-intro")
  assert.doesNotMatch(text, /Plain functions, `async` functions, `await`, `throw`, `using`/)
  assert.match(text, /The exception is `throw`: synchronous VibeLang code never throws, so a `throw` outside effect code and `async` functions is a compile error, `EK0401`/)
  assert.match(text, /\| `throw e` in synchronous code outside effect code \| compile error `EK0401` \|/)
})

test("chapter 7 lists no EK0511 warning", () => {
  assert.doesNotMatch(chapter("007-tooling"), /\| `EK0511` \|/)
})

test("Appendix B widens EK0401 and EK0406, narrows EK0403 and retires EK0405 and EK0511", () => {
  const text = chapter("900-appendices")
  const b = text.slice(text.indexOf("## Appendix B. Diagnostics"), text.indexOf("## Appendix C"))
  assert.match(b, /\| `EK0401` \| a `throw`, or a call known to throw outside the `try` block of a `try`\/`catch` statement, in synchronous `\.vibe` code outside effect code; .* \| 4, 5 \|/)
  assert.match(b, /\| `EK0403` \| an unwrapped call, `new` expression, tagged template or class evaluation that may throw, in effect code \| 4 \|/)
  assert.match(b, /\| `EK0406` \| a `@throws` or `@rethrows` tag in `\.vibe` or `\.vibex` source outside a `module` body, including on a service member or function-type signature; quick fix: remove the tag \|/)
  assert.doesNotMatch(b, /^\| `EK0405` \|/m)
  assert.doesNotMatch(b, /^\| `EK0511` \|/m)
  assert.match(b, /The old `EK0511` is retired too: VIP-4 makes a `throw` in a plain `catch` handler the error `EK0401`\./)
})

test("Appendix E's .vibe examples carry no @throws or @rethrows outside a module body", () => {
  const text = chapter("900-appendices")
  const e = text.slice(text.indexOf("## Appendix E."))
  for (const fence of fences(e)) {
    const outside = fence.replace(/^\s*(export\s+)?module\s+[\w$]+\s*\{[\s\S]*?^\}/gm, "")
    assert.doesNotMatch(outside, /@throws|@rethrows/)
  }
})

// localDefinitionThrows reads only VIP-27's first example, the local VibeLang definition and its declaration. A
// foreign alias elsewhere in the VIP keeps its contract as written (PREVIEW-16).
export function localDefinitionThrows(vip27) {
  const example = vip27.slice(vip27.indexOf("```"), vip27.indexOf("```", vip27.indexOf("```") + 3) + 3)
  return [...example.matchAll(/@throws \{(?!never\})[^}]*\}|\bthrow\s/g)].map(m => m[0])
}

test("localDefinitionThrows ignores a foreign alias's preserved contract (PREVIEW-16)", () => {
  const fixture = "```vibe es\n// load.vibe\nexport function add(a: number, b: number) { return a + b }\n\n// load.d.vibe.ts\n/** @throws {never} */\nexport declare function add(a: number, b: number): number\n```\n\n## Details\n\nAn imported foreign contract as written:\n\n```ts\nexport declare const parse: { /** @throws {BadInput} */ (s: string): string }\n```\n"
  assert.deepEqual(localDefinitionThrows(fixture), [])
  assert.deepEqual(localDefinitionThrows(fixture.replace("/** @throws {never} */", "/** @throws {BadInput} */")), ["@throws {BadInput}"])
  assert.match(fixture, /@throws \{BadInput\}/)
})

test("VIP-27 emits @throws {never} for .vibe callables and VIP-39 components throw never", () => {
  const vip27 = read("docs/design/vips/0027-declaration-output.md")
  assert.deepEqual(localDefinitionThrows(vip27), [])
  assert.match(vip27, /A non-effectful exported function carries `@throws \{never\}`, because a `\.vibe` function can't throw \(VIP-4\)/)
  assert.match(vip27, /A re-exported foreign callable keeps its actual contract\./)
  const vip39 = read("docs/design/vips/0039-vibex.md")
  assert.doesNotMatch(vip39, /A component's `@throws` comes from its own body/)
  assert.match(vip39, /A `\.vibe` component's declaration carries `@throws \{never\}` \(VIP-27\)/)
})

test("the release notes describe a plain function's throw one way", () => {
  const notes = read("docs/user/src/setup/release-notes.md")
  assert.doesNotMatch(notes, /a plain function's `throw` is JavaScript's/)
  assert.match(notes, /a `throw` in a plain VibeLang function/)
})

test("user docs, the cheat sheet and SKILL.md say plain VibeLang code never throws", () => {
  const skill = read("packages/compiler/skills/vibelang/SKILL.md")
  assert.doesNotMatch(skill, /In a plain function, `throw` is JavaScript's/)
  assert.doesNotMatch(skill, /a `\.vibe` one's throws are inferred/)
  assert.match(skill, /Synchronous VibeLang code outside effect code never throws: a `throw` in a plain function, .* is a compile error/)
  assert.match(skill, /A `throw` inside a plain handler is a compile error \(write `catch effect`\)/)
  const expected = read("docs/user/src/error-management/014-expected-errors.md")
  assert.doesNotMatch(expected, /A plain function may throw, and its thrown type is inferred/)
  assert.match(expected, /A plain function can't throw: a `throw` there is `EK0401`/)
  assert.match(read("docs/user/src/vibelang-features/115-cheat-sheet.md"), /In a plain function it is `EK0401`: make the function `effect`, or move the code to a `\.ts` file\. In an `async` function it rejects the Promise\./)
  assert.doesNotMatch(read("docs/user/src/getting-started/005-creating-effects.md"), /VibeLang infers throws from non-effectful plain `\.vibe` functions/)
  assert.match(read("docs/user/src/setup/release-notes.md").split("\n## ")[1], /\*\*Language change:\*\* a `throw` in a plain VibeLang function/)
})

test("plainThrows recognizes effect only as a modifier (PREVIEW-18)", () => {
  for (const code of [
    "function f(effect: number) { throw effect }",
    "function f() { const effect = 1; throw effect }",
    "function f(obj: { effect: number }) { throw obj.effect }",
    "const f = (effect: number) => { throw effect }",
    "const o = { effect() { throw 1 } }",
    "class C { effect() { throw 1 } }",
    "effect function f() { function g() { throw 1 } }",
    "effect function f() { const g = () => { throw 1 } }",
    "effect function f() { const o = { g() { throw 1 } } }",
    "effect function f() { class C { g() { throw 1 } } }",
    "async function f() { function g() { throw 1 } }",
  ]) assert.equal(plainThrows(code).length, 1, code)
  for (const code of [
    "effect function f() { throw 1 }",
    "const f = effect () => { throw 1 }",
    "const o = { effect f() { throw 1 } }",
    "class C { effect f() { throw 1 } }",
    "const f = effect { throw 1 }",
    "async function f() { throw 1 }",
    "module m { function f(effect: number) { throw effect } }",
    'function f() { return "throw effect" } // throw effect',
  ]) assert.deepEqual(plainThrows(code), [], code)
})

test("plainThrows is invariant under parameter renaming (PREVIEW-18)", () => {
  fc.assert(fc.property(fc.integer(), fc.integer({ min: 0, max: 4 }), (n, indent) => {
    const body = " ".repeat(indent)
    const ordinary = `function f(value: number) {${body}throw value + ${n}}`
    const renamed = `function f(effect: number) {${body}throw effect + ${n}}`
    assert.equal(plainThrows(ordinary).length, 1)
    assert.equal(plainThrows(renamed).length, plainThrows(ordinary).length)
  }), { seed: 8818, numRuns: 100 })
})

test("plainThrows is invariant under nested-function line layout (PREVIEW-18)", () => {
  fc.assert(fc.property(fc.integer(), fc.integer({ min: 0, max: 4 }), (n, indent) => {
    const pad = " ".repeat(indent)
    const inline = `effect function f() {
${pad}function g() { throw ${n} }
}`
    const multiline = `effect function f() {
${pad}function g() {
${pad}  throw ${n}
${pad}}
}`
    assert.equal(plainThrows(multiline).length, 1)
    assert.equal(plainThrows(inline).length, plainThrows(multiline).length)
  }), { seed: 8818, numRuns: 100 })
})

test("plainThrows preserves templates, foreign modules and callable boundaries", () => {
  const witnesses = [
    ['const s = `raw ${1} effect throw`; effect function f() { throw 1 }', 0],
    ['const s = `raw ${1} effect throw`; function f() { throw 1 }', 1],
    ['effect function f() { const s = `a ${(() => { throw 1 })()}` }', 1],
    ['export module m { function f() { throw 1 } }', 0],
    ['namespace m { function f() { throw 1 } }', 1],
    ['class C { effect f() { const g = () => { throw 1 }; throw 2 } }', 1],
    ['effect function f() { return g() catch effect (e) => { throw e } }', 0],
    ['async function* f() { throw 1 }', 0],
    ['function* f() { throw 1 }', 1],
    ['function f() { try { throw 1 } catch {} }', 1],
    ['function f() { throw "EK0401" }', 1],
    ['function f() { throw "// EK0401" }', 1],
    ['function f() { throw 1 } /* EK0401 */', 0],
  ]
  for (const [code, expected] of witnesses) assert.equal(plainThrows(code).length, expected, code)
})
