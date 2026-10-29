import { expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber } from "effect"
import { $forOf, $iteratorFrame, $produce, $yieldAll } from "vibelang-runtime"

type Mode = "normal" | "next" | "done" | "value" | "return getter" | "return throws" | "return primitive" | "return noncallable" | "exhausted"

const source = (events: string[], mode: Mode, name = "iterator"): Iterable<any> => ({
  [Symbol.iterator]() {
    events.push(name + ":open")
    return {
      next() {
        events.push(name + ":next")
        if (mode === "next") throw "next failed"
        return {
          get done() {
            if (mode === "done") throw "done failed"
            return mode === "exhausted"
          },
          get value() {
            if (mode === "value") throw "value failed"
            return undefined
          }
        }
      },
      get return(): any {
        events.push(name + ":return getter")
        if (mode === "return getter") throw "return getter failed"
        if (mode === "return noncallable") return 1
        return function(this: unknown) {
          events.push(name + ":return")
          if (mode === "return throws") throw "return failed"
          if (mode === "return primitive") return 1
          return { done: true }
        }
      }
    }
  }
})

// What IteratorClose with a return completion reports for the mode: a thrown
// value, a TypeError for a return() that is not callable or returns a
// primitive, or nothing.
const closeError = (mode: Mode): unknown =>
  mode === "return getter" ? "return getter failed"
    : mode === "return throws" ? "return failed"
    : mode === "return primitive" || mode === "return noncallable" ? TypeError
    : undefined

const tags = (exit: Exit.Exit<unknown, unknown>) => Exit.isFailure(exit) ? exit.cause.reasons.map((r) => r._tag) : "success"
const defects = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? exit.cause.reasons.map((r) => Cause.isDieReason(r) ? r.defect : undefined) : []

// D305: where JavaScript keeps only the original throw, VibeLang keeps the
// close error too, as a defect beside the original cause.
const expectDefectBeside = (exit: Exit.Exit<unknown, unknown>, original: unknown, close: unknown) => {
  expect(tags(exit)).toEqual(["Die", "Die"])
  expect(defects(exit)[0]).toBe(original)
  if (close === TypeError) expect(defects(exit)[1]).toBeInstanceOf(TypeError)
  else expect(defects(exit)[1]).toBe(close)
}

for (const mode of ["normal", "next", "done", "value", "return getter", "return throws", "return primitive", "return noncallable", "exhausted"] as const) {
  test(`destructuring ${mode}: an Effect failure runs the native IteratorClose protocol`, async () => {
    const reference: string[] = []
    let thrown: unknown
    const fail = () => {
      reference.push("default")
      throw "default failed"
    }
    try {
      const [value = fail()] = source(reference, mode)
      reference.push("body:" + value)
    } catch (error) {
      thrown = error
    }
    const actual: string[] = []
    const result = await Effect.runPromiseExit(Effect.gen($iteratorFrame(function*() {
      const [value = yield* Effect.suspend(() => {
        actual.push("default")
        return Effect.fail("default failed")
      })] = source(actual, mode)
      actual.push("body:" + value)
    })))
    expect(actual).toEqual(reference)
    const close = closeError(mode)
    if (mode === "next" || mode === "done" || mode === "value") expect(result).toEqual(Exit.die(thrown))
    else if (close === undefined) expect(result).toEqual(Exit.fail(thrown))
    else {
      expect(thrown).toBe("default failed")
      expectDefectBeside(result, "default failed", close)
    }
  })

  for (const outcome of ["break", "failure"] as const) {
    test(`for-of ${mode}/${outcome}: native protocol, and a close error is never dropped`, async () => {
      const reference: string[] = []
      let thrown: unknown
      try {
        for (const _value of source(reference, mode)) {
          reference.push("body")
          if (outcome === "failure") throw "body failed"
          break
        }
      } catch (error) {
        thrown = error
      }
      const actual: string[] = []
      const result = await Effect.runPromiseExit($forOf(source(actual, mode), () => {
        actual.push("body")
        return outcome === "failure" ? Effect.fail("body failed") : Effect.succeed({ kind: "break", label: "" })
      }))
      expect(actual).toEqual(reference)
      const close = closeError(mode)
      if (outcome === "failure" && close !== undefined) {
        expect(thrown).toBe("body failed")
        expectDefectBeside(result, "body failed", close)
      } else if (thrown instanceof TypeError) {
        expect(Exit.isFailure(result) && result.cause.reasons.find(Cause.isDieReason)?.defect).toBeInstanceOf(TypeError)
      } else if (thrown === undefined) {
        expect(Exit.isSuccess(result)).toBe(true)
      } else {
        expect(result).toEqual(thrown === "body failed" ? Exit.fail(thrown) : Exit.die(thrown))
      }
    })
  }
}

