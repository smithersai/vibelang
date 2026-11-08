import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
export declare const bare: Effect.Effect<number, never, never>;
export declare const inner: Effect.Effect<number, never, never>;
export declare const grouped: Effect.Effect<number, never, never>;
export declare const three: Effect.Effect<number, never, never>;
export declare const call: Effect.Effect<number, never, never>;
export declare function fn(): Effect.Effect<number, never, never>;
export declare const arrow: () => Effect.Effect<number, never, never>;
export declare class Box {
    run(): Effect.Effect<number, never, never>;
    values(): Stream.Stream<number, never, never>;
}
export declare const api: {
    run(): Effect.Effect<number, never, never>;
    values(): Stream.Stream<number, never, never>;
};
export declare const threeBare: Effect.Effect<number, never, never>;
export declare const mixed: Effect.Effect<number, never, never>;
export declare const member: Effect.Effect<number, never, never>;
export declare const chain: Effect.Effect<number, never, never>;
export declare function main(): Effect.Effect<number[], never, never>;
