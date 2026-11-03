import type { Effect } from "effect"
/** @throws {Error} */
export declare function risky(): 0
/** @throws {never} */
export declare function safe(): 1
/** @throws {never} */
export declare function safeZero(): 0
/** @throws {unknown} */
export declare function unknownSource(): 0
export declare const foreign: typeof risky | typeof safe
export declare const foreignSafe: typeof safeZero | typeof safe
export type Callback = () => 0 | 1
export type Allowed = {
  /** @throws {Error} */
  (): 0 | 1
}
export type Wide = {
  /** @throws {unknown} */
  (): 0 | 1
}
export type PerReturn = {
  /** @throws {Error} */
  (): 0
} | {
  /** @throws {never} */
  (): 1
}
export type WrongPerReturn = {
  /** @throws {never} */
  (): 0
} | {
  /** @throws {Error} */
  (): 1
}
/** @throws {never} */
export declare function take(f: Callback): void
/** @throws {never} */
export declare function takeOptional(f: Callback | undefined): void
/** @throws {never} */
export declare function allow(f: Allowed): void
/** @throws {never} */
export declare function wide(f: Wide): void
/** @throws {never} */
export declare function byReturn(f: PerReturn): void
/** @throws {never} */
export declare function wrongByReturn(f: WrongPerReturn): void
/** @throws {Error} */
export declare function effectZero(): Effect.Effect<0>
/** @throws {unknown} */
export declare function effectOne(): Effect.Effect<1>
/** @throws {never} */
export declare function effectUse(f: () => Effect.Effect<number>): void
/** @throws {Error} */
export declare function leftArg(value: 0): 0
/** @throws {never} */
export declare function rightArg(value: 1): 1
export declare const argUnion: typeof leftArg | typeof rightArg
/** @throws {never} */
export declare function wrongParameter(f: (value: 2) => 0 | 1): void
