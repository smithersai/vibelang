import { Effect, Stream, Layer } from "effect"
export declare function bare(): number
export declare const typed: () => number
export interface Port { method(): number }
export declare const port: Port
/** @throws {string} */
export declare function known(): number
/** @throws {never} */
export declare function safe(): number
/** @throws {string} */
export declare function effectful(): Effect.Effect<number>
/** @throws {string} */
export declare function stream(): Stream.Stream<number>
/** @throws {string} */
export declare function layer(): Layer.Layer<never>
export declare function loose(): any
export declare function uncertain(): unknown
export declare function mixed(): Effect.Effect<number> | undefined
export declare function generic<T>(): T
export declare function constrained<T extends Effect.Effect<number>>(): T
export declare class Foreign { constructor(); get value(): number; set value(n: number) }
/** @rethrows f @throws {never} */
export declare function rethrows(f: () => number): number
