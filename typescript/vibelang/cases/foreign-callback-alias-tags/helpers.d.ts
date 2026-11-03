/** @throws {Error} */
export declare function risky(): number
/** @throws {never} */
export declare function safe(): number
/** @throws {Error} */
export type Misplaced = () => number
/** @throws {unknown} */
export type Parenthesized = (() => number)
/** @throws {unknown} */
export type Chain = Misplaced
/** @throws {unknown} */
export type Bounded = {
  /** @throws {never} */
  (): number
}
/** @throws {never} */
export type Allowed = {
  /** @throws {Error} */
  (): number
}
/** @throws {Error} */
export type Wide = {
  /** @throws {unknown} */
  (): number
}
export interface Container { run: Misplaced }
/** @throws {never} */
export declare function take(f: Misplaced): void
/** @throws {never} */
export declare function takeParen(f: Parenthesized): void
/** @throws {never} */
export declare function takeChain(f: Chain): void
/** @throws {never} */
export declare function takeBounded(f: Bounded): void
/** @throws {never} */
export declare function takeAllowed(f: Allowed): void
/** @throws {never} */
export declare function takeWide(f: Wide): void
