// Compiler ABI for statement-lowered array binding defaults. Keep source jumps
// as native jumps: in particular IteratorClose errors replace a return, whereas
// an exception already in flight wins over a closing exception.
const apply = Reflect.apply
const object = Object
const defineProperty = Object.defineProperty
const iteratorKey: typeof Symbol.iterator = Symbol.iterator
const missing = () => undefined

type Element<T, I extends number> = T extends readonly unknown[] ? T[I] : T extends Iterable<infer V> ? V : never

/** @internal */
export function $bindingIterators() {
  type Frame = { state: { close(): void }; parent: Frame | undefined }
  let live: Frame | undefined
  return {
    open<T>(source: T) {
      // Native destructuring acquires the iterator and caches next once.
      if (source == null) { const [] = source as any }
      const method = (source as Iterable<unknown>)[iteratorKey]
      if (typeof method !== "function") { const [] = { [iteratorKey]: method } as any }
      const iterator = apply(method, source, []) as Iterator<unknown>
      if (object(iterator) !== iterator) { const [] = { [iteratorKey]: () => iterator } }
      const next = iterator.next
      let done = false
      const step = (read: boolean, hasDefault = false): unknown => {
        if (done) return undefined
        done = true
        // Let the host validate IteratorResult and callability, and perform
        // IteratorStep/IteratorValue. Record the host's close request without
        // closing the source merely because this one-element read ends.
        let closeRequested = false
        const bridge: Iterable<unknown> = {
          [iteratorKey]() {
            return {
              next: typeof next !== "function" ? next : () => {
                const result = apply(next, iterator, [])
                if (object(result) !== result) return result
                return {
                  get done() {
                    const exhausted = result.done
                    if (!exhausted) done = false
                    return exhausted
                  },
                  get value() { return read ? result.value : undefined }
                }
              },
              return() { closeRequested = true; return { done: true, value: undefined } }
            }
          }
        }
        try {
          if (read) {
            // Some hosts still distinguish SingleNameBinding with an
            // initializer when IteratorValue throws. Keep that native form.
            if (hasDefault) { const [value = missing()] = bridge; return value }
            const [value] = bridge
            return value
          }
          const [,] = bridge
          return undefined
        } catch (error) {
          // Hosts adopting IteratorStepValue mark a failed value read done;
          // older hosts request IteratorClose. Retain their native behavior.
          if (!closeRequested) done = true
          throw error
        }
      }
      const state = {
        value<const I extends number>(_index: I, hasDefault = false): Element<T, I> { return step(true, hasDefault) as Element<T, I> },
        skip() { step(false) },
        rest(): (T extends Iterable<infer V> ? V : never)[] {
          const values: unknown[] = []
          while (!done) { const value = step(true); if (!done) defineProperty(values, values.length, { value, writable: true, enumerable: true, configurable: true }) }
          return values as (T extends Iterable<infer V> ? V : never)[]
        },
        close() {
          if (done) return
          done = true
          // Native destructuring gives the host ownership of GetMethod(return),
          // callability and object-result validation, including error text.
          const bridge: Iterable<undefined> = {
            [iteratorKey]() {
              return {
                next() { return { done: false, value: undefined } },
                get return(): any {
                  const finish = iterator.return
                  return typeof finish === "function" ? () => apply(finish, iterator, []) : finish
                }
              }
            }
          }
          const [_] = bridge
        }
      }
      live = { state, parent: live }
      return state
    },
    close() { const frame = live!; live = frame.parent; frame.state.close() },
    finish(throwing: boolean) {
      while (live) {
        try { this.close() }
        catch (error) { if (!throwing) { this.finish(true); throw error } }
      }
    }
  }
}
