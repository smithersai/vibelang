# VIP-27: declaration output and `@throws`

**Status:** accepted, 2026-10-29, under Will's standing approval of recommendations ("assume I accept now. I will interrupt you if I need to").

## Decision

```ts
// load.vibe
export effect function load(id: string) { … }
export function parse(s: string) { if (!s) throw new BadInput(); return s }
export function add(a: number, b: number) { return a + b }

// load.d.vibe.ts, written next to load.vibe
export declare function load(id: string): Effect.Effect<User, NotFound, Users>
/** @throws {BadInput} */
export declare function parse(s: string): string
/** @throws {never} */
export declare function add(a: number, b: number): number
```

- **Content.** Declarations are exactly what idiomatic Effect TypeScript would declare, per Will's earlier ruling (D501).
- **Location.** `x.d.vibe.ts` is written next to each `x.vibe`, which TypeScript's `allowArbitraryExtensions` resolves, so plain `tsc` and TypeDoc understand `.vibe` imports. A package build also writes ordinary `.d.ts` files to its output directory.
- **`@throws`.** Every exported function carries `@throws`: its inferred thrown type, or `@throws {never}` when it can't throw. Under VIP-4, a function with no `@throws` throws `unknown`.
- *Updated by VIP-4's 2026-10-29 amendment:* `@throws` applies only to functions that don't return an Effect, so the effect function `load` carries none.
- The `@throws` annotations VibeLang ships for JavaScript's globals (VIP-4) use the same spelling.

- **Amended 2026-10-30: the generated matcher.** A declaration file that declares an `error` or `schema error` keeps its static `[Symbol.customMatcher]` member and begins with `/// <reference types="vibelang-runtime" />`, which declares the `Symbol.customMatcher` type, so plain `tsc` checks it and matching across packages works at run time. Decided by the agent on 2026-10-30 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 67c).

*Corrected 2026-10-29: `load` is declared with `export declare function`, because a declaration keeps its source form (VIP-1: `effect` goes exactly where TypeScript allows `async`) and idiomatic TypeScript declares a function declaration that way. The type is `Effect.Effect<…>`, as Effect TypeScript writes it.*

- **Amended 2026-10-30: ordinary async contracts survive declaration output.** A nongenerator `async` callable's `@rethrows` parameter retains throwing-callback admission as a parameter callable carrying `@throws {unknown}`; the emitted callee carries `@throws {never}` and no active synchronous `@rethrows`. Normalize declarations, methods, arrows, aliases and sidecars consistently. Use a local annotated parameter type rather than mutating a shared type alias; returned callables preserve their own contracts. This exception does not apply to async generators or ordinary Promise-returning functions.

### Amendment: Bun project scripts

`bun check` runs the project's `check` script; a script that invokes a TypeScript checker uses that checker's sidecar resolution. [Bun's script runner](https://bun.com/docs/runtime) executes the configured command.

- **Amended 2026-11-01: documented schemas.** A JSDoc comment on a `schema` declaration is emitted on its `declare const` only; its `typeof Name.Type` alias has no comment. This includes `@internal`, `@public` and `@deprecated`, as on the ordinary Effect TypeScript pair. Native `removeComments` and `stripInternal` behavior is unchanged. A separate type-comment form is not introduced.

### Amendment: an opt-in sidecar directory (2026-11-01)

The Location bullet stays the default: `x.d.vibe.ts` beside `x.vibe`, with no configuration. `vibe.sidecarDir` moves every sidecar of the project into one directory, conventionally `.vibe/declarations`, at the path the source has under the config's directory, so `src/x.vibe` gets `.vibe/declarations/src/x.d.vibe.ts`. The project's tsconfig adds the directory to `rootDirs` beside `.`, so stock `tsc`, TypeDoc and editors still resolve `import "./x.vibe"` under `allowArbitraryExtensions`:

```jsonc
{
  "compilerOptions": { "allowArbitraryExtensions": true, "rootDirs": [".", ".vibe/declarations"] },
  "vibe": { "sidecarDir": ".vibe/declarations" }
}
```

The hidden directory keeps sidecars out of code that enumerates a source folder's `*.ts` files, such as a test that imports every `*.ts` but `*.d.ts`. Switching the setting on or off removes each module's sidecar from the other place. The migrate flow's setup turns it on where tracked code enumerates `*.ts` files in a folder that will hold `.vibe` files. Decided detail 268 (spec agent, 2026-11-01, common sense and precedent: TypeScript's `declarationDir` and `rootDirs`); it reverses nothing.

Compatibility references preserve the source module selected by the original program, including explicit `.vibe` imports with a same-basename native `.ts` sibling. Written imports, re-exports and inferred import types retain that identity before relocation. The public declaration import style continues to govern ordinary `.d.ts` output; it cannot change which module a compatibility declaration represents. This follows the accepted Content contract and chapter 7’s source-import resolution.

Relative module references are written from the sidecar's final location. A reference to a VibeLang module targets that module's selected compatibility declaration; a reference to a native TypeScript module targets its native location. A consuming project does not inherit the producer's `rootDirs`, so producer-only virtual roots are not a substitute for correct relative specifiers. Public declarations still follow native `declarationDir` and `outDir` independently.

A workspace package's non-relative export, `paths` alias or package `#imports` entry resolving to a relocated sidecar uses its `.vibe` source when the owning config proves the mapping and TypeScript's final resolved path is outside `node_modules`. Config discovery follows VIP-30; inheritance and `${configDir}` retain their normal meanings. Apply normal `realpath` and `preserveSymlinks` policy first: a retained logical path inside `node_modules` keeps its declarations, even when its physical target is a workspace. Published packages also keep their declarations. This dated clarification follows decided detail 285 (2026-11-01); it does not merge source and declaration identities that native symlink policy keeps separate. Explicit declaration inputs retain details 281 and 283's overwrite protection.

Migration setup recognizes TypeScript ast-grep rules and quoted or unquoted script globs as well as source walks and test includes. It records the reason, preserves an effective existing directory, and adds the matching virtual root. When setup switches the layout it removes superseded adjacent sidecars immediately, preserves orphan declarations and selected outputs, and makes replay idempotent. A hidden directory does not guarantee exclusion by every recursive walker; implementation/test identities still have to be preserved, or the affected source stays TypeScript. These clarify the directory amendment under decided details 268 and 271 (2026-11-01); they add no output marker or backup.

## Prior art

