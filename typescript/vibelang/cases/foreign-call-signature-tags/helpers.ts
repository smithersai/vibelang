export type Reader = {
  /** @throws {never} */
  (): string
}
export const read: Reader = () => "signature"
export type Plain = () => string
/** @throws {never} */
export const tagged: Plain = () => "const"
