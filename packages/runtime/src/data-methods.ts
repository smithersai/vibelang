import { dataMethodTypeIds } from "./data-methods-table.js"

/** A call site's direct import, paired with its declaring D152 module. */
export type MethodCandidate = readonly [module: string, method: (...args: ReadonlyArray<never>) => unknown]

/** Dispatch only when one candidate matches, since Effect TypeIds can coexist. */
export function $method(value: unknown, name: string, args: readonly unknown[], candidates: readonly MethodCandidate[]): unknown {
  const member = value == null ? undefined : (value as Record<PropertyKey, unknown>)[name]
  // A callable member keeps its receiver; data fields such as HashMap.size
  // must not hide a module function. Read getters once, as JavaScript does.
  if (typeof member === "function") return Reflect.apply(member, value, args)
  const covered = candidates.filter(([module]) =>
    dataMethodTypeIds[module]?.some(id => id in Object(value)))
  if (covered.length === 1) return Reflect.apply(covered[0]![1], undefined, [value, ...args])
  // Uncovered and ambiguous values retain JavaScript's missing-method failure.
  return Reflect.apply(member as Function, value, args)
}
