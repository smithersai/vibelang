import { Effect, Stream, Layer } from 'effect'
// rule-evidence: docs/design/src/001-functions.md#declaration-output docs/design/vips/0027-declaration-output.md#decision
// VIP-27 / Will 2026-11-04: every local non-Effect export signature has a generated contract.
/** Adds one. @deprecated kept for compatibility */
export function add(n: number) { return n + 1 }
export default function identity(n: number) { return n }
export const arrow = () => 1
export const expression = function () { return 1 }
export class Methods {
  method() { return 1 }
  readonly arrow = () => 1
}
export const object = { method() { return 1 } }
export function overloaded(n: string): number
export function overloaded(n: number): number
export function overloaded(n: string | number) { return 1 }
function local() { return 1 }
export { local as renamed }
export namespace Nested { export function method() { return 1 } }
export type Callable = () => number
export interface Signatures {
 method(): number
 (): number
 new(): object
 callback: () => number
}
export { foreign } from "./foreign.js"

// Deferred failures keep their Effect, Stream or Layer channel.
export function stream(): Stream.Stream<number> { return undefined as unknown as Stream.Stream<number> }
export const layer = (): Layer.Layer<never> => (undefined as unknown as Layer.Layer<never>)
export interface Deferred {
  method<T extends Effect.Effect<number>>(): T
  (): Stream.Stream<number>
}
