// F11: how Effect 4.1.0 combines and recovers a cause that holds an expected
// failure beside a defect or an interruption (Effect-TS/effect#9433 and
// #9516). These test Effect, not VibeLang; VibeLang's forms follow them.
import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Scope, Stream } from "effect"

const reasons = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isSuccess(exit)
    ? [`Success(${String(exit.value)})`]
    : exit.cause.reasons.map((r) =>
      r._tag === "Fail" ? `Fail(${String(r.error)})` : r._tag === "Die" ? `Die(${String(r.defect)})` : "Interrupt"
    )

const run = (effect: Effect.Effect<unknown, unknown>) => reasons(Effect.runSyncExit(effect))
const later = <A, E>(effect: Effect.Effect<A, E>) => Effect.andThen(Effect.sleep(5), effect)

describe("F11 Effect 4.1.0 defect precedence", () => {
  test("F11a where the runtime combines a failure with a cleanup or a sibling's defect, the failure becomes a defect, first", async () => {
    const elected = ["Die(E)", "Die(D)"]
    expect(run(Effect.ensuring(Effect.fail("E"), Effect.die("D")))).toEqual(elected)
    expect(run(Effect.onExit(Effect.fail("E"), () => Effect.die("D")))).toEqual(elected)
    expect(run(Effect.acquireUseRelease(Effect.void, () => Effect.fail("E"), () => Effect.die("D")))).toEqual(elected)
    expect(run(Effect.scoped(Effect.andThen(Effect.acquireRelease(Effect.void, () => Effect.die("D")), Effect.fail("E"))))).toEqual(elected)
    expect(run(Effect.scopedWith((scope) => Effect.andThen(Scope.addFinalizer(scope, Effect.die("D")), Effect.fail("E"))))).toEqual(elected)
    expect(run(Effect.raceAll([Effect.fail("E"), Effect.die("D")]))).toEqual(elected)
    expect(reasons(await Effect.runPromiseExit(Stream.runForEach(Stream.ensuring(Stream.make(1), Effect.die("D")), () => Effect.fail("E")))))
      .toEqual(elected)
    const sibling = Effect.all([later(Effect.fail("E")), Effect.onInterrupt(Effect.never, () => Effect.die("D"))], { concurrency: "unbounded" })
    expect(reasons(await Effect.runPromiseExit(sibling))).toEqual(elected)
    // A cleanup failure that is itself expected stays expected.
    expect(run(Effect.onExit(Effect.fail("E"), () => Effect.fail("E2")))).toEqual(["Fail(E)", "Fail(E2)"])
    // Cause.combine itself keeps both reasons as they are.
    expect(Cause.combine(Cause.fail("E"), Cause.die("D")).reasons.map((r) => r._tag)).toEqual(["Fail", "Die"])
  })

  test("F11b typed recovery skips a cause with a defect and re-fails with its failures as defects", () => {
    const mixed = () => Effect.failCause(Cause.combine(Cause.fail("E"), Cause.die("D")))
    let handled = 0
    const handler = () => Effect.sync(() => ++handled)
    expect(run(mixed())).toEqual(["Fail(E)", "Die(D)"])
    for (
      const recovered of [
        Effect.catch(mixed(), handler),
        Effect.catchTag(Effect.failCause(Cause.combine(Cause.fail({ _tag: "E" } as const), Cause.die("D"))), "E", handler),
        Effect.orElseSucceed(mixed(), () => 0),
        Effect.result(mixed()),
        Effect.option(mixed()),
        Effect.ignore(mixed()),
        Effect.retry(mixed(), { times: 2 })
      ]
    ) {
      expect(Exit.isFailure(Effect.runSyncExit(recovered as Effect.Effect<unknown, unknown>))).toBe(true)
    }
    expect(handled).toBe(0)
    expect(run(Effect.catch(mixed(), handler))).toEqual(["Die(E)", "Die(D)"])
    // catchDefect receives the first defect: the original error, once elected.
    expect(run(Effect.catchDefect(Effect.onExit(Effect.fail("E"), () => Effect.die("D")), (d) => Effect.succeed(d)))).toEqual(["Success(E)"])
    // catchCause sees the cause as it is.
    expect(run(Effect.catchCause(mixed(), (c) => Effect.succeed(c.reasons.map((r) => r._tag).join("+"))))).toEqual(["Success(Fail+Die)"])
  })

  test("F11c an interruption beside a typed failure does not block recovery", () => {
    const mixed = () => Effect.failCause(Cause.combine(Cause.fail("E"), Cause.interrupt(11)))
    expect(run(Effect.catch(mixed(), (e) => Effect.succeed(`recovered ${e}`)))).toEqual(["Success(recovered E)"])
    let attempts = 0
    expect(run(Effect.retry(Effect.suspend(() => (attempts++, mixed())), { times: 2 }))).toEqual(["Fail(E)"])
    expect(attempts).toBe(3)
  })

  test("F11d mapError maps every typed failure in place and keeps the other reasons", () => {
    const cause = Cause.combine(Cause.combine(Cause.fail("E"), Cause.interrupt(11)), Cause.fail("E2"))
    expect(run(Effect.mapError(Effect.failCause(cause), (e) => `mapped ${e}`))).toEqual(["Fail(mapped E)", "Interrupt", "Fail(mapped E2)"])
  })

  test("F11e timeout still drops the interrupted source's cleanup failure (D256)", async () => {
    const exit = await Effect.runPromiseExit(Effect.timeout(Effect.onExit(Effect.never, () => Effect.die("D")), 5))
    expect(Exit.isFailure(exit) && exit.cause.reasons.map((r) => r._tag)).toEqual(["Fail"])
  })
})
