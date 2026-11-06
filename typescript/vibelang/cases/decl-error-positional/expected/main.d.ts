import { Effect } from "effect";
declare const Failure_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: string;
} & Readonly<A>;
export declare class Failure extends Failure_base<{
    readonly _tag: string;
    readonly code: string;
    readonly summary: string;
}> {
    constructor(code: string, summary: string);
    /** @throws {never} */
    toJSON(): Record<string, unknown>;
}
declare const Integration_base: typeof Failure;
export declare class Integration extends Integration_base {
    readonly _tag: "Integration";
    readonly reason: string;
    constructor(reason: string, summary: string);
}
declare const Plain_base: typeof Failure;
export declare class Plain extends Plain_base {
    readonly _tag: "Plain";
}
export declare function main(): Effect.Effect<{
    failure: {
        tag: string;
        summary: string;
    };
    integration: {
        tag: "Integration";
        code: string;
        reason: string;
        summary: string;
    };
    plain: {
        tag: "Plain";
        code: string;
        summary: string;
    };
    keys: string[];
    routed: string[];
    base: string;
}, never, never>;
export {};
