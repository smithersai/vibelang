import * as Effect from "effect/Effect";
export const create = (url: string) =>
  Effect.succeed(url).pipe(Effect.runPromise);
