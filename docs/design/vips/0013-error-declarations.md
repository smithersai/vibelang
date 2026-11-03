# VIP-13: `error` declarations

**Status:** accepted by Will, 2026-10-28.

## Decision

```ts
// VibeLang
error NotFound { id: string }
error Timeout                                   // an error with no fields

// exactly this Effect TS
class NotFound extends Data.TaggedError("NotFound")<{ readonly id: string }> {}
class Timeout extends Data.TaggedError("Timeout") {}

// using one (VIP-4, VIP-5, VIP-7)
throw new NotFound({ id })                      // in an effect function: fails with NotFound
fetchUser(id) catch (e) => match (e) { when NotFound: guest; }
```

- `error Name { fields }` declares exactly Effect's `Data.TaggedError` class. The tag is always the name, and every field is readonly.
- **Amended 2026-10-30: payload key erasure.** Plain `error` payload fields are `Data.TaggedError`'s generic type argument. Their computed type keys cause no runtime lookup, evaluation or TDZ read; declaration output retains the type. Admitted `schema error` field keys belong to the runtime schema object and evaluate normally, while actual methods/getters retain TypeScript's computed-name evaluation. A shared runtime-key rule never makes a plain payload type into an object initializer. See [Error declarations](../src/003-failures.md#error-declarations).
- The body may hold methods and getters, as any class can, for example `get message() { return \`no user ${this.id}\` }`. It may not hold a constructor or a `_tag` override.
- **Amended 2026-10-29: no `extends`.** An `error` declaration always extends `Data.TaggedError`, so `error UserNotFound extends NotFound { … }` is a compile error. Errors are grouped with a union, as in `type LookupError = NotFound | Timeout`, because tagged errors are matched by `_tag` and a subclass would match two tags. Recorded under Will's standing approval of recommendations.
- The base is `Data.TaggedError`, which can't be decoded from JSON. Serializable, Schema-based errors are left to the `schema` VIP.
- Two packages that both declare `error NotFound` match each other, as with Effect's `catchTag`, because VIP-7's matcher tests `_tag`.
- **Ambiguity: none.** `error` is a contextual keyword on the same line as its name, so `const error = …` and `catch (error)` still work.
- **Amended 2026-10-29: no user-written `static` members or setters** in `error` or `schema error` bodies, for now. Sent to Will on Telegram 2026-10-29 11:28 under his standing rule 'assume I accept'; no objection by 12:00.
- **Amended 2026-10-29: no type parameters.** `error Invalid<T> { value: T }` is a compile error, for now. Sent to Will on Telegram 2026-10-29 11:28 under his standing rule 'assume I accept'; no objection by 12:00.
- **Amended 2026-10-29: exactly VIP-13.** `error` declarations allow no `extends` and no `_tag` override; EK2117 enforces it. Sent to Will on Telegram 2026-10-29 12:28 under his standing rule 'assume I accept'; no objection by 13:00.

*Corrected 2026-10-29: the example ends every `match` arm with `;`, the last one included, as the pinned TC39 grammar requires; a newline is not a separator (found by the round-3 review).*

- **Amended 2026-10-30: computed payload key admission.** Plain `error` payload fields use the native TypeScript `TypeLiteral` member checks of `Data.TaggedError`'s payload type. Expression shape matters as well as key type: an identifier or property access of type `number` can be admitted while a call returning a literal, a parenthesized key or element access receives native `TS1170`. Only admitted payload keys are erased; actual runtime member names keep their ordinary evaluation. The runtime Schema fields object in VIP-29 has its own native key admission.

## Amendment: member diagnostic priority

A getter, setter or constructor rejected for an Effect modifier receives the applicable Functions diagnostics without an additional error-body category diagnostic, for both `error` and `schema error`. In particular, `async effect get x() { }` receives both `EK0104` and `EK0105` (VIP-1). Other rejected members use the first applicable member rule; the general category rule is the fallback.

## History

Every finding was about error classes combined with `match` exhaustiveness: round 2 M7 and round 8 M1 (majors), plus five minors, all lego-kind. VIP-7's custom matcher, which tests `_tag`, settles them. The declaration syntax itself drew no findings.

## Prior art

Zig's `error{NotFound}`, Swift's `enum: Error`, Rust's `thiserror`, Effect's `Data.TaggedError`.

## Will's words

> "Ok accept. Your best judgement on the questions is correct"

(The questions: the base, Data rather than Schema; and the body, methods and getters but no constructor or `_tag` override.)

## Details

Decided details folded in on 2026-11-03. Each keeps its old number as history. The conflict pass deleted superseded, duplicate and relic details and resolved contradictions in favor of Will's words, then accepted VIPs, then later details. Principles are numbered as in [the introduction's Details](../src/000-intro.md#details).

### Detail 8

(VIP-13) No user-written `static` members or setters in `error` or `schema error` bodies, for now.

### Detail 9

(VIP-13) No type parameters on `error`, for now (a compile error).

### Detail 24

(VIP-13) `error` declarations follow VIP-13 exactly: no `extends` and no `_tag` override (EK2117 enforces it).

### Detail 103

**An `error` class pattern's binding narrows as `Effect.catchTag` does** (Fable r18 design cost 2; refines 004's typing table; keeps VIP-13's cross-package `_tag` matching). For `when NotFound(let e):` and `when NotFound:`, the narrowed type is the subject's own members whose `_tag` is the literal `"NotFound"` (TypeScript's discriminant narrowing, `Extract<S, { readonly _tag: "NotFound" }>`), when the subject's type has any. Only when it has none (`unknown`, `any`, a non-union object type) does the binding take the declared class type `NotFound`, the case where an object from another package with the same tag can reach a getter the local class declares. 004's typing table states that hole in its "TypeScript intuition" list; it is not an error.
    Status: applied in 12d6a3b9ce5e on main (source/cross-reference revalidated by spec-fix-c; no duplicate patch).
    ```vibe
    effect function f(e: NotFound | Timeout) { return match (e) { when NotFound(let n): n.id; when Timeout: 0; } }   // n: NotFound (from the subject)
    function g(x: unknown) { return match (x) { when NotFound(let n): n.id; default: "" } }                        // n: NotFound (declared class; documented hole)
    ```
    Effect TS: `Effect.catchTag("NotFound", (n) => …)`, whose `n` is `Extract<E, { _tag: "NotFound" }>`. Decided by the agent from principle 2 (TypeScript's discriminant narrowing) and principle 1 (`catchTag`'s typing); no compiled program changes; 2026-10-29. Apply to 004's typing table row and TypeScript-intuition list.

### Detail 188

**Error-body methods include TypeScript class overload declarations.** (live `900-error-method-overloads`; VIP-13/VIP-29 method admission, distinct from detail 175's effect overload productions.) Classify TypeScript class method declarations and their bodyless overload signatures as accepted methods in both `error` and `schema error` bodies; do not send them to `RejectedElement` merely because ECMAScript's narrower `MethodDefinition` requires a body. This includes ordinary plain and async method overloads in the positions TypeScript admits. Preserve its ordering, adjacent implementation, compatibility, modifiers and declaration emission rules. Keep every explicit error-body restriction, including constructors, setters, static members and error type parameters. This does not generally admit ambient members, bodyless object-literal methods or starred overload signatures that TypeScript rejects.
    **Immutable-main source receipt (695576, 188).** Verified at immutable main `695576acb44b`: 003/AppendixA admit plain/async TypeScript class overload signatures in both error forms while retaining other rejected members. This is source-publication evidence only; no compiler/native/regression suite was run by decide-live.
    Status: applied in 2a1c089083b1 (spec-fix-a; queued, not yet a main landing receipt).
    ```vibe
    error Plain {
      label(x: string): string;
      label(x: number): number;
      label(x: string | number) { return x }
    }
    schema error Encoded {
      label(x: string): string;
      label(x: number): number;
      label(x: string | number) { return x }
    }
    effect function use() { return [new Plain().label("ok"), new Encoded().label(7)] }
    ```
    Effect TS: ordinary subclasses of `Data.TaggedError("Plain")` and `Schema.TaggedError<Encoded>()("Encoded", {})` carrying those same overload lists and one method implementation each. Calls expose `string`/`number` results; only the implementation emits a body. Decided by the agent from VIP-13's explicit promise of methods as in a TypeScript class, VIP-29's shared member restrictions, principle 2 (native TypeScript method overload syntax), and principle 4 (one class-method category instead of treating ordinary overload signatures as unknown members), 2026-10-30. Reconcile 003 and Appendix A's member partition; test plain and async overload controls without relaxing forbidden forms. `decide-live-scratch/root-error-method-overloads-types.log` passes strict checking of both error counterparts; `root-error-method-overloads-reference.log` records `Success(["ok", 7])` on Effect `4.1.0`. These are class/counterpart checks, not VibeLang compiler-conformance results.

Landing receipt: source 2a1c089083b1 landed in main 695576acb44b (queue 1793370440-spec-fix-a, gate mq-10302026-7).

### Detail 223

**Reserved schema-error keys use runtime key-domain exclusion, not raw nominal assignability.** (live006-computed-error-tag-domain; erratum to detail143's precise predicate; accepted VIP-13/VIP-29 no-`_tag`-override rule.) Reject a computed `schema error` key unless its well-typed runtime property-key domain can be proved to exclude the string `"_tag"`. The test `"_tag"` assignable to the raw key type is insufficient: generic constraints, nominal string enums and branded/refined primitive intersections can all make that assignability false while a well-typed runtime key is literally `"_tag"`. Replace only that defective test in143; preserve its conservative compile-error policy, existing reserved-tag diagnostic and version/code-alignment mapping, and no-runtime-guard policy.
    **Immutable-main source scope (d0cdbe, 223).** 003/006/AppendixB/VIP29 publish runtime-domain exclusion of reserved_tag including generics/enums/brands, without raw nominal-assignability escape or runtime guards. New computed-key admission233 remains separate. `root-main-d0cd-source-receipt.json` retains the complete31-file diff/hash/read scope. Source only; no decide-live compiler/gate rerun.
    Status: applied in a135733913d6b849719fbc706eda30217b25d26e (spec-fix-c; queued, not yet a main receipt).
    Resolve effective generic constraints recursively; a constraint of `string` or a union that may contain `"_tag"` is unsafe, while a generic constraint such as ``K extends `x_${string}` `` is safe. For enums include the actual underlying string values of every possible member, rather than asking whether an unbranded string literal inhabits the nominal enum. For intersections retain genuine primitive value constraints (a safe literal or template) but do not treat an opaque object brand/refinement marker as evidence that its underlying string cannot be `"_tag"`. For unions every possible component must exclude the reserved value. Known numeric and symbol domains, including unique symbols, cannot become that string property name; safe literals, safe literal unions/templates and their brands remain admitted. `never` has no possible key. An unconstrained/unresolved/cyclic or otherwise unprovable domain is rejected conservatively, as are `any`/`unknown` or broad string domains. Ordinary TypeScript invalid-key errors stay independent. This describes a conservative value-domain proof; it does not require enumeration of infinite string sets, execution of a decoder/refinement, inspecting user predicate bodies or a new reflection API.
    Emit accepted computed keys as written with their existing evaluation/order guarantees; do not unwrap values, add a runtime `_tag` guard or silently drop a field. A source branding assertion alone grants no escape from the accepted no-override rule.
    ```vibe
    enum Key { Tag = "_tag", Count = "count" }
    declare const key: Key
    schema error Bad { [key]: number } // reserved-tag diagnostic: Key.Tag remains possible
    schema error Good { [Key.Count]: number } // safe underlying literal "count"
    declare const branded: "_tag" & Brand.Brand<"Tag">
    schema error AlsoBad { [branded]: number } // branding does not change the runtime string
    ```
    Effect TS: the admitted case is `class Good extends Schema.TaggedError<Good>()("Good", { [Key.Count]: Schema.Number }) {}`; no accepted counterpart overrides TaggedError's discriminant. Decided by the agent from accepted VIP-29's explicit ban on `_tag` overrides, principle2 (native enums/constraints and brands preserve their primitive runtime values), principle8 (unproven key domains are compile errors), and143's already-chosen conservative/no-runtime-guard policy, 2026-10-30. This corrects the agent's inconsistent raw predicate under an existing ban; it does not request a new permission or change the public runtime API. `root-computed-tag-domain.log` independently passes strict TypeScript5.9.3 and Effect4.1.0 controls: raw assignability misses generic string, enum tag/union, branded string and branded tag; effective constraints expose the generic case; enum types retain their underlying literal values; real Schema-branded decoders return `"_tag"` without a user cast. Safe enum/literal/template/number/symbol controls are included. The fixer's matching native receipts remain attributed. No VibeLang compiler conformance, source fix or landing is claimed.

### Detail 273

**A fieldless plain `error` keeps VIP-13's no-type-argument counterpart; empty braces do not select a different declaration ABI.** (Corrects decide-live's unnumbered foldkit-90 advice at2026-11-01T02:50Z; fuzz-findings' fieldless twin report; accepted VIP-13's explicit `error Timeout` → `class Timeout extends Data.TaggedError("Timeout") {}`, VIP-27, principles1/4/8.) The earlier statement that every fieldless `error` must emit `extends X_base<{}>` was wrong and is withdrawn. The general declaration-fidelity rule in chapter001 does not override the specific native counterpart in accepted VIP-13/chapter003. Keep the established fieldless counterpart and its `extends X_base` declaration, for `error X` and `error X {}`; a body containing methods/getters but no payload fields also introduces no payload type argument. Written payload fields use their native readonly type literal as before. `schema error` has its own Schema counterpart and is not changed by this rule.

    Do not introduce the proposed brace/no-brace split merely to make two distinct TypeScript source spellings emit from one accepted source form. Existing fieldless VibeLang programs and the landed `FuzzErrorDeclarationTwin` already treat those spellings as the same form. A native `Data.TaggedError("X")<{}> {}` class can have a distinct declaration spelling. When replacing it with `error X`/`error X {}` would fail the required declaration-byte gate, the safe codemod refuses that conversion and retains the native class/TypeScript source under the existing migration rules; it does not silently drop the explicit type argument, weaken the baseline, or change all fieldless VibeLang declarations. No new language option or brace-sensitive semantic category is required.

    ```vibe
    error Timeout
    error TimeoutWithBraces {}
    error WithMethod { label(): string { return "x" } }
    error WithId { id: string }
    ```

    Effect TypeScript:

    ```ts
    import { Data } from "effect"
    class Timeout extends Data.TaggedError("Timeout") {}
    class TimeoutWithBraces extends Data.TaggedError("TimeoutWithBraces") {}
    class WithMethod extends Data.TaggedError("WithMethod") { label(): string { return "x" } }
    class WithId extends Data.TaggedError("WithId")<{ readonly id: string }> {}
    ```

    Decided by the agent from accepted VIP-13's exact counterpart, VIP-27's fidelity to that counterpart, principle1 (the native TypeScript result), principle4 (one fieldless form), and principle8 (preserve existing VibeLang declarations; refuse an unpreservable conversion), 2026-11-01. Class A; no Will question or breaking change to existing VibeLang. Four stock TypeScript5.9.3 declaration controls pass: bare base, explicit empty type argument, one readonly field and method-only body. The first and second emitted spellings are demonstrably different; this is native evidence, not a VibeLang/compiler/codemod/fuzz run. Receipt: `native-loop-r3/fieldless-canonical/receipt.json`. Main's twin source and quoted VIP/chapter were read with `jj`; its run/landing claims remain attributed. Preserve the existing plain-error twin corpus and both brace seeds under the approved counterpart. The separately claimed Schema-error twin gap remains with `fuzz-findings`; migration-specific refusal/declaration controls remain with the owning fixer. A compiler-only change to `<{}>` is not the authorized repair for foldkit-90.
