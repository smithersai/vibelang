export declare class Reader { read: () => string }
export declare class Source { read(): string }
export declare class Statics { static read: () => string }
export declare class Tolerant {
  /** @throws {Error} */
  read(): string
}
/** @throws {RangeError} */
export declare function parse(): string
/** @throws {never} */
export declare function safe(): string
export declare function untagged(): string
