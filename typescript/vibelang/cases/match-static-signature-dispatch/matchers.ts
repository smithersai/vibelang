import { customMatcher } from "vibelang-runtime"
export const events: string[] = []
/** @throws {never} */
export function predicate(this: { limit: number } | void, value: unknown, hint: { matchType: string }): value is number {
  events.push(hint.matchType)
  return typeof value === "number" && value > (this?.limit ?? 0)
}
predicate.prototype.marker = true
/** @throws {never} */
export function extractor(this: { limit: number } | void, value: unknown, hint: { matchType: string }): false | [number] {
  events.push(hint.matchType)
  return typeof value === "number" && value > (this?.limit ?? 0) ? [value] : false
}
extractor.prototype.marker = true
export class Box { readonly value = 7 }
export const BoundBox = Box.bind(undefined)
export const Constructor = function () { return false } as unknown as new () => object
export const constructed = new Constructor()
export const optionalPredicate = predicate as typeof predicate & {
  [customMatcher]?: (value: unknown, hint: { matchType: string }) => boolean
}
