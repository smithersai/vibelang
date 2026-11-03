export declare function plain(s: string): string
/** @throws {never} */
export declare function safe(s: string): string
/** @throws {RangeError} */
export declare function range(s: string): string
/** @throws {unknown} */
export declare function anything(s: string): string
export declare const callable: (s: string) => string
export interface Reader { read(s: string): string }
export declare const reader: Reader
export declare class Client {
  read(s: string): string
  field: (s: string) => string
}
export declare const client: Client
export declare function overloaded(s: string): string
export declare function overloaded(n: number): number
export declare const property: { read: (s: string) => string }
