import "./version.js"
// Cache operations use captured intrinsics: changing Map.prototype in a guard
// must not make an internal cache operation call user code (VIP-7).
const PropertyCacheMap = Map
const mapHas = Function.prototype.call.bind(Map.prototype.has) as <K, V>(map: Map<K, V>, key: K) => boolean
const mapGet = Function.prototype.call.bind(Map.prototype.get) as <K, V>(map: Map<K, V>, key: K) => V | undefined
const mapSet = Function.prototype.call.bind(Map.prototype.set) as <K, V>(map: Map<K, V>, key: K, value: V) => Map<K, V>
const propertyKeyString = String

const mapClear = Function.prototype.call.bind(Map.prototype.clear) as <K, V>(map: Map<K, V>) => void
const mapValues = Function.prototype.call.bind(Map.prototype.values) as <K, V>(map: Map<K, V>) => MapIterator<V>
const reflectApply = Reflect.apply
const emptyArgs: readonly [] = Object.freeze([])

// Private property observations and Iterator Records for VIP-7's match cache.
// Prefer known iterable union members, as TypeScript's iterable guard does.
// An open subject with no known iterable member yields unknown elements.
type IterableSubject<S> = [S] extends [Iterable<unknown>] ? S
  : [Extract<S, Iterable<unknown>>] extends [never] ? S
  : Extract<S, Iterable<unknown>>
type ItemOf<S> = S extends Iterable<infer T> ? T : unknown
type Item<S> = 0 extends 1 & S ? S : ItemOf<IterableSubject<S>>
type ItemAt<S, I extends number> = S extends ReadonlyArray<unknown> ? S[I] : ItemOf<S>
// A rest binding copies the unconsumed tuple positions into a mutable tuple.
type TupleRest<S extends readonly unknown[], I extends number, Count extends unknown[]=[]>
 = Count["length"] extends I ? [...S]
 : S extends readonly [unknown, ...infer Tail] ? TupleRest<Tail,I,[...Count,unknown]>
 : number extends S["length"] ? S[number][]
 : S extends readonly [unknown?, ...infer Tail] ? TupleRest<Tail,I,[...Count,unknown]>
 : []
type IsTuple<S extends readonly unknown[]> = S extends unknown
  ? number extends S["length"]
    ? "0" extends keyof S ? true
      : S extends readonly [...unknown[], unknown] ? true : false
    : true
  : never
type Rest<S,I extends number> = 0 extends 1 & S ? S
 : number extends I ? Item<S>[]
 : [IterableSubject<S>] extends [readonly unknown[]]
   ? false extends IsTuple<IterableSubject<S>> ? Item<S>[]
     : I extends unknown ? TupleRest<IterableSubject<S>,I> : never
   : Item<S>[]

interface RecordState {
  iterator: object
  next: unknown
  values: unknown[]
  done: boolean
}
const object = (value: unknown): value is object =>
  value !== null && (typeof value === "object" || typeof value === "function")

