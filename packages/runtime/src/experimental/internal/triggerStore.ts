/**
 * The storage seam under `Experimental.Trigger`: one row per trigger, holding
 * its watermark, the run it started last and the lease that names the one
 * scheduler deciding for it, and the fire ledger, one row per occurrence the
 * scheduler decided. A scheduler reads and writes only through this
 * interface, so a store is one layer.
 *
 * @internal
 */
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"

/** What became of one occurrence. `claimed` is a launch decided and not yet started. */
export type Outcome = "claimed" | "launched" | "skipped" | "buffered" | "superseded" | "missed"

/** A run a trigger started and has not seen finish. */
export interface Active {
  readonly run: string
  readonly occurrence: number
}

/** One stored trigger. */
export interface TriggerRow {
  readonly id: string
  readonly workflow: string
  /** The expression and zone, so a changed schedule is noticed. */
  readonly schedule: string
  readonly enabled: boolean
  /** The newest occurrence decided, or the registration time of a trigger that has decided none. */
  readonly watermark: number
  readonly active: Active | undefined
  /** The occurrence `buffer-one` holds until the active run ends. */
  readonly pending: number | undefined
  /** The scheduler holding the lease, and until when. */
  readonly owner: string | undefined
  readonly leaseUntil: number
}

/** One row of the fire ledger. */
export interface FireRow {
  readonly trigger: string
  readonly occurrence: number
  readonly outcome: Outcome
  readonly run: string | undefined
  /** Why, in words: the missed count, or the reason a launch has not started. */
  readonly detail: string | undefined
  readonly at: number
}

/** The state a lease holder writes. An absent field keeps its value; `null` clears it. */
export interface Patch {
  readonly watermark?: number | undefined
  readonly active?: Active | null | undefined
  readonly pending?: number | null | undefined
}

/** A write by a scheduler that no longer holds the trigger's lease. */
export class LeaseLost extends Data.TaggedError("LeaseLost")<{
  readonly trigger: string
  readonly owner: string
}> {}

export interface Registration {
  readonly id: string
  readonly workflow: string
  readonly schedule: string
  readonly enabled: boolean
  readonly at: number
}

export interface Store {
  /**
   * Inserts the trigger with its watermark at `at`, or updates its
   * declaration. A changed workflow or schedule moves the watermark to `at`,
   * so occurrences of the old schedule are not owed, and the ledger records
   * the change.
   */
  readonly register: (registration: Registration) => Effect.Effect<TriggerRow>
  /** Takes the lease when it is free, expired or already `owner`'s, until `at + leaseMs`. */
  readonly acquire: (trigger: string, owner: string, at: number, leaseMs: number) => Effect.Effect<Option.Option<TriggerRow>>
  /** Gives the lease up, when `owner` holds it. */
  readonly release: (trigger: string, owner: string) => Effect.Effect<void>
  /** Writes the trigger's state and ledger rows together, only while `owner` holds the lease. */
  readonly update: (trigger: string, owner: string, patch: Patch, fires: ReadonlyArray<FireRow>) => Effect.Effect<void, LeaseLost>
  readonly get: (trigger: string) => Effect.Effect<Option.Option<TriggerRow>>
  /** The trigger's ledger, newest occurrence first. */
  readonly fires: (trigger: string) => Effect.Effect<ReadonlyArray<FireRow>>
}

export const scheduleKey = (cron: string, timezone: string): string => `${cron} ${timezone}`

const newestFirst = (left: FireRow, right: FireRow) => right.occurrence - left.occurrence

export const makeMemory = (): Store => {
  const triggers = new Map<string, TriggerRow>()
  const ledger = new Map<string, Map<number, FireRow>>()
  const put = (fire: FireRow) => {
    let rows = ledger.get(fire.trigger)
    if (rows === undefined) {
      rows = new Map()
      ledger.set(fire.trigger, rows)
    }
    rows.set(fire.occurrence, fire)
  }
  return {
    register: (registration) =>
      Effect.sync(() => {
        const known = triggers.get(registration.id)
        if (known === undefined) {
          const row: TriggerRow = {
            id: registration.id,
            workflow: registration.workflow,
            schedule: registration.schedule,
            enabled: registration.enabled,
            watermark: registration.at,
            active: undefined,
            pending: undefined,
            owner: undefined,
            leaseUntil: 0
          }
          triggers.set(registration.id, row)
          return row
        }
        const changed = known.workflow !== registration.workflow || known.schedule !== registration.schedule
        const row: TriggerRow = {
          ...known,
          workflow: registration.workflow,
          schedule: registration.schedule,
          enabled: registration.enabled,
          pending: changed ? undefined : known.pending,
          watermark: changed ? Math.max(known.watermark, registration.at) : known.watermark
        }
        triggers.set(registration.id, row)
        if (changed) {
          for (const fire of ledger.get(registration.id)?.values() ?? []) {
            if (fire.outcome === "claimed" || fire.outcome === "buffered") {
              put({
                ...fire,
                outcome: "missed",
                detail: "the schedule or workflow changed before this occurrence was recorded as launched",
                at: registration.at
              })
            }
          }
          put({
            trigger: registration.id,
            occurrence: registration.at,
            outcome: "missed",
            run: undefined,
            detail: `rescheduled from "${known.schedule}" to "${registration.schedule}"; occurrences of the old schedule are not owed`,
            at: registration.at
          })
        }
        return row
      }),
    acquire: (trigger, owner, at, leaseMs) =>
      Effect.sync(() => {
        const row = triggers.get(trigger)
        if (row === undefined) return Option.none()
        if (row.owner !== undefined && row.owner !== owner && row.leaseUntil > at) return Option.none()
        const held = { ...row, owner, leaseUntil: at + leaseMs }
        triggers.set(trigger, held)
        return Option.some(held)
      }),
    release: (trigger, owner) =>
      Effect.sync(() => {
        const row = triggers.get(trigger)
        if (row !== undefined && row.owner === owner) triggers.set(trigger, { ...row, owner: undefined, leaseUntil: 0 })
      }),
    update: (trigger, owner, patch, fires) =>
      Effect.suspend(() => {
        const row = triggers.get(trigger)
        if (row === undefined || row.owner !== owner) return Effect.fail(new LeaseLost({ trigger, owner }))
        triggers.set(trigger, {
          ...row,
          watermark: patch.watermark ?? row.watermark,
          active: patch.active === undefined ? row.active : patch.active ?? undefined,
          pending: patch.pending === undefined ? row.pending : patch.pending ?? undefined
        })
        for (const fire of fires) put(fire)
        return Effect.void
      }),
    get: (trigger) => Effect.sync(() => Option.fromNullishOr(triggers.get(trigger))),
    fires: (trigger) => Effect.sync(() => [...(ledger.get(trigger)?.values() ?? [])].sort(newestFirst))
  }
}
