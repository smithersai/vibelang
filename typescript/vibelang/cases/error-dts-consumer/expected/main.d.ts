import { $ErrorArgs } from "vibelang-runtime";
declare const NotFound_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "NotFound";
} & Readonly<A>;
export declare class NotFound extends NotFound_base<{
    readonly id: string;
}> {
}
declare const Timeout_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "Timeout";
} & Readonly<A>;
export declare class Timeout extends Timeout_base<{
    readonly ms: number;
}> {
}
declare const AppError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: string;
} & Readonly<A>;
export declare class AppError extends AppError_base<{
    readonly _tag: string;
    readonly code: string;
}> {
}
declare const Denied_base: typeof AppError;
export declare class Denied extends Denied_base {
    readonly _tag: "Denied";
    readonly user: string;
    constructor(args: $ErrorArgs<typeof AppError, Pick<Denied, "user">>);
}
/** @throws {never} */
export declare function describe(e: NotFound | Timeout): string;
export {};
