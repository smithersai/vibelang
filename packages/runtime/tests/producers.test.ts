import { expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Stream } from "effect"
import { $finally, $forOf, $normal, $produce, $yield, $yieldAll } from "vibelang-runtime"

const producer = (values: Iterable<number>, events: string[]) => $produce(() => $finally(
  Effect.gen(function*() {
    events.push("open")
    for (const value of values) yield* $yield(value)
  }),
  Effect.sync(() => { events.push("close") })
))

// D26: all three iteration paths dispatch the same completion records.
// The values and target labels vary independently of the implementation.
for (const source of ["iterable", "stream", "producer"] as const) {
  for (const jump of ["normal", "continue", "break", "return", "outer break", "outer continue"] as const) {
    test(`${source}: ${jump} completion preserves values, target labels, and cleanup`, async () => {
      const events: string[] = []
      const values = [3, 7, 11, 19, 23]
      const input = source === "producer" ? producer(values, events)
        : source === "stream" ? Stream.ensuring(Stream.fromIterable(values), Effect.sync(() => { events.push("close") }))
        : values
      const seen: number[] = []
      const completion = jump === "outer break" ? { kind: "break", label: "outer" }
        : jump === "outer continue" ? { kind: "continue", label: "outer" }
        : jump === "return" ? { kind: "return", value: 42 }
        : { kind: jump, label: "inner" }
      const result = await Effect.runPromise($forOf(input as any, (value: number) => Effect.sync(() => {
        seen.push(value)
        return value === 7 ? completion : undefined
      }), "inner"))
      const continues = jump === "normal" || jump === "continue"
      expect(seen).toEqual(continues ? values : [3, 7])
      expect(result).toEqual(continues || jump === "break" ? $normal : completion)
      expect(events).toEqual(source === "producer" ? ["open", "close"] : source === "stream" ? ["close"] : [])
    })
  }
}

test("producer collection is cold, rerunnable, and preserves generated finite sequences", async () => {
  // A deterministic property sweep catches duplication, loss, reordering,
  // premature termination, and shared execution state across both adapters.
  let seed = 0x18c0ffee
  for (let trial = 0; trial < 40; trial++) {
    const values = Array.from({ length: trial * 7 % 53 }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed % 2001 - 1000
    })
    const events: string[] = []
    const input = producer(values, events)
    expect(events).toEqual([])
    const seen: number[] = []
    const loop = $forOf(input, value => Effect.sync(() => { seen.push(value) }))
    await Effect.runPromise(loop)
    await Effect.runPromise(loop)
    expect(seen).toEqual([...values, ...values])
    expect(await Effect.runPromise(Stream.runCollect(input))).toEqual(values)
    expect(await Effect.runPromise(Stream.runCollect(input))).toEqual(values)
    expect(events).toEqual(["open", "close", "open", "close", "open", "close", "open", "close"])
  }
})

for (const source of ["producer", "stream"] as const) {
  for (const failure of ["expected", "defect", "interruption"] as const) {
    test(`${source}: loop body ${failure} closes the source before propagating`, async () => {
      const events: string[] = []
      const input = source === "producer" ? producer([1, 2, 3], events)
        : Stream.ensuring(Stream.make(1, 2, 3), Effect.sync(() => { events.push("close") }))
      const cause = failure === "expected" ? Cause.fail("body") : failure === "defect" ? Cause.die("body") : Cause.interrupt(123)
      const seen: number[] = []
      const exit = await Effect.runPromiseExit($forOf(input, value => Effect.gen(function*() {
        seen.push(value)
        if (value === 2) return yield* Effect.failCause(cause)
      })))
      expect(exit).toEqual(Exit.failCause(cause))
      expect(seen).toEqual([1, 2])
      expect(events).toEqual(source === "producer" ? ["open", "close"] : ["close"])
    })
  }
}

// VIP-21: a producer is Stream.callback, whose fiber is interrupted when the
// consumer leaves; a failure of its cleanup then reaches no one, as in Effect.
test("early exit keeps the loop's failure; the producer's cleanup still runs", async () => {
  const events: string[] = []
  const input = $produce(() => $finally($yield(1), Effect.andThen(Effect.sync(() => { events.push("cleanup") }), Effect.fail("cleanup"))))
  const exit = await Effect.runPromiseExit($forOf(input, () => Effect.fail("body")))
  expect(exit).toEqual(Exit.fail("body"))
  expect(events).toEqual(["cleanup"])
})

