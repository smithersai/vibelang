import * as Effect_1 from "effect/Effect";
import * as runtime from "vibelang-runtime/internal";
import * as Queue from "effect/Queue";
import * as Stream_1 from "effect/Stream";
// expect-result: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]
// Each try runs its operand once, with or without parentheses around it:
// try (try (e)) is yield* (yield* e), as TypeScript's twin is.
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
const nested = () => Effect.succeed(Effect.succeed(5));
const record = () => Effect.succeed(Effect.succeed({ n: 12 }));
const holder = () => Effect.succeed({ v: Effect.succeed({ n: 13 }) });
export const bare = Effect_1.gen(function* bare() { return yield* yield* Effect.succeed(Effect.succeed(1)); });
export const inner = Effect_1.gen(function* inner() { return yield* (yield* Effect.succeed(Effect.succeed(2))); });
export const grouped = Effect_1.gen(function* grouped() { return yield* ((yield* Effect.succeed(Effect.succeed(3)))); });
export const three = Effect_1.gen(function* three() { return yield* (yield* ((yield* Effect.succeed(Effect.succeed(Effect.succeed(4)))))); });
export const call = Effect_1.gen(function* call() { return yield* ((yield* nested())); });
export function fn() {
    return Effect_1.gen(function* fn() { return yield* ((yield* Effect.succeed(Effect.succeed(6)))); });
}
export const arrow = () => {
    return Effect_1.gen(function* arrow() { return yield* ((yield* Effect.succeed(Effect.succeed(7)))); });
};
export class Box {
    run() {
        return Effect_1.gen(function* run() { return yield* ((yield* Effect.succeed(Effect.succeed(8)))); });
    }
    values() {
        return (producerBody => Stream_1.callback(producerQueue => Effect_1.andThen(Effect_1.provideService(Effect_1.suspend(producerBody), { key: "vibelang-runtime/ProducerQueue" }, producerQueue), Queue.end(producerQueue)), { bufferSize: 1, strategy: "suspend" }))(Effect_1.fnUntraced(function* values() { yield* runtime.$yield(yield* ((yield* Effect.succeed(Effect.succeed(14))))); }));
    }
}
export const api = {
    run() {
        return Effect_1.gen(function* run() { return yield* ((yield* Effect.succeed(Effect.succeed(9)))); });
    },
    values() {
        return (producerBody_1 => Stream_1.callback(producerQueue_1 => Effect_1.andThen(Effect_1.provideService(Effect_1.suspend(producerBody_1), { key: "vibelang-runtime/ProducerQueue" }, producerQueue_1), Queue.end(producerQueue_1)), { bufferSize: 1, strategy: "suspend" }))(Effect_1.fnUntraced(function* values() { yield* runtime.$yield(yield* ((yield* Effect.succeed(Effect.succeed(15))))); }));
    },
};
export const threeBare = Effect_1.gen(function* threeBare() { return yield* yield* yield* Effect.succeed(Effect.succeed(Effect.succeed(10))); });
export const mixed = Effect_1.gen(function* mixed() { return yield* (yield* (yield* Effect.succeed(Effect.succeed(Effect.succeed(11))))); });
export const member = Effect_1.gen(function* member() { return (yield* ((yield* record()))).n; });
export const chain = Effect_1.gen(function* chain() { return (yield* ((yield* holder())).v).n; });
export function main() {
    return Effect_1.gen(function* main() {
        return [yield* bare, yield* inner, yield* grouped, yield* three, yield* call, yield* fn(), yield* arrow(), yield* new Box().run(), yield* api.run(), yield* threeBare, yield* mixed, yield* member, yield* chain, ...(yield* Stream.runCollect(new Box().values())), ...(yield* Stream.runCollect(api.values()))];
    });
}
