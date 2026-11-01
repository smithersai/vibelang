import { Effect, Stream } from "effect";
export interface Db {
    readonly name: string;
}
export declare function scopedItem(): Stream.Stream<number, never, never>;
export declare function withDb(): Stream.Stream<number, never, Db>;
export declare function plainItem(): Stream.Stream<number, never, never>;
export declare function main(): Effect.Effect<number[], never, never>;
