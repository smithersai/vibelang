import { Stream } from "effect"
/** @throws {never} */
export declare function take(body: () => Stream.Stream<number>): number
/** @throws {never} */
export declare function take(body: () => Generator<number, void, unknown>): number
/** @throws {never} */
export declare function mixed(body: (() => Stream.Stream<number>) | (() => Generator<number, void, unknown>)): number
/** @throws {never} */
export declare function reject(body: () => Generator<number, void, unknown>): number
