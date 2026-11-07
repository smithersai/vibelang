import { Exit } from "effect"
/** @throws {never} */
export function iterator(log: string[], name: string, value: unknown): Iterable<unknown> {
  const it = { [Symbol.iterator]() { return it }, next() { return { done: false as const, value } }, return(): IteratorResult<unknown> { log.push(name); throw name + "-close" }, get Value(): never { throw "private Value read" }, get IteratorsToClose(): never { throw "private registry read" } }
  return it
}
/** @throws {never} */
export function errorsOf(exit: Exit.Exit<unknown, unknown>): unknown {
  if (exit._tag === "Success") return exit.value
  const defect = exit.cause.reasons.map((r) => r._tag === "Die" ? r.defect : r._tag)[0]
  return defect instanceof AggregateError ? defect.errors.map((e) => e instanceof TypeError ? "TypeError" : e) : defect
}
