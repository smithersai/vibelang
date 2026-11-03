# VIP-11: trailing blocks (denied)

**Status:** denied by Will, 2026-10-28. There is no trailing-block syntax. A function argument is written as an ordinary argument.

```ts
withSpan("load", () => { … })          // a function argument, as in TypeScript
Layer.effect(Users, effect { … })      // an Effect argument (VIP-2)
```

## What it was

Old VibeLang (D188, D376) wrote a block after a call as the call's last argument, a function. It copied Kotlin's trailing lambdas and Swift's trailing closures.

```ts
withSpan("load") { … }                 // meant withSpan("load", () => { … })
```

## Why it was denied

It is not TypeScript. It made `provide(AppLive) { … }` ambiguous (VIP-12), and old VibeLang also let a trailing block silently become a program where an Effect was expected.

## Will's words

> "ok yea trailing blocks is fucking awful remove that"

Implementation: `vibelang --fix` rewrites `f(args) { … }` to `f(args, () => { … })`, or to `f(args, effect { … })` where the old block became a program.

## Amendments

- **Amended 2026-11-01: the error and the codemod.** A trailing block, a `{` on the same line after a name, a property access or a call, is the error `EK1101`, reported at the block's `{`. Its quick fix, which `vibelang --fix` applies, writes the block as the call's last argument in the spelling of what the block compiled to: `f(args, effect { … })` where it ran as a program, `f(args, effect () => { … })` where it ran as an Effect function (`it.effect("…") { … }`), and `f(args, () => { … })` otherwise. The rewrite moves nothing, so arguments still evaluate in order and runtime behavior is unchanged; comment printing and equivalent arrow layout can differ. A line break before the block, an optional chain, a heritage clause, and the providers of a `provide` block are outside this form. A comment between the call and its block makes the fix refuse the site. A versioned Effect-dual migration runs first: retain its native call error (`TS2345`, `TS2554` or `TS2769`), or transitional `EK1023` when the appended call type-checks with changed meaning, with no duplicate `EK1101`. Preserve its original data-first or curried argument position. No trailing-block production is accepted. Ordinary parsing uses TypeScript's statement boundaries and recovery; private compatibility decoding may recover the old structure only for diagnosis and migration. Report `EK1101` at the unadmitted brace, suppressing only a redundant missing-separator `TS1005` for the same rejection and retaining independent native errors. These recovery and codemod rules derive from Will's denial and VIP-34's preserving-codemod requirement.
- **Amended 2026-11-02: the trigger is a parse position.** `EK1101` applies only where no TypeScript or VibeLang production admits the `{`. A `{` that a production reads is not a trailing block: an Effect block `effect { … }`, an interruption block, a `match (x) { … }` body, a namespace `namespace A.B { … }`, and the heads `error E { … }`, `service S { … }`, `schema S { … }` and `data D { … }`. This states the amendment above as a rule two implementations read the same way; it follows from the decision that there is no trailing-block syntax and from Appendix A's productions.

- **Amended 2026-11-03: prove the legacy repair.** Determine the old argument position and lowering from the pinned legacy source, compiler and options: an Effect value becomes `effect { … }`, an existing Effect-function activation becomes `effect () => { … }`, and an ordinary callback becomes `() => { … }`. The callee's expected parameter type alone is insufficient: an ordinary callback returning a held Effect must stay ordinary. Preserve callback count, coldness, argument and receiver order, captures, failures and defects, public declarations, and formerly executed operations with explicit `try`. When kind, placement or body preservation cannot be proved, retain the diagnostic and explain why no fix is offered (VIP-34). A candidate merely type-checking is insufficient.
