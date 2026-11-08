import { all } from "effect/Effect";
import * as Effect_1 from "effect/Effect";
export function main() {
    return Effect_1.gen(function* main() {
        let runs = 0;
        const programs = yield* Effect_1.sync(() => [1, 2, 3].map((n) => {
            return Effect_1.gen(function* () {
                runs++;
                const value = yield* Effect_1.sync(() => n);
                return value + 1;
            });
        }));
        const programsType = true;
        const before = runs;
        const results = yield* all(programs);
        return [before, results, runs];
    });
}
