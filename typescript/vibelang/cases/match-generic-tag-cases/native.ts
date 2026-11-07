function stringTag<T extends { _tag: "A" | "B" }>(s: T): number {
  if (s._tag === "A") return 1
  if (s._tag === "B") return 2
  throw new TypeError()
}
function booleanTag<U extends { _tag: boolean }, T extends U>(s: T): number {
  if (s._tag === true) return 1
  if (s._tag === false) return 2
  throw new TypeError()
}
function payload<T extends { _tag: "A" | "B"; value: number }>(s: T): number {
  if (s._tag === "A" && "value" in s) return s.value
  if (s._tag === "B" && "value" in s) return s.value
  throw new TypeError()
}
function shared<T extends { _tag: "A"; left: number } | { _tag: "A"; right: number }>(s: T): number {
  if (s._tag === "A") return 3
  throw new TypeError()
}
function alternatives<T extends { _tag: 1 | 2 }>(s: T): number {
  if (s._tag === 1 || s._tag === 2) return 4
  throw new TypeError()
}
/** @throws {never} */
export function nativeLabels(): number[] {
  return [stringTag({ _tag: "A" }), stringTag({ _tag: "B" }), booleanTag({ _tag: true }), booleanTag({ _tag: false }), payload({ _tag: "A", value: 7 }), payload({ _tag: "B", value: 8 }), shared({ _tag: "A", left: 0 }), alternatives({ _tag: 2 })]
}
