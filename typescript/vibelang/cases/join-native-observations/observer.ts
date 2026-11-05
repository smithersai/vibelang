import type { Fiber } from "effect"
/** Constructing the observer does not invoke its traps. @throws {never} */
export function guardFiber<A,E>(fiber: Fiber.Fiber<A,E>): Fiber.Fiber<A,E> {
  return new Proxy(fiber, {
    has() { throw new Error("join tested a marker") }
  })
}
