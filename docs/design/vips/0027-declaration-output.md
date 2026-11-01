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


### Amendment: cyclic inferred declaration types (2026-11-01)

Declaration serialization retains TypeScript 5.9 and 7.0 behavior at the anonymous-type cycle sites changed by [TypeScript #64461](https://github.com/microsoft/TypeScript/pull/64461): write `/*elided*/ any` at the repeated type rather than report the new `TS5088`. This applies to `.vibe` and unchanged `.ts` files alike. Other `TS5088` checks and ordinary recursive-inference errors `TS7022`, `TS7023` and `TS7024` remain unchanged. The [recursive builder](../src/001-functions.md#declaration-output) illustrates the boundary.
