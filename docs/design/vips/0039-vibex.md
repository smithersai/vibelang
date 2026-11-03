# VIP-39: `.vibex`, VibeLang with JSX

**Status:** accepted by Will, 2026-10-31. Merged from four independent panel submissions (Codex Astra, Codex Sol, Claude Opus, Claude Fable); disputed points were decided by probes with a `.vibex`-enabled build of the compiler, TypeScript 5.9.3 on `.tsx` controls, and opencode's pinned `babel-preset-solid` 1.9.15.

## Decision

`.vibex` is to `.vibe` what `.tsx` is to `.ts`:

> **A `.vibex` file is a `.vibe` file read with TypeScript's JSX language variant. Every JSX production, and its scanning, checking and emit, is exactly `.tsx`'s. Every VibeLang production is exactly `.vibe`'s. Where they compete for the same tokens, `<` in expression position takes its `.tsx` reading. JSX adds no other rule.**

```vibex
// compiler-gap: VIP-39 TS6054; file-kind support waits for the Preconditions below
// Profile.vibex   tsconfig: "jsx": "preserve", "jsxImportSource": "solid-js"
error ProfileMissing { id: string }

export const loadProfile = effect (id: string) => {
  const users = try Users
  return try users.find(id)
}

export function ProfileCard(props: { name: string; role: "admin" | "member" }) {
  return (
    <section class="card">
      <h2>{props.name |> titleCase(%)}</h2>
      {match (props.role) { when "admin": <Badge/>; default: null; }}
    </section>
  )
}
```

```tsx
// Profile.tsx, the same module in Effect TypeScript
import { Data, Effect } from "effect"

class ProfileMissing extends Data.TaggedError("ProfileMissing")<{ readonly id: string }> {}

export const loadProfile = (id: string) =>
  Effect.gen(function* () {
    const users = yield* Users
    return yield* users.find(id)
  })

export function ProfileCard(props: { name: string; role: "admin" | "member" }) {
  return (
    <section class="card">
      <h2>{titleCase(props.name)}</h2>
      {props.role === "admin" ? <Badge/> : null}
    </section>
  )
}
```

### The file kind

- **`.vibex` = `ScriptKindTSX` plus VibeLang.** The compiler gives `.vibex` TypeScript's `ScriptKindTSX` (so `LanguageVariantJSX`) and treats it as a VibeLang source exactly as it treats `.vibe`. No new `ScriptKind`, `LanguageVariant`, scanner mode or JSX parser. `.vibe` stays non-JSX; `.ts` and `.tsx` are unchanged. A `.vibex` with no JSX is legal.
- **Renaming parses the same both ways.** Renaming `x.vibe` to `x.vibex` changes how the file parses only where it has `<` in expression position or `</` (rows 1–5 and 39). The project still needs `.tsx`'s settings: without `jsx`, an import of `x.vibex` is TS6142, and under `preserve` the output is `x.jsx` ([Options, output and declarations](#options-output-and-declarations)). Renaming `x.tsx` to `x.vibex` changes nothing in its JSX; the rest of the file follows `.vibe`'s rules, as it would in `x.vibe`.
- **Every `.vibe` rule applies.** VIP-30 (every source file is a module), VIP-33 (platform code), VIP-14 and VIP-6 (Effect names in scope), VIP-38 (built-in Effect lint) and every other accepted VIP apply to `.vibex` as to `.vibe`. A file extension waives nothing.
- **No stricter mode.** `.vibex` implies no option, check or lint that `.tsx` and `.vibe` don't already imply.

### `<` in expression position reads as in `.tsx`

- `<T>x` is JSX, never a type assertion. Write `x as T`.
- A generic arrow writes `<T,>`, `<T extends U>` or `<T = D>`. `<T>(x: T) => x` is JSX. This includes `effect <T,>(x: T) => x`, `async <T,>(…)` and a generic `catch` handler `catch <E,>(e: E) => …`.
- An operand that starts with `<` is JSX: `try <A/>`, `fork <A/>`, `join <A/>`, `throw <A/>`, as `await <A/>` is in `.tsx`.

```vibex
// compiler-gap: VIP-39 TS6054; file-kind support waits for the Preconditions below
const id = <T,>(x: T) => x
const lift = effect <T,>(x: T) => x
const n = input as number
```

```tsx
const id = <T,>(x: T) => x
const lift = <T,>(x: T) => Effect.gen(function* () { return x })
const n = input as number
```

The cost is the one every `.tsx` author already pays. `effect <T>(x: T) => x`, legal in `.vibe`, is a syntax error in `.vibex`, with TypeScript's own diagnostics (TS1005), as `async <T>(x: T) => x` is in `.tsx`.

### Inside JSX: names and text are JSX's, `{…}` is VibeLang's

