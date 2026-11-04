import { Effect } from "effect"
import { coercionKey } from "./native-coercion.js"
const propertyKey = (value: any): PropertyKey => Reflect.ownKeys({ [value]: undefined })[0]
function probe() {
  let keyReads = 0
  let valueReads = 0
  const keys = { get name(): "value" { keyReads++; return "value" } }
  const subject = { get value() { valueReads++; return 7 }, other: 8 }
  const key = propertyKey(keys.name)
  let primitive: unknown = []
  if (key in subject) {
    const { [key as keyof typeof subject]: value, ...rest } = subject
    primitive = [value, (rest as { other: number }).other, keyReads, valueReads]
  }
  let objectReads = 0
  let coercions = 0
  const rawKey = { [Symbol.toPrimitive](_hint: string) { coercions++; return "value" } }
  const coercionKeys = { get name(): any { objectReads++; return rawKey } }
  const record: Record<PropertyKey, unknown> = { value: 7, other: 8 }
  const coerced = propertyKey(coercionKeys.name)
  let coercion: unknown = []
  if (coerced in record && record[coerced] === 7) {
    const { [coerced]: _value, ...rest } = record
    coercion = [(rest as Record<PropertyKey, unknown>).other, objectReads, coercions, Object.keys(rest).sort()]
  }
  let selected = "value"
  const changing: Record<string, unknown> = new Proxy({ value: 7, other: 8 }, {
    has(target, key) { selected = "other"; return Reflect.has(target, key) }
  })
  const captured = propertyKey(selected)
  const mutation = captured in changing && changing[captured as string] === 7 ? "hit" : "miss"
  let skipped = 0
  const lazy = { get name(): "value" { skipped++; return "value" } }
  const token = Symbol("key")
  let symbolReads = 0
  const symbolKeys = { get name(): typeof token { symbolReads++; return token } }
  const symbolSubject = { [token]: 9, other: 8 }
  let numberReads = 0
  const numberKeys = { get name(): 1 { numberReads++; return 1 } }
  const numberSubject = { 1: 5, other: 8 }
  let inlineReads = 0
  const inlineKeys = { get name(): "value" { inlineReads++; return "value" } }
  const inlineSubject = { value: 7 }
  const short = true
  const stopped = true
  const symbolKey = propertyKey(symbolKeys.name)
  let symbol: unknown = []
  if (symbolKey in symbolSubject) {
    const { [symbolKey as typeof token]: value, ...rest } = symbolSubject
    symbol = [value, rest.other, symbolReads, Reflect.ownKeys(rest).map(String)]
  }
  const numberKey = propertyKey(numberKeys.name)
  let numeric: unknown = []
  if (numberKey in numberSubject) {
    const { [numberKey as 1]: value, ...rest } = numberSubject
    numeric = [value, rest.other, numberReads, Object.keys(rest)]
  }
  const isValue = (wanted: number) => {
    const key = propertyKey(inlineKeys.name) as keyof typeof inlineSubject
    return key in inlineSubject && inlineSubject[key] === wanted
  }
  const inline = [isValue(7), isValue(0) || isValue(7), !isValue(0), !(propertyKey(inlineKeys.name) in {})]
  const inlineCount = inlineReads
  const arms = [isValue(0) || isValue(7), !isValue(0)]
  const abruptTrace: string[] = []
  const stop = {}
  const throwing = { get name(): any {
    abruptTrace.push("key")
    return coercionKey(abruptTrace, stop)
  } }
  const untouched: Record<PropertyKey, unknown> = new Proxy({ value: 7 }, { has() { abruptTrace.push("has"); return true } })
  let abrupt = false
  try { const key = propertyKey(throwing.name); if (key in untouched) { void untouched[key as "value"] } }
  catch (error) { abrupt = error === stop }
  return { primitive, coercion, mutation, short: [short, stopped, skipped], symbol, numeric, inline: [inline, inlineCount], arms: [arms, inlineReads - inlineCount], abrupt: [abrupt, abruptTrace] }
}
export function main(): Effect.Effect<unknown> { return Effect.sync(probe) }
