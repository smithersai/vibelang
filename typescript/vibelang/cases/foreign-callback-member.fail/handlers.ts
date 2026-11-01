/** @throws {Error} */
export function risky(): void {
  throw new Error("risky")
}

/** @throws {never} */
export function safe(): void {}

/** @throws {never} */
export declare function take(props: { onClick: () => void }): void
/** @throws {never} */
export declare function call(f: () => void): void
