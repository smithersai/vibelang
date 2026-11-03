import { Effect, Schema } from "effect";
declare const FsError_base: Schema.Class<FsError, Schema.TaggedStruct<string, {
    readonly method: Schema.String;
    readonly path: Schema.optional<Schema.String>;
}>, import("effect/Cause").YieldableError>;
/** The base of a family of file system failures. */
export declare class FsError extends FsError_base {
}
declare const NotFound_base: Schema.Class<NotFound, Schema.Struct<{
    readonly method: Schema.String;
    readonly path: Schema.optional<Schema.String>;
    _tag: Schema.tag<"NotFound">;
    attempts: Schema.Number;
}>, FsError> & Pick<{}, never>;
export declare class NotFound extends NotFound_base {
}
declare const Locked_base: Schema.Class<Locked, Schema.TaggedStruct<"Locked", {
    readonly holder: Schema.String;
}>, import("effect/Cause").YieldableError>;
export declare class Locked extends Locked_base {
    /** @throws {never} */
    describe(): string;
}
export declare function main(): Effect.Effect<{
    tag: "NotFound";
    name: string;
    encoded: {
        readonly method: string;
        readonly path?: string | undefined;
        readonly _tag: "NotFound";
        readonly attempts: number;
    };
    decoded: {
        tag: "NotFound";
        method: string;
        family: boolean;
    };
    base: {
        tag: string;
        encoded: {
            readonly _tag: string;
            readonly method: string;
            readonly path?: string | undefined;
        };
    };
    isNotFound: boolean;
    routed: string;
    locked: string;
}, never, never>;
export {};
