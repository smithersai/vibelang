export const events: string[] = []
export const factoryError = new Error("factory")
export type Safe = {
  /** @throws {never} */
  (): number
}
export interface Shape { run: Safe }
export type Throwing = {
  /** @throws {string} */
  (): number
}
/** @throws {Error} */
export function create(fail = false): (
  /** @throws {never} */
  () => number
) {
  events.push(fail ? "create-fail" : "create")
  if (fail) throw factoryError
  return () => { events.push("callback-safe"); return 7 }
}
/** @throws {Error} */
export function createThrowing(): (
  /** @throws {string} */
  () => number
) {
  events.push("create-throwing")
  return () => { events.push("callback-throwing"); throw "callback" }
}
/** @throws {never} */
export function consume(fn: Safe): number { return fn() }
/** @throws {never} @rethrows fn */
export function invoke(fn: () => number): number { return fn() }
