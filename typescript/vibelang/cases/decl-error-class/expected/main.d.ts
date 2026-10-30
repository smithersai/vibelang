import { Effect } from "effect";
interface Coded {
    readonly code: string;
}
declare const Validated_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "Validated";
} & Readonly<A>;
/** A failure whose code is normalized when it is made. */
export declare class Validated extends Validated_base<{
    /** The code, trimmed and in lower case. */
    readonly code: string;
    readonly attempts: number;
}> implements Coded {
    #private;
    static readonly docs = "https://example.com/errors";
    private readonly prefix;
    constructor(code: string, attempts?: number);
    static make(code: string): Validated;
    get label(): string;
    describe(): string;
    toJSON(): Record<string, unknown>;
}
declare const Wrapped_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "Wrapped";
} & Readonly<A>;
export declare class Wrapped<T extends string> extends Wrapped_base<{
    readonly value: T;
}> {
}
export declare function main(): Effect.Effect<{
    code: string;
    tag: "Validated";
    name: string;
    label: string;
    first: string;
    second: string;
    json: string;
    docs: string;
    made: string;
    coded: string;
    attempts: number;
    recovered: string;
    wrapped: "w";
    matched: string;
}, never, never>;
export {};
