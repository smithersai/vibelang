import { Effect } from "effect"
/** @throws {never} */
export function observe<A>(call: () => Effect.Effect<A>, hostile: boolean) {
  const descriptor = Object.getOwnPropertyDescriptor(Function.prototype, "apply")!
  let reads = 0
  const problem = { label: "unexpected forwarding" }
  Object.defineProperty(Function.prototype, "apply", {
    configurable: true,
    get() { reads++; if (hostile) throw problem; return descriptor.value },
  })
  try { return { program: call(), reads, threw: false } }
  catch (error) { return { program: Effect.die(error), reads, threw: true } }
  finally { Object.defineProperty(Function.prototype, "apply", descriptor) }
}
