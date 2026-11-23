# How real Effect code uses pipe

Measured 2026-10-16 with `experiments/scripts/pipe-census.ts`, which parses every `.ts`/`.tsx` file that imports `effect` with the TypeScript 5.9.3 parser (no type information) and inspects every `x.pipe(...)` and `pipe(x, ...)` call.

Set `SMITHERS_CHECKOUT` and `OPENCODE_CHECKOUT` to the roots of the Smithers and [opencode](https://github.com/anomalyco/opencode) source snapshots. The original measurement did not record the checkout revisions. Run from the VibeLang repository root.

```sh
cd experiments
bun scripts/pipe-census.ts "$SMITHERS_CHECKOUT/packages" "$SMITHERS_CHECKOUT/apps" "$SMITHERS_CHECKOUT/flows"
bun scripts/pipe-census.ts "$OPENCODE_CHECKOUT/packages"
```

The Tevm monorepo was excluded: all of its Effect files are a vendored copy of Smithers code (`vendor/flows`), so its numbers duplicate the Smithers sample.

## Results

| | Smithers | opencode |
| --- | --- | --- |
| Files importing `effect` | 3,397 | 1,058 |
| `pipe` calls | 17,189 | 3,582 |
| Pipes whose stages are mostly `Effect.*` | 13,692 | 2,594 |
| Stages per `Effect` pipe | 1.45 | 1.22 |
| Head is a function call, `f(x).pipe(...)` | 48.8% | 70.6% |
| Head is `Effect.gen(...)` | 29.0% | 9.6% |
| Head is another `Effect.*` constructor call | 11.8% | 12.0% |
| Head is a stored value | 8.4% | 7.5% |

Other pipe kinds in Smithers: 1,840 `Layer` pipes, 487 `Stream`, 178 `Schema`.

### Stages by what EffectScript turns them into

| Category | Stages | Smithers | opencode |
| --- | --- | --- | --- |
| Sequencing, becomes statements | `map`, `flatMap`, `andThen`, `tap`, `as`, `asVoid`, … | 14.4% | 22.9% |
| Error handling, becomes `try`/`catch` | `mapError`, `catch`, `catchTag`, `flip`, `orElseSucceed`, `tapError`, … | 10.7% | 18.8% |
| Cleanup, becomes `finally` | `ensuring`, `onExit`, `onInterrupt`, `onError` | 1.6% | 2.1% |
| Context, stays a combinator | `provide`, `provideService`, … | 48.9% | 16.3% |
| Policies, stays a combinator | `scoped`, `forkChild`, `timeout`, `retry`, `forkScoped`, … | 14.3% | 11.7% |
| Exit shape, stays a combinator | `orDie`, `exit`, `ignore`, `result`, `catchCause`, … | 8.5% | 25.8% |
| Observability, stays a combinator | `withSpan`, `annotateLogs`, … | 0.6% | 1.1% |

Most frequent stages. Smithers: `provide` 7,442, `provideService` 2,142, `scoped` 1,624, `mapError` 1,003, `andThen` 893, `orDie` 797, `map` 710, `forkChild` 703. opencode: `orDie` 464, `provide` 379, `map` 228, `mapError` 183, `catch` 179, `andThen` 145, `flatMap` 145, `ignore` 136.

### Stages left once statements absorb sequencing, errors, and cleanup

| Stages left | Smithers | of which in tests | opencode | of which in tests |
| --- | --- | --- | --- | --- |
| 0 | 3,835 (28.0%) | 1,747 | 1,017 (39.2%) | 347 |
| 1 | 6,732 (49.2%) | 5,934 | 1,430 (55.1%) | 886 |
| 2 | 2,004 (14.6%) | 1,908 | 119 (4.6%) | 62 |
| 3 or more | 1,121 (8.2%) | 1,065 | 28 (1.1%) | 17 |

Outside tests, pipes that would keep two or more stages in EffectScript are 152 of 13,692 in Smithers (1.1%) and 68 of 2,594 in opencode (2.6%). In Smithers, the multi-stage pipes are almost all test setup, such as `.pipe(Effect.provide(layer), Effect.scoped, Effect.exit)`.

## Caveats

- Classification is by stage name only. `mapError` and `flip` are counted as statement-replaceable (a `catch` that rethrows; a `try` in a test); counting them as combinators moves about 8% of Smithers stages and 9% of opencode stages to "stays".
- "In tests" means the path contains `.test.`, `.spec.`, `/test/`, or `/tests/`.
- The head classification is syntactic: `f(x).pipe(...)` counts as "a function call" whatever `f` returns.