- **Tag names, attribute names, attribute strings and JSX text are JSX's alone.** `match`, `try`, `effect`, `service`, `data`, `fork`, `join`, `provide`, `is` and `when` there are names; `!`, `%` and `|>` there are characters. `%` in text is never the pipe topic. `<try.all/>` is a member tag on an identifier `try`, never VIP-18's form.
- **`{…}` holds a VibeLang expression.** Child containers, attribute containers and `{...spread}` take any VibeLang expression: `try`, `match`, `|>` and `%`, `do {}`, `effect {}`, `effect` functions and arrows, `catch`, `is`. A declaration or statement (`provide`, `service`, `data`, `schema`, `error`) is not an expression; it goes inside a block (`do {}`, `effect {}`, a function body), as everywhere.
- **A container is transparent.** It creates no function, scope or Effect context. `{try load()}` is legal exactly where `try load()` is legal. `return`, `break` and `continue` inside a `do {}` in a container leave the enclosing function or loop (VIP-2). An `is` binding binds in the enclosing lexical home (VIP-7). A written arrow or function keeps its ordinary boundary.
- **The pipe topic crosses JSX.** VIP-23's `ContainsOuterTopic` recurses through JSX containers and through arrows, as the pinned TC39 spec's default rule says; only a nested pipe body hides its own topic. JSX text, attribute strings and names never contain a topic.
- **An attribute value is a string, a container or an element**, as in `.tsx`. `task=effect { … }` is a syntax error; write `task={effect { … }}`.

```vibex
// compiler-gap: VIP-39 TS6054; file-kind support waits for the Preconditions below
export effect function Row(id: string) {
  const item = try loadItem(id)
  return (
    <li title="50% off!" onClick={() => select(id)}>
      {item.price |> formatCents(%)}
      {match (item.stock) { when 0: <SoldOut/>; default: <Buy id={id}/>; }}
      <Timer task={effect { return try countdown(item) }} />
    </li>
  )
}
```

```tsx
export function Row(id: string) {
  return Effect.gen(function* () {
    const item = yield* loadItem(id)
    return (
      <li title="50% off!" onClick={() => select(id)}>
        {formatCents(item.price)}
        {item.stock === 0 ? <SoldOut/> : <Buy id={id}/>}
        <Timer task={Effect.gen(function* () { return yield* countdown(item) })} />
      </li>
    )
  })
}
```

### Types and patterns stay VibeLang's

- **Every type is a VibeLang type,** JSX type arguments included. `<Task<User!NotFound> run={load} />` passes `Effect.Effect<User, NotFound>`; `.tsx` reads that `!` as JSDoc's non-null type and fails. VIP-3's optional-slot rule ends a type before `>`, `}`, `/` and a line break.
- **Pattern position is not expression position.** After `when`, `is`, `and`, `or` and `not`, `<` is TC39's relational pattern, as in `.vibe`, except that `</` is one token in every `.vibex` context (row 39): write `when < /re/:`. A JSX value goes after the arm's `:`.

```vibex
// compiler-gap: VIP-39 TS6054; file-kind support waits for the Preconditions below
const view = <Task<User!NotFound> run={load} />
const size = match (n) { when < 5: <Small/>; default: <Big/>; }
```

```tsx
const view = <Task<Effect.Effect<User, NotFound>> run={load} />
const size = n < 5 ? <Small/> : <Big/>
```

### Effects and throws

- **JSX never runs an Effect.** An element doesn't run its props; a component is a plain function (VIP-1), not an Effect; an Effect-returning event handler returns an unrun Effect unless something runs it. TypeScript's `void` callback assignability means that mistake is not always a type error, as in `.tsx`.
- **An element is not a throw-tracked call** (VIP-4), as a getter isn't. The expressions inside it are tracked as usual. A `.vibe` component's declaration carries `@throws {never}` (VIP-27). (React's `jsx()` only builds a description; Solid's `createComponent` calls the component at once. What a component throws there is the framework's error-boundary business, as in `.tsx`.)
- **`try` inside JSX is legal and lowers in place.** Under `react`, `react-jsx` and `react-jsxdev`, TypeScript transforms the element and `try` runs where it stands, in source order. Under `preserve` and `react-native`, which keep the element in the output, the framework's compiler decides (Metro's Babel transform under `react-native`); Solid's compiler wraps an intrinsic element in an arrow, so `<div>{try x}</div>` fails Solid's build with "Unexpected reserved word 'yield'", exactly as `<div>{yield* x}</div>` and `<div>{await x}</div>` do in `.tsx`. Bind it first; that reads the same in every framework.
- **An attribute is an object member under VIP-4.** TypeScript checks the attributes against the props type member by member, so a function value in an attribute must fit the prop's call signature, as in `f({ onClick: … })` ([Assignability](../src/003-failures.md#assignability)). A handler imported from a `.ts` file with `/** @throws {Error} */` is `EK0402` against an untagged `onClick`, in `onClick={handler}` and in a spread `{...{ onClick: handler }}` alike. The check of a tag against `JSX.ElementType` or `JSX.ElementClass` is not an assignability site: an element is not a tracked call (Rejected: "JSX elements as throw-tracked calls"), so an imported component is never rejected for what it may throw.

