import * as Effect from "effect/Effect";
declare const customGen: <A>(
  f: () => Generator<Effect.Effect<any, any, any>, A, any>
) => Effect.Effect<A, any, any>;
export const flow = Effect.gen(function* () {
  return customGen(function* () {
    yield* Effect.succeed(1);
    return 2;
  });
});
