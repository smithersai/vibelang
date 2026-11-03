/** @throws {never} */
export declare function overloaded(value: number): number
/** @throws {RangeError} */
export declare function overloaded(value: string): number
type Returned = /** @throws {TypeError} */ () => number
/** @throws {never} */
export declare function factory(): Returned
