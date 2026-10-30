# VIP-26: top-level `await`, and no magic `main`

**Status:** accepted, 2026-10-29, under Will's standing approval of recommendations ("assume I accept now. I will interrupt you if I need to").

## Decision

```ts
export effect function main() { … }
NodeRuntime.runMain(main())     // exactly as in Effect TS
await runPromise(main())        // or ES top-level await of a Promise (VIP-5); runPromise is a VIP-6 global
```

- A module's top level is ordinary JavaScript. `await` there is ES top-level await of a Promise (VIP-5), and `try` is not allowed, because a top level is not an `effect` function.
- There is no magic entry point. A function named `main` is an ordinary function, and you call a runner yourself, exactly as in Effect TS.

## Amendment: source file kind

Every source `.vibe` compilation unit is an external module before binding and checking, independently of written imports and exports, required prelude imports, `vibe.effectGlobals` and `vibe.effectModules`. Preserve that classification in emitted JavaScript and declaration sidecars with an effective empty module marker when needed. Ordinary TypeScript module emission and host rules, including incompatible-option diagnostics, apply. Top-level `await` therefore requires supported module and target options. This adds no implicit runner or special `main`. The `moduleDetection` exception is explicit in VIP-30.

## What was not adopted

Old VibeLang (D135, D517, EK4843) had the compiler emit `runMain(main())` for an exported `main`. That needed the platform, the entry file and rules for `const main`, which is behavior Effect doesn't have.

## History

The old findings were contradictions about `main` (EK4843 versus chapter 28). They are moot.
