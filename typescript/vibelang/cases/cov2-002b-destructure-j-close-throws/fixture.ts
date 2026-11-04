import { Exit } from "effect"
const iteratorKey = Symbol.iterator
const NativeSymbol = Symbol
export const keys = ["k-throw-wins", "k-close-result", "h-close-capture", "h-intrinsic-symbol", "h-iterator-one", "h-iterator-null", "h-primitive-next", "h-next-not-callable", "h-close-not-callable", "h-scalar", "j-close-object", "j-close-throws", "j-close-result", "j-empty", "i-abandoned"]
export interface Fixture { method: string; xs: any; b: { value: number }; trace: unknown[]; cleanup: () => void }
/** @throws {never} */
export function attach(xs: any, read: () => unknown): void { if (typeof xs === "object" && xs !== null) xs.read = read }
/** @throws {never} */
export function fixture(key: string): Fixture {
 const trace: unknown[] = []
 const method = key[0]
 const xs: any = { read: undefined }
 let index = 0
 const iterator: any = {
  next() { trace.push("next"); return index++ === 0 && key !== "j-empty" ? { done: false, value: undefined } : { done: true, value: undefined } },
  return() {
   trace.push("return")
   if (key === "h-close-capture") trace.push(["captured", xs.read()])
   if (key === "j-close-throws" || key === "k-throw-wins") throw "close"
   if (key === "k-close-result" || key === "j-close-result") return 1
   return { done: true, value: undefined }
  }
 }
 xs[iteratorKey] = () => {
  trace.push("iterator")
  if (key === "h-iterator-one" || key === "h-primitive-next") return 1
  if (key === "h-iterator-null") return null
  return iterator
 }
 if (key === "h-next-not-callable") iterator.next = 1
 if (key === "h-close-not-callable") iterator.return = 1
 let cleanup = () => {}
 if (key === "h-intrinsic-symbol") {
  globalThis.Symbol = new Proxy(NativeSymbol, { get(target, prop, receiver) { return prop === "iterator" ? undefined : Reflect.get(target, prop, receiver) } })
  cleanup = () => { globalThis.Symbol = NativeSymbol }
 }
 if (key === "h-primitive-next") {
  const original = Object.getOwnPropertyDescriptor(Number.prototype, "next")
  Object.defineProperty(Number.prototype, "next", { configurable: true, value: () => { trace.push("wrong-next"); return { done: true } } })
  cleanup = () => { if (original) Object.defineProperty(Number.prototype, "next", original); else Reflect.deleteProperty(Number.prototype, "next") }
 }
 const b = { get value(): number { trace.push("get"); if (key === "k-throw-wins") throw "body"; return 7 } }
 return { method, xs: key === "h-scalar" ? 5 : xs, b, trace, cleanup }
}
/** @throws {never} */
export function finish(row: Fixture): void { row.cleanup() }
/** @throws {never} */
export function normalize(result: Exit.Exit<unknown, unknown>): unknown {
 if (Exit.isSuccess(result)) return { tag: "Success", value: result.value }
 return { tag: "Failure", reasons: result.cause.reasons.map(r => r._tag === "Fail" ? ["Fail", r.error] : r._tag === "Die" ? ["Die", r.defect instanceof Error ? { name: r.defect.name, message: r.defect.message } : r.defect] : ["Interrupt"]) }
}