```vibex
// compiler-gap: VIP-39 TS6054; file-kind support waits for the Preconditions below
export effect function Greeting() {
  const name = try currentUser()
  return <p>Hello, {name}</p>
}
export function SaveButton() {
  return <button onClick={() => runFork(save())}>Save</button>
}
```

```tsx
export function Greeting() {
  return Effect.gen(function* () {
    const name = yield* currentUser()
    return <p>Hello, {name}</p>
  })
}
export function SaveButton() {
  return <button onClick={() => Effect.runFork(save())}>Save</button>
}
```

`SaveButton`'s declaration carries `/** @throws {never} */` (VIP-27); the element `<button>` contributes nothing to it.

### Options, output and declarations

- **Options.** `jsx`, `jsxFactory`, `jsxFragmentFactory`, `jsxImportSource`, `reactNamespace` and the `@jsx`, `@jsxFrag`, `@jsxImportSource` and `@jsxRuntime` pragmas mean what they mean for `.tsx`, read through VIP-30's `vibe.config.json` → `tsconfig.json` → `jsconfig.json` discovery. A project without `jsx` gets `.tsx`'s errors (TS17004 at the element, TS6142 at the import). No VibeLang option touches JSX.
- **Output names.** `x.vibex` emits `x.jsx` under `"jsx": "preserve"` and `x.js` otherwise (`react-native` keeps JSX in `x.js`), as `x.tsx` does. This extends VIP-34's `.vibe` → `.js` rule. A relative `./x.vibex` specifier rewrites to `./x.jsx` under `preserve` and `./x.js` otherwise, as TypeScript rewrites `./x.tsx`, decided by the target file's actual output.
- **Declarations.** `x.vibex` writes the public `x.d.ts` to `outDir` and the sidecar `x.d.vibex.ts` beside the source (VIP-27), which plain `tsc` resolves under `allowArbitraryExtensions`. Neither contains JSX or VibeLang syntax. The public `x.d.ts` is API-identical ([VIP-27](0027-declaration-output.md)) to the one the fork writes for the `.tsx` twin that carries the same `@throws` tags. VIP-27 is unchanged: a converted component gains `@throws`, exactly as a `.ts` file converted to `.vibe` does.
- **Source maps.** `x.js.map`/`x.jsx.map` and `x.d.ts.map` name `x.vibex` with its `sourcesContent`; JSX nodes keep TypeScript's positions, VibeLang's lowered nodes stand on their keyword as in `.vibe`.
- **Diagnostics.** JSX errors keep their TypeScript codes; VibeLang errors keep their `EK` codes (VIP-34). VIP-39 adds no diagnostic. `EK39xx` stays reserved for it.

```jsonc
// tsconfig.json, identical for the .tsx project
{ "compilerOptions": { "jsx": "preserve", "jsxImportSource": "solid-js", "declaration": true, "outDir": "dist" } }
```

```text
src/Profile.vibex  ->  dist/Profile.jsx, dist/Profile.d.ts, src/Profile.d.vibex.ts
src/Profile.tsx    ->  dist/Profile.jsx, dist/Profile.d.ts
```

### Imports and resolution

`.vibe`, `.vibex`, `.ts` and `.tsx` import and re-export each other freely. Resolution treats `.vibex` as `.vibe`'s `.tsx`:

| Specifier | Tries, in order |
| --- | --- |
| `./App`, `./App.js` | `App.ts`, `App.tsx`, `App.vibe`, `App.vibex`, `App.d.ts`, then JavaScript |
| `./App.jsx` | `App.tsx`, `App.ts`, `App.vibex`, `App.vibe`, `App.d.ts`, `App.jsx`, `App.js` |
| `./App.vibe` | `App.vibe`, `App.d.ts` (unchanged) |
| `./App.vibex` | `App.vibex`, `App.d.ts` |

These orders apply after TypeScript's `exports`, `imports`, `paths`, `moduleSuffixes` and resolution-mode rules select a lookup; NodeNext still requires extensions where `.tsx` does. A live source beats its sidecar. `App.vibe` beside `App.vibex`, or `App.tsx` beside `App.vibex`, get TypeScript's TS5055/TS5056 only where the selected inputs write the same output path, as `App.ts` beside `App.tsx` does: under `"jsx": "preserve"` with declarations off, `App.vibe` and `App.vibex` write `App.js` and `App.jsx` and are both admitted; with declarations on both write `App.d.ts`, and under `"jsx": "react"` both write `App.js`, so those collide. Their compatibility sidecars stay distinct, `App.d.vibe.ts` and `App.d.vibex.ts`.

*Corrected 2026-11-02: the collision follows the selected native output paths, not a shared source stem (decided detail 265; found by the round-6 review).*

```vibex
// compiler-gap: VIP-39 TS6054; file-kind support waits for the Preconditions below
// main.vibex
import { ProfileCard } from "./Profile"      // Profile.vibex
import { format } from "./format.js"         // format.vibe
```

```tsx
// main.tsx
import { ProfileCard } from "./Profile"      // Profile.tsx
import { format } from "./format.js"         // format.ts
```

### Preconditions

