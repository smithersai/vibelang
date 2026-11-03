import assert from "node:assert/strict"
import { test } from "node:test"
import { chapter, read } from "./spec-witness.mjs"

// Will, 2026-10-31 ~14:00 PDT, recorded in core-decisions.md: "Plain functions are not allowed to throw I have said
// this about 15 times." Clarification: "If you throw in vibelang itself in a sync function that's an error." The
// rule replaces VIP-4's 2026-10-29 "plain functions may throw"; decided detail 251 keeps `async` as TypeScript.

const vip4 = () => read("docs/design/vips/0004-throw.md")

test("VIP-4 records plain functions never throw and supersedes plain functions may throw", () => {
  const text = vip4()
  assert.match(text, /\*\*Amended 2026-10-31: plain functions never throw\.\*\* This replaces the 2026-10-29 amendment's "plain functions may throw"\./)
  assert.match(text, /~~plain functions may throw~~ \*\(superseded 2026-10-31 by "plain functions never throw", below\)\*/)
  assert.match(text, /A `throw` statement in synchronous VibeLang code outside effect code is `EK0401`/)
  assert.match(text, /In an `async` function `throw` keeps JavaScript's meaning and rejects the Promise \(decided detail 251\)/)
  assert.match(text, /Every VibeLang callable has thrown type `never`/)
  assert.match(text, /"Plain functions are not allowed to throw I have said this about 15 times\."/)
  // Spec agent correction, 2026-10-31 21:50 UTC: a known-throwing call can't leave a `try` block that has a `catch`.
  assert.match(text, /A call in the `try` block of a `try` statement that has a `catch` clause, in the same function, is allowed/)
  assert.match(text, /`function f\(s\) \{ try \{ return JSON\.parse\(s\) \} catch \{ return null \} \}` compiles\. A call in the `catch` or `finally` block is the error\./)
})

test("VIP-4's decision bullets no longer let a plain function throw or infer a .vibe thrown type", () => {
  const decision = vip4().split("## Prior art")[0]
  assert.doesNotMatch(decision, /in a plain or `async` function, `throw` is JavaScript's throw/)
  assert.doesNotMatch(decision, /A `\.vibe` function's throws are inferred from its body/)
  assert.doesNotMatch(decision, /A plain function may call a function that may throw, and then may throw itself/)
  assert.match(decision, /function check\(s\) \{ if \(!s\) throw new Error\("empty"\) \}\s+\/\/ error EK0401/)
  for (const name of ["recursion", "a written `@throws`", "possible default callbacks", "synchronous call phases"]) {
    const line = decision.split("\n").find(l => l.includes(`Amended 2026-10-${name === "possible default callbacks" || name === "synchronous call phases" ? "30" : "29"}: ${name}`))
    assert.ok(line, name)
    assert.match(line, /Superseded 2026-10-31 by "plain functions never throw"/, name)
  }
})

test("VIP-4's quick fixes keep the order of the foldkit migration", () => {
  const text = vip4()
  const fixes = text.slice(text.indexOf("Quick fixes, in order:"))
  const order = ["make the function `effect`", "`return try die(e)`", "move the code to a `.ts` file"].map(f => fixes.indexOf(f))
  assert.ok(order.every(i => i > 0) && order[0] < order[1] && order[1] < order[2], String(order))
  assert.match(fixes, /For an exported function of a published package, "move to a `\.ts` file and re-export it" comes first, because `effect` changes its public declaration/)
})

test("VIP-5 makes a throw in a plain catch handler EK0401 and retires EK0511", () => {
  const text = read("docs/design/vips/0005-try-runs-effects.md")
  assert.match(text, /\*\*Amended 2026-10-31: plain handlers never throw\.\*\*/)
  assert.match(text, /A `throw` statement anywhere in a plain handler \(its parameters, defaults and body, caught inside it or not\) is `EK0401`/)
  assert.match(text, /and so is a call there known to throw, unless it sits in the `try` block of a `try` statement with a `catch` clause inside the handler/)
  assert.match(text, /This replaces the old `EK0511` warning, which is retired, and moves the plain-handler part of `EK0403` to `EK0401`/)
  assert.match(text, /\*Superseded 2026-10-31 by "plain handlers never throw" \(below\): the old `EK0511` is retired\.\* \*\*Amended 2026-10-30: an explicit `throw` in a plain handler warns/)
  assert.match(text, /\*Superseded 2026-10-31 by "plain handlers never throw" \(below\): the error is `EK0401`, and an explicit `throw` there is `EK0401` too\.\* \*\*Amended 2026-10-29: a throwing call in a plain handler\.\*\*/)
  const fixes = text.slice(text.indexOf("plain handlers never throw.**"))
  const order = ["`x catch effect (e) => { throw e }`", "`x catch effect (e) => { return try die(e) }`", "move the code to a `.ts` file"].map(f => fixes.indexOf(f))
  assert.ok(order.every(i => i > 0) && order[0] < order[1] && order[1] < order[2], String(order))
})

test("chapter 3 makes throw and calls known to throw EK0401 in synchronous code outside effect code", () => {
  const text = chapter("003-failures")
  assert.doesNotMatch(text, /`throw` is allowed everywhere/)
  assert.match(text, /\| an `async` function, arrow or method, its parameter list included, or an `async` generator's body \| JavaScript's `throw`: the returned Promise rejects with `e` \(decided detail 251\) \|/)
  assert.match(text, /\| any other `\.vibe` code \| a compile error, `EK0401` \(\[Plain code never throws\]\(#plain-code-never-throws\)\) \|/)
  const section = text.slice(text.indexOf("### Plain code never throws"), text.indexOf("## Thrown types"))
  for (const construct of ["plain function declarations", "function expressions and arrows", "plain methods", "constructors", "getters and setters",
    "plain generators", "class field initializers", "`static` field initializers and `static` blocks", "every function's parameter list",
    "plain `catch` handlers", "the module top level, top-level `await` or not"]) assert.ok(section.includes(construct), construct)
  // An ordinary async function's parameter list rejects its Promise; an async generator's runs at the call (detail 108).
  assert.match(section, /every function's parameter list except an ordinary nongenerator `async` function's \(an `effect` function's and an `async` generator's included, since each runs at the call, before the Effect or the generator exists\)/)
  assert.match(section, /its directly evaluated blocks, `do` expressions and `try` statements included/)
  assert.match(section, /A function nested in such a literal, whether it is returned, stored, passed on or called in place, is its own plain code and keeps this check/)
  assert.match(section, /A `throw` statement is `EK0401`, whether or not a `try` statement in the same function catches it\./)
  assert.match(section, /A call whose throwing is unknown, such as an unannotated `\.ts` function, stays an ordinary call\./)
  assert.match(section, /A `throw` statement in such a literal is still `EK0401`\./)
  assert.match(section, /unless it sits in the `try` block of a `try` statement that has a `catch` clause, in the same function: the `catch` clause catches everything, so the throw can't leave the function\. A call in the `catch` or `finally` block, or in a `try` statement with only `finally`, is the error\./)
  assert.match(section, /function orNull\(s: string\) \{ try \{ return JSON\.parse\(s\) \} catch \{ return null \} \} \/\/ allowed/)
  const fixes = ["make the function `effect`", "write `return try die(e)`", "move the code to a `.ts` file"].map(f => section.indexOf(f))
  assert.ok(fixes.every(i => i > 0) && fixes[0] < fixes[1] && fixes[1] < fixes[2], String(fixes))
  assert.match(section, /For an exported function of a published package, "move to a `\.ts` file and re-export it" comes first/)
})

test("chapter 3 infers no thrown type for VibeLang callables and retires EK0405", () => {
  const text = chapter("003-failures")
  assert.match(text, /Every callable declared in `\.vibe` has thrown type `never`/)
  assert.doesNotMatch(text, /Otherwise infer a plain `\.vibe` function's uncaught throws/)
  assert.doesNotMatch(text, /least fixed point of their thrown types/)
  assert.match(text, /A `\.vibe` function has no inferred thrown type, recursive or not/)
  assert.match(text, /`EK0405` is retired/)
  assert.match(text, /Any `@throws` or `@rethrows` tag in a `\.vibe` file is `EK0406`: remove the tag\./)
})

test("chapter 3's .vibe examples never throw outside effect or async code unless they show EK0401", () => {
  const text = chapter("003-failures")
  for (const m of text.matchAll(/```vibe es\n([\s\S]*?)```/g)) {
    for (const line of m[1].split("\n")) {
      const code = line.replace(/\/\/.*$/, "")
      if (!/\bthrow\s/.test(code)) continue
      if (/^\s*(export\s+)?effect\b|^\s*if \(|^\s*async\b|^\s*export async\b|catch effect|EK0401|EK0406|^\s*(when|default)\b/.test(line)) continue
      assert.fail(`a plain throw without EK0401: ${line.trim()}`)
    }
  }
})

test("chapter 2 makes a plain handler's throw EK0401 and retires the EK0511 warning", () => {
  const text = chapter("002-running")
  assert.doesNotMatch(text, /EK0511`? \(lint warning\)|lint warning `EK0511`|VIP-38 lint warning \(`EK0511`\)/)
  assert.match(text, /\| `x catch \(e\) => \{ throw e \}` \| plain function \| error `EK0401`: synchronous VibeLang code never throws \(VIP-5, amended 2026-10-31\); quick fixes `x catch effect \(e\) => \{ throw e \}`, then `x catch effect \(e\) => \{ return try die\(e\) \}`, then a `\.ts` file \|/)
  assert.match(text, /\| a `throw` statement anywhere in a plain handler's parameters or body, caught inside it or not, or a call known to throw there outside the `try` block of a `try` statement with a `catch` clause; .* \| `EK0401` \|/)
  assert.match(text, /A `throw` inside is `EK0401` \(VIP-5, amended 2026-10-31\); write `catch effect \(e\) =>` to fail again, typed/)
  assert.match(text, /const died = fail\(id\) catch effect \(e\) => \{ return try die\(e\) \}/)
})

test("the introduction no longer says plain functions keep TypeScript's throw", () => {
  const text = chapter("000-intro")
  assert.doesNotMatch(text, /Plain functions, `async` functions, `await`, `throw`, `using`/)
  assert.match(text, /The exception is `throw`: synchronous VibeLang code never throws, so a `throw` outside effect code and `async` functions is a compile error, and code that throws is written in a `\.ts` file/)
  assert.match(text, /\| `throw e` in synchronous code outside effect code \| compile error `EK0401`/)
})

test("chapter 7 lists the EK0401 quick fixes in order and drops the EK0511 warning", () => {
  const text = chapter("007-tooling")
  assert.doesNotMatch(text, /\| `EK0511` \|/)
  const rows = ["| 1 | Make the function `effect`", "| 2 | Make the function `effect` and replace `throw e` with `return try die(e)`", "| 3 | Move the code to a `.ts` file and import it"].map(r => text.indexOf(r))
  assert.ok(rows.every(i => i > 0) && rows[0] < rows[1] && rows[1] < rows[2], String(rows))
  assert.match(text, /For an exported function of a published package \(its nearest `package\.json` has a `name` and no `"private": true`\), "move to a `\.ts` file and re-export it" comes first, because `effect` changes its public declaration's return type\./)
})

test("Appendix B widens EK0401 and EK0406, narrows EK0403 and retires EK0405 and EK0511", () => {
  const text = chapter("900-appendices")
  const b = text.slice(text.indexOf("## Appendix B. Diagnostics"), text.indexOf("## Appendix C"))
  assert.match(b, /\| `EK0401` \| a `throw` statement, or a call, `new` expression, tagged template or class evaluation known to throw outside the `try` block of a `try` statement with a `catch` clause, in synchronous code outside effect code: .*a parameter list \(an `effect` function's and an `async` generator's included, an ordinary `async` function's excluded\), a plain `catch` handler, or the module top level, top-level `await` or not; .*quick fixes: make the function `effect`, use `die`, or move the code to a `\.ts` file \| 4, 5, 26, 27 \|/)
  assert.match(b, /\| `EK0403` \| an unwrapped call, `new` expression, tagged template or class evaluation that may throw, in effect code \| 4 \|/)
  assert.match(b, /\| `EK0406` \| a `@throws` or `@rethrows` tag in a `\.vibe` file, on any declaration, signature or type; quick fix: remove the tag \|/)
  assert.doesNotMatch(b, /^\| `EK0405` \|/m)
  assert.doesNotMatch(b, /^\| `EK0511` \|/m)
  assert.match(b, /The old `EK0405` and `EK0511` are retired the same way \(VIP-4 and VIP-5, amended 2026-10-31\)/)
})

test("Appendix E's annotations are for foreign callables; its example imports each from a .ts file", () => {
  const text = chapter("900-appendices")
  const e = text.slice(text.indexOf("## Appendix E."))
  assert.match(e, /Only foreign callables carry them: a callable declared in `\.vibe` has thrown type `never` and takes no `@throws` tag/)
  for (const m of e.matchAll(/```vibe es\n([\s\S]*?)```/g)) assert.doesNotMatch(m[1], /@throws|@rethrows/)
  assert.match(e, /```ts\n\/\/ each\.ts\n\/\*\* @throws \{never\} @rethrows f \*\/\nexport function each/)
})

test("chapters 1, 6 and Appendix E show no plain throw outside effect and async code", () => {
  const plain = /^\s*(export\s+)?effect\b|^\s*async\b|^\s*export async\b|catch effect|EK0401|^\s*(when|default)\b/
  for (const name of ["001-functions", "006-data", "900-appendices"]) {
    for (const m of chapter(name).matchAll(/```vibe es\n([\s\S]*?)```/g)) {
      if (/^\s*effect function/m.test(m[1]) && !/^\s*(export )?function/m.test(m[1])) continue
      for (const line of m[1].split("\n")) {
        if (/\bthrow\s/.test(line.replace(/\/\/.*$/, "")) && !plain.test(line)) assert.fail(`${name}: ${line.trim()}`)
      }
    }
  }
  assert.match(chapter("900-appendices"), /A `throw` statement in a `\.vibe` executor is still `EK0401`/)
})

test("VIP-27 emits @throws {never} for .vibe callables and VIP-39 components throw never", () => {
  const vip27 = read("docs/design/vips/0027-declaration-output.md")
  assert.match(vip27, /\*\*Amended 2026-10-31: `\.vibe` callables are emitted `@throws \{never\}`\.\*\*/)
  assert.match(vip27, /never writes `@rethrows`, so a TypeScript reader doesn't fall back to the foreign default `unknown`/)
  assert.doesNotMatch(vip27, /if \(!s\) throw new BadInput\(\)/)
  assert.doesNotMatch(vip27, /@throws \{BadInput\}/)
  const vip39 = read("docs/design/vips/0039-vibex.md")
  assert.doesNotMatch(vip39, /A component's `@throws` comes from its own body/)
  assert.match(vip39, /A component written in `\.vibex` throws `never`, as every VibeLang callable does \(VIP-4, amended 2026-10-31\)/)
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
