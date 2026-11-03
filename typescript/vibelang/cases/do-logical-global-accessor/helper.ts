export const events: string[] = []
let value: any = 0
let failure = ""
let step = 0
/** @throws {never} */
export function reset(initial: any, fail = "", getterStep = 0) {
  value = initial; failure = fail; step = getterStep; events.length = 0
}
/** @throws {never} */
export function state() { return value }
/** Native fixture intentionally hides throws from the Vibe checker.
 * @throws {never}
 */
export function abrupt(stage: string) {
  if (failure === stage) throw new Error(stage)
}
Object.defineProperty(globalThis, "censusLogical", {
  configurable: true,
  get() {
    events.push("get:" + String(value)); abrupt("get")
    const old = value
    if (step) value = Number(value) + step
    return old
  },
  set(n: any) {
    events.push("set:" + String(n)); abrupt("set"); value = n + 100
  }
})
/** @throws {never} */
export function observe(assignments: (() => any)[]) {
  const out = []
  for (const assignment of assignments) {
    for (const initial of [0, 2, null, undefined, false, "", "yes"]) {
      for (const fail of ["", "get", "rhs", "set"]) {
        for (const getterStep of [0, 1]) {
          reset(initial, fail, getterStep)
          let result: any = "abrupt", error: string | null = null
          try { result = assignment() }
          catch (e) { error = e instanceof Error ? e.message : String(e) }
          out.push({ result, state: state(), events: [...events], error })
        }
      }
    }
  }
  return out
}
