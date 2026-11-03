/** @throws {Error} */
export declare function risky(): void
/** @throws {never} */
export declare function safe(): void
/** @throws {never} */
export declare function take(props: { onClick: () => void }): void
/** @throws {never} */
export declare function call(f: () => void): void
export interface Throwing {
  /** @throws {unknown} */
  (): void
}
