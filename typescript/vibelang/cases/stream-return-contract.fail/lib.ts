import type { Stream } from "effect"
export type Marker = Pick<Stream.Stream<number>, typeof Stream.TypeId>
export type NoChannel = Omit<Stream.Stream<number>, "channel">
export type NoPipe = Omit<Stream.Stream<number>, "pipe">
export type View = { readonly [K in keyof Stream.Stream<number>]: Stream.Stream<number>[K] }
export declare function marker(): Marker
export declare function noChannel(): NoChannel
export declare function noPipe(): NoPipe
export declare function whole(): Stream.Stream<number>
export declare function view(): View
export declare function mixed(): Marker | Stream.Stream<number>
export declare function constrained<T extends Marker>(): T
export declare function complete<T extends Stream.Stream<number>>(): T
export declare function untagged(): number
/** @throws {never} */
export declare function safeMarker(): Marker
/** @throws {RangeError} */
export declare function knownMarker(): Marker
