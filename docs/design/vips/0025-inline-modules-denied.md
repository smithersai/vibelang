# VIP-25: inline `module` declarations as a TypeScript escape (denied)

**Status:** denied, 2026-10-29, under Will's standing approval of recommendations ("assume I accept now. I will interrupt you if I need to").

## Decision

There are no inline `module` declarations.

*Superseded by [VIP-40](0040-module-declarations.md), 2026-11-03: its reason, that plain functions kept TypeScript's `throw`, was removed by Will's 2026-10-31 ruling.*

## What was proposed

Old VibeLang (D283) used TC39's module-declaration syntax, `module text { export function clean(v: string): string { … } }`, as an escape: a body of plain TypeScript inside a `.vibe` file.

## Why it was denied

The escape existed because old VibeLang changed what `throw`, `try`/`catch`, `await` and `async` meant. VIP-1, VIP-4 and VIP-5 gave plain and `async` functions in `.vibe` exactly TypeScript's meaning, so nothing is left to escape from. TC39's module declarations (stage 2) can be added later as exact TC39 if they prove useful; adding them later breaks nothing.

*Amended 2026-11-02: the reason above is out of date.* Will's ruling of 2026-10-31 makes `throw` in synchronous VibeLang code a compile error ("Plain functions are not allowed to throw"; "If you have some kind of exception it should be in a typescript module {} or in a ts file"), so a plain `.vibe` function no longer has TypeScript's meaning for `throw`, and code that throws has something to escape to. The denial stands: no inline `module` block exists, and code that throws lives in a `.ts` file (Appendix C). An inline TypeScript block needs its own VIP, which the same ruling records as asked of Will (found by the round-9 review).
