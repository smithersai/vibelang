# VIP-9: `service` declarations

**Status:** accepted by Will, 2026-10-28.

## Decision

```ts
// fragment
// VibeLang
service Users {
  find(id: string): User!NotFound
}

// compiles to exactly Effect's class
class Users extends Context.Service<Users, {
  find(id: string): Effect<User, NotFound>
}>()("@acme/app/src/users#Users") {}
```

- `service Name { members }` is the only way to declare a service. An `abstract class` is no longer a service.
- **The key.** The key is Effect's run-time identity for the service. It is derived from the package, the file and the name. A service can write it explicitly instead, `static readonly key = "app/Users"`, as a migrated service does to keep its key. A duplicate key anywhere in the program is a compile error (EK3001).
- **A default.** `static readonly defaultValue`, of the same type as `Context.Reference`'s `defaultValue` (`() => Shape`), makes the service a `Context.Reference`. Nothing has to provide it, and providing it overrides the default.

  ```ts
  service Flags {
    static readonly defaultValue = () => ({ newCheckout: false })
    newCheckout: boolean
  }
  // Context.Reference<{ newCheckout: boolean }>("…#Flags", { defaultValue: () => ({ newCheckout: false }) })
  ```

- **Amended 2026-10-30: service default initializer context.** A service's `static readonly defaultValue` initializer uses the source class-field context, outside enclosing Effect execution and `fork`/`join` reservation. `try e` is `EK0501` there; compute an Effect-based factory in the surrounding permitted body first and assign that value. An ordinary `join(...)` helper call remains ordinary in the initializer. Preserve eager once-only declaration evaluation, source order, bindings/TDZ, cold enclosing bodies and eager throw checks. Creating the factory is distinct from native Reference fallback invocation; emitted options-object syntax grants no source permission or extra runtime wrapper. The factory must still have type `() => Shape`.

- **Two types,** as in Effect. `Users` is the identifier, the type that appears in R. `Users.Shape` is the members, the type an implementation has; Effect writes it `Context.Service.Shape<typeof Users>`.
- Contracts are written out, because members have no bodies to infer from.
- **Misuse checks.** A service is a key, not a class you use, so these are compile errors:

  | Error | Code | Why |
  | --- | --- | --- |
  | `class X extends Users {}` | EK3002 | X would inherit Users' key and silently become the same service |
  | `new Users()` | EK3003 | |
  | `impl instanceof Users` | EK3004 | always false, because implementations are plain objects |
  | `service Repo<T> { … }`, or a member contract capturing an outer type parameter | EK3005 | specialized shapes would share one key; a parameter belonging to a member-local generic signature is allowed |

- **Amended 2026-10-29: any member type.** A bodyless `service` member may declare any return type, Effect or not, as `Context.Service` allows (the old EK2101 is relaxed). Sent to Will on Telegram 2026-10-29 12:28 under his standing rule 'assume I accept'; no objection by 13:00.
- **Amended 2026-10-29: no derived key outside a package.** A `service` in a file outside any package, or declared inside a function or block, has no derived key: omitting `static readonly key` there is a compile error with a quick fix that inserts one. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 54).


- **Amended 2026-10-30: recursive member shapes.** Declare the written member shape under a private type alias before constructing the service key. Inside that service's own shape, `S.Shape` denotes that alias directly, so recursive members do not project through the not-yet-constructed `typeof S`. Outside the shape it retains `Context.Service.Shape<typeof S>`. Apply this to both class services and defaulted `Context.Reference` services, using resolved service identity rather than spelling. The hook is type-only; no runtime namespace or `Shape` property is created.
- **Amended 2026-10-30: outer generic capture.** The generic-service diagnostic also rejects a resolved written Shape contract that depends on a free type parameter from an enclosing scope. Follow aliases, constraints, defaulted type arguments and callable thrown contracts; erased type arguments must not specialize one runtime key. A member's own generic parameters are allowed when their contracts do not depend on an outer parameter. A concrete parameter-independent shape inside a generic function remains allowed, as do unrelated generic value computations.