The `.vibex` examples explicitly name the current unsupported-file diagnostic, `TS6054`, with a `// compiler-gap:` marker while these prerequisites and file-kind support are pending. This records the planned feature, not successful compilation. The check rejects a stale marker once that code disappears; remaining diagnostics then retain their own checks.

`.vibex` ships after these, each fixed in VibeLang with a test (see Clashes, rows marked **gap**):

1. **VIP-1's plain functions.** Main still lowers every plain function to an Effect: `export function Label(…) { return <b/> }` is declared `Effect.Effect<JSX.Element>`, and `<Label/>` fails with TS2786 "'Label' cannot be used as a JSX component" (probe `q17`). No component works until VIP-1's lowering ships.
2. **Four parser gaps** that change how `.vibex` reads: a bodyless `error` eats a `<` on the next line; `fork`/`join` reject a `<` operand; a generic `catch` handler doesn't parse; the denied trailing-block parser (VIP-11) still runs.

## Clashes

Every place any panelist found where the same tokens could read two ways, or where JSX meets a VibeLang rule. Deduplicated to **39 rows**. Parser functions are in `typescript/tsc/internal/parser/parser.go` unless a file is named. "Agrees" means both readings give the same result. **Gap** means main's compiler is wrong today, independent of JSX, and must be fixed in VibeLang first. Rows 1–5 and 39 are the only places where `.vibe` text changes meaning in `.vibex`.

### `<`: angle brackets

