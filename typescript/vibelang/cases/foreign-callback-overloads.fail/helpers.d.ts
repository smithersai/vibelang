import type { Effect } from "effect"
/** @throws {Error} */
export declare function choose(value: 0): number
/** @throws {never} */
export declare function choose(value: 1): number
/** @throws {never} */
export declare function reverse(value: 0): number
/** @throws {Error} */
export declare function reverse(value: 1): number
/** @throws {never} */
export declare function safe(value: 0): number
/** @throws {never} */
export declare function safe(value: 1): number
/** @throws {Error} */
export declare function single(value: 0 | 1): number
/** @throws {never} */
export declare function singleSafe(value: 0 | 1): number
/** @throws {Error} */
export declare function intrinsic<T extends Effect.Effect<number>>(value: 0): T
/** @throws {unknown} */
export declare function intrinsic<T extends Effect.Effect<number>>(value: 1): T

export interface Zero { /** @throws {never} */ (value: 0): number }
export interface One { /** @throws {never} */ (value: 1): number }
export interface Both {
  /** @throws {never} */
  (value: 0): number
  /** @throws {never} */
  (value: 1): number
}
export interface Permissive {
  /** @throws {Error} */
  (value: 0): number
  /** @throws {never} */
  (value: 1): number
}
/** @throws {never} */
export declare function zero(f: Zero): void
/** @throws {never} */
export declare function one(f: One): void
/** @throws {never} */
export declare function both(f: Both): void
/** @throws {never} */
export declare function permitted(f: Permissive): void
/** @throws {never} */
export declare function either(f: Zero | One): void
/** @throws {never} */
export declare function effectUse(f: (value: 0) => Effect.Effect<number>): void
/** @throws {never} */
export declare function wrongParameter(f: (value: 2) => number): void
