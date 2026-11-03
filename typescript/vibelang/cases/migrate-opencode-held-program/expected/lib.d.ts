import { Effect } from "effect";
export declare const log: Array<string>;
export declare const finalized: Effect.Effect<void, never, import("effect/Scope").Scope>;
export declare const returned: Effect.Effect<Effect.Effect<number, never, never>, never, never>;
export declare const ranLater: Effect.Effect<number, never, never>;
export declare const bothLayers: Effect.Effect<number, never, never>;