| # | `.vibex` snippet | VibeLang reading | JSX reading | How `.tsx` resolves it | Rule | Found by |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `const id = <T>(x: T) => x` | generic arrow | element `<T>` | `isParenthesizedArrowFunctionExpressionWorker` "JSX overrides": `<` Identifier is an arrow only before `,`, `=` or `extends`. TS 5.9: TS17008, TS1382 | `.tsx`'s. Write `<T,>`, `<T extends U>`, `<T = D>`; same for `async <T,>` | all four |
| 2 | `const id = effect <T>(x: T) => x` | effect arrow (legal in `.vibe`) | `effect<T>(x: T)`, a generic call | `tryParseVibeLangEffectArrow` (`vibelang_effect.go`) calls the same worker, gets false, rewinds. Probe `q03`: TS1005 ×2; `q04` `effect <T,>` parses | `.tsx`'s: `effect <T,>(x: T) => x`. No new diagnostic | all four |
| 3 | `const s = <string>y` | type assertion | element `<string>` | `parseSimpleUnaryExpression` sends `<` to the JSX parser; `parseTypeAssertion` asserts it never runs in JSX. TS17008 | `.tsx`'s: `y as string`. Same inside containers and after `try`: `try <Eff>y` is JSX | all four |
| 4 | `fork <A/>`, `join <A/>`, `try <A/>`, `throw <A/>` | operand is a type assertion | operand is JSX, as `await <A/>` | `parseSimpleUnaryExpression`; TS 5.9 accepts `await <b/>` and the statement `throw <b/>` | `.tsx`'s. The operand of `try`, `fork` and `join` is a `UnaryExpression` (VIP-5, VIP-17 amended); `throw <A/>` is JavaScript's `throw` statement, whose operand is an `Expression`. Either way `<` starts JSX. `x ?? throw <E/>` is a throw expression, adopted from the [TC39 throw-expressions proposal](https://github.com/tc39/proposal-throw-expressions/tree/78b887751db4e380870a0a6bfc47319c50aa1404) (decided detail 284; Will, 2026-11-02: "Refer to tc39 spec for answer"): its operand is a `UnaryExpression`, so `<` starts JSX there too. It is allowed where a throw statement is: synchronous VibeLang code cannot throw, so a throw expression there is `EK0401` (VIP-4, amended 2026-10-31). TypeScript's `TS1109` on it shows only that the proposal adds syntax. **Gap:** `nextTokenStartsForkOperand`/`nextTokenStartsJoinOperand` (`vibelang_fibers.go`) exclude `<`; probe `q06` gives TS1109 | Opus (fork, join), Fable (try, throw) |
| 5 | `x catch <E,>(e: E) => 1` | Appendix A `ArrowHandler` admits a generic arrow | generic arrow needs `<E,>` | no `catch` expression in TS | `.tsx`'s: `<E,>`. **Gap:** `parseVibeLangCatchHandler` (`vibelang_catch.go`) never tries `<`; probe `q08` fails even with the comma | Opus |
| 6 | `<const const={1}/>` | element `const` | generic-arrow `const T` modifier lookahead | the arrow lookahead runs first. TS 5.9 and probe `q09`: TS1359, TS1139 | `.tsx`'s. Keyword tag names parse only once the outer lookahead has chosen JSX | Astra |
| 7 | `<Box v={id<T>(x)} less={a < b} />` | type arguments or comparison | type arguments or tag opener | `tryParseTypeArgumentsInExpression`, `canFollowTypeArgumentsInExpression` speculate and roll back | Agrees: unchanged | Astra, Sol |
| 8 | `<Box<Array<T>> v={n >> 1} />` | type closers, shift | tag `>` | `parseJsxOpeningOrSelfClosingElementOrOpeningFragment` calls `parseTypeArguments`; expressions use `reScanGreaterThanToken` | Agrees: unchanged; no global `>>` splitting | Astra, Sol, Opus |
| 9 | `<>{x}</>` | (no `<>` form in `.vibe`) | fragment | `parseJsxOpeningOrSelfClosingElementOrOpeningFragment`, `parseJsxClosingFragment` | Fragment | all four |
| 10 | `<a:b c:d="1"/>`, `<Foo.Bar/>`, `<a:b.c/>` | member access, type colon | namespaced and member tags | `parseJsxTagName`, `parseJsxElementName`; `<a:b.c/>` is TS1003 | `.tsx`'s. Babel's React transform may reject namespaces downstream (`throwIfNamespace`); that is the framework's error | all four |
| 11 | `match (n) { when <b/>: 1; default: 2; }`, `x is <b/>` | relational pattern `< b` | element `<b/>` | no patterns in TS | `.vibe`'s: pattern position never starts JSX. Probe `q10`: `< b` then a syntax error at `/`. `when < 5` keeps working | Opus, Sol |
| 12 | `error Timeout`⏎`<App />` | Appendix A: `<` continues an `error` only on its name's line, so a declaration then a statement | a JSX statement | n/a | Appendix A's. **Gap:** `parseErrorDeclaration` (`vibelang_errors.go`) reads type parameters across the line break; probe `q07x`: `<App />` is eaten (TS1005), and `<T,>(x: T) => x` gives EK1303 | Opus |
| 39 | `a </b/.source.length`, `match (s) { when </b/: 1; default: 2; }` | `<`, then a regular expression | `</`, a closing-tag token | `scanner.Scan` returns `LessThanSlashToken` for `</` under `LanguageVariantJSX` in any context, unless `/*` starts a comment. TS 5.9: TS1005 twice | `.tsx`'s, in patterns too: write a space, `a < /b/`, `when < /b/:`. No pattern-only scanner exception | Opus |

### `!`: Effect types and bangs

| # | `.vibex` snippet | VibeLang reading | JSX/TS reading | How `.tsx` resolves it | Rule | Found by |
| --- | --- | --- | --- | --- | --- | --- |
| 13 | `<Comp<User!NotFound> v={1} />` | `Effect.Effect<User, NotFound>` | JSDoc non-null type `User!`, then an error (TS 5.9: TS17019) | `parseTypeArguments` → `parseType` | `.vibe`'s: every type is a VibeLang type. Probe `q16` compiles | all four |
| 14 | `{u!.name}`, `{!x}`, `{x != y}`, `{x !== y}` | non-null, not, inequality | same | containers call `parseExpression` (`parseJsxExpression`) | Agrees. `ReScanExclamationToken` splits `!` only inside a type | Astra, Sol, Fable |
| 15 | `const p: User!!=src` inside `{do { … }}` | omitted slots, then `=` | `!=` | `scanner.Scan` | VIP-3's type-only rescan, unchanged | Astra, Sol |
| 16 | `{x as A!!}`, `<Comp<A!!>>text</Comp>`, `(): JSX.Element!! => <div/>` | optional `R` omitted | — | — | VIP-3: `}`, `>`, `/`, `=>`, `{` and a line break never start a type, so `R` ends there | Opus, Fable, Astra |
| 17 | `{x as A!! < 3}` | Appendix A: `R` omitted, then a comparison | — | `<` is binary here; JSX can't start | Appendix A's. **Gap (VIP-3, not JSX):** probe `q19` gives TS1139 in `.vibe` and `.vibex` | all four (Fable: no gap; probe disagrees) |
| 18 | `<T extends User!NotFound>(v: T) => v` | constrained generic arrow, Effect constraint | arrow (`extends` disambiguates) | the JSX override, then `parseType` | Agrees | Fable |

### Names

| # | `.vibex` snippet | VibeLang reading | JSX reading | How `.tsx` resolves it | Rule | Found by |
| --- | --- | --- | --- | --- | --- | --- |
| 19 | `<try/> <match/> <effect/> <service/> <data/> <fork/> <join/> <provide/> <catch/> <when/> <is/>` | keywords | intrinsic tag names | `parseJsxTagName` with `scanJsxIdentifier`; never VibeLang dispatch | Names. Probe `q11` compiles. Covers `fork`/`join` in effect code, legacy words (`control`, `handle`, `layer`) included | all four |
| 20 | `<Show when={x} is="a" match={1} try={2} effect={3} fork provide="y" />` | keywords | attribute names | `parseJsxAttributeName` | Names. Solid's `<Show when>`, `<Match when>` and the Web Components `is` attribute work | all four |
| 21 | `<try.all/>`, `<fork.in/>`, `<fork.scoped/>` vs `{try.all [a, b]}` | VIP-18 and VIP-17 forms | member tags | `parseJsxElementName` | Tags: a member of identifier `try` (TS2304, probe `q12`). Inside braces: VIP-18/VIP-17 | all four |
| 22 | `<Match />`, `<Option />` with no import | VIP-14: Effect's module is in scope | a component name | identifier resolution | Ordinary resolution: Effect's module is found and TS2604 says it isn't a component (probe `q20`). An import (`import { Match } from "solid-js"`) shadows it | Opus, Fable |
| 23 | `<map>`, `<select>` | VIP-6 globals | intrinsic string tags | lowercase tags are never identifiers | Agrees | Opus |
| 24 | `{ effect m<T>(x: T) {} }`, `class C { effect render() { return <b/> } }`, `data Box<T> {…}` | type parameters after a declared name | — | — | `<` after a name in a declaration is type parameters, never JSX | Opus, Fable |

### Text, strings, comments

| # | `.vibex` snippet | VibeLang reading | JSX reading | How `.tsx` resolves it | Rule | Found by |
| --- | --- | --- | --- | --- | --- | --- |
| 25 | `<p>a \|> b</p>` | pipe | text with a bare `>` | `ScanJsxTokenEx` (`scanner.go`) reports TS1382 (TS 5.9 and probe `q15` identical) | `.tsx`'s. Write `{"\|>"}` or `\|&gt;` | all four |
| 26 | `<p>Hi! 50% off</p>`, `x \|> <b title="%">%</b>` | non-null, topic | text, attribute string | `ScanJsxTokenEx`, `scanJsxAttributeValue` | Text. `%` there is not the topic: probe `q13` reports EK1006 "This pipe's body does not use its topic" | all four |
| 27 | `<Box title="{try p}" />` | interpolated `try` | quoted string | `scanJsxAttributeValue`: no escapes, no interpolation | String | Astra |
| 28 | ``{`! % \|> ${x}`}``, `{/[!%>]/.test(s)}`, `{/* try p */}`, `<p>// text</p>` | templates, regex, comments | same, and text | template rescanning, `ReScanSlashToken`, empty container, `ScanJsxTokenEx` | Agrees: unchanged lexical states | Astra, Sol, Fable |

### Containers: VibeLang forms inside JSX

| # | `.vibex` snippet | VibeLang reading | JSX reading | How `.tsx` resolves it | Rule | Found by |
| --- | --- | --- | --- | --- | --- | --- |
| 29 | `<div>{match (x) { when 0: <Zero/>; default: <Other/>; }}</div>` | `match`; inner `{ ; }` are its arms | the first `}` closes the container | `parseJsxExpression` → `parseExpression` owns everything up to its `}` | VibeLang's: inner braces and `;` belong to `match` | all four |
| 30 | `x \|> <Box f={() => %}>{%}</Box>`, `{n % 2}` | topic captured through JSX and the arrow; remainder | no `\|>` in TS | `parseJsxExpression` → expressions | `ContainsOuterTopic` recurses through containers and arrows (pinned spec's default rule); only a nested pipe body hides a topic. Probe `q14` compiles. `n % 2` is remainder | Astra, Sol, Opus, Fable |
| 31 | `<Box task={effect { return 1 }} value={{ effect: 1 }} />` | Effect block vs object literal | container holding an object | `parseJsxExpression` takes the outer braces only | VibeLang's: `{effect {…}}` is a block, `{{…}}` an object | all four |
| 32 | `<Box task=effect { return 1 } />`, `<Box v=do { 1 } />` | bare VibeLang value | `parseJsxAttributeValue` accepts a string, `{…}` or an element | TS1145 (probe `q21`) | `.tsx`'s: rejected; brace it | Astra, Sol |
| 33 | `function f() { return <Box v={do { return 7 }} /> }` | `return` leaves `f` (VIP-2) | (no `do` in TS) | `parseJsxExpression` creates no function | VIP-2's: `return` leaves `f`; the lowering never wraps it in an IIFE. If the `do` must become statements, everything before it in the element (the tag, earlier attributes, spreads and children) is evaluated first, once, in source order ([Evaluation order](../src/002-running.md#evaluation-order)); the `do` never moves alone. Under `preserve` and `react-native` those earlier values reach the framework as values: `a={props.a}` before such a `do` is read once, not re-read by the framework | Astra, Sol |
| 34 | `<Box ok={x is { let name }} label={name} />` | binding in the enclosing lexical home | a prop | no `is` in TS | VIP-7's: binds in the enclosing home with its TDZ rules; JSX adds no scope | Astra, Sol, Fable |
| 35 | `{provide Live { … }}`, `{service S {…}}`, `{error E}` | declarations and statements | container expects an expression | `parseJsxExpression` | Not expressions: syntax errors. Put them in `do {}`, `effect {}` or a function body | Astra, Sol, Fable |
| 36 | `{render { return 1 }}` | old trailing block `render(() => …)` | container, then a stray block | n/a | VIP-11 denied trailing blocks: a syntax error. **Gap:** `isStartOfVibeLangBlockParam` (`vibelang_blocks.go`) still parses it | Fable |
| 37 | `return`⏎`<div/>`; `effect`⏎`(x) => x` | ASI and modifier lookahead | same | `hasPrecedingLineBreak` | Agrees: existing no-line-terminator rules | Astra, Sol |

### Meaning

| # | `.vibex` snippet | Two readings | `.tsx` behavior | Rule | Found by |
| --- | --- | --- | --- | --- | --- |
| 38 | `effect function f() { return <div>{try load()}</div> }` under `"jsx": "preserve"` with Solid | `try` runs where it stands, or the framework moves it | Solid wraps an intrinsic element in `(() => {…})()`, so `yield*` and `await` inside it are invalid. Rerun: `<div>{yield* x}</div>`, `<div title={yield* x}/>`, `<div>{await x}</div>` fail to reparse; `<Comp v={yield* x}/>` and a bound `const` pass | No language rule: the `.tsx` twin fails the same way, and the failure is a build error, never silent. Docs and the Solid fixture teach "bind it first" | Astra (probe), Opus, Fable |

Two semantic meetings are rules in the Decision rather than token clashes: an element is not a throw-tracked call (Opus), and a plain component must stay plain (VIP-1 precondition; Opus, Fable).

## Alternatives

| Design | Used by | Why not for VibeLang |
| --- | --- | --- |
| JSX in every `.vibe` file | Flow, Babel, ReScript, CoffeeScript 2 (folded `.cjsx` into `.coffee`) | `<T>x`, `try <T>x` and `effect <T>(x) => x` change meaning in existing `.vibe` code. Flow and ReScript never had `<T>x`; VibeLang inherits it from TypeScript, so it inherits TypeScript's answer: a second extension. |
| A per-file pragma | Deno's and Babel's `@jsx…` pragmas | Every tool (LSP, bundlers, editors) keys the language on the extension before reading the file. Pragmas still work inside `.vibex`. |
| Builders, no markup | Kotlin Compose, Swift result builders, Flutter | The 267 blocked files are JSX; migration means keeping their text. VIP-11 denied trailing blocks. |
| Macros | Rust `view!` (Leptos), `html!` (Yew), `rsx!` (Dioxus) | Each macro parses its own dialect; TypeScript's JSX typings can't check it. |
| Single-file components | Svelte, Vue | Separate template language, checked through virtual files. `.vibex` is parsed directly. |
| A VibeLang-flavored JSX (implicit `try` in tags, Effect children) | none | Solid, React and opentui compile JSX themselves; a different meaning breaks them. |
| Keep `.tsx` calling `.vibe` | today | Works, but 45 opencode, 218 t3code and 4 foldkit Effect modules can't use `effect {}`, `try`, `match` or `error`. |

## Did similar features cause problems elsewhere?

Yes, and each shaped a rule here:

- **TypeScript's own `.tsx`** removed `<T>x` and made `<T>(x) =>` JSX (handbook, "JSX"). Users write `as` and `<T,>`. `.vibex` inherits the same cost and the same errors, including after `effect`.
- **Babel and Flow** parse `<T>(x) => x` in `.js` by trying JSX and backtracking. A parse that depends on backtracking is hard for other tools to match; a file kind avoids it.
- **Reason's JSX** had its own children and props semantics; ReScript's JSX v4 (2022) moved back to React's model. Lesson: JSX means what the host's JSX means.
- **Swift result builders** (SE-0289) document "unable to type-check this expression in reasonable time" on large views, and one-way constraints added to contain it. `.vibex` adds no inference.
- **Rust UI macros**: rustfmt can't format inside them, so Leptos ships `leptosfmt`; rust-analyzer support lags. A file kind keeps every tool in the loop.
- **Svelte and Vue** needed `svelte2tsx` and Volar's virtual files, and a `generics` attribute for type parameters.
- **MDX 2** made JSX parsing strict and broke content written for MDX 1. Lesson: take one JSX grammar and never fork it.
- **E4X** (ECMA-357) gave XML literals their own runtime; it was withdrawn and removed from SpiderMonkey.
- **Solid** wraps containers in closures, so `await` (and `yield*`) inside an intrinsic element breaks its build. Row 38 inherits this unchanged.
- **Babel's React transform** rejects namespaced tags by default (`throwIfNamespace`) even though JSX parses them. Parse success is not framework support.

## Recommendation

Accept. `.vibex` is one extension that selects `.tsx`'s language variant plus VibeLang's forms, with no grammar of its own and no new diagnostic. Its only source-visible cost is `.tsx`'s (`as`, `<T,>`, a space in `< /re/`). Every real witness from opencode, t3code and foldkit (15 files across the panel) compiles as `.vibex` with zero JSX errors; their remaining errors are VibeLang rules (VIP-33 platform code, the VIP-1 gap) and missing dependencies. Ship it after VIP-1's plain functions and the four parser gaps, then land it on t3code's web modules (React, Vite) and opencode's app (Solid, Vite) first; t3code's 78 mobile modules wait for a Metro adapter, which `.vibe` lacks too.

## Credits

| Adopted idea | Author |
| --- | --- |
| `.vibex` = `ScriptKindTSX` + VibeLang identity as two independent facts; no new `ScriptKind` or `LanguageVariant` | Astra, Sol (Opus, Fable independently) |
| The one-sentence rule: only `<` in expression position is disputed | Opus |
| Containers are transparent: no scope, function or Effect context; `{try x}` legal exactly where `try x` is | Astra, Sol |
| The pipe topic crosses JSX and arrows per the pinned `ContainsOuterTopic`; JSX-aware traversal predicates | Astra |
| JSX types are VibeLang types (`<Comp<A!E>>`) | Opus, Fable |
| Pattern position never starts JSX | Opus, Sol |
| An element is not a throw-tracked call | Opus |
| VIP-1 plain functions as the gate, shown by TS2786 on real witnesses | Opus, Fable |
| Parser gaps: `error` line break, `fork`/`join` operand, generic `catch` handler | Opus |
| Parser gap: denied trailing-block parser still runs | Fable |
| Unimported capitalized tags resolve VIP-14 names (TS2604); imports shadow | Opus, Fable |
| `<const const={1}/>` keyword exception | Astra |
| Solid suspension probe (intrinsic vs component props) and "no Vibe-wide ban" | Astra |
| Output names `.jsx` under `preserve`, rewrite by target's actual output | Astra, Sol |
| Resolution tables | Opus, Fable (Sol, Astra for the non-`.jsx` rows) |
| Declaration identity against the `@throws`-carrying twin, keeping VIP-27 | Astra, Opus |
| No stricter mode (old research note D21) | Fable |
| Every `.vibe` rule applies (VIP-33 platform witness `tui/src/app.tsx`) | Fable, Astra |
| No new diagnostics; TS codes for JSX, EK for VibeLang | Sol, Astra |

## Rejected

| Idea | Author | Why not |
| --- | --- | --- |
| `EK3902`/`EK3901`: ban `try`, `fork`, `join`, `try.all` directly in JSX (always, or only under `preserve`) | Opus, Fable | The rerun shows Solid's failure is a loud build error, identical to `.tsx`'s `yield*` and `await`, and only for intrinsic elements: component props and `react-jsx` work. A ban rejects valid React code; a `preserve`-only ban makes legality depend on config. Fable's claim that Solid wraps component props in getters is wrong: `<Comp v={yield* x}/>` stays in place. |
| `EK3901`: a dedicated error for `effect <T>(x) =>` | Opus | `async <T>(x) =>` has the same TS1005 errors in `.tsx`, and TypeScript users know `<T,>`. A new code is a feature beyond JSX. |
| Suppress inferred `@throws` in public `.d.ts` (amend VIP-27) for byte identity with unannotated `.tsx` | Sol | Not a JSX question: `.ts` → `.vibe` has the same difference. VIP-39 changes no other VIP. |
| JSX elements as throw-tracked calls of the factory | Sol | React's `jsx()` doesn't call the component; Solid's does. Tracking would make every component throw `unknown` under VIP-4's foreign-callable rule, which `.tsx` never imposes. |
| A function boundary for the topic at arrows inside JSX | Sol (C16 wording) | The pinned `ContainsOuterTopic` hides a topic only at a nested pipe body. |
| `fork <A/>` stays a comparison | Fable | VIP-17's amendment makes the operand a `UnaryExpression`; the comparison is a parser gap. |
| `.jsx` specifiers don't substitute `.vibe` | Sol | TypeScript resolves `./x.jsx` to `x.ts` (TS 5.9 control); `.vibe` mirrors `.ts`. |
| Tell users to add `.vibex` to `vite-plugin-solid`/`plugin-react` options | Fable, Sol | The plugin hands off a virtual id ending `.jsx`, which every framework filter already matches, with no user config. Kept as the documented fallback. |
| Editor language id `vibelangreact` | Opus | The existing id is `vibe`; `vibex` matches it and the extension. |
| A `ScriptKindVibeX` | Astra (as fallback) | No host path needs it; the file name carries the dialect. |
| A `.vibex` quick fix for `try` in JSX, auto-hoisting | Opus, Fable | Hoisting one child ahead of earlier props reorders evaluation. |

## Will's words

> "Great question! New vip. We should support vibex. Have a panel of Astra opus fable and sol all research and write a vip and an implementation plan followed by an opus agent combining them into a single plan that uses the best ideas from all of them. Be careful to look for any ways the Jsx syntax might clash with vibe syntax if there are any." (2026-10-31)

> "we should support Jsx ideally mostly from typescript itself already supporting it and us forking ts." (2026-10-31)

> "Looks pretty simple I approve." (2026-10-31, accepting this VIP)

## Context

The proposals page lists "JSX source files" as not in VibeLang: components live in `.tsx` files that call `.vibe` functions. The earlier design left `.vibex` as a candidate that must not imply a stricter mode (research note D21). 45 opencode (Solid, `class=`, `jsxImportSource` from tsconfig), 218 t3code (React, `react-jsx`, `@effect/atom-react`) and 4 foldkit Effect modules are `.tsx` and can't become VibeLang today.
