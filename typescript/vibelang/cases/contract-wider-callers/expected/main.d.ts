import { Context, Effect } from "effect";
declare const Gone_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "Gone";
} & Readonly<A>;
declare class Gone extends Gone_base {
}
type Needed_shape = {
    readonly id: string;
};
declare const Needed_base: Context.ServiceClass<Needed, "contract-wider-callers/main#Needed", Needed_shape>;
declare class Needed extends Needed_base {
}
declare namespace Needed {
    type Shape = Needed_shape;
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
