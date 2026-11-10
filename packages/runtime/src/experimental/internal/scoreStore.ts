/**
 * Where live scores persist: a memory store and one over Effect's
 * `SqlClient`, ported from Smithers' `ScoreStore` and `SqlScoreStore`. Each
 * observation has an identity, and `recordOnce` keeps the first observation
 * of an identity, so a run that is executed, joined or resumed again records
 * its score once. One table, created if missing: `score_observations`.
 *
 * @internal
 */
import * as Effect from "effect/Effect"
import { SqlClient } from "effect/sql"

export type ObservationCode = "invalid_declaration" | "invalid_score" | "inconclusive"

export interface StoredObservation {
  readonly identity: string
  readonly workflow: string
  readonly run: string
  readonly scorer: string
  readonly scorerName: string
  readonly kind: "score" | "inconclusive"
  readonly score?: number | undefined
  readonly reason?: string | undefined
  readonly code?: ObservationCode | undefined
  readonly meta?: unknown
  readonly at: number
}

export interface Filter {
  readonly workflow?: string | undefined
  readonly run?: string | undefined
  readonly scorer?: string | undefined
}

export interface Aggregate {
  readonly count: number
  readonly mean: number | undefined
  readonly min: number | undefined
  readonly inconclusive: number
}

export interface Store {
  readonly recordOnce: (observation: StoredObservation) => Effect.Effect<boolean>
  readonly observations: (filter?: Filter) => Effect.Effect<ReadonlyArray<StoredObservation>>
  readonly prune: (before: number) => Effect.Effect<number>
}

const matches = (observation: StoredObservation, filter: Filter): boolean =>
  (filter.workflow === undefined || observation.workflow === filter.workflow) &&
  (filter.run === undefined || observation.run === filter.run) &&
  (filter.scorer === undefined || observation.scorer === filter.scorer)

const byTime = (left: StoredObservation, right: StoredObservation): number =>
  left.at - right.at || (left.identity < right.identity ? -1 : left.identity > right.identity ? 1 : 0)

export const aggregate = (observations: ReadonlyArray<StoredObservation>): Aggregate => {
  const scores = observations.flatMap((observation) => observation.kind === "score" && observation.score !== undefined ? [observation.score] : [])
  return {
    count: scores.length,
    mean: scores.length === 0 ? undefined : scores.reduce((total, score) => total + score, 0) / scores.length,
    min: scores.length === 0 ? undefined : scores.reduce((low, score) => score < low ? score : low, Number.POSITIVE_INFINITY),
    inconclusive: observations.length - scores.length
  }
}

export const makeMemory = (): Store => {
  const rows = new Map<string, StoredObservation>()
  return {
    recordOnce: (observation) =>
      Effect.sync(() => {
        if (rows.has(observation.identity)) return false
        rows.set(observation.identity, observation)
        return true
      }),
    observations: (filter = {}) => Effect.sync(() => [...rows.values()].filter((row) => matches(row, filter)).sort(byTime)),
    prune: (before) =>
      Effect.sync(() => {
        let removed = 0
        for (const [identity, row] of rows) {
          if (row.at < before) {
            rows.delete(identity)
            removed++
          }
        }
        return removed
      })
  }
}

interface Row {
  readonly identity: string
  readonly workflow: string
  readonly run: string
  readonly scorer: string
  readonly scorerName: string
  readonly kind: string
  readonly score: number | string | null
  readonly reason: string | null
  readonly code: string | null
  readonly meta: string | null
  readonly at: number | string | bigint
}

const fromRow = (row: Row): StoredObservation => ({
  identity: row.identity,
  workflow: row.workflow,
  run: row.run,
  scorer: row.scorer,
  scorerName: row.scorerName,
  kind: row.kind === "score" ? "score" : "inconclusive",
  ...(row.score === null ? {} : { score: Number(row.score) }),
  ...(row.reason === null ? {} : { reason: row.reason }),
  ...(row.code === null ? {} : { code: row.code as ObservationCode }),
  ...(row.meta === null ? {} : { meta: JSON.parse(row.meta) }),
  at: Number(row.at)
})

const metaText = (meta: unknown): string | null => {
  if (meta === undefined) return null
  try {
    return JSON.stringify(meta) ?? null
  } catch {
    return null
  }
}

export const makeSql = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE IF NOT EXISTS score_observations (
    identity TEXT PRIMARY KEY,
    workflow TEXT NOT NULL,
    run TEXT NOT NULL,
    scorer TEXT NOT NULL,
    scorer_name TEXT NOT NULL,
    kind TEXT NOT NULL,
    score DOUBLE PRECISION,
    reason TEXT,
    code TEXT,
    meta TEXT,
    at BIGINT NOT NULL
  )`
  yield* sql`CREATE INDEX IF NOT EXISTS score_observations_run ON score_observations (run, scorer)`
  const select = (filter: Filter) => {
    const conditions = [
      ...(filter.workflow === undefined ? [] : [sql`workflow = ${filter.workflow}`]),
      ...(filter.run === undefined ? [] : [sql`run = ${filter.run}`]),
      ...(filter.scorer === undefined ? [] : [sql`scorer = ${filter.scorer}`])
    ]
    return sql<Row>`SELECT identity, workflow, run, scorer, scorer_name AS "scorerName", kind, score, reason, code, meta, at
      FROM score_observations ${conditions.length === 0 ? sql`` : sql`WHERE ${sql.and(conditions)}`}
      ORDER BY at, identity`
  }
  const store: Store = {
    recordOnce: (observation) =>
      Effect.orDie(
        sql<{ readonly identity: string }>`INSERT INTO score_observations
          (identity, workflow, run, scorer, scorer_name, kind, score, reason, code, meta, at)
          VALUES (${observation.identity}, ${observation.workflow}, ${observation.run}, ${observation.scorer},
            ${observation.scorerName}, ${observation.kind}, ${observation.score ?? null}, ${observation.reason ?? null},
            ${observation.code ?? null}, ${metaText(observation.meta)}, ${observation.at})
          ON CONFLICT (identity) DO NOTHING RETURNING identity`
      ).pipe(Effect.map((rows) => rows.length > 0)),
    observations: (filter = {}) => Effect.orDie(select(filter)).pipe(Effect.map((rows) => rows.map(fromRow))),
    prune: (before) =>
      Effect.orDie(sql<{ readonly identity: string }>`DELETE FROM score_observations WHERE at < ${before} RETURNING identity`)
        .pipe(Effect.map((rows) => rows.length))
  }
  return store
})
