import * as Effect from "effect/Effect";
export declare const reserve: (attempts: number) => Effect.Effect<string, string, never>;
export declare const load: () => Effect.Effect<string, never, never>;
export declare const depth: (n: number) => Effect.Effect<number, never, never>;
interface Tree {
    readonly name: string;
    readonly children: ReadonlyArray<Tree>;
}
export declare const holds: (tree: Tree, name: string) => Effect.Effect<boolean, never, never>;
export declare const walk: (n: number) => Effect.Effect<number, never, never>;
export declare const count: (n: number) => Effect.Effect<number>;
/** @throws {never} */
export declare const plainCount: (n: number) => number;
declare const Rejected_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "Rejected";
} & Readonly<A>;
declare class Rejected extends Rejected_base<{
    readonly message: string;
}> {
}
export declare const validate: (depth: number) => Effect.Effect<void, Rejected, never>;
export declare const processTrigger: (n: number) => Effect.Effect<number>;
export declare function main(): Effect.Effect<{
    race: number;
    reserve: string;
    depth: number;
    holds: boolean[];
    walk: number;
    count: number;
    plainCounts: number[];
    validate: string;
    processTrigger: number;
}, never, never>;
export {};
