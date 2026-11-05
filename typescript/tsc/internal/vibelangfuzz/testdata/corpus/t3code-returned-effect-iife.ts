import * as Effect from "effect/Effect";
export const make = (valid: boolean) => valid ? Effect.succeed(1) : Effect.fail("bad");
