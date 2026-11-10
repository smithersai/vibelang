/**
 * A {@link Store} over Effect's `SqlClient`, so any of Effect's SQL clients
 * holds the runs: `@effect/sql-sqlite-node` or `-bun` for one file,
 * `@effect/sql-pg` for a server. Three tables, created if missing:
 * `durable_runs`, `durable_journal` and `durable_cache`. Each fenced write is
 * one transaction that reads the run's fence and appends its events, so an
 * event and the state it records commit together. A SQL failure is a defect:
 * the engine cannot run without its store.
 *
 * @internal
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { SqlClient, SqlError } from "effect/sql"
import {
  type CacheEntry,
  type Commit,
  FenceLost,
  type JournalEntry,
  type NewEvent,
  type RunFilter,
  RunNotFound,
  type RunRow,
  type RunStatus,
  type Store
} from "./durableStore.js"

interface RunRecord {
  readonly run: string
  readonly workflow: string
  readonly payload: string
  readonly status: string
  readonly result: string | null
  readonly parent: string | null
  readonly owner: string | null
  readonly fence: number | string | bigint
  readonly createdAt: number | string | bigint
  readonly updatedAt: number | string | bigint
}

interface EntryRecord {
  readonly run: string
  readonly seq: number | string | bigint
  readonly eventType: string
  readonly payload: string
  readonly at: number | string | bigint
}

const toRow = (record: RunRecord): RunRow => ({
  run: record.run,
  workflow: record.workflow,
  payload: JSON.parse(record.payload),
  status: record.status as RunStatus,
  result: record.result === null ? undefined : JSON.parse(record.result),
  parent: record.parent ?? undefined,
  owner: record.owner ?? undefined,
  fence: Number(record.fence),
  createdAt: Number(record.createdAt),
  updatedAt: Number(record.updatedAt)
})

const toEntry = (record: EntryRecord): JournalEntry => ({
  run: record.run,
  seq: Number(record.seq),
  eventType: record.eventType,
  payload: JSON.parse(record.payload),
  at: Number(record.at)
})

const terminal = ["succeeded", "failed", "interrupted"] as const

export const make = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE IF NOT EXISTS durable_runs (
    run TEXT PRIMARY KEY,
    workflow TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL,
    result TEXT,
    parent TEXT,
    owner TEXT,
    fence BIGINT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  )`
  yield* sql`CREATE TABLE IF NOT EXISTS durable_journal (
    run TEXT NOT NULL,
    seq BIGINT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    at BIGINT NOT NULL,
    PRIMARY KEY (run, seq)
  )`
  yield* sql`CREATE TABLE IF NOT EXISTS durable_cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at BIGINT
  )`

  const selectRun = (run: string) =>
    sql<RunRecord>`SELECT run, workflow, payload, status, result, parent, owner, fence,
      created_at AS "createdAt", updated_at AS "updatedAt" FROM durable_runs WHERE run = ${run}`

  // Reads the run's fence, locking its row where the database can.
  const lockRun = (run: string) =>
    Effect.flatMap(
      sql.onDialectOrElse({
        pg: () => sql<{ readonly fence: number | string }>`SELECT fence FROM durable_runs WHERE run = ${run} FOR UPDATE`,
        orElse: () => sql<{ readonly fence: number | string }>`SELECT fence FROM durable_runs WHERE run = ${run}`
      }),
      (rows) => rows.length === 0 ? Effect.fail(new RunNotFound({ run })) : Effect.succeed(Number(rows[0]!.fence))
    )

  const push = (run: string, events: ReadonlyArray<NewEvent>, at: number) =>
    Effect.gen(function*() {
      const [{ last }] = yield* sql<{ readonly last: number | string | null }>`SELECT MAX(seq) AS last FROM durable_journal WHERE run = ${run}`
      let seq = Number(last ?? 0)
      const seqs: Array<number> = []
      for (const event of events) {
        seq++
        yield* sql`INSERT INTO durable_journal (run, seq, event_type, payload, at)
          VALUES (${run}, ${seq}, ${event.eventType}, ${JSON.stringify(event.payload)}, ${at})`
        seqs.push(seq)
      }
      return seqs
    })

  // A SQL failure is a defect; the store's own failures stay typed.
  const die = <A, E>(effect: Effect.Effect<A, E>) =>
    Effect.catchTag(effect as Effect.Effect<A, E | SqlError.SqlError>, "SqlError", (error) => Effect.die(error)) as Effect.Effect<
      A,
      Exclude<E, SqlError.SqlError>
    >

  const store: Store = {
    open: (input) =>
      die(sql.withTransaction(Effect.gen(function*() {
        const inserted = yield* sql<{ readonly run: string }>`INSERT INTO durable_runs
          (run, workflow, payload, status, result, parent, owner, fence, created_at, updated_at)
          VALUES (${input.run}, ${input.workflow}, ${JSON.stringify(input.payload)}, ${"running"}, ${null},
            ${input.parent ?? null}, ${null}, ${0}, ${input.at}, ${input.at})
          ON CONFLICT (run) DO NOTHING RETURNING run`
        if (inserted.length > 0) {
          yield* push(input.run, [{
            eventType: "RunStarted",
            payload: { workflow: input.workflow, payload: input.payload, parent: input.parent ?? null }
          }], input.at)
        }
        return toRow((yield* selectRun(input.run))[0]!)
      }))),
    claim: (run, owner, at) =>
      die(Effect.flatMap(
        sql<{ readonly fence: number | string }>`UPDATE durable_runs SET owner = ${owner}, fence = fence + 1, updated_at = ${at}
          WHERE run = ${run} RETURNING fence`,
        (rows) => rows.length === 0 ? Effect.fail(new RunNotFound({ run })) : Effect.succeed(Number(rows[0]!.fence))
      )),
    commit: (run, commit: Commit, at) =>
      die(sql.withTransaction(Effect.gen(function*() {
        const current = yield* lockRun(run)
        if (current !== commit.fence) return yield* Effect.fail(new FenceLost({ run, fence: commit.fence, current }))
        const seqs = yield* push(run, commit.events, at)
        if (commit.status === undefined) {
          yield* sql`UPDATE durable_runs SET updated_at = ${at} WHERE run = ${run}`
        } else {
          const result = commit.result === undefined ? null : JSON.stringify(commit.result)
          yield* sql`UPDATE durable_runs SET status = ${commit.status}, result = ${result}, updated_at = ${at} WHERE run = ${run}`
        }
        return seqs
      }))),
    append: (run, events, at) =>
      die(sql.withTransaction(Effect.andThen(lockRun(run), push(run, events, at)))),
    get: (run) => die(Effect.map(selectRun(run), (rows) => Option.map(Option.fromNullishOr(rows[0]), toRow))),
    list: (filter: RunFilter) =>
      die(Effect.map(
        sql<RunRecord>`SELECT run, workflow, payload, status, result, parent, owner, fence,
          created_at AS "createdAt", updated_at AS "updatedAt" FROM durable_runs
          WHERE (${filter.status ?? null} IS NULL OR status = ${filter.status ?? null})
            AND (${filter.workflow ?? null} IS NULL OR workflow = ${filter.workflow ?? null})
          ORDER BY created_at, run`,
        (rows) => rows.map(toRow)
      )),
    entries: (run, range) =>
      die(Effect.map(
        sql<EntryRecord>`SELECT run, seq, event_type AS "eventType", payload, at FROM durable_journal
          WHERE run = ${run} AND seq >= ${range?.from ?? 1} AND seq <= ${range?.to ?? Number.MAX_SAFE_INTEGER}
          ORDER BY seq`,
        (rows) => rows.map(toEntry)
      )),
    fork: (run, seq, target, at) =>
      die(sql.withTransaction(Effect.gen(function*() {
        yield* lockRun(run)
        yield* sql`INSERT INTO durable_runs
          (run, workflow, payload, status, result, parent, owner, fence, created_at, updated_at)
          SELECT ${target}, workflow, payload, ${"suspended"}, ${null}, parent, ${null}, ${0}, ${at}, ${at}
          FROM durable_runs WHERE run = ${run}`
        yield* sql`INSERT INTO durable_journal (run, seq, event_type, payload, at)
          SELECT ${target}, seq, event_type, payload, at FROM durable_journal WHERE run = ${run} AND seq < ${seq}`
        return toRow((yield* selectRun(target))[0]!)
      }))),
    truncate: (run, seq, owner, at) =>
      die(sql.withTransaction(Effect.gen(function*() {
        yield* lockRun(run)
        yield* sql`DELETE FROM durable_journal WHERE run = ${run} AND seq >= ${seq}`
        const [{ fence }] = yield* sql<{ readonly fence: number | string }>`UPDATE durable_runs
          SET status = ${"suspended"}, result = ${null}, owner = ${owner}, fence = fence + 1, updated_at = ${at}
          WHERE run = ${run} RETURNING fence`
        return Number(fence)
      }))),
    cacheGet: (key, now) =>
      die(Effect.gen(function*() {
        const rows = yield* sql<{ readonly value: string; readonly expiresAt: number | string | null }>`SELECT value,
          expires_at AS "expiresAt" FROM durable_cache WHERE key = ${key}`
        const row = rows[0]
        if (row === undefined) return Option.none()
        if (row.expiresAt !== null && Number(row.expiresAt) <= now) {
          yield* sql`DELETE FROM durable_cache WHERE key = ${key}`
          return Option.none()
        }
        return Option.some(JSON.parse(row.value) as unknown)
      })),
    cachePut: (key, entry: CacheEntry) =>
      die(Effect.asVoid(sql`INSERT INTO durable_cache (key, value, expires_at)
        VALUES (${key}, ${JSON.stringify(entry.value)}, ${entry.expiresAt ?? null})
        ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`)),
    sweep: (before, now) =>
      die(sql.withTransaction(Effect.gen(function*() {
        const deleted = yield* sql<{ readonly run: string }>`DELETE FROM durable_runs
          WHERE status IN ${sql.in(terminal)} AND updated_at < ${before} RETURNING run`
        for (const { run } of deleted) yield* sql`DELETE FROM durable_journal WHERE run = ${run}`
        yield* sql`DELETE FROM durable_cache WHERE expires_at IS NOT NULL AND expires_at <= ${now}`
        return deleted.length
      })))
  }
  return store
})