// VIP-21: one element of buffer, so the producer runs up to two elements
// ahead of its consumer, one buffered and one waiting to be offered, and
// never further, whichever fiber pulls.
test("a producer runs at most two elements ahead of a pull from any fiber", async () => {
  const events: string[] = []
  let produced = 0
  const input = $produce(() => $finally(Effect.gen(function*() {
    for (let value = 0; value < 6; value++) {
      produced++
      yield* $yield(value)
    }
  }), Effect.sync(() => { events.push("closed") })))
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const pull = yield* Stream.toPull(input)
    for (let pulled = 1; pulled <= 6; pulled++) {
      const reader = yield* Effect.forkChild(pull)
      expect(yield* Fiber.join(reader)).toEqual([pulled - 1])
      yield* Effect.sleep("1 millis")
      expect(produced - pulled).toBe(Math.min(2, 6 - pulled))
    }
  })))
  expect(events).toEqual(["closed"])
})

test("interrupting an external pull waits for asynchronous producer cleanup", async () => {
  const events: string[] = []
  await Effect.runPromise(Effect.gen(function*() {
    const entered = yield* Deferred.make<void>()
    const cleaning = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const input = $produce(() => $finally(
      Effect.andThen(Deferred.succeed(entered, undefined), Effect.never),
      Effect.gen(function*() {
        yield* Deferred.succeed(cleaning, undefined)
        yield* Deferred.await(release)
        events.push("closed")
      })
    ))
    const consumer = yield* Effect.forkChild(Stream.runCollect(input))
    yield* Deferred.await(entered)
    consumer.interruptUnsafe(123)
    yield* Deferred.await(cleaning)
    expect(consumer.pollUnsafe()).toBeUndefined()
    expect(events).toEqual([])
    yield* Deferred.succeed(release, undefined)
    const exit = yield* Fiber.await(consumer)
    expect(Exit.isFailure(exit) && exit.cause.reasons.some(Cause.isInterruptReason)).toBe(true)
    expect(events).toEqual(["closed"])
  }))
})

test("yield delegation closes the delegated producer and then its own on break", async () => {
  const events: string[] = []
  const outer = $produce(() => $finally(Effect.gen(function*() {
    yield* $yieldAll([1, 2])
    yield* $yieldAll(producer([3, 4, 5, 6, 7], events))
    events.push("too late")
  }), Effect.sync(() => { events.push("outer closed") })))
  const seen: number[] = []
  await Effect.runPromise($forOf(outer, value => Effect.sync(() => {
    seen.push(value)
    return value === 4 ? { kind: "break", label: "" } : $normal
  })))
  expect(seen).toEqual([1, 2, 3, 4])
  expect(events).toEqual(["open", "close", "outer closed"])
})

test("a 100,000-element delegated producer delivers every element", async () => {
  const inner = $produce(() => Effect.gen(function*() {
    for (let n = 0; n < 100_000; n++) yield* $yield(n)
  }))
  const input = $produce(() => $yieldAll(inner))
  let count = 0
  let sum = 0
  expect(await Effect.runPromise($forOf(input, n => Effect.sync(() => { count++; sum += n })))).toEqual($normal)
  expect(count).toBe(100_000)
  expect(sum).toBe(4_999_950_000)
})

for (const outcome of ["normal", "break", "return", "failure", "defect", "interrupt"] as const) {
  test(`iterable ${outcome}: loop closes a JavaScript generator exactly once`, async () => {
    const events: string[] = []
    const values = {
      *[Symbol.iterator]() {
        try {
          yield 1
          yield 2
          events.push("exhausted")
        } finally {
          events.push("closed")
        }
      }
    }
    const body = () => outcome === "failure" ? Effect.fail("body")
      : outcome === "defect" ? Effect.die("body")
      : outcome === "interrupt" ? Effect.interrupt
      : Effect.succeed(outcome === "normal" ? $normal : { kind: outcome, label: "", value: 42 })
    const exit = await Effect.runPromiseExit($forOf(values, body))
    if (outcome === "normal") expect(exit).toEqual(Exit.succeed($normal))
    else if (outcome === "break") expect(exit).toEqual(Exit.succeed($normal))
    else if (outcome === "return") expect(exit).toEqual(Exit.succeed({ kind: "return", label: "", value: 42 }))
    else expect(Exit.isFailure(exit)).toBe(true)
    expect(events).toEqual(outcome === "normal" ? ["exhausted", "closed"] : ["closed"])
  })
}

test("abandoning yield delegation closes the delegated JavaScript generator", async () => {
  let closed = 0
  const values = {
    *[Symbol.iterator]() {
      try { yield 1; yield 2 } finally { closed++ }
    }
  }
  const input = $produce(() => $yieldAll(values))
  await Effect.runPromise($forOf(input, () => Effect.succeed({ kind: "break", label: "" })))
  expect(closed).toBe(1)
})