```vibe es
// compiler-gap: pending VIP-9
service NodeKey { static readonly key = "test/NodeKey"; next?: NodeKey.Shape }
function bad<T>() {
  service Store { static readonly key = "test/Store"; value: T } // error: the Shape depends on outer T
  return Store
}
service Fixed { static readonly key = "test/Fixed"; identity<T>(value: T): T }
```

```ts effect
import { Context, Effect, Layer } from "effect"
type NodeKeyShape = { next?: NodeKeyShape }
class NodeKey extends Context.Service<NodeKey, NodeKeyShape>()("test/NodeKey") {}
type NodeImplementation = Context.Service.Shape<typeof NodeKey>
const implementation: NodeImplementation = { next: {} }
const recursiveShapeExit = Effect.runSyncExit(Effect.provide(
  Effect.gen(function* () { const node = yield* NodeKey; return node.next !== undefined }),
  Layer.succeed(NodeKey, implementation)
)) // Success(true)
type RefShape = { next?: RefShape }
const Ref = Context.Reference<RefShape>("test/Ref", { defaultValue: () => ({}) })
type RefImplementation = Context.Service.Shape<typeof Ref>
const refImplementation: RefImplementation = { next: {} }
const referenceShapeExit = Effect.runSyncExit(Effect.gen(function* () {
  const value = yield* Ref
  return value.next === undefined
})) // Success(true)
```

- **Amended 2026-10-30: migration warnings.** The transitional compiler reports `EK4854` for a safe migration from the retired abstract-class spelling to `service`, retaining its contract and key, and `EK4855` for `static readonly default = shape` to `static readonly defaultValue = () => shape`, including corresponding type and value reads. An abstract class keeps ordinary TypeScript semantics until explicitly migrated. These warnings retain their emitted compatibility codes until a coordinated compiler/documentation renumber; the existing safe-fix and refusal rules apply.

- **Amended 2026-10-30: incomplete declaration diagnostics.** A recognized service declaration missing its required body is `EK0906`. Every custom `service` declaration in a native TypeScript ambient source context is unsupported (`EK0907`), before missing-body recovery for that declaration. This includes explicit `declare service` and inherited ambientness through nested namespaces, ambient external modules, `declare global` and native declaration-file contexts wherever the source syntax can otherwise occur. `export`, a complete body, an explicit key or a default does not escape that ambientness. Determine the context from source semantics, not the declaration's spelling; preserve ordinary native ambient classes/consts, imported real keys and generated `.d.ts` output. Use the intended runtime declaration or import the real service key; do not synthesize an ambient service or an empty implementation. Ordinary TypeScript ambient class/const declarations keep their rules. These codes label existing rejections; they add no admitted syntax.

## History

| Problem | Kind | Status |
| --- | --- | --- |
| Two installed copies of a package shared one service (private brands) | lego | fixed, by the derived key |
| `Users` vs `Users.Shape` confused | local | fixed (D519) |

Declarations drew no review findings after round 4. The call shorthand `Users.find(id)` is a separate VIP.

## Prior art

Effect's `Context.Service` and `Context.Reference`; a ZIO service trait; an Angular or NestJS injection token.

## Will's words

> "yea remove that I don't accept that 2 spellings."

> "even though we treat it like a class these safeguards make sense. I acccept static default but name it defaultValue. and the same type as defaultValue in context.reference. With all that and all our changes I accept this VIP"

## Footnote: old VibeLang

Old VibeLang is a reference only; nothing in it is part of the language unless a VIP adds it. For implementers, this VIP replaces:


D40's abstract-class services, and `static readonly default`, which becomes `defaultValue`.

- **Amended 2026-11-01: omitted member types.** Bodyless method and property signatures follow TypeScript's interface rules. Under `noImplicitAny`, `read()` reports `TS7010` and an untyped property reports `TS7008`; with that option off they have implicit `any`. An explicit `read(): any` is valid under strict checking. No separate VibeLang error, inferred Effect contract or Effect-only return restriction applies. The repair is the intended written type.

## Details

