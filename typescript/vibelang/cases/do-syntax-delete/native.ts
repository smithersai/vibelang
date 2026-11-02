export function probe(): unknown[] {
  const events: string[] = []
  const target: { value?: number } = { value: 7 }
  const box = new Proxy(target, {
    get(object, key): unknown { events.push("wrong-get"); return Reflect.get(object, key) },
    deleteProperty(object, key): boolean { events.push("delete"); return Reflect.deleteProperty(object, key) }
  })
  const a = delete box[(() => { events.push("key"); return "value" as const })()]
  target.value = 8
  const b = delete ((() => { events.push("object"); return box })()).value
  return [a, b, Object.hasOwn(target, "value"), events]
}
