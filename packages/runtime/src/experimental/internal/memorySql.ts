/**
 * A memory store over Effect's `SqlClient`, so any of Effect's SQL clients
 * holds the rows: `@effect/sql-sqlite-node` or `-bun` for one file,
 * `@effect/sql-pg` for a server. The tables are `@smthrs/memory`'s
 * (`memory_facts`, `memory_notes`, `memory_note_supersedes`,
 * `memory_threads`, `memory_messages`), created if missing, so a Smithers
 * store and this one read each other's rows: a fact's value is
 * `{ "content": text }`, and a value of another shape reads as its JSON
 * text. Each write that checks before it inserts runs in one transaction. A
 * SQL failure is a memory failure with the code `store`.
 *
 * Text comparisons stay out of SQL: SQLite, PostgreSQL and JavaScript order
 * strings differently, so history is ordered in JavaScript.
 *
 * @internal
 */
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import { SqlClient } from "effect/sql"
import type { MemoryError, Message, SearchRow, Store } from "../Memory.js"
import { type Fail, newest } from "./memoryStore.js"

interface FactRecord {
  readonly key: string
  readonly value: string
  readonly updatedAt: number | string | bigint
}

interface NoteRecord {
  readonly key: string
  readonly kind: string
  readonly namespace: string
  readonly text: string
  readonly createdAt: number | string | bigint
}

interface MessageRecord {
  readonly id: string
  readonly role: string
  readonly text: string
  readonly at: number | string | bigint
}

/** A fact's recallable text, as Smithers projects it. */
export const searchableText = (value: unknown): string => {
  if (typeof value === "string") return value
  if (typeof value === "object" && value !== null && "content" in value && typeof value.content === "string") {
    return value.content
  }
  return JSON.stringify(value) ?? ""
}

const parse = (json: string): unknown => {
  try {
    return JSON.parse(json)
  } catch {
    return json
  }
}

const isMemoryError = (error: unknown): error is MemoryError =>
  typeof error === "object" && error !== null && "_tag" in error && error._tag === "MemoryError"

