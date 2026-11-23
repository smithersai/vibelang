/**
 * A trigger {@link Store} over Effect's `SqlClient`, so any of Effect's SQL
 * clients holds the triggers: `@effect/sql-sqlite-node` or `-bun` for one
 * file, `@effect/sql-pg` for a server. Two tables, created if missing:
 * `trigger_rows` and `trigger_fires`. Taking a lease is one conditional
 * update, and a lease holder's write is one transaction that checks the
 * lease and writes the row and its ledger rows together. A SQL failure is a
 * defect: the scheduler cannot decide without its store.
 *
 * @internal
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { SqlClient, SqlError } from "effect/sql"
import { type FireRow, LeaseLost, type Outcome, type Patch, type Store, type TriggerRow } from "./triggerStore.js"

type Int = number | string | bigint

interface RowRecord {
  readonly id: string
  readonly workflow: string
  readonly schedule: string
  readonly enabled: Int | boolean
  readonly watermark: Int
  readonly activeRun: string | null
  readonly activeOccurrence: Int | null
  readonly pending: Int | null
  readonly owner: string | null
  readonly leaseUntil: Int
}

interface FireRecord {
  readonly trigger: string
  readonly occurrence: Int
  readonly outcome: string
  readonly run: string | null
  readonly detail: string | null
  readonly at: Int
}

const toRow = (record: RowRecord): TriggerRow => ({
  id: record.id,
  workflow: record.workflow,
  schedule: record.schedule,
  enabled: record.enabled === true || Number(record.enabled) === 1,
  watermark: Number(record.watermark),
  active: record.activeRun === null ? undefined : { run: record.activeRun, occurrence: Number(record.activeOccurrence) },
  pending: record.pending === null ? undefined : Number(record.pending),
  owner: record.owner ?? undefined,
  leaseUntil: Number(record.leaseUntil)
})

const toFire = (record: FireRecord): FireRow => ({
  trigger: record.trigger,
  occurrence: Number(record.occurrence),
  outcome: record.outcome as Outcome,
  run: record.run ?? undefined,
  detail: record.detail ?? undefined,
  at: Number(record.at)
})

export const make = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE IF NOT EXISTS trigger_rows (
    id TEXT PRIMARY KEY,
    workflow TEXT NOT NULL,
    schedule TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    watermark BIGINT NOT NULL,
    active_run TEXT,
    active_occurrence BIGINT,
    pending BIGINT,
    owner TEXT,
    lease_until BIGINT NOT NULL
  )`
  yield* sql`CREATE TABLE IF NOT EXISTS trigger_fires (
    trigger_id TEXT NOT NULL,
    occurrence BIGINT NOT NULL,
    outcome TEXT NOT NULL,
    run TEXT,
    detail TEXT,
    at BIGINT NOT NULL,
    PRIMARY KEY (trigger_id, occurrence)
  )`

  const columns = sql`id, workflow, schedule, enabled, watermark, active_run AS "activeRun",
    active_occurrence AS "activeOccurrence", pending, owner, lease_until AS "leaseUntil"`

  const select = (id: string) => sql<RowRecord>`SELECT ${columns} FROM trigger_rows WHERE id = ${id}`

  // Reads the row, locking it where the database can.
  const lock = (id: string) =>
    sql.onDialectOrElse({
      pg: () => sql<RowRecord>`SELECT ${columns} FROM trigger_rows WHERE id = ${id} FOR UPDATE`,
      orElse: () => select(id)
    })

  const putFire = (fire: FireRow) =>
    sql`INSERT INTO trigger_fires (trigger_id, occurrence, outcome, run, detail, at)
      VALUES (${fire.trigger}, ${fire.occurrence}, ${fire.outcome}, ${fire.run ?? null}, ${fire.detail ?? null}, ${fire.at})
      ON CONFLICT (trigger_id, occurrence) DO UPDATE SET outcome = excluded.outcome, run = excluded.run,
        detail = excluded.detail, at = excluded.at`

  // A SQL failure is a defect; the store's own failures stay typed.
  const die = <A, E>(effect: Effect.Effect<A, E>) =>
    Effect.catchTag(effect as Effect.Effect<A, E | SqlError.SqlError>, "SqlError", (error) => Effect.die(error)) as Effect.Effect<
      A,
      Exclude<E, SqlError.SqlError>
    >

  const store: Store = {
    register: (registration) =>
      die(sql.withTransaction(Effect.gen(function*() {
        const known = (yield* lock(registration.id))[0]
        const enabled = registration.enabled ? 1 : 0
        if (known === undefined) {
          yield* sql`INSERT INTO trigger_rows (id, workflow, schedule, enabled, watermark, lease_until)
            VALUES (${registration.id}, ${registration.workflow}, ${registration.schedule}, ${enabled}, ${registration.at}, ${0})`
        } else {
          const changed = known.workflow !== registration.workflow || known.schedule !== registration.schedule
          const watermark = changed ? Math.max(Number(known.watermark), registration.at) : Number(known.watermark)
          yield* sql`UPDATE trigger_rows SET workflow = ${registration.workflow}, schedule = ${registration.schedule},
            enabled = ${enabled}, watermark = ${watermark},
            pending = ${changed ? null : known.pending} WHERE id = ${registration.id}`
          if (changed) {
            yield* sql`UPDATE trigger_fires SET outcome = ${"missed"},
              detail = ${"the schedule or workflow changed before this occurrence was recorded as launched"},
              at = ${registration.at}
              WHERE trigger_id = ${registration.id} AND outcome IN (${"claimed"}, ${"buffered"})`
            yield* putFire({
              trigger: registration.id,
              occurrence: registration.at,
              outcome: "missed",
              run: undefined,
              detail: `rescheduled from "${known.schedule}" to "${registration.schedule}"; occurrences of the old schedule are not owed`,
              at: registration.at
            })
          }
        }
        return toRow((yield* select(registration.id))[0]!)
      }))),
    acquire: (trigger, owner, at, leaseMs) =>
      die(Effect.map(
        sql<RowRecord>`UPDATE trigger_rows SET owner = ${owner}, lease_until = ${at + leaseMs}
          WHERE id = ${trigger} AND (owner IS NULL OR owner = ${owner} OR lease_until <= ${at})
          RETURNING ${columns}`,
        (rows) => Option.map(Option.fromNullishOr(rows[0]), toRow)
      )),
    release: (trigger, owner) =>
      die(Effect.asVoid(sql`UPDATE trigger_rows SET owner = ${null}, lease_until = ${0} WHERE id = ${trigger} AND owner = ${owner}`)),
    update: (trigger, owner, patch: Patch, fires) =>
      die(sql.withTransaction(Effect.gen(function*() {
        const row = (yield* lock(trigger))[0]
        if (row === undefined || row.owner !== owner) return yield* Effect.fail(new LeaseLost({ trigger, owner }))
        const active = patch.active === undefined
          ? { run: row.activeRun, occurrence: row.activeOccurrence }
          : patch.active === null
          ? { run: null, occurrence: null }
          : { run: patch.active.run, occurrence: patch.active.occurrence }
        const pending = patch.pending === undefined ? row.pending : patch.pending
        yield* sql`UPDATE trigger_rows SET watermark = ${patch.watermark ?? Number(row.watermark)},
          active_run = ${active.run}, active_occurrence = ${active.occurrence === null ? null : Number(active.occurrence)},
          pending = ${pending === null ? null : Number(pending)} WHERE id = ${trigger}`
        for (const fire of fires) yield* putFire(fire)
      }))),
    get: (trigger) => die(Effect.map(select(trigger), (rows) => Option.map(Option.fromNullishOr(rows[0]), toRow))),
    fires: (trigger) =>
      die(Effect.map(
        sql<FireRecord>`SELECT trigger_id AS "trigger", occurrence, outcome, run, detail, at FROM trigger_fires
          WHERE trigger_id = ${trigger} ORDER BY occurrence DESC`,
        (rows) => rows.map(toFire)
      ))
  }
  return store
})
