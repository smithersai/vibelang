import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"

// Brackets the construction of one try.allSettled literal: install() is its
// first element and restore() its last, so Array.prototype[Symbol.iterator] is
// patched while the elements and spreads are evaluated and is back before any
// Effect runs. Each element's evaluation is recorded in order.
const original = Array.prototype[Symbol.iterator]
let iteratorCalls = 0
export const order: string[] = []

/** @throws {never} */
export function install(mode: "count" | "reverse"): Effect.Effect<string> {
  iteratorCalls = 0
  order.length = 0
  order.push("install")
  Object.defineProperty(Array.prototype, Symbol.iterator, {
    configurable: true,
    writable: true,
    value: function (this: unknown[]) {
      iteratorCalls++
      const items = Array.from({ length: this.length }, (_, i) => this[i])
      return original.call(mode === "reverse" ? items.reverse() : items)
    }
  })
  return Effect.succeed(mode)
}

/** @throws {never} */
export function restore(): Effect.Effect<string> {
  Object.defineProperty(Array.prototype, Symbol.iterator, { configurable: true, writable: true, value: original })
  order.push("restore")
  return Effect.succeed("restore")
}

/** @throws {never} */
export function calls(): number {
  return iteratorCalls
}

/** @throws {never} */
export function at(label: string, value: number): Effect.Effect<number> {
  order.push(label)
  return Effect.succeed(value)
}

/** @throws {never} */
export function set12(): Set<Effect.Effect<number>> {
  order.push("set")
  // Built with add, not new Set([...]): the Set constructor iterates an
  // array argument with the patched Array.prototype[Symbol.iterator].
  const set = new Set<Effect.Effect<number>>()
  set.add(Effect.succeed(1))
  set.add(Effect.succeed(2))
  return set
}

/** @throws {never} */
export function arr12(): Effect.Effect<number>[] {
  order.push("array")
  return [Effect.succeed(1), Effect.succeed(2)]
}

/** @throws {never} */
export function tag(e: Exit.Exit<unknown, unknown>): string {
  return Exit.isSuccess(e) ? "Success:" + String(e.value) : "Failure"
}