export const make = (fail: Fail, compareMessages: (left: Message, right: Message) => number) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const failure = (message: string) => (cause: unknown): MemoryError =>
      isMemoryError(cause) ? cause : fail("store", `${message}: ${String(cause)}`, { cause })
    yield* Effect.mapError(
      Effect.all([
        sql`CREATE TABLE IF NOT EXISTS memory_facts (
          namespace_kind TEXT NOT NULL,
          namespace_id TEXT NOT NULL,
          fact_key TEXT NOT NULL,
          value_json TEXT NOT NULL,
          tags_json TEXT,
          ttl_ms BIGINT,
          provenance_json TEXT NOT NULL,
          created_at_ms BIGINT NOT NULL,
          updated_at_ms BIGINT NOT NULL,
          PRIMARY KEY (namespace_kind, namespace_id, fact_key),
          CHECK (namespace_kind IN ('flow', 'agent', 'user', 'global')),
          CHECK (length(namespace_id) > 0),
          CHECK (length(fact_key) > 0),
          CHECK (ttl_ms IS NULL OR ttl_ms >= 0)
        )`,
        sql`CREATE TABLE IF NOT EXISTS memory_threads (
          thread_id TEXT PRIMARY KEY CHECK (length(thread_id) > 0),
          namespace_kind TEXT NOT NULL,
          namespace_id TEXT NOT NULL,
          title TEXT,
          metadata_json TEXT,
          created_at_ms BIGINT NOT NULL,
          updated_at_ms BIGINT NOT NULL,
          CHECK (namespace_kind IN ('flow', 'agent', 'user', 'global')),
          CHECK (length(namespace_id) > 0)
        )`,
        sql`CREATE TABLE IF NOT EXISTS memory_messages (
          id TEXT NOT NULL CHECK (length(id) > 0),
          thread_id TEXT NOT NULL,
          role TEXT NOT NULL,
          text TEXT NOT NULL,
          at_ms BIGINT NOT NULL,
          PRIMARY KEY (thread_id, id),
          FOREIGN KEY (thread_id) REFERENCES memory_threads (thread_id)
        )`,
        sql`CREATE INDEX IF NOT EXISTS memory_messages_thread_order_idx ON memory_messages (thread_id, at_ms, id)`,
        sql`CREATE TABLE IF NOT EXISTS memory_notes (
          id TEXT PRIMARY KEY CHECK (length(id) > 0),
          namespace_kind TEXT NOT NULL,
          namespace_id TEXT NOT NULL,
          text TEXT NOT NULL,
          tags_json TEXT NOT NULL,
          provenance_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'accepted',
          created_at_ms BIGINT NOT NULL,
          CHECK (namespace_kind IN ('flow', 'agent', 'user', 'global')),
          CHECK (length(namespace_id) > 0),
          CHECK (status IN ('pending', 'accepted', 'rejected'))
        )`,
        sql`CREATE INDEX IF NOT EXISTS memory_notes_namespace_order_idx
          ON memory_notes (namespace_kind, namespace_id, created_at_ms, id)`,
        sql`CREATE TABLE IF NOT EXISTS memory_note_supersedes (
          superseder_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          created_at_ms BIGINT NOT NULL,
          PRIMARY KEY (superseder_id, target_id),
          FOREIGN KEY (superseder_id) REFERENCES memory_notes (id),
          FOREIGN KEY (target_id) REFERENCES memory_notes (id),
          CHECK (superseder_id <> target_id)
        )`,
        sql`CREATE INDEX IF NOT EXISTS memory_note_supersedes_target_idx
          ON memory_note_supersedes (target_id, superseder_id)`
      ], { discard: true }),
      failure("could not create the memory tables")
    )

    const store: Store = {
      putFact: ({ namespace, key, text, at, ttlMs }) =>
        sql`INSERT INTO memory_facts (
          namespace_kind, namespace_id, fact_key, value_json, tags_json, ttl_ms, provenance_json, created_at_ms, updated_at_ms
        ) VALUES (
          ${namespace.kind}, ${namespace.id}, ${key}, ${JSON.stringify({ content: text })}, ${"[]"}, ${ttlMs ?? null}, ${"{}"}, ${at}, ${at}
        ) ON CONFLICT (namespace_kind, namespace_id, fact_key) DO UPDATE SET
          value_json = excluded.value_json,
          tags_json = excluded.tags_json,
          ttl_ms = excluded.ttl_ms,
          provenance_json = excluded.provenance_json,
          updated_at_ms = excluded.updated_at_ms`.pipe(
          Effect.asVoid,
          Effect.mapError(failure("could not write a memory fact"))
        ),

      searchRows: (namespace) =>
        Effect.gen(function*() {
          const now = yield* Clock.currentTimeMillis
          const facts = yield* sql<FactRecord>`SELECT fact_key AS "key", value_json AS "value", updated_at_ms AS "updatedAt"
            FROM memory_facts
            WHERE namespace_kind = ${namespace.kind} AND namespace_id = ${namespace.id}
              AND (ttl_ms IS NULL OR updated_at_ms + ttl_ms > ${now})`
          // A note drops out once an accepted note supersedes it, as in Smithers.
          const notes = yield* sql<NoteRecord>`SELECT notes.id AS "key", notes.namespace_kind AS "kind",
              notes.namespace_id AS "namespace", notes.text AS "text", notes.created_at_ms AS "createdAt"
            FROM memory_notes notes
            WHERE notes.namespace_kind = ${namespace.kind} AND notes.namespace_id = ${namespace.id}
              AND notes.status = 'accepted'
              AND NOT EXISTS (
                SELECT 1 FROM memory_note_supersedes edges
                JOIN memory_notes superseder ON superseder.id = edges.superseder_id
                WHERE edges.target_id = notes.id AND superseder.status = 'accepted')`
          return [
            ...facts.map((row): SearchRow => ({
              key: row.key,
              text: searchableText(parse(row.value)),
              updatedAtMs: Number(row.updatedAt)
            })),
            ...notes.map((row): SearchRow => ({ key: row.key, text: row.text, updatedAtMs: Number(row.createdAt) }))
          ]
        }).pipe(Effect.mapError(failure("could not read memory facts"))),

      putNote: ({ namespace, id, text, supersedes, at }) =>
        sql.withTransaction(Effect.gen(function*() {
          const existing = yield* sql<NoteRecord>`SELECT id AS "key", namespace_kind AS "kind", namespace_id AS "namespace",
              text AS "text", created_at_ms AS "createdAt"
            FROM memory_notes WHERE id = ${id}`
          if (existing.length > 0) {
            const note = existing[0]!
            if (note.kind !== namespace.kind || note.namespace !== namespace.id || note.text !== text) {
              return yield* Effect.fail(fail("idempotency_conflict", `note id "${id}" already exists with different content`, { path: ["id"] }))
            }
            const edges = yield* sql<{ readonly target: string }>`SELECT target_id AS "target"
              FROM memory_note_supersedes WHERE superseder_id = ${id}`
            const targets = edges.map((edge) => edge.target).sort((l, r) => l < r ? -1 : l > r ? 1 : 0)
            if (targets.join("\u0000") !== supersedes.join("\u0000")) {
              return yield* Effect.fail(fail("supersede_conflict", `note id "${id}" already exists with different supersedes`, { path: ["supersedes"] }))
            }
            return
          }
          for (const target of supersedes) {
            const found = yield* sql<{ readonly id: string }>`SELECT id FROM memory_notes
              WHERE id = ${target} AND namespace_kind = ${namespace.kind} AND namespace_id = ${namespace.id}`
            if (found.length === 0) {
              return yield* Effect.fail(fail("supersede_conflict", `superseded note "${target}" does not exist in this bank`, { path: ["supersedes"] }))
            }
          }
          yield* sql`INSERT INTO memory_notes (id, namespace_kind, namespace_id, text, tags_json, provenance_json, status, created_at_ms)
            VALUES (${id}, ${namespace.kind}, ${namespace.id}, ${text}, ${"[]"}, ${"{}"}, ${"accepted"}, ${at})`
          for (const target of supersedes) {
            yield* sql`INSERT INTO memory_note_supersedes (superseder_id, target_id, created_at_ms)
              VALUES (${id}, ${target}, ${at})`
          }
        })).pipe(Effect.mapError(failure("could not write a memory note"))),

      appendMessage: ({ thread, id, role, text, at }) =>
        sql.withTransaction(Effect.gen(function*() {
          yield* sql`INSERT INTO memory_threads (thread_id, namespace_kind, namespace_id, created_at_ms, updated_at_ms)
            VALUES (${thread}, ${"global"}, ${"history"}, ${at}, ${at})
            ON CONFLICT (thread_id) DO NOTHING`
          const existing = yield* sql<MessageRecord>`SELECT id, role, text, at_ms AS "at"
            FROM memory_messages WHERE thread_id = ${thread} AND id = ${id}`
          if (existing.length > 0) {
            const message = existing[0]!
            const field = message.role !== role ? "role" : message.text !== text ? "text" : undefined
            if (field !== undefined) {
              return yield* Effect.fail(
                fail("idempotency_conflict", `message id "${id}" already exists in thread "${thread}" with a different ${field}`, { path: [field] })
              )
            }
            return
          }
          yield* sql`INSERT INTO memory_messages (id, thread_id, role, text, at_ms) VALUES (${id}, ${thread}, ${role}, ${text}, ${at})`
          yield* sql`UPDATE memory_threads
            SET updated_at_ms = CASE WHEN updated_at_ms > ${at} THEN updated_at_ms ELSE ${at} END
            WHERE thread_id = ${thread}`
        })).pipe(Effect.mapError(failure("could not append a memory message"))),

      history: (thread, limit) =>
        Effect.gen(function*() {
          if (limit === 0) return []
          // The newest `limit` messages by time, every message tied with the
          // oldest of them included; ties are ordered by id in JavaScript.
          const cutoff = limit === undefined ? [] : yield* sql<{ readonly at: number | string | bigint }>`SELECT at_ms AS "at"
            FROM memory_messages WHERE thread_id = ${thread}
            ORDER BY at_ms DESC LIMIT 1 OFFSET ${limit - 1}`
          const rows = cutoff.length === 0
            ? yield* sql<MessageRecord>`SELECT id, role, text, at_ms AS "at" FROM memory_messages WHERE thread_id = ${thread}`
            : yield* sql<MessageRecord>`SELECT id, role, text, at_ms AS "at" FROM memory_messages
              WHERE thread_id = ${thread} AND at_ms >= ${cutoff[0]!.at}`
          const messages = rows.map((row): Message => ({ id: row.id, role: row.role, text: row.text, at: Number(row.at) }))
          return newest(messages.sort(compareMessages), limit)
        }).pipe(Effect.mapError(failure("could not read memory messages"))),

      sweep: ({ now, writtenBefore, keep }) =>
        sql.withTransaction(Effect.gen(function*() {
          const due = writtenBefore === undefined
            ? sql`ttl_ms IS NOT NULL AND updated_at_ms + ttl_ms <= ${now}`
            : sql`(ttl_ms IS NOT NULL AND updated_at_ms + ttl_ms <= ${now}) OR updated_at_ms < ${writtenBefore}`
          const [{ count }] = yield* sql<{ readonly count: number | string | bigint }>`SELECT COUNT(*) AS "count" FROM memory_facts WHERE ${due}`
          yield* sql`DELETE FROM memory_facts WHERE ${due}`
          let messages = 0
          if (keep !== undefined) {
            const threads = yield* sql<{ readonly thread: string }>`SELECT DISTINCT thread_id AS "thread" FROM memory_messages`
            for (const { thread } of threads) {
              const rows = yield* sql<MessageRecord>`SELECT id, role, text, at_ms AS "at" FROM memory_messages WHERE thread_id = ${thread}`
              const ordered = rows.map((row): Message => ({ id: row.id, role: row.role, text: row.text, at: Number(row.at) })).sort(compareMessages)
              const drop = ordered.slice(0, Math.max(0, ordered.length - keep)).map((message) => message.id)
              for (let start = 0; start < drop.length; start += 500) {
                yield* sql`DELETE FROM memory_messages WHERE thread_id = ${thread} AND ${sql.in("id", drop.slice(start, start + 500))}`
              }
              messages += drop.length
            }
          }
          return { facts: Number(count), messages }
        })).pipe(Effect.mapError(failure("could not sweep memory")))
    }
    return store
  })
