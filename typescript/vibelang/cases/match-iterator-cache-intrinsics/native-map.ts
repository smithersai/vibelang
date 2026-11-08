let activeChange = () => false

/** @throws {never} */
export function changeMaps(): boolean { return activeChange() }

/** @throws {never} */
export function changedMaps(body: () => unknown, early = false): unknown {
  const OriginalMap = Map
  const keys = ["has", "get", "set", "clear", "values", Symbol.iterator] as const
  const descriptors = keys.map(key => [key, Object.getOwnPropertyDescriptor(OriginalMap.prototype, key)!] as const)
  let calls = 0
  const poison = () => { calls++; throw new Error("user Map operation") }
  const change = () => {
    for (const [key, descriptor] of descriptors) Object.defineProperty(OriginalMap.prototype, key, { ...descriptor, value: poison })
    globalThis.Map = poison as unknown as MapConstructor
    return false
  }
  const previous = activeChange
  activeChange = change
  try {
    if (early) change()
    return [body(), calls]
  } catch (error) { return [{ error: (error as Error).message }, calls] }
  finally {
    activeChange = previous
    globalThis.Map = OriginalMap
    for (const [key, descriptor] of descriptors) Object.defineProperty(OriginalMap.prototype, key, descriptor)
  }
}
