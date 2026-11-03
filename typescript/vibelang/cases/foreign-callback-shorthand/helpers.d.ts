import type { Effect } from "effect"
/** @throws {Error} */
export declare function risky(): number
/** @throws {never} */
export declare function safe(): number
/** @throws {never} */
export declare function fx(): Effect.Effect<number>
export interface Strict { risky: () => number }
export interface Renamed { handler: () => number }
export interface Safe { safe: () => number }
export interface AllowedCallback {
 /** @throws {Error} */
 (): number
}
export interface Loose { risky: AllowedCallback }
export interface Fx { fx: () => Effect.Effect<number> }
/** @throws {never} */
export declare function take(value: Strict): void
/** @throws {never} */
export declare function takeRenamed(value: Renamed): void
/** @throws {never} */
export declare function takeSafe(value: Safe): void
/** @throws {never} */
export declare function takeLoose(value: Loose): void
declare global {
 /** @throws {Error} */
 var pending: () => number
}
