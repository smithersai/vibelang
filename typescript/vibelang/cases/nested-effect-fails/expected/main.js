import { $catchExpression, $schemaErrorMatcher, TaggedError } from "vibelang-runtime/internal";
import * as Effect_1 from "effect/Effect";
import * as runtime from "vibelang-runtime/internal";
class Refused extends TaggedError("Refused") {
    static {
        $schemaErrorMatcher(this, "Refused", true);
    }
}
export function main() {
    return Effect_1.gen(function* main() {
        let runs = 0;
        const holder = yield* Effect_1.sync(() => ({
            run: () => {
                return Effect_1.gen(function* run() {
                    const value = yield* Effect_1.sync(() => 1);
                    if (value > 0)
                        return yield* Effect_1.fail(new Refused({ attempt: value }));
                    runs++;
                    return value;
                });
            },
        }));
        const runType = true;
        const outcome = yield* runtime.$catch(yield* (() => { return Effect_1.sync(() => { return holder.run(); }); })(), (e) => Effect_1.sync(() => { return [e._tag, e.attempt, runs]; }));
        return outcome;
    });
}
