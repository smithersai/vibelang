import { Stream } from "effect"
export type Marker = Pick<Stream.Stream<number>, typeof Stream.TypeId>
export type NoChannel = Omit<Stream.Stream<number>, "channel">
export type NoPipe = Omit<Stream.Stream<number>, "pipe">
export type View = { readonly [K in keyof Stream.Stream<number>]: Stream.Stream<number>[K] }
export function marker(): Marker { events.push("marker"); return value }
export function noChannel(): NoChannel { return value }
export function noPipe(): NoPipe { return value }
export function whole(): Stream.Stream<number> { return value }
export function view(): View { return value }
export declare function mixed(): Marker | Stream.Stream<number>
export declare function constrained<T extends Marker>(): T
export declare function complete<T extends Stream.Stream<number>>(): T
export function untagged(): number { return 1 }
/** @throws {never} */
export function safeMarker(): Marker { return value }
/** @throws {RangeError} */
export function knownMarker(): Marker { events.push("known"); throw boom }

export const events: string[] = []
export const value = Stream.succeed(1)
export const boom = new RangeError("partial")
