import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { parseESTree } from "../../packages/compiler/eslint.mjs"
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

// Parse the source grammar with the compiler, including do expressions, effect modifiers and foreign modules.
// ESTree ranges and tokens refer to the original UTF-16 source offsets; no TypeScript projection or recovery.
export function plainThrows(fence) {
  if (!/\bthrow\b/.test(fence)) return []
  const source = parseESTree(fence, "nothrow-fence.vibe")
  const lines = fence.split("\n")
  const lineAt = offset => fence.slice(0, offset).split("\n").length - 1
  const expectedErrors = new Set()
  for (const comment of source.comments) {
    if (/EK0401|EK1010/.test(comment.value)) {
      for (let line = lineAt(comment.range[0]); line <= lineAt(comment.range[1]); line++) expectedErrors.add(line)
    }
  }
  const tokens = source.tokens
  const writtenThrows = new Set(tokens.filter(t => t.type === "Keyword" && t.value === "throw").map(t => t.range[0]))
  const tokenAt = offset => tokens.find(t => t.range[0] >= offset)
  const found = new Set()
  function visit(node, allowed = false, parent) {
    if (!node || typeof node !== "object" || !node.type) return
    if (node.type === "VibeModuleDeclaration") return // VIP-40: foreign TypeScript.
    if (node.type === "ThrowStatement" && writtenThrows.has(node.range[0])) {
      const line = lineAt(node.range[0])
      if (!allowed && !expectedErrors.has(line)) found.add(line)
    }
    const callable = ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)
    // do/match lowering introduces arrows with no written => header. They retain the source activation.
    // An effect block and an async match introduce their own activation even without a written arrow.
    const first = callable && tokenAt(node.range[0])?.value
    const writtenArrow = callable && tokens.some(t => t.range[0] >= node.range[0]
      && t.range[1] <= node.body.range[0] && t.value === "=>")
    const transparent = node.type === "ArrowFunctionExpression" && !writtenArrow && first !== "effect" && !node.async
    if (callable && !transparent) {
      const method = parent && ["Property", "MethodDefinition"].includes(parent.type) && parent.value === node
      const effect = method
        ? tokens.some(t => t.range[0] >= parent.range[0] && t.range[1] <= parent.key.range[0] && t.value === "effect")
        : tokenAt(node.range[0])?.value === "effect"
      visit(node.body, effect || node.async, node)
      for (const parameter of node.params) visit(parameter, node.async && !node.generator && !effect, node)
      return
    }
    if (["PropertyDefinition", "StaticBlock"].includes(node.type)) allowed = false
    for (const [key, value] of Object.entries(node)) {
      if (["tokens", "comments"].includes(key)) continue
      if (Array.isArray(value)) for (const child of value) visit(child, allowed, node)
      else visit(value, allowed, node)
    }
  }
  visit(source)
  return [...found].sort((a, b) => a - b).map(i => lines[i].trim())
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

test("plainThrows keeps regex literals opaque in the native parser", () => {
  fc.assert(fc.property(fc.constantFrom('/"/', '/[{}]/', '/effect/'), fc.integer(), (regex, value) => {
    const prefix = `const pattern = ${regex}; `
    assert.equal(plainThrows(prefix + `effect function f() { throw ${value} }`).length, 0)
    assert.equal(plainThrows(prefix + `function f() { throw ${value} }`).length, 1)
  }), { seed: 8818, numRuns: 100 })
})

test("plainThrows preserves async defaults containing do expressions (PREVIEW-19)", () => {
  fc.assert(fc.property(fc.integer(), fc.integer({ min: 0, max: 4 }), (n, indent) => {
    const pad = " ".repeat(indent)
    const source = `export async function f(flag: boolean, x = do {\n${pad}if (flag) throw ${n};\n${pad}0\n}) { return x }`
    assert.deepEqual(plainThrows(source), [])
  }), { seed: 9419, numRuns: 100 })
})

test("plainThrows keeps do defaults transparent but nested callables independent", () => {
  for (const [prefix, count] of [["async", 0], ["effect", 1], ["", 1], ["async function*", 1]]) {
    const head = prefix.includes("function") ? prefix : `${prefix} function`
    assert.equal(plainThrows(`${head} f(flag: boolean, x = do { if (flag) throw 1; 0 }) { return x }`).length, count)
  }
  assert.equal(plainThrows("async function f(x = do { const g = () => { throw 1 }; 0 }) {}").length, 1)
  assert.equal(plainThrows("effect function f() { const x = do { if (flag) throw 1; 0 } }").length, 0)
  assert.equal(plainThrows("async function f() { const x = do { const g = () => { throw 1 }; 0 } }").length, 1)
})

test("plainThrows preserves match lowering and rejects source callbacks inside it", () => {
  for (const [modifier, count] of [["effect", 0], ["async", 0], ["", 1]]) {
    assert.equal(plainThrows(`${modifier} function f(x) { return match (x) { default: throw 1 } }`).length, count)
  }
  assert.equal(plainThrows("effect function f(x) { return match (x) { default: (() => { throw 1 })() } }").length, 1)
  assert.equal(plainThrows("effect function f(x) { return match (x) { default: do { throw 1; 0 } } }").length, 0)
})

test("plainThrows refuses an invalid parse instead of trusting a recovered tree", () => {
  assert.throws(() => plainThrows("function f( { throw 1 }"), SyntaxError)
})

test("plainThrows ignores typed-catch fallback rethrows regardless of unrelated source (PREVIEW-21)", () => {
  fc.assert(fc.property(fc.integer(), fc.constantFrom(" ", "\n  "), (value, layout) => {
    const source = `error Tagged {}\ndeclare function g(): unknown;\nfunction f() { try { g() } catch (e: Tagged) {${layout}} }`
    assert.deepEqual(plainThrows(source), [])
    assert.deepEqual(plainThrows(source + `\nasync function h() { throw ${value} }`), [])
    assert.equal(plainThrows(source.replace(`{${layout}} }`, `{${layout}throw e } }`)).length, 1)
  }), { seed: 9821, numRuns: 100 })
})

test("plainThrows checks source throw expressions as well as statements", () => {
  assert.equal(plainThrows("function f(x: number | undefined) { return x ?? throw 1 }").length, 1)
  assert.deepEqual(plainThrows("effect function f(x: number | undefined) { return x ?? throw 1 }"), [])
  assert.deepEqual(plainThrows("async function f(x: number | undefined) { return x ?? throw 1 }"), [])
})
