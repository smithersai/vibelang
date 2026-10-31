# Alchemy migration pairs

Real Effect TypeScript to VibeLang pairs from the VibeLang team's migration
of [alchemy-run/alchemy](https://github.com/alchemy-run/alchemy) at
`29537a8f4aa3` (2026-10-28), package `@alchemy.run/domain`. The VibeLang
compiler was 0.0.11.

`Telemetry.ts` (batch 02) compiled as `Telemetry.vibe` with no errors in the
batch and Domain's 150 tests passed, but the run reverted it: its public
declarations changed. `service` emits a VibeLang service key in place of the
explicit `"alchemy/Domain/Correlation"` key, and `schema` emits an interface
in place of the `type` alias. A library whose declarations are public API
keeps those two in TypeScript until that is resolved.

These are fragments of `@alchemy.run/domain` and are not compiled here.

## 1. A service and a schema

```ts
import * as Context from "effect/Context";
import * as Schema from "effect/Schema";

export const TraceJson = Schema.Struct({
  traceId: Schema.String,
  spanId: Schema.String,
  sampled: Schema.Boolean,
});
export type TraceJson = typeof TraceJson.Type;

export class Correlation extends Context.Service<Correlation, { readonly id: string }>()(
  "alchemy/Domain/Correlation",
) {}
```

```vibe
export schema TraceJson {
  traceId: string
  spanId: string
  sampled: boolean
}

export service Correlation { id: string }
```

## 2. Map and fallback pipelines as direct code

`Effect.map` and `Effect.orElseSucceed` become a `do` block and a `catch`
fallback; `Effect.currentParentSpan` is a held Effect, so `()` runs it. The
results are programs, so each is held as a function with a written contract.

```ts
export const currentTrace: Effect.Effect<TraceJson | undefined> = Effect.currentParentSpan.pipe(
  Effect.map((span): TraceJson => ({
    traceId: span.traceId,
    spanId: span.spanId,
    sampled: span.sampled,
  })),
  Effect.orElseSucceed(() => undefined),
);

export const correlationFor = (commandId: string): Effect.Effect<string> =>
  Effect.map(Effect.serviceOption(Correlation), (c) => (Option.isSome(c) ? c.value.id : commandId));
```

```vibe
export const currentTrace: (TraceJson | undefined)!! = () => {
  return do {
    const span = Effect.currentParentSpan();
    ({ traceId: span.traceId, spanId: span.spanId, sampled: span.sampled })
  } catch undefined;
};

export const correlationFor = (commandId: string): string!! => () => {
  const c = Effect.serviceOption(Correlation);
  return Option.isSome(c) ? c.value.id : commandId;
};
```
