/** @throws {never} */
export type Reader = () => string
export declare const read: Reader
/** @throws {never} */
export type Make<T> = () => T
export declare const make: Make<number>
/** @throws {never} */
export type Base = () => string
export type Nested = Base
export declare const nested: Nested
