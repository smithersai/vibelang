import { Context, Effect } from "effect";
type Count_shape = {
    readonly n: number;
};
declare const Count_base: Context.ServiceClass<Count, "method-effect-contract-dts/main#Count", Count_shape>;
export declare class Count extends Count_base {
}
export declare namespace Count {
    type Shape = Count_shape;
}
export interface CounterApi {
    count(): Effect.Effect<number>;
    read(): Effect.Effect<number, never, Count>;
    label(): string;
}
export declare class Counter {
    count(): Effect.Effect<number>;
    read(): Effect.Effect<number, never, Count>;
    label(): string;
}
export declare function total(): Effect.Effect<string, never, Count>;
export {};
