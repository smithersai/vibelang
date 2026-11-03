import { Effect } from "effect"
import { inputs, Foreign, CrossRealm, TaggedBase, TaggedSub } from "./subjects.js"

export function recognize(value: unknown): readonly boolean[] {
  return [
    Array.isArray(value), value instanceof Date, value instanceof Map, value instanceof Error,
    value instanceof RegExp, value instanceof Set, value instanceof WeakMap, value instanceof WeakSet,
    value instanceof Promise, value instanceof Uint8Array, value instanceof ArrayBuffer, value instanceof AggregateError,
    value instanceof Foreign, value instanceof CrossRealm,
    typeof value === "object" && value !== null && "_tag" in value && value._tag === "TaggedBase", value instanceof TaggedSub
  ]
}
function isText(value: string | number): value is string { return typeof value === "string" }
export function narrow(value: string | number): number {
  if (isText(value)) return value.length
  return value * 2
}
export function main(): Effect.Effect<readonly unknown[]> {
  return Effect.sync(() => [inputs().map(recognize), [narrow("abc"), narrow(4)]])
}
