# VIP-15: `schema` declarations

**Status:** accepted by Will, 2026-10-28.

## Decision

```ts
// fragment
// VibeLang
schema User { id: string; nickname?: string; role: "admin" | "member"; home: Address }
schema Code = "root_missing" | "read_failed"           // alias form

// exactly this Effect TS
const User = Schema.Struct({
  id: Schema.mutableKey(Schema.String),
  nickname: Schema.mutableKey(Schema.optional(Schema.String)),
  role: Schema.mutableKey(Schema.Literals(["admin", "member"])),
  home: Schema.mutableKey(Address),
})
type User = typeof User.Type
const Code = Schema.Literals(["root_missing", "read_failed"])
type Code = typeof Code.Type
```

Using one is Effect's own Schema API (VIP-14), for example:

```ts
const user = try Schema.decodeUnknownEffect(User)(input)   // fails with a SchemaError
```

- `schema Name { fields }` and `schema Name = type` declare a Schema constant and its type under one name.
- Each field's schema is written from its TypeScript type: primitives, literals, unions, arrays, tuples, `Record`, nested object types, or another schema's name. A type outside that mapping is a compile error.
- `name?: T` means `Schema.optional`, which accepts a missing key or `undefined`, matching TypeScript's default.
- Refinements and transformations stay Schema constants, which a field names, as in `name: NonEmptyString`.
- **Ambiguity: none.** `schema` is a contextual keyword on the same line as its name.
- **Amended 2026-10-29: the type mappings mirror TypeScript, mutability included.**
  - `"a"` → `Schema.Literal("a")`;
  - a union → `Schema.Union([...])`;
  - `null` / `undefined` → `Schema.Null` / `Schema.Undefined`;
  - `T[]` → `Schema.mutable(Schema.Array(S))`, and `readonly T[]` → `Schema.Array(S)`;
  - `[A, B]` → `Schema.Tuple([A, B])`, mutable unless `readonly`;
  - `Record<K, V>` → `Schema.Record(K, V)`;
  - a struct → `Schema.Struct`, with `Schema.mutableKey` for mutable fields.

  Sent to Will on Telegram 2026-10-29 11:28 under his standing rule 'assume I accept'; no objection by 12:00.

*Corrected 2026-10-29: under "mutability included", a writable `Record<K, V>` is `Schema.Record(K, Schema.mutableKey(V))` and `Readonly<Record<K, V>>` is `Schema.Record(K, V)`, because `Schema.Record(K, V).Type` is readonly in effect 4.1.0; and a union made only of literals is `Schema.Literals([...])`, as the decision example writes it (found by the round-3 review).*

*Corrected 2026-10-29: a mutable tuple `[A, B]` is `Schema.mutable(Schema.Tuple([A, B]))`, because `Schema.Tuple([A, B]).Type` is readonly in effect 4.1.0; `readonly [A, B]` is `Schema.Tuple([A, B])` (found by the round-4 review).*


