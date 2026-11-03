import * as Effect_1 from "effect/Effect";
import * as runtime from "vibelang-runtime";
// A concise arrow body that the lowering turns into a block keeps the
// comment after it outside the block, and the file keeps its last comment.
import { Effect } from "effect";
class Settings extends runtime.$service("vibelang-concise-comments/main#Settings") {
}
function findName(id) {
    return (_tail_1 => Effect_1.gen(function* findName() {
        const _completion_1 = _tail_1(), _value_1 = _completion_1[1];
        return _completion_1[0] ? yield* _value_1 : _value_1;
    }))({ findName: () => id === 1 ? [true, Effect.succeed("ada")] : [true, Effect.succeed("grace")] }.findName);
}
export const greeting = Effect_1.fnUntraced(function* greeting() { return (yield* Settings).greeting; });
// Effect<string, never, Settings>
export const nameLength = Effect_1.fnUntraced(function* nameLength() { return (yield* findName(1)).length; });
// Effect<number, never, never>
