import { Data, Effect } from "effect";
/** A parcel on its way. */
export type Delivery = Data.TaggedEnum<{
    Waiting: {};
    /** Handed to the carrier. */
    Sent: {
        tracking: string;
        carrier?: string;
    };
    Rejected: {
        reason: string;
        note?: string;
    };
}>;
/** A parcel on its way. */
export declare const Delivery: Data.TaggedEnum.Constructor<{
    readonly _tag: "Rejected";
    readonly reason: string;
    readonly note?: string;
} | {
    readonly _tag: "Sent";
    readonly tracking: string;
    readonly carrier?: string;
} | {
    readonly _tag: "Waiting";
}>;
export type LoadState<A, E> = Data.TaggedEnum<{
    Idle: {};
    Loaded: {
        value: A;
    };
    Failed: {
        error: E;
    };
}>;
export interface $LoadState$Definition extends Data.TaggedEnum.WithGenerics<2> {
    readonly taggedEnum: LoadState<this["A"], this["B"]>;
}
export declare const LoadState: Data.TaggedEnum.GenericConstructor<$LoadState$Definition>;
export declare function describe(delivery: Delivery): string;
export declare function main(): Effect.Effect<{
    described: string[];
    loads: number[];
    sent: boolean;
    same: boolean;
    different: boolean;
    matched: string;
    guard: boolean[];
    note: string;
    fromObject: string[];
}, never, never>;