Svelte's and Vue's TypeScript tooling; CSS modules' `.d.css.ts`; TypeScript's `allowArbitraryExtensions`.

- **Amended 2026-11-01: a sidecar is an emit output.** Discovery through `include` or default globs selects the source and omits its compatibility declaration, as native `.ts`/`.d.ts` discovery does. A declaration explicitly selected in `files` remains an input: an attempted compatibility write over it reports `TS5055`, exits `1`, and leaves its bytes unchanged. This includes `.d.vibex.ts` and mapped sidecar locations. VIP-27's independent compatibility write still runs under `noEmit: true` and `declaration: false`; those options retain their ordinary JavaScript/public-declaration output controls. The overwrite check follows that required write.

- **Amended 2026-11-01: sidecars reached by non-relative names.** After native resolution and `realpath`/`preserveSymlinks` handling, a non-relative export, `paths` or `#imports` resolution to a known `.d.vibe.ts`/`.d.vibex.ts` sidecar uses its available source only when the final path is outside `node_modules`. With relocated sidecars, follow the recorded source map, never a guessed basename. A retained logical `node_modules` path under `preserveSymlinks` keeps declarations. This Vibe-aware source preference changes which file is read, not native discovery or explicit-input overwrite protection; an explicitly listed declaration remains an input. Ordinary TypeScript source/declaration resolution is unchanged.

