import * as Effect from "effect/Effect";
import * as Effect_1 from "effect/Effect";
export function main() {
    return Effect_1.gen(function* main() {
        let runs = 0;
        let afterInner = 0;
        const outer = yield* Effect_1.sync(() => ({
            run: () => {
                return Effect_1.gen({ *run() {
                        runs++;
                        const inner = yield* Effect.try(() => ({
                            run: () => Effect_1.gen(function* () {
                                runs++;
                                const value = yield* Effect_1.sync(() => 10);
                                return value + 1;
                            }),
                        }));
                        afterInner = runs;
                        const value = yield* inner.run();
                        return value + afterInner;
                    } }.run);
            },
        }));
        const runType = true;
        const program = outer.run();
        const before = runs;
        const result = yield* program;
        return [before, afterInner, result, runs];
    });
}
