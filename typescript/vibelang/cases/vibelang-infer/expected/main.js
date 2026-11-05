import * as Effect_1 from "effect/Effect";
import { Console, Data, Effect } from "effect";
class NotFound extends Data.TaggedError("NotFound") {
}
const names = ["ada", "grace", "barbara"];
// No annotations: lookup is Effect<string, NotFound, never>.
function lookup(id) {
    return Effect_1.gen(function* lookup() {
        if (id >= names.length)
            yield* Effect.fail(new NotFound({ id }));
        return names[id];
    });
}
// main is Effect<void, NotFound, never>: lookup's error flows into it.
export function main() {
    return Effect_1.fnUntraced(function* main() {
        yield* Console.log(`found ${yield* lookup(1)}`);
        const missing = yield* lookup(7); // fails, so main stops here
        yield* Console.log(`not printed: ${missing}`);
    }).apply(this, arguments);
}
// The module top level is not inside a program, so a runner starts one: it
// receives a program, a function with no parameters (D7, D38).
Effect.runPromise(Effect_1.gen(function* () { return yield* Effect.catch(Effect_1.gen(function* () { return yield* main(); }), (e) => {
    return Effect_1.gen(function* () { return yield* Console.log(`caught ${e._tag} ${e.id}`); });
}); }));