// Effect 4.0.6 gives defects precedence where it combines a body's failure
// with a cleanup failure (Effect-TS/effect#9433): the body's typed failure
// becomes a defect, first, beside the cleanup's.
test("iterable cleanup failures accompany body failures as defects, and exhausted iterators are not closed twice", async () => {
  let returned = 0
  const values = {
    [Symbol.iterator]() {
      return {
        next: () => ({ done: false as const, value: 1 }),
        return() { returned++; throw new Error("close failed") }
      }
    }
  }
  const exit = await Effect.runPromiseExit($forOf(values, () => Effect.fail("body failed")))
  expect(returned).toBe(1)
  expect(Exit.isFailure(exit) && exit.cause.reasons.map(r => r._tag)).toEqual(["Die", "Die"])
  expect(Exit.isFailure(exit) && exit.cause.reasons.map(r => String((r as Cause.Die).defect))).toEqual(["body failed", "Error: close failed"])
  const exhausted = {
    [Symbol.iterator]() {
      return {
        next: () => ({ done: true as const, value: undefined }),
        return() { returned++; return { done: true as const, value: undefined } }
      }
    }
  }
  await Effect.runPromise($forOf(exhausted, () => Effect.die("unreachable")))
  expect(returned).toBe(1)
})

test("iterable next failures and invalid results match JavaScript iterator validation", async () => {
  let returned = 0
  const invalid = (next: () => unknown, close?: () => unknown) => ({
    [Symbol.iterator]() { return { next, return: close ?? (() => { returned++; return { done: true } }) } }
  }) as Iterable<number>
  const defect = new Error("next failed")
  expect(await Effect.runPromiseExit($forOf(invalid(() => { throw defect }), () => Effect.void))).toEqual(Exit.die(defect))
  expect(returned).toBe(0)
  for (const source of [invalid(() => 1), invalid(() => ({ done: false, value: 1 }), () => 42), invalid(() => ({ done: false, value: 1 }), () => undefined)]) {
    const exit = await Effect.runPromiseExit($forOf(source, () => Effect.succeed({ kind: "break", label: "" })))
    expect(Exit.isFailure(exit) && exit.cause.reasons.find(Cause.isDieReason)?.defect).toBeInstanceOf(TypeError)
  }
})

test("iterable loops cache next, preserve its receiver, and skip return when a value getter throws", async () => {
  const events: string[] = []
  let index = 0
  const iterator = {
    get next() {
      events.push("get next")
      return function(this: unknown) {
        expect(this).toBe(iterator)
        return Object.assign(() => {}, { done: false, value: ++index })
      }
    },
    return() { events.push("return"); return Object.assign(() => {}, { done: true }) }
  }
  await Effect.runPromise($forOf({ [Symbol.iterator]: () => iterator }, value => Effect.succeed(value === 2 ? { kind: "break", label: "" } : $normal)))
  expect(events).toEqual(["get next", "return"])
  expect(index).toBe(2)
  const defect = new Error("value getter failed")
  const broken = {
    [Symbol.iterator]() {
      return {
        next: () => ({ done: false, get value(): number { throw defect } }),
        return() { events.push("unexpected return"); return { done: true, value: undefined } }
      }
    }
  }
  expect(await Effect.runPromiseExit($forOf(broken, () => Effect.void))).toEqual(Exit.die(defect))
  expect(events).toEqual(["get next", "return"])
})

test("an input Stream failure is propagated intact after its scope closes", async () => {
  for (const cause of [Cause.fail("upstream"), Cause.die("upstream defect"), Cause.combine(Cause.fail("upstream"), Cause.interrupt(123))]) {
    const events: string[] = []
    const input = Stream.ensuring(
      Stream.concat(Stream.make(1), Stream.failCause(cause)),
      Effect.sync(() => { events.push("closed") })
    )
    const exit = await Effect.runPromiseExit($forOf(input, value => Effect.sync(() => { events.push(`value:${value}`) })))
    expect(exit).toEqual(Exit.failCause(cause))
    expect(events).toEqual(["value:1", "closed"])
  }
})

for (const shadow of ["bind", "call"] as const) {
  test(`iterable methods ignore shadowed Function.prototype.${shadow}`, async () => {
    const events: string[] = []
    const iterator = {
      next: Object.assign(function(this: unknown) {
        expect(this).toBe(iterator)
        events.push("next")
        return { done: false as const, value: 1 }
      }, shadow === "bind" ? { bind: undefined } : {}),
      return: Object.assign(function(this: unknown) {
        expect(this).toBe(iterator)
        events.push("return")
        return { done: true as const, value: undefined }
      }, shadow === "call" ? { call: undefined } : {})
    }
    const values = { [Symbol.iterator]: () => iterator }
    for (const value of values) { expect(value).toBe(1); break }
    expect(events).toEqual(["next", "return"])
    events.length = 0
    expect(await Effect.runPromiseExit($forOf(values, () => Effect.succeed({ kind: "break", label: "" })))).toEqual(Exit.succeed($normal))
    expect(events).toEqual(["next", "return"])
  })
}
