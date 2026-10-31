import { Context, Effect } from "effect";
declare const Gone_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "Gone";
} & Readonly<A>;
declare class Gone extends Gone_base {
}
declare const Needed_base: Context.ServiceClass<Needed, "contract-wider-callers/main#Needed", {
    readonly id: string;
}>;
declare class Needed extends Needed_base {
}
export declare function longForm(): Effect.Effect<number, Gone, Needed>;
export declare function shortForm(): Effect.Effect<number, Gone, Needed>;
export declare function plain(): Effect.Effect<number>;
export declare function callerOfLong(): Effect.Effect<number, Gone, Needed>;
export declare function callerOfShort(): Effect.Effect<number, Gone, Needed>;
export declare function callerOfPlain(): Effect.Effect<number, never, never>;
export declare function callerOfMethod(): Effect.Effect<number, Gone, Needed>;
export declare function main(): Effect.Effect<number[], Gone, never>;
export {};
