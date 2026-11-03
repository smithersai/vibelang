import { Effect } from "effect"
import { events, abrupt, observe } from "./helper.js"
declare let censusLogical: any
function orAssign() {
  const result = censusLogical ||= (() => { events.push("rhs"); abrupt("rhs"); return 7 })()
  return result
}
function andAssign() {
  const result = censusLogical &&= (() => { return (() => { events.push("rhs"); abrupt("rhs"); return 7 })() })()
  return result
}
function nullAssign() {
  const result = censusLogical ??= (() => { return (() => { return (() => { events.push("rhs"); abrupt("rhs"); return 7 })() })() })()
  return result
}
export function probe() { return observe([orAssign, andAssign, nullAssign]) }
export function localOr(value: number | undefined): number {
  const result = value ||= (() => { return 7 })()
  const assigned: number = value
  return result + assigned
}
export function localAnd(value: number | undefined): number | undefined {
  const result = value &&= (() => { return value + 1 })()
  return result
}
export function localNull(value: number | null | undefined): number {
  const result = value ??= (() => { return 7 })()
  return result + value
}
export function effectProbe() {
  return Effect.gen(function* () {
    let value = 0
    const first = value ||= yield* Effect.succeed(7)
    const second = value &&= (value = 99, yield* Effect.succeed(8))
    return [first, second, value]
  })
}
export function condition(value: string | undefined): number {
  if (value &&= (() => { return value })()) return value.length
  return 0
}

export function compared(value: string | undefined): number {
  if ((value &&= (() => { return value })()) !== undefined) return value.length
  return 0
}
export function typed(value: string | number | undefined): number {
  if (typeof (value ||= (() => { return "fallback" })()) === "string") return value.length
  return value
}
export function negated(value: string | undefined): number {
  if (!(value &&= (() => { return value })())) return 0
  return value.length
}

function isText(value: unknown, unused: () => unknown): value is string {
  return typeof value === "string"
}
export function predicateBoundary(value: unknown): number {
  if (isText(value, () => value ||= (() => { return "fallback" })())) return value.length
  return 0
}
