# Token comparison

The main README compares one program written in VibeLang (`users.vibe`) and in Effect 4 TypeScript (`users.ts`). This directory reproduces the token counts and checks that both programs compile and print the same output.

| File | Tokens |
| --- | --- |
| `users.vibe` | 133 |
| `users.ts` | 202 |

VibeLang uses 34.2% fewer tokens: `(202 − 133) / 202`, rounded to one decimal place. `counts.json` records the result.

## Reproduce

Build the compiler and runtime first with `sh scripts/setup.sh` from the repository root. Then, in this directory, with Node and npm:

```sh
npm ci --ignore-scripts --workspaces=false
node verify.mjs
node count.mjs
```

`verify.mjs` compiles `users.vibe` with the checkout's native compiler and runtime, strictly type-checks and emits `users.ts` against Effect 4.0.6 with TypeScript 5.9.3, runs both with Node, and fails unless each prints `Ada Guest`. It uses the repository this directory is in; set `VIBELANG_CHECKOUT` to use another checkout. `package-lock.json` pins every dependency. `users.vibe` is written in the VIP language (VIP-1, 5, 6, 9, 12, 13, 18 and 26), so `verify.mjs` fails on it until the compiler implements those forms. The counts don't depend on compiling.

`count.mjs` encodes each complete file with the `o200k_base` encoding bundled in `js-tiktoken` 1.0.21, offline. The repository's docs footers use the same tokenizer.

## Method

- The counts cover the exact files, including imports, whitespace, the final newline and each program's runner. Effect's functions and modules are in scope in VibeLang, so `users.vibe` has no imports. Each file runs `main` itself: `runPromise(main())` and `Effect.runPromise(main)`.
- Both programs provide the same layer, run the same two lookups concurrently, recover the missing user and log the same values. The TypeScript uses inference, one service lookup, a generator and standard combinators, with no extra annotations.
- The program adapts `examples/react-vite/src/users.vibe` and the idioms in [VibeLang for Effect users](https://vibelang.sh/vibelang-features/114-vibelang-for-effect-users).

## Limits

- It is one small program, not a corpus benchmark, and says nothing about runtime performance.
- `o200k_base` is an OpenAI encoding. Other models' tokenizers give other counts; none is reported here because no offline tokenizer for them was verified.
