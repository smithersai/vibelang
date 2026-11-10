/**
 * The storage seam under `Experimental.Durable`: run rows, an append-only
 * journal per run and a result cache. An engine reads and writes only
 * through this interface, so a store is one layer: memory for tests, SQL for
 * a server. Every value it holds is JSON, already encoded by the engine.
 *
 * @internal
 */
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"

/** Where a run stands. The last three are terminal. */
export type RunStatus = "running" | "suspended" | "succeeded" | "failed" | "interrupted"

export const isTerminal = (status: RunStatus): boolean =>
  status === "succeeded" || status === "failed" || status === "interrupted"

/** One stored run. */
export interface RunRow {
  readonly run: string
  readonly workflow: string
  /** The payload, encoded with the workflow's payload schema as JSON. */
  readonly payload: unknown
  readonly status: RunStatus
  /** The encoded `Workflow.Result` once the run is terminal. */
  readonly result: unknown
  readonly parent: string | undefined
  /** The engine that last claimed the run. */
  readonly owner: string | undefined
  /** Raised by every claim. A write under an older fence is refused. */
  readonly fence: number
  readonly createdAt: number
  readonly updatedAt: number
}

/** One journal event. `seq` starts at 1 and has no holes. */
export interface JournalEntry {
  readonly run: string
  readonly seq: number
  readonly eventType: string
  readonly payload: unknown
  readonly at: number
}

export interface NewEvent {
  readonly eventType: string
  readonly payload: unknown
}

/** A fenced write: events appended and the run row updated in one step. */
export interface Commit {
  readonly fence: number
  readonly events: ReadonlyArray<NewEvent>
  readonly status?: RunStatus | undefined
  readonly result?: unknown
}

export interface CacheEntry {
  readonly value: unknown
  readonly expiresAt: number | undefined
}

/** A write whose fence is older than the run's. */
export class FenceLost extends Data.TaggedError("FenceLost")<{
  readonly run: string
  readonly fence: number
  readonly current: number
}> {}

/** A run id the store does not hold. */
export class RunNotFound extends Data.TaggedError("RunNotFound")<{ readonly run: string }> {}

export interface RunFilter {
  readonly status?: RunStatus | undefined
  readonly workflow?: string | undefined
}

export interface Store {
  /** Inserts the run with a `RunStarted` event unless it exists; returns the stored row either way. */
  readonly open: (row: {
    readonly run: string
    readonly workflow: string
    readonly payload: unknown
    readonly parent: string | undefined
    readonly at: number
  }) => Effect.Effect<RunRow>
  /** Makes `owner` the run's owner and returns the new fence. */
  readonly claim: (run: string, owner: string, at: number) => Effect.Effect<number, RunNotFound>
  /** Appends the events and updates the row, atomically, if `fence` is current. Returns the new seqs. */
  readonly commit: (run: string, commit: Commit, at: number) => Effect.Effect<ReadonlyArray<number>, FenceLost | RunNotFound>
  /** Appends events with no fence: signals from outside the owner. */
  readonly append: (run: string, events: ReadonlyArray<NewEvent>, at: number) => Effect.Effect<ReadonlyArray<number>, RunNotFound>
  readonly get: (run: string) => Effect.Effect<Option.Option<RunRow>>
  /** Runs in creation order, then by id. */
  readonly list: (filter: RunFilter) => Effect.Effect<ReadonlyArray<RunRow>>
  /** Entries with `from <= seq <= to`, in order. */
  readonly entries: (run: string, range?: { readonly from?: number; readonly to?: number }) => Effect.Effect<ReadonlyArray<JournalEntry>>
  /** Copies the run's row and its entries before `seq` to a new suspended run. */
  readonly fork: (run: string, seq: number, target: string, at: number) => Effect.Effect<RunRow, RunNotFound>
  /** Drops entries from `seq` on, raises the fence and leaves the run suspended. Returns the new fence. */
  readonly truncate: (run: string, seq: number, owner: string, at: number) => Effect.Effect<number, RunNotFound>
  readonly cacheGet: (key: string, now: number) => Effect.Effect<Option.Option<unknown>>
  readonly cachePut: (key: string, entry: CacheEntry) => Effect.Effect<void>
  /** Deletes terminal runs last updated before `before`, and expired cache entries. Returns the runs deleted. */
  readonly sweep: (before: number, now: number) => Effect.Effect<number>
}

interface MemoryRun {
  row: RunRow
  entries: Array<JournalEntry>
}

/**
 * A store in this process's memory. Each operation runs synchronously, so
 * each is atomic. Several engines may share one, which is how tests model a
 * crash and a restart.
 */
