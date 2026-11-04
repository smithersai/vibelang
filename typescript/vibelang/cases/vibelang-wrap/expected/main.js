import * as Effect from "effect/Effect";
import { Console } from "effect";
// Each function that runs an Effect becomes one. Calling Console.log runs it.
export function answer() {
    return Effect.fnUntraced(function* answer() {
        yield* Console.log("computing the answer");
        return 42;
    }).apply(this, arguments);
}
export const half = (n) => {
    return Effect.gen(function* half() {
        yield* Console.log(`halving ${n}`);
        return n / 2;
    });
};
