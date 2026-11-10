/**
 * A memory store over Effect's `SqlClient`, so any of Effect's SQL clients
 * holds the facts: `@effect/sql-sqlite-node` or `-bun` for one file,
 * `@effect/sql-pg` for a server. The table is `@smthrs/memory`'s
 * `memory_facts`, created if missing, so a Smithers store and this one read
 * each other's facts: a fact's value is `{ "content": text }`, and a value
 * of another shape reads as its JSON text. A SQL failure is a memory failure
 * with the code `store`.
 *
 * @internal
 */
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import { SqlClient } from "effect/sql"
import type { MemoryError, SearchRow, Store } from "../Memory.js"

interface FactRecord {
  readonly key: string
  readonly value: string
  readonly updatedAt: number | string | bigint
}

/** A fact's recallable text, as Smithers projects it. */
export const searchableText = (value: unknown): string => {
  if (typeof value === "string") return value
  if (typeof value === "object" && value !== null && "content" in value && typeof value.content === "string") {
    return value.content
  }
  return JSON.stringify(value) ?? ""
}

export const make = (storeError: (message: string, cause: unknown) => MemoryError) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const failure = (message: string) => (cause: unknown) => storeError(`${message}: ${String(cause)}`, cause)
    yield* sql`CREATE TABLE IF NOT EXISTS memory_facts (
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
    )`.pipe(Effect.mapError(failure("could not create the memory tables")))

    const store: Store = {
      putFact: ({ namespace, key, text, at }) =>
        sql`INSERT INTO memory_facts (
          namespace_kind, namespace_id, fact_key, value_json, tags_json, ttl_ms, provenance_json, created_at_ms, updated_at_ms
        ) VALUES (
          ${namespace.kind}, ${namespace.id}, ${key}, ${JSON.stringify({ content: text })}, ${"[]"}, ${null}, ${"{}"}, ${at}, ${at}
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
          const rows = yield* sql<FactRecord>`SELECT fact_key AS "key", value_json AS "value", updated_at_ms AS "updatedAt"
            FROM memory_facts
            WHERE namespace_kind = ${namespace.kind} AND namespace_id = ${namespace.id}
              AND (ttl_ms IS NULL OR updated_at_ms + ttl_ms > ${now})`.pipe(
            Effect.mapError(failure("could not read memory facts"))
          )
          return rows.map((row): SearchRow => ({
            key: row.key,
            text: searchableText(parse(row.value)),
            updatedAtMs: Number(row.updatedAt)
          }))
        })
    }
    return store
  })

const parse = (json: string): unknown => {
  try {
    return JSON.parse(json)
  } catch {
    return json
  }
}