- **Amended 2026-11-02: declaration import spelling.** `vibelang.declarationImportStyle` ([VIP-30](0030-config-files.md)) spells a relative reference the source writes as `./x.vibe` in package declarations, the `.d.ts` files in the output directory: `./x.js` by default, `./x` for `"extensionless"` and `./x.ts` for `".ts"`. A source-adjacent sidecar, `x.d.vibe.ts` or `x.d.vibex.ts`, keeps `./x.vibe` under every setting, so plain `tsc` resolves it through `allowArbitraryExtensions`; JavaScript output keeps `./x.js`. A `./x.vibex` reference is declared through its JavaScript output by default, `./x.jsx` under `"jsx": "preserve"` and `./x.js` otherwise ([VIP-39](0039-vibex.md#options-output-and-declarations)); what `"extensionless"` and `".ts"` declare for it is not yet decided. Every other written specifier, `./helper.ts` included, stays as written. Recorded from decided detail 263 (C-prime, Will via proxy, 2026-10-31): "an opt-in package declaration spelling policy" ... "source-adjacent sidecars retain their existing VibeLang-source reference rules".

An empty `vibe.sidecarDir` string names the directory of its declaring config, as an empty TypeScript path does. A present child value overrides an inherited path; an absent child value inherits. Non-string values report `EK3007`. This is the path-inheritance contract of the directory setting.

Directory paths may overlap the source tree; emit still mirrors config-relative paths, and stale cleanup preserves every module's selected output. Stock TypeScript keeps its native `rootDirs` longest-prefix resolution. A separate sidecar directory avoids virtual-path collisions with sources inside that directory.

## Details

Decided details folded in verbatim on 2026-11-03 (mechanical pass). Each keeps its old number as history; where one conflicts with the text above, the fold's conflict pass resolves it.

### Detail 38

(NW 3; r11-003 "retained throw metadata"; VIP-27) `@throws` and `@rethrows` attach to a call signature, as TypeScript attaches JSDoc to each overload. A returned function's contract sits on its own call signature. Declaration output writes the inferred contract on every emitted call signature of exported functions, callable constants, methods and callable types.
    ```vibe
    export declare const parse: { /** @throws {BadInput} */ (s: string): string }
    declare function decodeUnknownSync<T>(s: Schema<T>): { /** @throws {SchemaError} */ (input: unknown): T }
    ```
    Effect TS: none (types only). Decided by the agent from principle 2 (TypeScript's per-signature JSDoc) and principle 4 (no new `@returnsThrows` tag); 2026-10-29.

    **Foreign boundary after Will's 2026-10-31 ruling (existing38/VIP-27).** Do not infer or attach a local thrown type to a VibeLang function. Keep actual imported `.ts`/`.js` contracts through aliases, re-exports, overloads and declaration-only imports. Source-available and emitted-declaration clients must agree on the callable's classification; simply deleting local metadata and then misclassifying its declaration as an unknown foreign function is not faithful output. For an ordinary Vibe-defined nonthrowing function, the existing constant `@throws {never}` foreign-declaration encoding may preserve that boundary fact where accurate; it is not a source annotation or local inference. Preserve foreign aliases' actual contracts instead of stamping a nonthrowing label on every function-valued export. Native async/generator phases retain their independent rules.
    ```vibe
    // pure.vibe
    export function add(a: number, b: number) { return a + b }
    export { foreignParse as parse } from "./foreign.ts"
    ```
    Effect TS: the same native function and re-export; an emitted foreign declaration can state `/** @throws {never} */ export declare function add(a: number, b: number): number` while the re-export retains `foreignParse`'s actual foreign contract. The VibeLang source has no thrown annotation. Decided by the agent from Will's foreign-only clarification, existing38/VIP-27's faithful import/declaration contract, principle3 (origin/alias identity, not spelling) and principle4 (no restored local inference), 2026-10-31. No new number or metadata scheme is allocated. Source/compiler owners must cover source-versus-declaration imports, local definitions versus foreign aliases, overloads and native callable kinds in regression/spec-quoted fuzz tests; no VibeLang emission test was run here.


    **38 published-boundary clarification, decide-live, 2026-11-02: retain the existing constant foreign encoding (round5 ASK-WILL1 option A).** The late sl5-apply receipt re-asks whether a compiled non-effectful VibeLang definition carries `@throws {never}` when consumed from its emitted TypeScript declaration. Existing38's post-ruling paragraph already allows that faithful boundary encoding; accepted VIP-27 defines it, and accepted VIP-39 explicitly says `SaveButton` carries it and compares public declarations to a `.tsx` twin “that carries the same `@throws` tags”. No new Will answer is needed to retain the current contract.

    Local VibeLang source still has no thrown annotation/inference under his ruling. The generated `.d.ts`/`.d.vibe.ts`/`.d.vibex.ts` is a foreign TypeScript boundary and preserves the actual source classification through the existing constant `never` encoding where accurate. Effectful signatures retain their existing no-tag treatment. Actual imported/re-exported foreign callable contracts are preserved, never stamped `never` merely because their export passes through a VibeLang module. Native callable phases and callback contracts remain independent.

    ```vibe
    // lib/add.vibe
    export function add(a: number, b: number) { return a + b }
    // emitted TypeScript declaration retains /** @throws {never} */ on add
    // another package's effect code can keep: return add(1, 2)
    export { parse } from "./foreign.ts" // retains parse's actual foreign contract
    ```

    Effect TS counterpart for the defined function is `export function add(a: number, b: number) { return a + b }` with the existing `/** @throws {never} */` declaration boundary fact. TypeScript itself ignores that metadata; a VibeLang declaration consumer uses the approved supplied contract instead of treating it as unknown. The source annotation ban is not a ban on foreign declaration metadata.

    Removing that boundary fact while keeping VIP-4's Effect-to-foreign trust check would change currently valid cross-package Effect calls; it is not required by removing local inferred thrown types. Principle8 and existing38 preserve the current behavior. Any intentional future removal is a separate compatibility change, not an implementation consequence of the sync-throw ruling.

    Preserve public-byte requirements under277. VIP-39's exact twin already includes matching tags; this grants no normalization or permission to add tags to an unrelated target repository's original public declaration. If an actual migration's stronger unchanged-byte/consumer gate cannot pass, retain/refuse that native source under277 rather than silently drop the supplied contract, weaken its gate or infer a new origin marker.

    Decided by the agent from accepted VIP-27, VIP-39's explicit same-tags declaration clause and `SaveButton` example, existing38's 2026-10-31 foreign-boundary clarification, principle3 (source versus declaration identity) and principle8 (preserve an existing permission), 2026-11-02 under the 2026-10-29 delegation. This is prior-rule reuse, not Will answering the owner-managed ASK-WILL1. Do not edit/close that owner's ask or add a duplicate Mac question; give the owner these sources to reconcile it. Publish any missing no-local-inference reconciliation through the existing nothrow source owners under213. No new number, metadata scheme, package-API change or compiler test here.

### Detail 255

**An explicit foreign `@throws {unknown}` is an affirmative may-throw contract, not the unannotated default.** (Loop r5 Opus OPUS-1 follow-up; Will's 2026-10-31 foreign-only tracking clarification and “throwing is unknown stays an ordinary call” default; existing details38/66, principles3 and8.) For the new synchronous VibeLang known-throwing-call gate, an actual imported `.ts`/`.js` signature with an explicit, shipped or generated `@throws` contract whose effective bound is not provably `never` is known to admit a throw. This includes a bound of `unknown`, `any` or an alias resolving to either. Reject an otherwise-unhandled synchronous plain-code call under the governing no-throw rule. An explicit `unknown` upper bound does not assert that every call throws; it affirmatively admits an exception of unspecified type, which the caller must not silently treat as absent.

    A foreign callable with no supplied contract keeps Will's separately stated ordinary-call default in synchronous plain code, even though its old foreign type default is also `unknown`. Preserve the distinction by the resolved signature's contract origin, not the spelling `unknown`, the import name or the presence of a function body. Do not infer from the foreign implementation that an explicit bound can be ignored. Preserve actual contracts through import aliases, re-exports, overloads and source/declaration clients under38/VIP-27. A known `never` contract remains nonthrowing. Existing admitted foreign-call handling and the approved Effect bridge remain; this rule creates neither a local VibeLang annotation/inference scheme nor a blanket proof that unannotated JavaScript cannot throw.

    Apply the existing wholly-Effect/Stream/Layer callee trust rule and native callable-phase classification before this contract test (36/66/175/185); this detail does not restore a thrown contract for an effectful callee. This clarification is about the new synchronous plain-call gate. Effect code keeps its existing foreign trust/bridge checks: an unannotated foreign call does not acquire a nonthrowing guarantee there. Native async/generator/initializer phases and existing foreign `@rethrows` rules retain their independent treatment; no new callback-analysis algorithm is supplied here.

    ```vibe
    // foreign.ts supplies risky's @throws {unknown}; opaque has no supplied contract.
    import { risky, opaque } from "./foreign.ts"
    function rejected(s: string) { return risky(s) } // error: affirmative may-throw contract
    function currentDefault(s: string) { return opaque(s) } // ordinary foreign-call default
    effect function bridged(s: string) {
      return try Effect.try({ try: () => risky(s), catch: (error) => error })
    }
    ```

    Effect TS:

    ```ts
    import { risky, opaque } from "./foreign.js"
    function bridged(s: string) {
      return Effect.gen(function* () {
        return yield* Effect.try({ try: () => risky(s), catch: (error) => error })
      })
    }
    // Native TypeScript ignores @throws metadata; the plain-call rejection is Will's VibeLang rule.
    ```

    The foreign fixture declares `risky` with `/** @throws {unknown} */` and `opaque` without a tag; it may give both the same ordinary TypeScript signature/body. Their distinct source contracts are the witness, not a value-dependent throw test. `nothrow-spec`/`nothrow-impl` retain implementation ownership. Add plain/effect and admitted handling controls plus spec-quoted keyed fuzz variants for explicit/default/never/unknown/any/aliased bounds, shipped annotations, aliases/re-exports, overloads and source-versus-sidecar clients. Preserve annotation provenance without resurrecting local summary inference. No VibeLang compiler or declaration-emission test was run by this policy lane.

    Decided by the agent from Will's no-throw rule and foreign unknown-default clause, existing38/66's supplied-contract-before-default boundary, principle3 (resolved signature identity) and principle8 (conservative known contract), 2026-10-31. Class A; no Will question.

### Detail 258

**Migration never writes `moduleSuffixes`; stock consumers name the `.vibe` source, and declaration identity is per resolved module, not specifier spelling.** (migfix-opencode opencode-19, "For Will" 2026-10-31; chapter 007 "`.vibe` is a supported source extension", "Existing tools work" and "Emit names"; Will's decision-6 reason; principles 2, 3 and 8.) A migration or `setup` step must not add `moduleSuffixes` (such as `["", ".d.vibe"]`) to a repository's `tsconfig.json`: stock TypeScript tries `.ts` before `.tsx` for each suffix, so that setting makes an unchanged consumer of `runtime.tsx` resolve `runtime.d.vibe.ts` ahead of its source and changes the checker's types for code the migration did not touch (receipt `op19-stock-tsx-priority.log`). An edit that changes the meaning of unchanged TypeScript is out by the same reason Will gave for decision 6. The guaranteed stock-TypeScript route to a `.vibe` module stays chapter 007's: an import that names the source, `./runtime.vibe`, with `allowArbitraryExtensions`; stock `tsc` resolves it to `runtime.d.vibe.ts` and VibeLang to the source. Stock resolution of an extensionless `./runtime` to a `.vibe` file is not a language guarantee, and the migration says so instead of configuring it.

    When a migration rewrites a consumer's specifier to that form, or VibeLang's emit rewrites `./x.vibe` to `./x.js` (007 Emit names), the declaration-identity gate compares the module each import specifier resolves to, not the spelling: `from "./runtime"` and `from "./runtime.js"` that resolve to the same emitted module are the same declaration, as two spellings of one symbol are the same symbol (principle 3). The gate still rejects a specifier that resolves to a different module or to nothing.

    ```vibe
    // runtime.vibe
    export effect function start() { return try succeed("up") }
    ```

    ```ts
    // consumer.ts, checked by stock tsc with allowArbitraryExtensions
    import { start } from "./runtime.vibe"   // stock tsc: runtime.d.vibe.ts; VibeLang: the source
    ```

    Effect TS: `consumer.ts` is ordinary TypeScript, and `start` is `Effect.gen(function* () { return yield* Effect.succeed("up") })`; the counterpart is the same import of the same module.

    The independent stale-sidecar resolver defect (VibeLang choosing a stale `.d.vibe.ts` over the source) stays a VIP-27 bug owned by migfix-opencode. Fixers add a migration test that a `.tsx` sibling keeps its source types after `setup`, and property coverage over specifier spellings that resolve to one module for the identity gate. Decided by the agent from chapter 007's resolution and emit rules, Will's unchanged-TypeScript reason, principle 2 (TypeScript's own `allowArbitraryExtensions` route), principle 3 (identity by resolution, not spelling) and principle 8, 2026-10-31. Class A; no Will question.


    **258 empty-first suffix clarification and recovery correction, decide-live, 2026-11-01.** This prohibition includes `moduleSuffixes: ["", ".d.vibe"]`; placing the empty suffix first does not establish original-source precedence across TypeScript's extension search. Four fresh stock TypeScript5.9.3 controls resolve an unchanged `./runtime.js` to `runtime.tsx` without the option, but to `runtime.d.vibe.ts` with either suffix order, changing its inferred literal type from `"original"` to `"sidecar"`. An explicit `./explicit.vibe` control resolves its declaration with `allowArbitraryExtensions` and no suffix option. Receipt `r13-native-reference/suffix-control/receipt.json`; no target or VibeLang compiler was executed/edited by this lane.

    Accordingly, Foldkit108's Knip resolver extension and its TypeScript suffix configuration have different proof obligations. Permitted product-tool wiring does not authorize adding this banned compiler option to the UI/base/docs config chain. Use258's source-named importer route and preserve the native target/resolution/public gates, or retain the affected native closure until that route works. The existing Knip patch can be judged separately against actual native precedence and unchanged tools. This is an application of258, not a new ban or a demand to change protected tests.

    My earlier recovery triage of the combined tooling patch was too broad if read as approval of `moduleSuffixes`. It is corrected here and in the receipt ledger: config inheritance and passing the reported cases cannot waive258. Principles2/3/8 and the already-decided native-source identity rule settle this without another question for Will.

### Detail 263

**C-prime is the approved package declaration-import spelling option; it changes only references to migrated VibeLang sources.** (Will via proxy, `inbox/migrate-opencode.md`, 2026-10-31 approximately20:15Z, C-prime decided under use common sense; smithers agent 23:10Z adds the `.ts` case from that same reason; VIP-27/VIP-30/VIP-34, existing72/258 and principles1/2/3.) Record the already-approved `vibelang.declarationImportStyle` with values `.js` (default), `extensionless` and `.ts`. It controls the emitted-declaration spelling of a relative source reference to `./x.vibe`: respectively `./x.js`, `./x` and `./x.ts`. This is an opt-in package declaration spelling policy derived from the original package imports; it is not new source resolution or runtime behavior. JavaScript output retains the normal emitted `.js` names, and source-adjacent sidecars retain their existing VibeLang-source reference rules.

    **Scope of rewriting.** Preserve every unrelated written specifier, including package/asset names and references to ordinary TypeScript or JavaScript siblings, in all three modes. The20:15ruling explicitly limits the option to a relative reference the source writes as `./x.vibe`, and says other `.ts`/`.js` specifiers stay as written, as TypeScript keeps them. Thus a written `./helper.ts` naming an unchanged `.ts` sibling remains `./helper.ts` in declaration output even under the default `.js` mode. The default determines the spelling of migrated VibeLang references; it is not authority to rewrite every source extension. Do not turn the declaration option into `rewriteRelativeImportExtensions` for declarations, synthesize moduleSuffixes, change unchanged TypeScript resolution, or normalize away a changed module identity. The actual resolved source module remains the identity gate under258.

    ```json
    { "vibelang": { "declarationImportStyle": ".ts" } }
    ```

    ```vibe
    // source after migrating runtime, while helper remains TypeScript
    export * as Runtime from "./runtime.vibe"
    export { helper } from "./helper.ts"
    // .ts mode declarations keep ./runtime.ts and ./helper.ts
    // extensionless mode uses ./runtime and still ./helper.ts
    // default .js mode uses ./runtime.js and still ./helper.ts
    ```

    Effect TS:

    ```ts
    // original package using .ts imports; stock TypeScript declaration counterpart
    export * as Runtime from "./runtime.ts"
    export { helper } from "./helper.ts"
    // declaration output preserves both written .ts specifiers
    ```

    Setup selects the package convention from its existing ordinary relative imports, excluding migrated `.vibe` spelling, assets and bare package names. Preserve the default when the convention is `.js`; use the explicit other setting when the original package uses that style. Mixed conventions must be disclosed with a warning rather than silently guessed into one style or a relaxed public-byte gate. The option and setup update must preserve unrelated config keys; do not add a new canonical alias or change legacy-object inheritance based on this record. Publish the exact transitional path, validation and inheritance behavior in the config reference and the approved VIP-27/VIP-30 amendment under213, beside the declaration-output and release notes.

    Preserve the TypeScript counterpart quote choice as part of the same declaration fidelity fix: recreated imports retain their own quotes, and synthesized imports follow the file/native compiler quote preference. Cover a file with no written import as well as mixed quote styles. This changes no language call, return, thrown-type, host-access or execution rule.

    Implementation owner `declstyle-smithers` reports candidate40e455eb2604 queued, four before/after cases and flow properties passing, with a larger declaration matrix pending. Its shared report says the default retains an old `.ts`-to-`.js` declaration rewrite; that reported behavior needs verification/correction against the scoped20:15ruling and TypeScript twin in every setting. This policy lane has not inspected the candidate/compiler implementation or executed those tests and makes no landing/green-main claim. Keep the owner regression matrix over all three settings, source specifiers, import/re-export/import-type forms, quote modes, aliases/inferred types, unchanged TypeScript siblings, sidecar resolution, JavaScript output and invalid/mixed configuration. Compiler/tooling owners retain product and keyed fuzz/property coverage.

    Decided by the agent from the recorded C-prime ruling, its23:10`.ts` application of the same package-spelling reason, VIP-27 faithful declaration output, principle2 (ordinary TypeScript preserves the sibling specifier), principle3 (resolved module identity) and existing258 (do not alter unchanged TypeScript resolution), 2026-10-31. Class A; previously approved direction recorded for the spec round, not a new Will question.


    **Bounded native emit evidence.** Two stock TypeScript5.9.3 declaration-only controls preserve three `./helper.ts` references (export, namespace export and import type) and one `./helper.js` reference with `rewriteRelativeImportExtensions` both off and on. This supports the ordinary sibling-specifier rule only; it does not execute the C-prime option, candidate40e455eb2604, VibeLang, TypeScript7.1, sidecar resolution, runtime JavaScript or the migration gate. Receipt: `cprime-native-reference.json`.

    **Superseding tooling disposition (2026-11-02T13:15Z, decide-live records the newer owner receipt):** Will, verbatim relayed by effectscript-11: "Yea no decision you just fit the pattern of how typescript already works as well as possible" (`loop/WILL-ANSWERS.md`). The newer `AGENT-DECISIONS.md` stops the root-only alias codemod before enqueue and assigns `declstyle-from-tsc` the native TypeScript5.9.3 matrix: written `./user.js`, `./user`, `./user.ts`, each module-resolution mode, with/without `rewriteRelativeImportExtensions` and `allowImportingTsExtensions`. Match the native `.ts`/`.tsx` twins for Vibe source extensions. If ordinary source spelling/configuration determines declaration spelling, the extra `declarationImportStyle` option goes away and the root-only codemod is moot; retain an option only for a concrete named example TypeScript cannot express. This supersedes the earlier root-only disposition, not the public-declaration preservation requirement277. Actual matrix/proof and preserving implementation remain the named owner's work, not completed here. Package trust (297part2) remains open.

    **2026-11-02 amendment to detail 263 (declstyle-from-tsc, Will's ruling).** Will: "Yea no decision you just fit the pattern of how typescript already works as well as possible" (AGENT-DECISIONS.md, 2026-11-02). The completed TypeScript 5.9.3 declaration matrix has 384 cells and preserves every written relative specifier, including with diagnostics; neither extension switch changes declaration spelling. No case needs an additional option. This supersedes detail 263's declarationImportStyle policy, detail 297's root-only codemod/invalid-enum policy and detail 298's style question. Match the native twin (.vibe for .ts, .vibex for .tsx); retire both legacy option paths with a nonfatal deprecation warning for every value. Generated import types retain native TypeScript preferences. Census owners affected: opencode, Smithers, foldkit (04db4f250ebf). Full before table and receipts: ~/vibe/fix/alpha/declstyle-from-tsc.REPORT.md. Compiler after verification and queue landing are still pending.

    **Native emission and migration preservation remain separate obligations (decide-live, 2026-11-02):** the Foldkit byte audit does not supersede this detail's later native-counterpart amendment or restore retired declaration-style options. Compare the same current source, pinned TypeScript lineage, options and resolution context for emitter conformance. Separately, a migration must preserve the original required API under277. Changed source can cause a native-correct emitter to print different specifiers; that is not permission to waive the migration gate. Under272 an importer must retain its written specifier when the target is unchanged. Repair the source transformation, or keep the module native if both contracts cannot be proved. Do not choose a global `.js` or `.ts` output policy from a differing-input byte count.

    ```vibe
    import { value } from "./kept.js" // kept.ts was not migrated: retain this spelling
    ```
    Effect TS: `import { value } from "./kept.js"` in the same project. A newly written Vibe-source reference follows the recorded native-counterpart rule for its actual context; this example authorizes no blanket ending rewrite.
    Decided by the agent from the recorded Will native-tooling rule, existing263/272/277/297/298 and principles2/8, 2026-11-02; no new compiler option, API permission or Will question.

### Detail 271

**The approved sidecar-directory option is `vibe.sidecarDir`, an optional path string with TypeScript-style path inheritance.** (Round7 Astra ASTRA-1, external detail268; accepted VIP-27/VIP-30/VIP-39, existing59/213, principles2/4/8.) Detail268 already authorizes an opt-in directory; this records its missing configuration contract, not a second relocation feature. Put `sidecarDir` in the top-level `vibe` object of any accepted config file. Its type is `string`. If there is no effective entry after `extends`, keep the default beside-source `x.d.vibe.ts`/`x.d.vibex.ts` output. There is no boolean switch, `null` alias, array of destinations or new CLI flag. Wrong types use existing `EK3007`; the retired `declarationSidecars` switch stays retired.

    Resolve an ordinary relative value from the config file that declares it, preserving that base when inherited, as TypeScript does for `outDir`/`declarationDir`. Absolute paths retain their ordinary host meaning. A leading `${configDir}` is supported with the same selected-project-directory meaning as the existing TypeScript path fields described in chapter007; it is not arbitrary environment-variable expansion. `extends` merges this scalar by key: the child's present value wins; an absent child entry inherits; the beside-source default applies only when no entry remains. An empty string is an ordinary path to the declaring config directory, as for TypeScript path options, not an alias for disabling declaration output.

    Directory mode keeps detail268's mirrored source tree and suffixes, source/sidecar precedence, mode-switch cleanup of stale generated sidecars, matching `rootDirs` wiring and implementation/test-inventory preservation. For the existing project-root example, `src/user.vibe` maps to `.vibe/declarations/src/user.d.vibe.ts`, and `src/View.vibex` maps to `.vibe/declarations/src/View.d.vibex.ts`; `rootDirs: [".", ".vibe/declarations"]` supplies the corresponding native resolution. Setup must use the roots matching the actual layout and preserve existing roots rather than blindly replace them. A hidden directory is not universally excluded by every tool. This option changes compatibility-sidecar location only; public declaration output still follows native `compilerOptions.declarationDir`/`outDir`. It does not suppress sidecars or make a declaration executable. No new source-root restriction, diagnostic code, source-discovery permission or runtime loader is introduced here.

    ```vibe
    // vibe.config.json: { "vibe": { "sidecarDir": ".vibe/declarations" } }
    // src/user.vibe -> .vibe/declarations/src/user.d.vibe.ts
    export effect function current() { return 1 }
    ```

    Effect TypeScript:

    ```ts
    import { Effect } from "effect"
    export function current() { return Effect.gen(function* () { return 1 }) }
    // Native resolution of relocated compatibility declarations uses tsconfig rootDirs;
    // this VibeLang location option has no Effect runtime operation.
    ```

    Decided by the agent from approved detail268 (directory feature), principle2 (TypeScript config path resolution and inheritance), principle4 (one optional scalar, no disabling aliases), principle8 (reject wrong types), VIP-30 and VIP-39, 2026-11-01. Class A; no Will question or breaking change to the default. Publish VIP-27/VIP-30 amendments plus chapters001/007 and apply `.vibex` consistently. Existing `sidecar-dir` implementation ownership is retained. Regression and spec-quoted keyed fuzz coverage must include inherited declaring-config paths, child overrides, `${configDir}`, wrong types, nested source trees, both suffixes, public-output independence, mode switches, source-first resolution and unchanged implementation/test inventories. Existing native controls under268 demonstrate bounded `rootDirs` resolution, not enforcement of this new config key. This decision lane ran no candidate/compiler/config-parser/fuzz/loader test.


    **Private migration-process qualification, detail272 (decide-live test-edit audit, 2026-11-01).** The discovery/loader preservation requirement above never authorizes changing target tests, test fixtures, snapshots or protected test-runner configuration to make a migration pass. Preserve the original test/implementation inventory through permitted product/source/export wiring, or retain the affected TypeScript closure. A test-owned literal selector is not rewritten. VibeLang repository regression/fuzz tests remain the explicit exception. This qualifies migration advice under268/271; it is not a new public language option, source-root rule or permission to weaken a test.


    **Consumer-resolution clarification (opencode-53, decide-live, 2026-11-01).** Producer-local `rootDirs` is bounded local resolution, not a package-consumer contract. A native consumer does not inherit the producer project's `rootDirs`; `skipLibCheck` hiding an unresolved import and degrading its payload to `any` is not declaration preservation. Any compatibility declaration exposed through package `types`/exports must resolve its transitive relative references from its actual relocated location under the consumer's settings and shipped file graph, preserving the referenced module identity and type. Directory mode does not move public declaration output or retarget metadata to an unusable compatibility file.

    ```vibe
    // @demo/a/src/index.vibe; Helper is an unchanged native TypeScript sibling.
    import type { Helper } from "./helper.ts"
    export const make = (n: number): Helper => ({ n })
    ```

    Effect TS: the same plain function and `Helper` import. For `Helper = { readonly n: number }`, a native consumer's `const wrong: string = make(1).n` retains `TS2322`; an unresolved import must not turn it into `any`. For a sidecar at `.vibe/declarations/src/index.d.vibe.ts`, `../../../src/helper.ts` demonstrates resolution back to the same native sibling in this layout. This is a witness, not a universal path literal or mandate to ship TypeScript source. Appropriate declared outputs and migrated siblings use the actual approved declaration layout/spelling and shipped graph. Keep detail 263's module identity/spelling scope: relocation can require rebasing a relative path, but does not authorize changing the module, rewriting native siblings as migrated ones, or requiring consumer `moduleSuffixes`. Implementation may instead retain a correctly resolving native public declaration entrypoint; no repair algorithm is added.

    Decided by the agent from principle 2 (native TypeScript consumers do not inherit another project's configuration), principle 8 (do not erase a failed type contract), accepted VIP-27/VIP-34 and details 268, 271, 263 and 258, 2026-11-01 under Will's 2026-10-29 delegation. This clarifies the approved directory/identity contract, not a new option, public API or breaking language choice. Five stock TypeScript 5.9.3 controls pass: producer-local overlay, independent consumer with/without `skipLibCheck`, and self-resolving sidecar under both settings. Broken consumers have `TS2307`/`any` or silent `any`; both repaired controls retain `number`/`TS2322`. Receipt `sidecar-consumer-native/receipt.json`; no VibeLang compiler, m9 or actual Opencode artifact was executed. Existing sidecar/publication owners need the minimized Opencode corpus, failing-old/passing-fixed product regression and keyed spec-quoted neighbourhood coverage over native/migrated siblings, nested paths, both suffixes, references, package exports/deep entries, `skipLibCheck`, public outputs and consumers without producer roots. Keep the affected closure native until its real consumer/declaration gates pass.

### Detail 283

**Compatibility sidecars keep VIP-27's independent write trigger; detail281 governs selection and overwrite protection at that write.** (Round9 OPUS-1 follow-up to ASTRA-1; accepted VIP-27's required per-source compatibility declarations, existing277/281; principles2/4/8.) A normal compilation that requires `x.d.vibe.ts` or `x.d.vibex.ts` under VIP-27 still generates that compatibility artifact when `noEmit: true` or `declaration: false` disables ordinary JavaScript/public declaration output. Those flags alone do not remove the compatibility declaration that plain `tsc`, TypeDoc and editors need to resolve a VibeLang import. Preserve the existing separate controls on ordinary outputs; this records the already-promised sidecar schedule, not a new output kind or CLI flag.

    Apply281's native selection/overwrite rule whenever that required sidecar write is attempted. Discovery through `include` or the default selector lets the source supersede its sibling sidecar, which can then be regenerated. A sidecar explicitly included as an input alongside its source in `files` remains protected: the attempted sidecar write reports native `TS5055`, the compile exits nonzero and its existing bytes stay unchanged. This applies in a configured `vibe.sidecarDir` and under the two flags above. There is no marker, backup directory or new warning.

    **State the deliberate schedule distinction.** Native TypeScript's own `noEmit` does not write an ordinary `.d.ts` and therefore attempts no overwrite. VIP-27 compatibility output is required independently;281's evidence used `declaration: true` to settle how a declaration write treats selected inputs, and did not retire that existing compatibility guarantee. For the corresponding native overwrite control, actually enable declaration writing; separately retain the native `noEmit`/`declaration: false` no-write controls and disclose their different output trigger. Do not claim identical exit codes from unmatched write schedules. This distinction keeps existing no-emit VibeLang consumers working and preserves native input protection at the actual write.

    ```vibe
    // x.vibe; project uses noEmit: true and files: ["x.vibe"]
    export const answer = 7 // compatibility x.d.vibe.ts is still refreshed
    // Add "x.d.vibe.ts" explicitly to files: TS5055; its bytes stay unchanged.
    ```

    Effect TypeScript: the source counterpart is `export const answer = 7`; its native declaration is `export declare const answer = 7;`. The native declaration-writing control uses `declaration: true` with emit enabled, then compares `include` discovery against explicit `files` selection. Native TypeScript with `noEmit: true` or `declaration: false` remains a separate no-declaration-write control. No Effect operation or source runtime behavior changes.

    Decided by the agent from accepted VIP-27 and277's compatibility guarantee,281's actual input-selection/overwrite ruling and principles2(native behavior at a write),4(one existing sidecar trigger),8(retain required output and reject an attempted input overwrite),2026-11-01. Class A; no breaking removal of an output or new public API. Publish the trigger and its explicit reason beside281's selection rule in001/007/VIP27, including both source suffixes and configured destinations. Owners need regression/corpus and keyed properties across `files`/`include`, existing output bytes, ordinary emit flags, adjacent/relocated layouts and configured-path inheritance; verify ordinary output suppression and actual sidecar results separately. Existing277 artifact-preserving fixes still cover these sidecars under `noEmit`/`declaration: false`. This lane reviewed immutable normative text and attributed native probes, not a new compiler execution.

    **Ordinary-output precision for detail283.** `noEmit: true` suppresses ordinary JavaScript and public declaration emit; `declaration: false` suppresses ordinary declaration emit and leaves ordinary JavaScript behavior unchanged. The independent compatibility sidecar follows283 in both cases. An attempted sidecar overwrite of an explicitly selected input has281's exact exit code `1` with `TS5055` and unchanged input bytes.

### Detail 285

**The Vibe-aware view of a known compatibility sidecar follows TypeScript's final resolved path; it does not erase explicit declaration inputs.** (R10 Opus OPUS-1; accepted VIP-27/VIP-39, existing258/268/271/277/281/283; principles1,2,3.) When VibeLang resolves a non-relative name to a compatibility sidecar for an available source, use that source in the Vibe-aware program when the final resolved path is outside `node_modules`. Non-relative names include package exports, `paths` and package `#imports`; the spelling that reached the same resolved module does not create a different rule. Perform TypeScript's ordinary resolution and its `realpath`/`preserveSymlinks` policy first. Classify the resulting path, not the written package specifier or its pre-realpath `node_modules` segment. With `preserveSymlinks: true` a retained logical path inside `node_modules` keeps the package's declarations, as published-package resolution does. This deliberately does not promise to collapse logical modules that TypeScript's symlink option distinguishes.

    Apply the same compatibility view to `x.vibex`/`x.d.vibex.ts` under VIP-39. With `vibe.sidecarDir` follow the effective source-to-sidecar map of268/271, rather than guessing an adjacent source or matching only basenames. No available mapped source, or a final path inside `node_modules`, means ordinary declaration resolution. Preserve package conditions and source selection otherwise.

    Detail281 controls emit-output discovery and overwrite protection, not a promise that stock TypeScript and the Vibe-aware checker consume the same physical file. A sidecar explicitly named in `files` remains an input even when another import is redirected to the source: retain `TS5055`, failure status and untouched input bytes whenever the independent compatibility write would overwrite it. Detail283's write schedule remains. No marker, backup, silent input deletion or change to ordinary `.ts`/`.d.ts` resolution follows.

    ```vibe
    // app.vibe; lib/Stage's types export names its compatibility sidecar
    import { Stage } from "lib/Stage"
    import { Stage as SourceStage } from "../lib/src/Stage.vibe"
    // Default realpath resolution outside node_modules uses the same source module.
    ```

    Effect TypeScript counterpart: stock consumers use `allowArbitraryExtensions` to read the sidecar; the Vibe-aware checker reads the known source, as258 already requires for an explicit `.vibe` import. Native TypeScript can legitimately treat `Stage.ts` and an independently exported `Stage.d.ts` as two modules; the reviewer's `TS2345` control is not denied. Recognizing a Vibe compatibility view is a stated tooling difference needed by the accepted source/sidecar route, not a general merger of native declarations or nominal types. TypeScript's path identity policy remains the counterpart for symlinks and published packages.

    Publish this clarification as a dated VIP-27 amendment with007, and the VIP-39/sidecar-directory companions; until then the present one-line chapter claim is incomplete. Cover exports/paths/imports, realpath/preserveSymlinks, published versus workspace paths, both dialects, relocated sidecars and explicit-input overwrite controls. Preserve importer diagnostics and declaration aliases; no structural comparator may hide a genuinely different module.

    Decided by the agent from accepted VIP-27's compatibility route, detail258's source resolution, principle1 (one useful module view), principle2 (TypeScript resolved-path and symlink policy), principle3 (identity rather than spelling) and principle8 (no extra path or declaration-merging permission), 2026-11-01, under Will's 2026-10-29 delegation. Class A; no Will answer or new compiler execution is claimed.

### Detail 299

**OPEN for the spec agent: where an added name goes when a declaration joins it to a written `effect` import.** (Round 14 Opus OPUS-4 at frozen `b48c60e5ee9a`, 001:483; lane spec-fix-r14 under Will's 2026-11-02 fix-on-find instruction.) 001's Specifiers bullet says an added name "joins" a written import, "in the written order and quotes", with the example `import { Effect, HashSet, Option } from 'effect'` for a file that writes `import { HashSet, Option } from 'effect'`. That example fits both "sorted" and "prepended", and no VIP, detail or ruling says which. spec-fix-r14 fixed the other half of OPUS-4 (the Content bullet and the 001 worked example now write the value import `import { Effect, Stream } from "effect"`, as the Effect TypeScript twin's `tsc` 5.9.3 declaration keeps it; VIP-27 holds declarations to that twin) and added the rule `declaration-import-form` to `//:spec-lint`.

    **The compiler.** On main the compiler prepends: a file that writes `import { Option, HashSet } from 'effect'` declares `import { Effect, Option, HashSet } from 'effect';` (round 14 `probes/decl/`). Stock `tsc` declares the twin's two written imports separately, so the twin does not settle the position. This lane changed no compiler behavior.

    **To decide.** Prepend (the compiler's behavior; state "an added name goes before the written names" and use a non-sorted example), append, or sort.


    **299 disposition, decide-live: decided as detail 299, Class A, 2026-11-02.** Preserve the existing stable insertion rule. In the first retained eligible named import of the same module, insert an added specifier immediately before the first existing specifier whose emitted local identifier name is lexicographically greater; append if none is greater. Never sort or reorder the source-written specifiers. Added module names are processed in existing deterministic sorted-name order, with existing hygienic aliases; compare the resulting local identifier names for insertion. Preserve quotes, aliases, kind, comments and native elision. This concerns names the declaration already must add, not permission to retain an unused import or merge unrelated imports.

    ```vibe
    import { Option, Cause } from 'effect'
    export effect function echo(x: Option.Option<Cause.Cause<never>>) { return x }
    // Added Effect: import { Effect, Option, Cause } from 'effect';
    // Written { Cause, Option } instead joins as { Cause, Effect, Option }.
    ```

    Effect TS counterpart: write the corresponding explicit import above, then `export function echo(x: Option.Option<Cause.Cause<never>>) { return Effect.gen(function* () { return x }) }`. TypeScript retains authored specifier order. Joining is a VibeLang prelude adaptation, not a claim that stock `tsc` merges imports.

    Decided by the agent from principle 2 (retain native authored order), principle 4 (one deterministic insertion rule), and principle 8 plus VIP-27/details 263/277 (preserve existing declaration bytes), 2026-11-02 under the 2026-10-29 delegation. Immutable main `2519454b6513` `declarations.go` sorts added names and `joinImport` inserts each before the first greater local name. This corrects the opening report's inferred “compiler prepends”: its single added `Effect` before `Option` proves neither unconditional prepending nor a global sort. Publish both unsorted and non-leading examples in VIP-27/001 under 213. No own compiler/native emit probe; owners retain regression/keyed permutations over before/between/after insertion, unsorted written imports, multiple additions/aliases/imports, quotes and comments. Existing migration byte gates are unchanged.

### Detail 307

**Native consumers keep the accepted arbitrary-extension route; migration preserves authored rewrite options.** (Foldkit's 25 inferred-ending declarations; accepted VIP-27 sidecars, VIP-34/detail72 output names, VIP-39 cross-file imports; details263/277/296 and Will's TypeScript-tooling rule.) A `.ts` or `.tsx` consumer with a valid `allowArbitraryExtensions` sidecar route to a `.vibe` or `.vibex` module is accepted without additionally enabling `rewriteRelativeImportExtensions`. The fork must not reject that already-adopted native-consumer route with `TS5097` merely because it also knows the VibeLang source. Retain normal resolution, arbitrary-extension checks, `jsx` requirements and native `.ts`/`.tsx` extension gates. This is the narrow B route in the owner's question, not unconditional source-extension admission.

    ```vibe
    // producer.vibe
    export const value = 42
    ```

    ```ts
    // consumer.ts; allowArbitraryExtensions: true; no rewrite option added
    import { value } from "./producer.vibe"
    export const answer = value
    ```

    **Effect TS:** VIP-27's `producer.d.vibe.ts` contains `export declare const value: 42`, so stock TypeScript accepts that same native consumer through its arbitrary-extension route. An ordinary all-TypeScript counterpart can import `./producer.js` from `producer.ts` under NodeNext without the rewrite option. Stock TypeScript leaves a custom `.vibe`/`.vibex` specifier in JavaScript; VibeLang's already-accepted detail72/VIP-39 source-suffix lowering selects `.js` or `.jsx` from the target's output. That custom lowering is existing language authority, not a claim that stock TypeScript rewrites arbitrary extensions.

    Migration setup keeps the repository's authored effective `rewriteRelativeImportExtensions` value. It stops globally adding `true` solely to admit the already-approved native-consumer Vibe import. Preserve a user-authored `true`, `false` or inherited value and its ordinary native declaration behavior. An earlier tool-added value can be removed only with recorded provenance and a paired compiler/setup rollout that preserves the final project's checks, runtime module identity and original public declarations. First make the accepted import route work, then change setup; do not strand existing migrated projects between those steps. Retain ordinary native declaration rendering under the actual options, including synthesized import types. Details263/297/298's later native-tooling disposition governs the historical declaration-style option. This decision restores neither that retired option nor a forced declaration suffix. The original migration byte/API gate remains independent.

    Independent native reference: `import-gate-native-controls/receipt.json`, TypeScript5.9.3, 22/22 expected compile/emit outcomes across Bundler/NodeNext, `.ts`/`.tsx` consumers, `.vibe`/`.vibex` sidecars and the arbitrary-extension flag. Native custom imports fail `TS6263` with the flag off and pass with it on; native `.ts` imports retain `TS5097` without their rewrite permission, and written `.js` controls pass. These are stock counterpart checks, not a VibeLang compiler fix or runtime/gate pass. The owner's separate 12-cell stock5.9/7.1 matrix attributes the inferred-ending change to the setup-added option; it corrects the earlier attribution to `.vibe` imports.

    Import-spelling/compiler and migration-wiring owners implement the paired repair, documentation and release notes. Require failing-before/passing-after compiler cases and keyed properties for importer kinds, sidecar layouts, native-extension controls, JSX output, authored versus generated/inherited options, replays and original declaration-byte gates. A change to ten setup pages is documentation work, not itself a new language choice.

    Decided by the agent from principles2/4/8, accepted VIP-27/VIP-34/VIP-39 and existing72/263/277/296, 2026-11-02 under the 2026-10-29 delegation. Class A: a restrictive implementation gap is relaxed to the accepted import contract; existing valid native syntax and authored options keep their meanings. No public package API or new Will question.

### Amendment: cyclic inferred declaration types (2026-11-01)

Declaration serialization retains TypeScript 5.9 and 7.0 behavior at the anonymous-type cycle sites changed by [TypeScript #64461](https://github.com/microsoft/TypeScript/pull/64461): write `/*elided*/ any` at the repeated type rather than report the new `TS5088`. This applies to `.vibe` and unchanged `.ts` files alike. Other `TS5088` checks and ordinary recursive-inference errors `TS7022`, `TS7023` and `TS7024` remain unchanged. The [recursive builder](../src/001-functions.md#declaration-output) illustrates the boundary.
