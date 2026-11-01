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

- **Amended 2026-11-01: the error and the codemod.** A trailing block, a `{` on the same line after a name, a property access or a call, is the error `EK1101`, reported at the block's `{`. Its quick fix, which `vibelang --fix` applies, writes the block as the call's last argument in the spelling of what the block compiled to: `f(args, effect { … })` where it ran as a program, `f(args, effect () => { … })` where it ran as an Effect function (`it.effect("…") { … }`), and `f(args, () => { … })` otherwise. The rewrite moves nothing, so arguments still evaluate in order and runtime behavior is unchanged; comment printing and equivalent arrow layout can differ. A line break before the block, an optional chain, a heritage clause, and the providers of a `provide` block are outside this form. A comment between the call and its block makes the fix refuse the site. A block after an Effect dual that `0.0.10` placed elsewhere keeps its own error and migration (D382) and gets no `EK1101`. Once the examples and cases are converted, the parser stops reading trailing blocks, and `f(x) { }` parses as TypeScript parses it, still with `EK1101`. Decided by Will in this VIP; the code and the spellings follow its Implementation line.
