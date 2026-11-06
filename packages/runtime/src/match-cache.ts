// Cache operations use captured intrinsics: changing Map.prototype in a guard
// must not make an internal cache operation call user code (VIP-7).
const PropertyCacheMap = Map
const mapHas = Function.prototype.call.bind(Map.prototype.has) as (map: Map<any, any>, key: unknown) => boolean
const mapGet = Function.prototype.call.bind(Map.prototype.get) as (map: Map<any, any>, key: unknown) => any
const mapSet = Function.prototype.call.bind(Map.prototype.set) as (map: Map<any, any>, key: unknown, value: unknown) => unknown
const propertyKeyString = String

const propertyMapClear = Function.prototype.call.bind(Map.prototype.clear) as (map: Map<any, any>) => void

// Private property observations and Iterator Records for VIP-7's match cache.
// Prefer known iterable union members, as TypeScript's iterable guard does.
// An open subject with no known iterable member yields unknown elements.
type IterableSubject<S> = [S] extends [Iterable<unknown>] ? S
  : [Extract<S, Iterable<unknown>>] extends [never] ? S
  : Extract<S, Iterable<unknown>>
type ItemOf<S> = S extends Iterable<infer T> ? T : unknown
type Item<S> = 0 extends 1 & S ? any : ItemOf<IterableSubject<S>>
type ItemAt<S, I extends number> = S extends ReadonlyArray<unknown> ? S[I] : ItemOf<S>
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
  const presence = new PropertyCacheMap<object, Map<PropertyKey, boolean>>()
  const values = new PropertyCacheMap<object, Map<PropertyKey, unknown>>()
  const observe = <T>(groups: Map<object, Map<PropertyKey, T>>, subject: object, key: PropertyKey, read: () => T): T => {
    const name = typeof key === "symbol" ? key : propertyKeyString(key)
    let cache = mapGet(groups, subject) as Map<PropertyKey, T> | undefined
    if (cache !== undefined && mapHas(cache, name)) return mapGet(cache, name) as T
    const value = read()
    if (cache === undefined) {
      cache = new PropertyCacheMap<PropertyKey, T>()
      mapSet(groups, subject, cache)
    }
    mapSet(cache, name, value)
    return value
  }

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
    start(): true { propertyMapClear(presence); propertyMapClear(values); records.clear(); failed = false; failure = undefined; return true },
    propertyHas(subject: object, key: PropertyKey): boolean {
      return observe(presence, subject, key, () => key in subject)
    },
    get(subject: object, key: PropertyKey): unknown {
      return observe(values, subject, key, () => (subject as any)[key])
    },
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
    at<S, I extends number>(subject: S, index: I): ItemAt<IterableSubject<S>, I> {
      return record(subject).values[index] as ItemAt<IterableSubject<S>, I>
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
