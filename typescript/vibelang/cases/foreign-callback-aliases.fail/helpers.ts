/** @throws {Error} */
export function risky(): void {}
/** @throws {never} */
export function safe(): void {}
export const nativeAlias = risky
export const box = { risky, safe }
/** @throws {never} */
export declare function call(f: () => void): void
export interface Throwing {
  /** @throws {unknown} */
  (): void
}
/** @throws {never} */
export declare function allow(f: Throwing): void