Decided details folded in on 2026-11-03. Each keeps its old number as history. The conflict pass deleted superseded, duplicate and relic details and resolved contradictions in favor of Will's words, then accepted VIPs, then later details. Principles are numbered as in [the introduction's Details](../src/000-intro.md#details).

### Detail 21

(VIP-9) A bodyless `service` method may declare any return type, as `Context.Service` allows (relax EK2101).

### Detail 54

(NW 17; VIP-9) A `service` in a file outside any package, or declared inside a function or block, has no derived key: omitting `static readonly key` there is a compile error with a quick fix that inserts one.
    ```vibe
    // /repo/tools/x.vibe, no package.json
    service Users { }                                    // error: write static readonly key
    service Users { static readonly key = "tools/Users" } // ok
    ```
    Effect TS: `class Users extends Context.Service<Users, Shape>()("tools/Users") {}`. Decided by the agent from principle 8 (a repository-relative key changes when the repository moves); 2026-10-29.

### Detail 231

**Assign owner-block diagnostics to already-incomplete custom declaration forms.** (Opus round30 m14 extension after m54; accepted VIP-9/VIP-15/VIP-16/VIP-34; details60/212.) Use `EK0906` for a recognized service declaration missing its required body, `EK1503` for a recognized ordinary schema declaration missing the body or other already-admitted form required there, and `EK1604` for a recognized data declaration missing its required variant body. Use `EK0907` for the unsupported ambient `declare service` prefix; it takes priority over the same declaration's missing-body recovery. Accepted service syntax creates a runtime key and has no ambient-service form; suggest the existing runtime declaration or importing the actual service key, not silently inventing an ambient service API. Existing TypeScript ambient class/const and declaration-output counterparts retain their ordinary rules.
    Status: landed on main f58798560fe7 (commit 8048dc684df0; spec-fix-c, stack 815bb0b4841c).
    Status: applied in 58a5db00d9c3f261804f99cc591c7b146db5565e (spec-fix-c; queued, not yet a main receipt).
    Status: applied in a003b6faf5b7e9b98f12131814f90ace29cb7c0a (spec-fix-c; queued, not yet a main receipt).
    These entries only label rejections already required by the accepted productions. They do not admit bodyless service/schema/data declarations, turn missing braces into an empty body, forbid an admitted schema alias, or remove the explicitly allowed bodyless `error`/`schema error` forms. Preserve contextual declaration-keyword classification, ordinary native TypeScript errors on ordinary source, independent unsupported type-parameter/member checks, and parser recovery without duplicate root-cause noise. A brace insertion can be offered when it forms the intended valid declaration; do not invent members, keys or a runtime implementation for an ambient request.
    ```vibe
    service Missing // EK0906: required service body missing
    schema Missing // EK1503: required schema declaration form missing
    data Missing // EK1604: required variant body missing
    declare service Missing // EK0907: unsupported ambient service form
    error Allowed // existing bodyless error form remains admitted
    schema error AlsoAllowed // existing bodyless schema-error form remains admitted
    ```
    Effect TS: valid runtime alternatives remain the existing `Context.Service`/`Context.Reference`, `Schema.Struct` or admitted schema-alias, and `Data.taggedEnum` counterparts; invalid incomplete forms have no runtime counterpart. Decided by the agent from the accepted declaration productions (VIP-9 explicitly says service Name with members is the service form), VIP-34/detail60's agent-owned diagnostic allocation, principle4 (complete the existing catalog without another declaration kind), and principle8 (no unspecified ambient/runtime-key API), 2026-10-30. All four printed codes and numeric906/907/1503/1604 are absent from the actual registry and AppendixB at fetched immutable maine0671f9473e6, plus the shared decision/live logs when allocated; `root-round30-code-availability.json` retains the checks. This is catalog/recovery policy only, not a claim that the current compiler emits these codes or that source/regressions landed. Reconcile005/006/AppendicesA/B and relevant public VIP amendments together.

    **Ambient-context scope clarification (existing `EK0907`, not a new declaration kind).** The unsupported source ambient-service class is semantic: reject a custom `service` declaration whenever native TypeScript ambient-context rules make its source region ambient, even if that service has no own `declare` token. This includes inherited ambient context inside `declare namespace`, ambient external `declare module`, `declare global`, and a native declaration-file context wherever custom source service syntax can otherwise occur. Nested regions and an `export` modifier do not escape inherited ambientness. The same `EK0907` owns this rejection and takes precedence over that service's missing-body `EK0906` recovery, as for an explicit `declare service`. A complete body, explicit key or `defaultValue` does not create an ambient-service alternative. No runtime service/key construction is prescribed for a rejected form.
    ```vibe
    declare namespace Ambient {
      service Users { static readonly key = "app/Users"; find(id: string): User!NotFound } // EK0907: ambient context
    }
    declare global {
      service GlobalUsers { static readonly key = "app/GlobalUsers"; find(id: string): User!NotFound } // EK0907
    }
    service RuntimeUsers { static readonly key = "app/RuntimeUsers"; find(id: string): User!NotFound } // ordinary runtime form
    ```
    Effect TS: `declare namespace Ambient { class Users extends Context.Service<Users, { find(id: string): Effect.Effect<User, NotFound> }>()("app/Users") {} }` is a native ambient declaration that erases without constructing a service; its TypeScript acceptance does not supply the runtime key promised by the custom source form. Ordinary native ambient classes/consts, imported real service keys, generated `.d.ts` class/namespace counterparts, and admitted bodyless `error`/`schema error` declarations retain their existing rules. Ordinary nonambient service contexts retain their current admission and key rules. Determine ambientness using the source context, not a spelling heuristic or a ban on native ambient syntax.
    Decided by the agent from accepted VIP-9's single runtime-key service form and detail231's already-decided absence of an ambient-service form, principle2 (mirror TypeScript for recognizing ambient context), principle4 (one rejection class rather than a prefix exception), and principle8 (do not invent an ambient runtime-key API), 2026-10-30. Clarify chapter005, public VIP-9 and both diagnostic summaries under detail213; spec-fix-c retains its existing source claim. The strict TypeScript5.9.3 reference source, emitted JavaScript and empty diagnostic log were read from the fixer's scratch: both ambient native classes erase, but no VibeLang/compiler probe was run here. This clarifies existing231; it does not allocate another code, new decision number or new Will question.

### Detail 262

**Experimental browser capabilities use ordinary Effect services and explicit provider boundaries; host values add no source exception.** (exp-browser-foldkit design note 2026-10-31T17:56:10Z, corrected 19:28:15Z and 21:51:09Z; accepted VIP-9/VIP-12/VIP-33; details101/201/261; principles1/3/4/7/8.) Adopt the proposed capability-by-capability direction under `Experimental`: `MediaQuery.MediaQuery`, `FileReader.FileReader`, `Animations.Animations`, `Document.Document`, `BrowserInfo.BrowserInfo` and `ResizeObserver.ResizeObserver`, provided through the browser platform modules and aggregate browser layer. These are provisional Experimental package names/contracts under VIP-33, not added VibeLang syntax or a compatibility promise. Reuse an upstream Effect/browser capability wherever it already exists instead of duplicating it. The runtime owner validates exact exports and pinned upstream availability before shipping.

    Keep live host access lazy at operation execution, not module import or aggregate-layer construction. A worker must be able to construct the combined browser layer without requiring every window API. A missing required host capability defects only when the corresponding operation runs; it does not gain a new recoverable source error or a run permission. Facts are Effect values and event sequences are Streams, with ordinary interruption/resource cleanup. Use the established PlatformError counterpart for host refusals instead of inventing one error class per browser wrapper; exact per-operation error types remain implementation work with native failure controls. Preserve original initial events, listener order, same-turn callbacks, frame timing and cancellation. Detail261 separately settles the atomic scheduling operation; this record does not re-admit its proposed plain-host exception.

    **The Document choice.** `Experimental.Document.Document.current` may succeed with the actual DOM `Document`, keeping its event-map type when passed as data to the existing Effect BrowserStream APIs. Do not widen it to `EventTarget` merely to hide host members, and do not reimplement an existing Effect event helper. This is typed capability data, not a new global or a sandbox bypass: existing derived-global/reference and foreign/host-member call checks remain. Returning or passing a host object does not authorize calling its members without the checks/bridges already required at that source site. Preserve ordinary type identity, aliases and source call syntax.

    ```vibe
    // fragment: proposed runtime capability; not present on audited main
    effect function eventTarget() {
      const document = try (try Experimental.Document.Document).current
      return document // pass the typed value to an existing Effect event helper
    }
    ```

    Effect TS:

    ```ts
    // fragment: the same proposed service contract
    const eventTarget = () => Effect.gen(function* () {
      const service = yield* Experimental.Document.Document
      return yield* service.current
    })
    ```

    **The provider choice.** A library may explicitly provide the browser implementation to a constructed Stream with normal `Stream.provide`, preserving an original requirement-free public Stream when that is the faithful native Effect counterpart. That explicit inner provider owns its requirements and native precedence. It does not promise that a caller can override its captured implementation by providing the same service outside it. Do not add such an override, automatic layer, hidden runner or changed declaration to make tests pass. A separately injectable variant or `make(host)`/test layer can be an explicit ordinary API; migration still must preserve the original public signature and timing, or retain the TypeScript boundary. No compiler rule erases an R slot merely because a browser layer is imported.

    ```vibe
    // fragment: proposed runtime capability and platform module
    import { ExperimentalBrowserMediaQuery } from "vibelang-runtime/experimental/platform-browser"
    const queries = Stream.unwrap(effect {
      const mediaQuery = try Experimental.MediaQuery.MediaQuery
      return mediaQuery.changes("(prefers-reduced-motion: reduce)")
    })
    export const reducedMotion = Stream.provide(queries, ExperimentalBrowserMediaQuery.layer)
    ```

    Effect TS: the same `Stream.provide` call over `Stream.unwrap(Effect.gen(function* () { const mediaQuery = yield* Experimental.MediaQuery.MediaQuery; return mediaQuery.changes("(prefers-reduced-motion: reduce)") }))`. Requirement discharge and provider precedence are those of the ordinary API, not a new language behavior. Native TypeScript implementation code owns `make(host)` and the platform layer; using an explicit host slice/test layer is an API convention, not a permission to read host globals in `.vibe`.

    The proposed API/candidate has not been inspected or executed by this policy lane; the owner reports `c38e9f7e898d` queued. Product source, real-browser/worker tests, typings, public declarations and property/fuzz coverage remain owner work. Validate import/layer coldness, missing-host operation defects, cleanup, real Document event-map typing and existing call diagnostics, explicit inner-versus-outer provider precedence and unchanged public Stream requirements. New service generality cannot silently change migrated target predicates (for example Element versus HTMLElement); preserve those original controls independently.

    Decided by the agent from VIP-33 (Effect services for missing capabilities, no duplicate upstream wrappers), VIP-9 (ordinary service member/data types), VIP-12 (ordinary explicit provider scope), principle1 (the native Effect counterpart), principle3 (resolved identity and source calls), principle4 (one capability/module convention), principle7 and principle8 (no extra syntax, runtime privilege or implicit injection), 2026-10-31. Class A; no Will question.


    **Bounded native provider evidence.** `native-loop-r3/browser-provider-boundary.mjs` passes three native Effect4.1 controls: an inner live Stream provider wins over an outer fake, the fake supplies an otherwise unprovided stream, and an outer Stream provider does not replace the inner live provider. Stream construction performs zero reads and three consumptions perform three reads. This tests ordinary provider precedence/coldness only, not the proposed API, actual Document types, browser/worker behavior, VibeLang, R-slot typing or delivered fuzz coverage. Receipt: `experimental-browser-shape-reference.json`.

### Detail 276

**A service member's omitted type follows native TypeScript `noImplicitAny`; it is not an independent VibeLang prohibition or inferred Effect contract.** (Earlier `service-untyped-method-native-any` policy inquiry from impl-hunt-svc; accepted VIP-9 any-member-type amendment, AppendixA's native `MethodSignature`/`PropertySignature`, existing21/175/189, principles1/2/4.) A bodyless method `read()` has TypeScript's implicit `any` return. With `noImplicitAny` enabled it receives native `TS7010`; with the option disabled it is admitted as an `any` return, including an explicit override of `strict`. An untyped property follows the corresponding native `TS7008` rule. An explicit `read(): any` is admitted under strict checking. There is no body to infer from and no automatic Effect/channel inference. VIP-9's “contracts are written out” means the written member signatures are the shape; it does not add a second mandatory-return-type error to native signature checking.

    Apply this to the service's native member shape, including member-local generics and ordinary optional forms, without changing the key/default/outer-generic-capture restrictions. A default factory must satisfy that shape; it does not secretly infer an omitted return channel. Retire the old Effect-only `EK9205` rejection at this site; preserve independent native signature diagnostics and existing legacy-inventory treatment rather than allocate a new code. Recommend a written return type as the repair for `TS7010`, not “make every service member Effect-returning”.

    ```vibe
    service Reader {
      static readonly key = "test/Reader"
      read() // TS7010 with noImplicitAny; any return when that option is false
    }
    service ExplicitReader {
      static readonly key = "test/ExplicitReader"
      read(): any // admitted under strict
    }
    ```

    Effect TypeScript:

    ```ts
    import { Context } from "effect"
    interface ReaderShape { read() } // same native noImplicitAny rule
    class Reader extends Context.Service<Reader, ReaderShape>()("test/Reader") {}
    ```

    Decided by the agent from VIP-9's native Context.Service shape and any-member-type amendment, principle2 (TypeScript has the exact signature/option rule), principle1 (the Effect TypeScript counterpart), and principle4 (no separate implicit-any scheme), 2026-11-01. Class A; no new Will choice or change to the accepted MethodSignature grammar. Seven stock TypeScript5.9.3 Context.Service-shape controls pass: strict/loose/override method returns, explicit `any`, strict/loose properties and a generic method. Receipt: `native-loop-r3/service-implicit-any/receipt.json`. These do not test the VibeLang parser/checker or an implementation candidate. Existing `impl-hunt-svc` ownership and its earlier plain-return fix/receipt paths are retained; no duplicate compiler patch or queue replacement is made here. Owners add the failing-main regression and spec-quoted keyed fuzz over method/property annotations, compiler options, optional/generic members, class/defaulted services and independent restrictions.

