import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Effect_1 from "effect/Effect";
export function main() {
    return Effect_1.gen(function* main() {
        const state = yield* Ref.make(0);
        const holder = yield* Effect.try(() => ({
            run: () => Effect_1.gen(function* () {
                const value = yield* Ref.get(state);
                yield* Ref.set(state, value + 1);
                return value + 1;
            }),
        }));
        const runType = true;
        const program = holder.run();
        const before = yield* Ref.get(state);
        const result = yield* program;
        return [before, result, yield* Ref.get(state)];
    });
}