export const makeMemory = (): Store => {
  const runs = new Map<string, MemoryRun>()
  const cache = new Map<string, CacheEntry>()
  const find = (run: string) =>
    Effect.suspend(() => {
      const found = runs.get(run)
      return found === undefined ? Effect.fail(new RunNotFound({ run })) : Effect.succeed(found)
    })
  const push = (state: MemoryRun, events: ReadonlyArray<NewEvent>, at: number): Array<number> =>
    events.map((event) => {
      const seq = state.entries.length + 1
      state.entries.push({ run: state.row.run, seq, eventType: event.eventType, payload: event.payload, at })
      return seq
    })
  return {
    open: (input) =>
      Effect.sync(() => {
        const existing = runs.get(input.run)
        if (existing !== undefined) return existing.row
        const row: RunRow = {
          run: input.run,
          workflow: input.workflow,
          payload: input.payload,
          status: "running",
          result: undefined,
          parent: input.parent,
          owner: undefined,
          fence: 0,
          createdAt: input.at,
          updatedAt: input.at
        }
        const state: MemoryRun = { row, entries: [] }
        runs.set(input.run, state)
        push(state, [{ eventType: "RunStarted", payload: { workflow: input.workflow, payload: input.payload, parent: input.parent ?? null } }], input.at)
        return row
      }),
    claim: (run, owner, at) =>
      Effect.map(find(run), (state) => {
        state.row = { ...state.row, owner, fence: state.row.fence + 1, updatedAt: at }
        return state.row.fence
      }),
    commit: (run, commit, at) =>
      Effect.flatMap(find(run), (state) => {
        if (state.row.fence !== commit.fence) {
          return Effect.fail(new FenceLost({ run, fence: commit.fence, current: state.row.fence }))
        }
        const seqs = push(state, commit.events, at)
        state.row = {
          ...state.row,
          status: commit.status ?? state.row.status,
          result: commit.status === undefined ? state.row.result : commit.result,
          updatedAt: at
        }
        return Effect.succeed(seqs)
      }),
    append: (run, events, at) => Effect.map(find(run), (state) => push(state, events, at)),
    get: (run) => Effect.sync(() => Option.map(Option.fromNullishOr(runs.get(run)), (state) => state.row)),
    list: (filter) =>
      Effect.sync(() =>
        Array.from(runs.values(), (state) => state.row)
          .filter((row) =>
            (filter.status === undefined || row.status === filter.status) &&
            (filter.workflow === undefined || row.workflow === filter.workflow)
          )
          .sort((left, right) => left.createdAt - right.createdAt || (left.run < right.run ? -1 : left.run > right.run ? 1 : 0))
      ),
    entries: (run, range) =>
      Effect.sync(() => {
        const state = runs.get(run)
        if (state === undefined) return []
        const from = range?.from ?? 1
        const to = range?.to ?? Number.POSITIVE_INFINITY
        return state.entries.filter((entry) => entry.seq >= from && entry.seq <= to)
      }),
    fork: (run, seq, target, at) =>
      Effect.map(find(run), (state) => {
        const row: RunRow = {
          ...state.row,
          run: target,
          status: "suspended",
          result: undefined,
          owner: undefined,
          fence: 0,
          createdAt: at,
          updatedAt: at
        }
        const copy: MemoryRun = {
          row,
          entries: state.entries.filter((entry) => entry.seq < seq).map((entry) => ({ ...entry, run: target }))
        }
        runs.set(target, copy)
        return row
      }),
    truncate: (run, seq, owner, at) =>
      Effect.map(find(run), (state) => {
        state.entries = state.entries.filter((entry) => entry.seq < seq)
        state.row = { ...state.row, status: "suspended", result: undefined, owner, fence: state.row.fence + 1, updatedAt: at }
        return state.row.fence
      }),
    cacheGet: (key, now) =>
      Effect.sync(() => {
        const entry = cache.get(key)
        if (entry === undefined) return Option.none()
        if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
          cache.delete(key)
          return Option.none()
        }
        return Option.some(entry.value)
      }),
    cachePut: (key, entry) => Effect.sync(() => void cache.set(key, entry)),
    sweep: (before, now) =>
      Effect.sync(() => {
        let deleted = 0
        for (const [run, state] of runs) {
          if (isTerminal(state.row.status) && state.row.updatedAt < before) {
            runs.delete(run)
            deleted++
          }
        }
        for (const [key, entry] of cache) {
          if (entry.expiresAt !== undefined && entry.expiresAt <= now) cache.delete(key)
        }
        return deleted
      })
  }
}
