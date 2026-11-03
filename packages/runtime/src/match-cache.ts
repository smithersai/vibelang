// Private Iterator Records for VIP-7's per-evaluation match cache.
type Item<S> = S extends ReadonlyArray<infer T> ? T : any
interface RecordState {
  iterator: object
  next: unknown
  values: unknown[]
  done: boolean
}
const object = (value: unknown): value is object =>
  value !== null && (typeof value === "object" || typeof value === "function")

/** Compiler ABI: one instance per match expression or is test. */
export function $matchCache() {
  const records = new Map<unknown, RecordState | false>()
  let failed = false
  let failure: unknown
  const record = (subject: unknown): RecordState => {
    const entry = records.get(subject)
    if (!entry) throw new TypeError("Missing match iterator")
    return entry
  }
  const pull = (entry: RecordState, index: number): boolean => {
    while (!entry.done && entry.values.length <= index) {
      try {
        const result = Reflect.apply(entry.next as Function, entry.iterator, [])
        if (!object(result)) throw new TypeError("Iterator result is not an object")
        if ((result as IteratorResult<unknown>).done) entry.done = true
        else entry.values.push((result as IteratorResult<unknown>).value)
      } catch (error) {
        // IteratorStepValue marks a failed iterator done; FinishMatch skips it.
        entry.done = true
        throw error
      }
    }
    return index < entry.values.length
  }
  return {
    start(): true { records.clear(); failed = false; failure = undefined; return true },
    iterable<S>(subject: S): subject is S & Iterable<Item<S>> {
      if (records.has(subject)) return records.get(subject) !== false
      if (subject === null || subject === undefined) { records.set(subject, false); return false }
      const method = (subject as any)[Symbol.iterator]
      if (typeof method !== "function") { records.set(subject, false); return false }
      const iterator = Reflect.apply(method, subject, [])
      if (!object(iterator)) throw new TypeError("Iterator is not an object")
      const next = (iterator as any).next
      records.set(subject, { iterator, next, values: [], done: false })
      return true
    },
    has(subject: unknown, index: number): boolean { return pull(record(subject), index) },
    at<S, I extends number>(subject: S, index: I): S extends ReadonlyArray<unknown> ? S[I] : any {
      return record(subject).values[index] as S extends ReadonlyArray<unknown> ? S[I] : any
    },
    end(subject: unknown, index: number): boolean { return !pull(record(subject), index) },
    rest<S>(subject: S, index: number): Item<S>[] {
      const entry = record(subject)
      while (pull(entry, entry.values.length)) {}
      return entry.values.slice(index) as Item<S>[]
    },
    threw(error: unknown): void { failed = true; failure = error },
    finish(): void {
      const errors: unknown[] = failed ? [failure] : []
      failed = false
      failure = undefined
      for (const entry of records.values()) {
        if (!entry || entry.done) continue
        entry.done = true
        try {
          const close = (entry.iterator as any).return
          if (close === undefined || close === null) continue
          const result = Reflect.apply(close, entry.iterator, [])
          if (!object(result)) throw new TypeError("Iterator return result is not an object")
        } catch (error) { errors.push(error) }
      }
      if (errors.length > 1) throw new AggregateError(errors)
      if (errors.length === 1) throw errors[0]
    }
  }
}
