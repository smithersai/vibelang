import * as Effect from "effect/Effect"; export const bootstrap=():Promise<void>=>Effect.gen(function*(){yield*Effect.void;}).pipe(Effect.scoped,Effect.runPromise);
