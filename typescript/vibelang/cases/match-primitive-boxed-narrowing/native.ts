// The TypeScript test a primitive class pattern performs, and the types it
// gives the subject: the primitive or its boxed object, and neither when false.
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
export function narrowed(s: unknown) {
  if (typeof s === "string" || s instanceof String) { const ok: Eq<typeof s, string | String> = true; void ok }
  if (typeof s === "number" || s instanceof Number) { const ok: Eq<typeof s, number | Number> = true; void ok }
  if (typeof s === "boolean" || s instanceof Boolean) { const ok: Eq<typeof s, boolean | Boolean> = true; void ok }
  if (typeof s === "bigint" || s instanceof BigInt) { const ok: Eq<typeof s, bigint | BigInt> = true; void ok }
  if (typeof s === "symbol" || s instanceof Symbol) { const ok: Eq<typeof s, symbol | Symbol> = true; void ok }
}
export function complement(s: string | String | readonly number[]) {
  if (!(typeof s === "string" || s instanceof String)) { const ok: Eq<typeof s, readonly number[]> = true; void ok }
}
export function stringLength(s: unknown) {
  if ((typeof s === "string" || s instanceof String) && (typeof s === "object" || typeof s === "function") && s !== null && "length" in s) return s.length
  return "miss"
}
