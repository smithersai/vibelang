import * as Effect_1 from "effect/Effect";
export function main() {
    return Effect_1.gen(function* main() {
        let runs = 0;
        const holder = yield* Effect_1.sync(() => ({
            run() {
                return Effect_1.gen(function* run() {
                    runs++;
                    const value = yield* Effect_1.sync(() => runs);
                    return value + 1;
                });
            },
        }));
        const runType = true;
        const program = holder.run();
        const before = runs;
        const result = yield* program;
        return [before, result, runs];
    });
}
