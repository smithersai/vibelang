import * as Effect_1 from "effect/Effect";
import * as runtime from "vibelang-runtime/internal";
// A concise arrow body that the lowering turns into a block keeps the
// comment after it outside the block, and the file keeps its last comment.
import { Effect } from "effect";
class Settings extends runtime.$service("vibelang-concise-comments/main#Settings") {
}
function findName(id) {
    return Effect_1.gen(function* findName() {
        return id === 1 ? yield* Effect.succeed("ada") : yield* Effect.succeed("grace");
    });
}
export const greeting = () => {
    return Effect_1.gen(function* greeting() { return (yield* Settings).greeting; });
};
// Effect<string, never, Settings>
export const nameLength = () => {
    return Effect_1.gen(function* nameLength() { return (yield* findName(1)).length; });
};
// Effect<number, never, never>
