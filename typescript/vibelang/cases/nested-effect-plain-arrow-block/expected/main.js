import * as Effect from "effect/Effect";
import * as Effect_1 from "effect/Effect";
export function main() {
    return Effect_1.gen(function* main() {
        let runs = 0;
        const make = yield* Effect.try(() => (n) => Effect_1.gen(function* () {
            runs++;
            const value = yield* Effect_1.sync(() => n);
            return value * 2;
        }));
        const makeType = true;
        const program = make(3);
        const before = runs;
        const result = yield* program;
        return [before, result, runs];
    });
}
