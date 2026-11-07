import type { Effect, Stream, Layer, Exit } from "effect"
/** @throws {RangeError} */
export declare function maybeEffect(): Effect.Effect<number> | undefined
/** @throws {RangeError} */
export declare function maybeStream(): Stream.Stream<number> | null
/** @throws {RangeError} */
export declare function maybeLayer(): Layer.Layer<never> | undefined
/** @throws {RangeError} */
export declare function maybeExit(): Exit.Exit<number> | undefined
/** @throws {RangeError} */
export declare function genericMaybe<T extends Effect.Effect<number> | undefined>(): T
/** @throws {RangeError} */
export declare const optionalWhole: (() => Effect.Effect<number>) | undefined
/** @throws {never} */
export declare function safeMaybe(): Effect.Effect<number> | undefined
