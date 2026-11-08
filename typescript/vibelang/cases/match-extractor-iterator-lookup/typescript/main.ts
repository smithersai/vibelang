import { Effect } from "effect"

export function witness() {
  const trace: string[] = []
  const iterable = new Proxy({
    *[Symbol.iterator]() { trace.push("iterate"); yield 7 }
  }, {
    has() { trace.push("has"); return false },
    get(target, key, receiver) {
      if (key === Symbol.iterator) trace.push("get")
      return Reflect.get(target, key, receiver)
    }
  })
  const own = { [Symbol.iterator]() { return iterable[Symbol.iterator]() } }
  const callable = (_subject: unknown) => iterable
  const aList = Array.from(own)
  const a = aList.length === 1 ? aList[0] : -1
  const bList = Array.from(callable(null))
  const b = bList.length === 1 ? bList[0] : -1
  const cList = Array.from(own)
  const c = cList.length === 1 && cList[0] === 7
  const dList = Array.from(callable(null))
  const d = dList.length === 1 && dList[0] === 7
  return [a, b, c, d, trace]
}

export function main() { return Effect.sync(witness) }