function pullEntry(entry: RecordState, index: number): boolean {
  while (!entry.done && entry.values.length <= index) {
    try {
      const result = reflectApply(entry.next as Function, entry.iterator, emptyArgs)
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

class MatchCacheImpl {
  #records: Map<unknown, RecordState | false> | undefined = undefined
  #presence: Map<object, Map<PropertyKey, boolean>> | undefined = undefined
  #values: Map<object, Map<PropertyKey, unknown>> | undefined = undefined
  #failed = false
  #failure: unknown = undefined

  #record(subject: unknown): RecordState {
    const entry = this.#records === undefined ? undefined : mapGet(this.#records, subject) as RecordState | false | undefined
    if (!entry) throw new TypeError("Missing match iterator")
    return entry
  }

  start(): true {
    if (this.#presence !== undefined) mapClear(this.#presence)
    if (this.#values !== undefined) mapClear(this.#values)
    if (this.#records !== undefined) mapClear(this.#records)
    this.#failed = false
    this.#failure = undefined
    return true
  }

  propertyHas(subject: object, key: PropertyKey): boolean {
    const name = typeof key === "symbol" ? key : propertyKeyString(key)
    let groups = this.#presence
    let cache = groups === undefined ? undefined : mapGet(groups, subject) as Map<PropertyKey, boolean> | undefined
    if (cache !== undefined && mapHas(cache, name)) return mapGet(cache, name) as boolean
    const value = key in subject
    if (groups === undefined) {
      groups = new PropertyCacheMap<object, Map<PropertyKey, boolean>>()
      this.#presence = groups
    }
    if (cache === undefined) {
      cache = new PropertyCacheMap<PropertyKey, boolean>()
      mapSet(groups, subject, cache)
    }
    mapSet(cache, name, value)
    return value
  }

  get(subject: object, key: PropertyKey): unknown {
    const name = typeof key === "symbol" ? key : propertyKeyString(key)
    let groups = this.#values
    let cache = groups === undefined ? undefined : mapGet(groups, subject) as Map<PropertyKey, unknown> | undefined
    if (cache !== undefined && mapHas(cache, name)) return mapGet(cache, name)
    const value = (subject as Record<PropertyKey, unknown>)[key]
    if (groups === undefined) {
      groups = new PropertyCacheMap<object, Map<PropertyKey, unknown>>()
      this.#values = groups
    }
    if (cache === undefined) {
      cache = new PropertyCacheMap<PropertyKey, unknown>()
      mapSet(groups, subject, cache)
    }
    mapSet(cache, name, value)
    return value
  }

  iterable<S>(subject: S): subject is S & Iterable<Item<S>> {
    let records = this.#records
    if (records !== undefined && mapHas(records, subject)) return mapGet(records, subject) !== false
    if (records === undefined) {
      records = new PropertyCacheMap<unknown, RecordState | false>()
      this.#records = records
    }
    if (subject === null || subject === undefined) { mapSet(records, subject, false); return false }
    const method = (subject as { readonly [Symbol.iterator]?: unknown })[Symbol.iterator]
    if (typeof method !== "function") { mapSet(records, subject, false); return false }
    const iterator = reflectApply(method, subject, emptyArgs)
    if (!object(iterator)) throw new TypeError("Iterator is not an object")
    const next = (iterator as { readonly next?: unknown }).next
    mapSet(records, subject, { iterator, next, values: [], done: false })
    return true
  }

  has(subject: unknown, index: number): boolean { return pullEntry(this.#record(subject), index) }

  at<S, I extends number>(subject: S, index: I): ItemAt<IterableSubject<S>, I> {
    return this.#record(subject).values[index] as ItemAt<IterableSubject<S>, I>
  }

  end(subject: unknown, index: number): boolean { return !pullEntry(this.#record(subject), index) }

  rest<S, I extends number>(subject: S, index: I): Rest<S, I> {
    const entry = this.#record(subject)
    while (pullEntry(entry, entry.values.length)) {}
    return entry.values.slice(index) as Rest<S, I>
  }

  threw(error: unknown): void { this.#failed = true; this.#failure = error }

  finish(): void {
    const failed = this.#failed
    const failure = this.#failure
    this.#failed = false
    this.#failure = undefined
    const records = this.#records
    if (records === undefined) {
      if (failed) throw failure
      return
    }
    let errors: unknown[] | undefined = failed ? [failure] : undefined
    for (const entry of mapValues(records) as Iterable<RecordState | false>) {
      if (!entry || entry.done) continue
      entry.done = true
      try {
        const close = (entry.iterator as { readonly return?: unknown }).return
        if (close === undefined || close === null) continue
        const result = reflectApply(close as Function, entry.iterator, emptyArgs)
        if (!object(result)) throw new TypeError("Iterator return result is not an object")
      } catch (error) {
        if (errors === undefined) errors = [error]
        else errors.push(error)
      }
    }
    if (errors !== undefined) {
      if (errors.length > 1) throw new AggregateError(errors)
      throw errors[0]
    }
  }
}

/** Compiler ABI: one instance per match expression or is test. */
export function $matchCache(): {
  start(): true
  propertyHas(subject: object, key: PropertyKey): boolean
  get(subject: object, key: PropertyKey): unknown
  iterable<S>(subject: S): subject is S & Iterable<Item<S>>
  has(subject: unknown, index: number): boolean
  at<S, I extends number>(subject: S, index: I): ItemAt<IterableSubject<S>, I>
  end(subject: unknown, index: number): boolean
  rest<S, I extends number>(subject: S, index: I): Rest<S, I>
  threw(error: unknown): void
  finish(): void
} {
  return new MatchCacheImpl()
}
