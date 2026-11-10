/**
 * The in-process store under `Experimental.Memory`: facts keyed by namespace
 * and key, gone at exit.
 *
 * @internal
 */
import * as Effect from "effect/Effect"
import type { Namespace, SearchRow, Store } from "../Memory.js"

interface Fact extends SearchRow {
  readonly createdAtMs: number
}

const identity = (namespace: Namespace): string => `${namespace.kind}\u0000${namespace.id}`

/** A store in this process's memory. Layers that share one see each other's facts. */
export const makeMemory = (): Store => {
  const facts = new Map<string, Map<string, Fact>>()
  return {
    putFact: ({ namespace, key, text, at }) =>
      Effect.sync(() => {
        const id = identity(namespace)
        let bank = facts.get(id)
        if (bank === undefined) facts.set(id, bank = new Map())
        bank.set(key, { key, text, createdAtMs: bank.get(key)?.createdAtMs ?? at, updatedAtMs: at })
      }),
    searchRows: (namespace) =>
      Effect.sync(() =>
        [...(facts.get(identity(namespace))?.values() ?? [])].map(({ key, text, updatedAtMs }) => ({ key, text, updatedAtMs }))
      )
  }
}
