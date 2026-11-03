const f = Object.assign((n: number): number => n + 1, { bind: (_self: unknown) => (n: number): string => "wrong" })
const noncallable = Object.assign((n: number): number => n + 2, { bind: 0 })
const generic = Object.assign(<T>(value: T): T => value, { bind: false })
function overloaded(value: number): number
function overloaded(value: string): string
function overloaded(value: number | string): number | string { return value }
const overload = Object.assign(overloaded, { bind: "unused" })
const receiver = Object.assign(function(this: { base: number }, n: number): number { return this.base + n }, { bind: null })
const tag = Object.assign((parts: TemplateStringsArray, n: number): number => parts.length + n, { bind: () => () => "wrong" })
const obj = { f, noncallable, generic, overload, receiver, tag, base: 10 }
export function probe() { return obj.f(2) }
export function numericBind() { return obj.noncallable(2) }
export function genericBind() { return obj.generic("kept" as const) }
export function overloadedBind() { return obj.overload("overload") }
export function explicitThis() { return obj.receiver(2) }
export function elementAccess() { return obj["f"](2) }
export function taggedTemplate() { return obj.tag`head${2}tail` }
export function writtenBind() { return f.bind(obj)(2) }