test("nested destructuring closes inner before outer for defects and interruption, and keeps the inner close error", async () => {
  for (const kind of ["defect", "interrupt"] as const) {
    const events: string[] = []
    const entered = Deferred.makeUnsafe<void>()
    const program = Effect.gen($iteratorFrame(function*() {
      const inner = source(events, "return throws", "inner")
      const outer = {
        *[Symbol.iterator]() {
          try {
            events.push("outer:open")
            yield inner
          } finally {
            events.push("outer:close")
          }
        }
      }
      const [[value = yield* Effect.andThen(
        Deferred.succeed(entered, undefined),
        kind === "defect" ? Effect.die("body defect") : Effect.never
      )]] = outer
      events.push("unreachable:" + value)
    }))
    const result = kind === "defect" ? await Effect.runPromiseExit(program) : await Effect.runPromise(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(program)
      yield* Deferred.await(entered)
      fiber.interruptUnsafe(123)
      return yield* Fiber.await(fiber)
    }))
    expect(events).toEqual(["outer:open", "inner:open", "inner:next", "inner:return getter", "inner:return", "outer:close"])
    if (kind === "defect") expectDefectBeside(result, "body defect", "return failed")
    else {
      expect(Exit.isFailure(result) && result.cause.reasons.some(Cause.isInterruptReason)).toBe(true)
      expect(defects(result).filter((d) => d !== undefined)).toEqual(["return failed"])
    }
  }
})

test("a producer that delegates to a JavaScript iterator closes it when the consumer leaves", async () => {
  const values = {
    *[Symbol.iterator]() {
      try {
        yield 1
      } finally {
        throw "close failed"
      }
    }
  }
  function* delegated() {
    yield* values
  }
  let native: unknown
  try {
    for (const _value of delegated()) break
    native = "success"
  } catch (error) {
    native = error
  }
  expect(native).toBe("close failed")
  // VIP-21: the producer runs ahead of the loop and its close error fails a
  // Stream whose consumer has already left, as Stream.callback does.
  const producer = () => $produce(() => $yieldAll(values))
  const onBreak = await Effect.runPromiseExit($forOf(producer(), () => Effect.succeed({ kind: "break", label: "" })))
  expect(onBreak).toEqual(Exit.succeed({ kind: "normal" }))
  const onFailure = await Effect.runPromiseExit($forOf(producer(), () => Effect.fail("body failed")))
  expect(onFailure).toEqual(Exit.fail("body failed"))
})

test("a JavaScript finally block that yields while the frame is unwound is a defect", async () => {
  const exit = await Effect.runPromiseExit(Effect.gen($iteratorFrame(function*() {
    try {
      yield* Effect.fail("body failed")
    } finally {
      yield* Effect.void
    }
  })))
  expect(tags(exit)).toEqual(["Die", "Die"])
  expect(defects(exit)[0]).toBe("body failed")
  expect(String(defects(exit)[1])).toContain("yielded while its iterator frame was unwound")
})

test("successful defaults preserve binding captures, rest, and reusable frame state", async () => {
  let next = 0
  const body = $iteratorFrame(function*(this: { prefix: number }, argument: number) {
    let [first = yield* Effect.succeed(this.prefix + argument), read = () => first, ...rest] = [undefined, undefined, 3, 4]
    first++
    return [read(), rest, ++next]
  })
  expect(body.length).toBe(1)
  expect(body.name).toBe("")
  const effect = Effect.fnUntraced(body).call({ prefix: 10 }, 2)
  expect(await Effect.runPromise(effect)).toEqual([13, [3, 4], 1])
  expect(await Effect.runPromise(effect)).toEqual([13, [3, 4], 2])
})
