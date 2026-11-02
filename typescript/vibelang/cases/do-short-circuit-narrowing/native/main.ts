// RC-38: stock TypeScript twin; no assertions or weakened strictness.
export function truthy(x: { n: number } | undefined): number | undefined {
  return x && (() => { return x.n })()
}
export function defined(x: string | undefined): false | number {
  return x !== undefined && (() => { return x.length })()
}
export function nonnull(x: string | null): false | number {
  return x !== null && (() => { return x.length })()
}
export function typeofAnd(x: string | number): false | number {
  return typeof x === "string" && (() => { return x.length })()
}
export function typeofOr(x: string | number): true | number {
  return typeof x !== "string" || (() => { return x.length })()
}
export function aliased(x: string | undefined): false | number {
  const present = x !== undefined
  const alias = present
  return alias && (() => { return x.length })()
}
type Shape = { kind: "a"; n: number } | { kind: "b"; text: string }
export function discriminant(x: Shape): false | number {
  return x.kind === "a" && (() => { return x.n })()
}
function isString(x: unknown): x is string { return typeof x === "string" }
export function predicate(x: unknown): false | number {
  return isString(x) && (() => { return x.length })()
}
export function predicateOr(x: unknown): true | number {
  return !isString(x) || (() => { return x.length })()
}
export function nullish(x: string | null | undefined): string {
  return x ?? (() => { const missing: null | undefined = x; return missing === null ? "null" : "undefined" })()
}
export function nested(x: string | undefined): false | number {
  return (x !== undefined && x.length > 0) && (() => { return x.length > 1 && (() => { return x.length })() })()
}
export function nestedOr(x: string | undefined): true | number {
  return x === undefined || (x.length === 0 || (() => { return x.length })())
}
type Scalar = number | boolean | string | undefined
type Observed = Scalar | string[]
export function sideEffects(x: string | undefined): Observed[] {
  const events: string[] = []
  const box = { get value() { events.push("get"); return x } }
  const a = (events.push("and"), isString(x)) && (() => { events.push("and-body"); return x.length })()
  const b = (events.push("or"), !isString(x)) || (() => { events.push("or-body"); return x.length })()
  const c = box.value ?? (() => { events.push("nullish-body"); return "fallback" })()
  const d = (events.push("call"), x) && (() => { events.push("truthy-body"); return x.length })()
  return [a, b, c, d, events]
}
export function reassigned(x: string | undefined): false | undefined {
  return x !== undefined && (() => { x = undefined; return x })()
}
export function readBeforeWrite(x: string | undefined): false | number {
  return x !== undefined && (() => { const n = x.length; x = undefined; return n })()
}
export function propertyNullish(box: { value?: string }): string {
  return box.value ?? (() => { const missing: undefined = box.value; return missing === undefined ? "missing" : "wrong" })()
}
function retainString(x: string | undefined): string | undefined { return x }
export function guardRecheckAnd(x: string | undefined): false | number {
  return (x !== undefined && (x = retainString(x), x !== undefined)) && (() => { return x.length })()
}
export function guardRecheckOr(x: string | undefined): true | number {
  return (x === undefined || (x = retainString(x), x === undefined)) || (() => { return x.length })()
}
export function leftAnd(x: string | undefined): false | number {
  return (x !== undefined && (() => { return x.length > 0 })()) && (() => { return x.length })()
}
export function leftOr(x: string | undefined): true | number {
  return (x === undefined || (() => { return x.length === 0 })()) || (() => { return x.length })()
}
export function leftNil(x: string | undefined): string | number {
  return (x ?? (() => { return undefined })()) ?? (() => { const missing: undefined = x; return 7 })()
}
export function leftRecheck(x: string | undefined): false | number {
  return ((x !== undefined && (() => { x = retainString(x); return true })()) && x !== undefined) && (() => { return x.length })()
}
export function unrelatedProperty(x: { kind: "a"; n: number; count: number } | { kind: "b"; count: number }): false | number {
  return (x.kind === "a" && (x.count++, true)) && (() => x.n + x.count)()
}
export function main(): (Scalar | Observed[])[] {
  return [
    truthy({ n: 7 }), truthy(undefined),
    defined("abc"), defined(undefined), nonnull("abc"), nonnull(null),
    typeofAnd("abc"), typeofAnd(4), typeofOr("abc"), typeofOr(4),
    aliased("abc"), aliased(undefined),
    discriminant({ kind: "a", n: 7 }), discriminant({ kind: "b", text: "b" }),
    predicate("abc"), predicate(4), predicateOr("abc"), predicateOr(4),
    nullish(""), nullish("abc"), nullish(null), nullish(undefined),
    nested("abc"), nested("a"), nested(""), nested(undefined),
    nestedOr("abc"), nestedOr(""), nestedOr(undefined),
    sideEffects("abc"), sideEffects(undefined), reassigned("abc"), reassigned(undefined),
    readBeforeWrite("abc"), readBeforeWrite(undefined), propertyNullish({ value: "" }), propertyNullish({}),
    guardRecheckAnd("abc"), guardRecheckAnd(undefined), guardRecheckOr("abc"), guardRecheckOr(undefined),
    leftAnd("abc"), leftAnd(undefined), leftOr("abc"), leftOr(undefined),
    leftNil("abc"), leftNil(undefined), leftRecheck("abc"), leftRecheck(undefined),
    unrelatedProperty({ kind: "a", n: 7, count: 0 }), unrelatedProperty({ kind: "b", count: 0 })
  ]
}