### Detail 302

**Accept `service Name: Type { ... }` under Will-approved foldkit-48; earlier native-only deferral is superseded.** The accepted exact-shape rule and examples below are current; implementation and unchanged target gates remain separate.

    **Accepted foldkit-48 amendment, decide-live, 2026-11-02:** `loop/WILL-ANSWERS.md` records Will's actual acceptance, “Accept good ideas”, relayed by effectscript-11, of `foldkit-sugar/foldkit-48.md`. It supersedes the former conservative deferral and plan-only status. `service Name: Type { ... }` supplies the exact whole Shape; the required body permits only the existing `key` and `defaultValue` members. Pass the written type directly to `Context.Service<Name, Type>` or, with a default, `Context.Reference<Type>`. `Name.Shape` resolves to the supplied type where chapter005 permits it; preserve the reference and modifiers without an extra shape helper or namespace. Existing ambient, generic-capture, key and default rules apply. Body-only services retain their existing meaning.

    ```vibe
    import { Context } from "effect"
    export type Shape = { readonly value: string }
    service Port: Shape { static readonly key = "probe/Port" }
    export type Implementation = Context.Service.Shape<typeof Port>
    ```

    Effect TS:

    ```ts
    import { Context } from "effect"
    export type Shape = { readonly value: string }
    class Port extends Context.Service<Port, Shape>()("probe/Port") {}
    export type Implementation = Context.Service.Shape<typeof Port>
    ```

    Decided from Will's recorded acceptance and his normal-syntax/sugar principle, 2026-11-02. Class A; no new question. Existing-type providers stay native until the matching spec/compiler delivery and unchanged runtime/raw-declaration gates pass. No new runtime API or arbitrary service body member is approved.
