export function increment(provide: number, scale: number) {
  const value = provide++ / scale / { value: 2 }.value
  return [value, provide]
}
export function decrement(provide: number, scale: number) {
  const value = provide-- / scale / { value: 2 }.value
  return [value, provide]
}
export function nonnull(provide: number | null, scale: number) {
  return provide! / scale / { value: 2 }.value
}
type NumericCallable = number & { <T>(): T }
export function instantiate(provide: NumericCallable, scale: number) {
  return provide<number> / scale / { value: 2 }.value
}
export function main() {
  const numeric = (function<T>() { return 0 as unknown as T }) as NumericCallable
  return [increment(8,2),decrement(8,2),nonnull(8,2),Number.isNaN(instantiate(numeric,2))]
}
