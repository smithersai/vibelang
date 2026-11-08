import * as Effect_1 from "effect/Effect";
let runs = 0;
export function nested() {
    return Effect_1.gen(function* nested() {
        return yield* Effect_1.sync(() => ({
            run: () => {
                return Effect_1.gen(function* run() {
                    runs++;
                    const value = yield* Effect_1.sync(() => 1);
                    return value + 1;
                });
            },
        }));
    });
}
export function main() {
    return Effect_1.gen(function* main() {
        const holder = yield* nested();
        const runType = true;
        const program = holder.run();
        const before = runs;
        const result = yield* program;
        return [before, result, runs];
    });
}