- **Amended 2026-10-30: referenced schemas preserve source modifier promises by conservative admission.** A required source field, a required fixed tuple position (before or after rest), or a required `Record` value position requires the referenced schema's inferred decoded-key optionality to be required. An effectively readonly field or readonly `Record` value position requires readonly decoded-key mutability. Check resolved schema flags through aliases; conflicting or unprovable needed flags are rejected by the field-mapping rule, with the repair to use an unmodified value schema and write modifiers on the source occurrence. Apply this recursively in nested mappings. Writable fields/records and optional source occurrences keep their existing mappings. This checks the flags at the mapped occurrence, not constructor spellings; it invents no flag-reset or unwrapping API. Encoded and constructor-input defaults retain Effect's behavior. Schema-error payload keys are effectively readonly even without a written `readonly`; this is shallow key readonlyness, not a deeply readonly decoded value. The [Data chapter's mapping](../src/006-data.md#schema-declarations) states the admitted cases.

- **Amended 2026-10-30: computed-key counterparts.** Computed keys use the native TypeScript runtime object-literal grammar and property-key type checks of the `Schema` fields object, including admitted calls, parentheses and element access. Evaluate each key once in native property order, preserving getters, coercion, TDZ, thrown values and source-context throw checks. Infer the public type from the actual `Schema` value, not a synthetic type literal containing a key call. Reference modifiers and special-property-name rules retain their existing meaning.

- **Amended 2026-10-30: named declarations and diagnostics.** A `schema` declaration has no type parameters (`EK1502`); generic Schema construction stays an ordinary generic TypeScript factory. A direct `export default schema S …` is `EK1501`: declare `S` and write `export { S as default }`. A `schema error` follows the [error-declaration rules](0029-schema-errors.md). These codes catalog the existing named, nongeneric declaration grammar.

- **Amended 2026-10-30: incomplete declaration diagnostics.** A recognized ordinary schema declaration missing its required body or admitted alias form is `EK1503`. Recovery does not turn a missing body into an empty struct or reject a valid schema alias. The explicitly admitted bodyless `schema error` form keeps its existing rules. These codes label existing rejections; they add no admitted syntax.

## History

One minor finding, a wrong Effect API name, fixed.

## Prior art

Effect's `Schema.Struct`; Zod's `z.object`; Pydantic models.

## TODO (Will)

> "we also need to mark as a TODO creating a smithers generation script that properly updates the library as schema changes"

## Will's words

> "Yup I'm accepting this"


- **Amended 2026-11-01: mapped generic bindings.** The generic built-ins `Array<T>`, `ReadonlyArray<T>`, `Record<K, V>` and `Readonly<T>` in the table mean the corresponding TypeScript-library type bindings, selected by ordinary type lookup and alias resolution, not by spelling. A local or imported type binding can shadow a library type; a value-only binding does not by itself replace the separate library type binding. When the resolved binding is not a mapped built-in, apply the existing Schema-value lookup and arity rules. A reference with no suitable Schema value is `EK2109`: declare a schema or name a Schema value. This does not expand arbitrary user type aliases or introduce generic Schema declarations. The array syntax `T[]` and `readonly T[]` remains independent of any written `Array` binding. See [Shadowing mapped built-ins](../src/006-data.md#shadowing-mapped-built-ins).

## Details

Decided details folded in verbatim on 2026-11-03 (mechanical pass). Each keeps its old number as history; where one conflicts with the text above, the fold's conflict pass resolves it.

### Detail 12

(VIP-15) Schema mappings mirror TypeScript, mutability included:
    - `"a"` → `Schema.Literal("a")`;
    - a union → `Schema.Union([...])`;
    - `null` / `undefined` → `Schema.Null` / `Schema.Undefined`;
    - `T[]` → `Schema.mutable(Schema.Array(S))`, and `readonly T[]` → `Schema.Array(S)`;
    - `[A, B]` → `Schema.Tuple([A, B])`, mutable unless `readonly`;
    - `Record<K, V>` → `Schema.Record(K, V)`;
    - a struct → `Schema.Struct`, with `Schema.mutableKey` for mutable fields.

### Detail 256

**An ordinary `schema` can use one written type alias with independent documentation.** (foldkit-9, accepted by Will on 2026-11-02: “Accept good ideas”; amends VIP-15 and VIP-27.) For either ordinary `schema X` form, one written, nongeneric `type X = typeof X.Type` in the same scope replaces the synthesized alias, in either source order. Its type query resolves to that schema value. Preserve each declaration’s own JSDoc, order and export status as on the native constant/type pair; native comment/visibility emit options still apply. Other type-name collisions remain errors. Without a written alias, synthesize the same bare alias: the schema declaration's JSDoc belongs to its constant only. This supersedes the previous requirement to retain the native pair in a `.ts` file for separate type documentation.

    ```vibe
    /** A message on the wire. */
    export schema Message { id: string }
    // declaration output:
    // /** A message on the wire. */
    // export declare const Message: Schema.Struct<{ readonly id: typeof Schema.String }>
    // export type Message = typeof Message.Type
    ```

    Effect TS:

    ```ts
    /** A message on the wire. */
    export const Message = Schema.Struct({ id: Schema.String })
    export type Message = typeof Message.Type
    ```

    The compiler's existing `schemas_declarations.go` behavior (type after the constant, `EFNoComments` on the type) is the rule, not a defect; the spec round states it in chapter 001's declaration-output section beside the `schema` row, and chapter 006 may show the emitted pair. Fixers add a declaration regression (documented `schema` emits one comment) and a keyed fuzz mutation over tag kinds (`@internal`, `@deprecated`, multi-line docs) checking that the type alias stays bare. Decided by the agent from chapter 001's idiomatic-declaration rule, principle 1 (what Effect TypeScript writes), principle 7 (no syntax for non-idiomatic behavior) and principle 8 (no new permission), 2026-10-31. Class A; no Will question.

    **256 current-scope clarification, decide-live, 2026-11-02.** The new Mac question `foldkit-schema-alias-doc` proposes a written type alias replacing the synthesized alias beside `schema X`. That replacement is an additional declaration rule; it is not adopted merely because its tokens already exist in TypeScript. Choose option B under existing256, accepted VIP-27's documented-schema amendment and principles4/8: retain the current constant-only documentation rule and keep the independently documented original const/type pair in TypeScript when required. Do not copy or discard either comment, synthesize an override, or weaken the target comparison to force a conversion.

    The earlier sentence saying every migration identity gate strips comments is not applicable to Foldkit's stronger raw published-declaration contract. Existing277 requires that actual contract, so four reported modules may correctly remain TypeScript. No separate-comment or alias-replacement permission is introduced, and valid existing source and native TypeScript declaration rules are unchanged. This is current accepted scope, not a permanent ban on a future approved amendment. The question is settled by the agent from already-accepted256/VIP-27 and the conservative principle, not answered by Will.

    **Newer owner-authorized amendment plan (2026-11-02T13:23Z):** foldkit agent now applies Will's actual sugar principle (anything Effect TypeScript can write, the sugar should write) to foldkit-9/48; `foldkit-sugar-amend` drafts the VIP change. For a written `type X = typeof X.Type` beside `schema X`, the plan retains that exact written alias and its own JSDoc instead of synthesizing a duplicate alias. This supersedes this detail's earlier current-scope deferral of that feature when the new amendment applies; it does not authorize arbitrary conflicting alias replacements or copying/dropping native comments. Retain the four separately documented native files until the matched spec/compiler change lands and raw public declarations pass277. Owner plan is authorized from Will's principle, not an invented new Will answer, current compiler acceptance or completed fix.

    **Accepted foldkit-9 amendment, decide-live, 2026-11-02:** `loop/WILL-ANSWERS.md` now records Will's actual acceptance, “Accept good ideas”, relayed by effectscript-11, of `foldkit-sugar/foldkit-9.md`. The first paragraph is current; the former constant-only deferral and later plan-only status below it are historical. One same-scope nongeneric written `type X = typeof X.Type` replaces the synthesized alias in either source order; preserve each declaration's own JSDoc, order and exports under the native emit options. Other type-name collisions remain errors. Do not duplicate a written alias or move documentation between declarations.

    ```vibe
    /** Value documentation. */
    export schema Message { id: string }
    /** Type documentation. */
    export type Message = typeof Message.Type
    ```

    Effect TS:

    ```ts
    /** Value documentation. */
    export const Message = Schema.Struct({ id: Schema.mutableKey(Schema.String) })
    /** Type documentation. */
    export type Message = typeof Message.Type
    ```

    Decided from Will's recorded acceptance and his normal-syntax/sugar principle, 2026-11-02. Class A; no new question. This is design acceptance, not a landed implementation or successful migration receipt. Keep native files until the matching compiler and actual raw declaration gate pass.

    **Native `stripInternal` counterpart, owner receipt 2026-11-02T19:29Z:** the synthesized bare alias may remain after the constant's own `@internal` removes the value; native TypeScript produces that same consumer `TS2693`. The owner records12 byte-equal declaration pairs,36 source emits and72 real consumers (`skipLibCheck:false`):36 unstripped passes and36 stripped `TS2693` rejections. Stock7.1 independently confirms; the Vibe binary was c9 with source equality checked through ee96/candidate, not a claimed fresh e4 run. Preserve comment ownership and the native limitation. Do not delete the bare alias or copy `@internal` onto it merely to make consumers pass. A genuinely written alias retains its own native comment/visibility behavior under accepted foldkit-9. Reconcile the old consumer oracle against current006/007 by comparing exact native limitations; never blanket-ignore `TS2693`, `stripInternal` or other non-native declaration defects. This is already-decided256/277 and principle2, no new emitter rule, test waiver or Will question.

### Detail 286

**A mapped generic schema built-in is selected by its resolved TypeScript type binding, never its spelling.** (R10 Opus OPUS-2; accepted VIP-15, chapter000's hygienic intrinsics rule, chapter006's Schema-value requirement; principles2/3/8.) The generic table's `Array<T>`, `ReadonlyArray<T>`, `Record<K,V>` and `Readonly<T>` mean the corresponding TypeScript-library type symbols. Use ordinary TypeScript type-meaning lookup and alias resolution. A local or imported type with that spelling does not become the built-in; a value-only binding does not by itself replace a separate library type binding. Do not expand an arbitrary user type alias into a decoder.

    If lookup does not select the mapped library built-in, apply the existing ordinary Schema-value and arity rules. A reference with no suitable Schema value is `EK2109`; having the same name as a table row is no exemption. This adds no generic Schema API or runtime name dispatch.

    ```vibe
    type Record<K, V> = { k: K; v: V }
    schema S { a: Record<string, number> } // EK2109: this is the local type, not lib Record
    ```

    Effect TypeScript counterpart: a type alias supplies no runtime Schema. A repair writes the actual decoder, for example `const Entry = Schema.Struct({ k: Schema.String, v: Schema.Number }); const S = Schema.Struct({ a: Entry })`, rather than silently using `Schema.Record` for the local alias. The unshadowed library `Record` keeps the existing documented mapping and modifier rules.

    Publish006 and the VIP-15 companion. Regression/fuzz coverage varies each mapped generic name, local/imported bindings, qualified references, aliases, value-only versus type shadowing and actual Schema-value repairs; assert `EK2109` or the unchanged decoded shape as appropriate. The compiler probe's silently changed payload type is attributed evidence, not this lane's execution.

    Decided by the agent from principle3 (hygienic symbols, not spellings), principle2 (TypeScript's separate type/value lookup) and principle8 (reject an unprovided decoder), 2026-11-01, under Will's 2026-10-29 delegation. Class A.
