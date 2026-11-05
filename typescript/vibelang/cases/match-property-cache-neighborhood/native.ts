/** @throws {never} */
export function poisonedSubject(trace: string[]) {
  return new Proxy({ get key(): number { throw new Error("must not read") } }, {
    has(target, key) { trace.push("has:" + String(key)); return Reflect.has(target, key) }
  })
}
/** @throws {Error} */
export function capturedHelper(): never { throw new Error("captured") }
