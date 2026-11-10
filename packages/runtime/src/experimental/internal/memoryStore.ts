/**
 * The in-process store under `Experimental.Memory`: facts, notes and
 * threads, gone at exit. It keeps the SQL store's rules, so either serves
 * the same program.
 *
 * @internal
 */
import * as Effect from "effect/Effect"
import type { MemoryError, MemoryErrorCode, Message, Namespace, SearchRow, Store } from "../Memory.js"

/** Builds a memory failure; the public module passes its constructor in. */
export type Fail = (
  code: MemoryErrorCode,
  message: string,
  options?: { readonly path?: ReadonlyArray<string> | undefined; readonly cause?: unknown }
) => MemoryError

interface Note {
  readonly namespace: Namespace
  readonly text: string
  readonly supersedes: ReadonlyArray<string>
  readonly createdAtMs: number
}

const identity = (namespace: Namespace): string => `${namespace.kind}\u0000${namespace.id}`
const sameNamespace = (left: Namespace, right: Namespace): boolean => left.kind === right.kind && left.id === right.id

/** The newest `limit` of `messages`, already in history order. */
export const newest = <A>(messages: ReadonlyArray<A>, limit: number | undefined): ReadonlyArray<A> =>
  limit === undefined ? messages : limit === 0 ? [] : messages.slice(-limit)

/** A store in this process's memory. Layers that share one see each other's rows. */
export const makeMemory = (fail: Fail, compareMessages: (left: Message, right: Message) => number): Store => {
  const facts = new Map<string, Map<string, SearchRow>>()
  const notes = new Map<string, Note>()
  const superseded = new Set<string>()
  const threads = new Map<string, Map<string, Message>>()
  return {
    putFact: ({ namespace, key, text, at }) =>
      Effect.sync(() => {
        const id = identity(namespace)
        let bank = facts.get(id)
        if (bank === undefined) facts.set(id, bank = new Map())
        bank.set(key, { key, text, updatedAtMs: at })
      }),
    searchRows: (namespace) =>
      Effect.sync(() => [
        ...(facts.get(identity(namespace))?.values() ?? []),
        ...[...notes].flatMap(([id, note]) =>
          sameNamespace(note.namespace, namespace) && !superseded.has(id)
            ? [{ key: id, text: note.text, updatedAtMs: note.createdAtMs }]
            : []
        )
      ]),
    putNote: ({ namespace, id, text, supersedes, at }) =>
      Effect.suspend(() => {
        const existing = notes.get(id)
        if (existing !== undefined) {
          if (!sameNamespace(existing.namespace, namespace) || existing.text !== text) {
            return Effect.fail(fail("idempotency_conflict", `note id "${id}" already exists with different content`, { path: ["id"] }))
          }
          if (existing.supersedes.join("\u0000") !== supersedes.join("\u0000")) {
            return Effect.fail(fail("supersede_conflict", `note id "${id}" already exists with different supersedes`, { path: ["supersedes"] }))
          }
          return Effect.void
        }
        for (const target of supersedes) {
          const note = notes.get(target)
          if (note === undefined || !sameNamespace(note.namespace, namespace)) {
            return Effect.fail(fail("supersede_conflict", `superseded note "${target}" does not exist in this bank`, { path: ["supersedes"] }))
          }
        }
        notes.set(id, { namespace, text, supersedes, createdAtMs: at })
        for (const target of supersedes) superseded.add(target)
        return Effect.void
      }),
    appendMessage: ({ thread, id, role, text, at }) =>
      Effect.suspend(() => {
        let messages = threads.get(thread)
        if (messages === undefined) threads.set(thread, messages = new Map())
        const existing = messages.get(id)
        if (existing === undefined) {
          messages.set(id, { id, role, text, at })
          return Effect.void
        }
        const field = existing.role !== role ? "role" : existing.text !== text ? "text" : undefined
        return field === undefined
          ? Effect.void
          : Effect.fail(fail("idempotency_conflict", `message id "${id}" already exists in thread "${thread}" with a different ${field}`, { path: [field] }))
      }),
    history: (thread, limit) =>
      Effect.sync(() => newest([...(threads.get(thread)?.values() ?? [])].sort(compareMessages), limit))
  }
}
