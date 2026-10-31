import { Context, Effect } from "effect";
declare const Missing_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "Missing";
} & Readonly<A>;
export declare class Missing extends Missing_base {
}
declare const Need_base: Context.ServiceClass<Need, "infer-deduplicated-channels/main#Need", {
    value(): Effect.Effect<number>;
}>;
export declare class Need extends Need_base {
}
export declare function base(x: number): Effect.Effect<number, Missing, Need>;
export declare function twice(x: number): Effect.Effect<number, Missing, Need>;
export declare function contracted(x: number): Effect.Effect<number, Missing, Need>;
export declare class Chain {
    base(x: number): Effect.Effect<number, Missing, Need>;
    top(x: number): Effect.Effect<number, Missing, Need>;
}
export declare function main(): Effect.Effect<number, Missing, never>;
export {};
