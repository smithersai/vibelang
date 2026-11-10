import { expect, test } from "bun:test"
import fc from "fast-check"
import { Duration, Effect, Exit, Layer, Option, Schema } from "effect"
import { DurableDeferred } from "effect/workflow"
import { Durable, Human } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { boot, finished, journal, makeWallClock, parked, type Process, tick } from "./experimental-durable-waits-support.ts"

const start = Date.UTC(2026, 0, 1)
const hour = 3_600_000

const Release = Durable.workflow("human#Release", { payload: { build: Schema.String }, success: Schema.String, error: Human.Failed })
const Triage = Durable.workflow("human#Triage", { payload: { issue: Schema.String }, success: Schema.String, error: Human.Failed })
const Review = Durable.workflow("human#Review", { payload: { id: Schema.String }, success: Schema.String, error: Human.Failed })
const Explain = Durable.workflow("human#Explain", { payload: { id: Schema.String }, success: Schema.String, error: Human.Failed })
const Budget = Durable.workflow("human#Budget", {
  payload: { id: Schema.String, maxAttempts: Schema.Number },
  success: Schema.Boolean,
  error: Human.Failed
})
const Broken = Durable.workflow("human#Broken", { payload: { how: Schema.String }, success: Schema.String, error: Human.Failed })
const Malformed = Durable.workflow("human#Malformed", { payload: { id: Schema.String }, success: Schema.String, error: Human.Failed })

const Verdict = Schema.Struct({ score: Schema.Number, due: Schema.Date })
const go = Durable.signal("go", Schema.String)
// A workflow that outlives its question: it takes the timeout as a branch and waits again.
const Patient = Durable.workflow("human#Patient", { payload: { id: Schema.String }, success: Schema.String })

const questions = Layer.mergeAll(
  Release.toLayer(({ build }) =>
    Effect.map(
      Human.confirm("ship", `Ship ${build}?`, { timeout: "6 hours", maxAttempts: 3 }),
      (approved) => approved ? `shipped:${build}` : "held"
    )
  ),
  Triage.toLayer(({ issue }) =>
    Effect.map(Human.select("severity", `How bad is ${issue}?`, ["low", "high"]), (severity) => `${issue}:${severity}`)
  ),
  Review.toLayer(({ id }) =>
    Effect.map(
      Human.json("verdict", "Score it", Verdict),
      (verdict) => `${id}:${verdict.score}:${verdict.due instanceof Date ? verdict.due.toISOString() : "not a date"}`
    )
  ),
  Explain.toLayer(({ id }) => Effect.map(Human.ask("why", "Why?"), (reason) => `${id}:${reason}`)),
  Budget.toLayer(({ maxAttempts }) => Human.confirm("ok", "OK?", { maxAttempts })),
  // A name that is half of a surrogate pair cannot be a journal key.
  Malformed.toLayer(() => Human.ask("bad\uD800", "Pick")),
  Patient.toLayer(({ id }) =>
    Effect.gen(function*() {
      const answer = yield* Human.confirm("ok", "OK?", { timeout: "1 hour" }).pipe(
        Effect.map((approved) => approved ? "yes" : "no"),
        Effect.catch((failed) => Effect.succeed(failed.code))
      )
      const word = yield* go.wait()
      return `${id}:${answer}:${word}`
    })
  ),
  Broken.toLayer(({ how }) =>
    how === "no-choices"
      ? Human.select("pick", "Pick", [])
      : how === "no-attempts"
      ? Human.ask("pick", "Pick", { maxAttempts: 0 })
      : how === "too-many-attempts"
      ? Human.ask("pick", "Pick", { maxAttempts: 1001 })
      : how === "negative-timeout"
      ? Human.ask("pick", "Pick", { timeout: -1 })
      : how === "negative-duration"
      ? Human.ask("pick", "Pick", { timeout: Duration.seconds(-5) })
      : how === "unreachable-deadline"
      ? Human.ask("pick", "Pick", { timeout: Duration.millis(1e300) })
      : how === "endless-timeout"
      ? Human.ask("pick", "Pick", { timeout: Number.POSITIVE_INFINITY })
      : Human.ask("pick", "Pick", { timeout: Number.NaN })
  )
)

const runOf = <P>(W: { readonly executionId: (payload: P) => Effect.Effect<string> }, payload: P) =>
  Effect.runPromise(W.executionId(payload))

const failure = (exit: Exit.Exit<unknown, unknown>) => Option.getOrUndefined(Exit.findErrorOption(exit)) as Human.Failed | undefined

/** Waits until the run asks `name` on `attempt`, or has finished. */
const asking = async (process: Process, run: string, name: string, attempt: number) => {
  for (let waited = 0; waited < 2000; waited++) {
    const waits = await process.run(Durable.waiting(run))
    const open = waits.find((wait) => wait.reason === "approval" && wait.name === name)
    if (open?.attempt === attempt) return open
    await Effect.runPromise(tick())
  }
  throw new Error(`run ${run} did not ask ${name} on attempt ${attempt}`)
}

test("a question parks the run with what an inbox needs, and the answer wakes it", async () => {
  const store = Durable.makeMemoryStore()
  const process = boot(store, makeWallClock(start), questions)
  const run = await runOf(Release, { build: "build-42" })
  await process.run(Release.execute({ build: "build-42" }, { discard: true }))
  expect(await parked(process, Release, run)).toBe(true)

  const [wait] = await process.run(Durable.waiting(run))
  expect(wait).toMatchObject({
    reason: "approval",
    name: "ship",
    attempt: 1,
    wakeAt: start + 6 * hour,
    request: { kind: "confirm", prompt: "Ship build-42?", maxAttempts: 3 }
  })
  expect(DurableDeferred.TokenParsed.fromString(wait!.token as DurableDeferred.Token)).toMatchObject({
    workflowName: "human#Release",
    executionId: run
  })
  // The published question is what validate checks an answer against.
  expect(Human.validate("yes", wait!.request as Human.Request)).toBe("The answer must be a boolean.")
  expect(Human.validate(true, wait!.request as Human.Request)).toBeUndefined()

  await process.run(Human.answer(Release, run, "ship", true))
  expect(await finished(process, Release, run)).toEqual(Exit.succeed("shipped:build-42"))
  expect(await process.run(Durable.waiting(run))).toEqual([])
  await process.kill()
})

test("no is an answer: the workflow gets false", async () => {
  const process = boot(Durable.makeMemoryStore(), makeWallClock(start), questions)
  const run = await runOf(Release, { build: "b2" })
  await process.run(Release.execute({ build: "b2" }, { discard: true }))
  await asking(process, run, "ship", 1)
  await process.run(Human.answer(Release, run, "ship", false))
  expect(await finished(process, Release, run)).toEqual(Exit.succeed("held"))
  await process.kill()
})

test("an answer that does not fit is recorded and refused, and the run asks again", async () => {
  const process = boot(Durable.makeMemoryStore(), makeWallClock(start), questions)
  const run = await runOf(Release, { build: "b3" })
  await process.run(Release.execute({ build: "b3" }, { discard: true }))
  await asking(process, run, "ship", 1)

  await process.run(Human.answer(Release, run, "ship", "yes please"))
  const second = await asking(process, run, "ship", 2)
  // Asking again does not extend the deadline.
  expect(second.wakeAt).toBe(start + 6 * hour)
  expect((await journal(process, run)).filter(([type]) => type === "StepCompleted").map(([, step]) => step)).toContain(
    "Human/ship#1/rejected"
  )

  await process.run(Human.answer(Release, run, "ship", true))
  expect(await finished(process, Release, run)).toEqual(Exit.succeed("shipped:b3"))
  await process.kill()
})

test("a question that runs out of attempts fails with rejected and the reasons", async () => {
  const process = boot(Durable.makeMemoryStore(), makeWallClock(start), questions)
  const run = await runOf(Release, { build: "b4" })
  await process.run(Release.execute({ build: "b4" }, { discard: true }))
  for (const [index, wrong] of ["yes", 1, null].entries()) {
    await asking(process, run, "ship", index + 1)
    await process.run(Human.answer(Release, run, "ship", wrong))
  }
  const failed = failure(await finished(process, Release, run))
  expect(failed).toBeInstanceOf(Human.Failed)
  expect(failed).toMatchObject({
    code: "rejected",
    question: "ship",
    attempts: 3,
    rejections: [
      "attempt 1: The answer must be a boolean.",
      "attempt 2: The answer must be a boolean.",
      "attempt 3: The answer must be a boolean."
    ]
  })
  // The question is closed: a fourth answer has nowhere to go.
  const late = await process.run(Effect.exit(Human.answer(Release, run, "ship", true)))
  expect(Option.getOrUndefined(Exit.findErrorOption(late))).toMatchObject({ _tag: "HumanAnswerInvalid", code: "answer_not_open" })
  await process.kill()
})

test("a question nobody answers times out, and asking again does not extend the deadline", async () => {
  const wall = makeWallClock(start)
  const process = boot(Durable.makeMemoryStore(), wall, questions)
  const silent = await runOf(Release, { build: "b5" })
  const wrong = await runOf(Release, { build: "b6" })
  await process.run(Release.execute({ build: "b5" }, { discard: true }))
  await process.run(Release.execute({ build: "b6" }, { discard: true }))
  await asking(process, silent, "ship", 1)
  await asking(process, wrong, "ship", 1)

  wall.advance(5 * hour)
  await process.run(Human.answer(Release, wrong, "ship", "maybe"))
  await asking(process, wrong, "ship", 2)
  expect(await parked(process, Release, silent)).toBe(true)

  wall.advance(hour)
  expect(failure(await finished(process, Release, silent))).toMatchObject({ code: "timeout", question: "ship", attempts: 1, rejections: [] })
  expect(failure(await finished(process, Release, wrong))).toMatchObject({
    code: "timeout",
    attempts: 2,
    rejections: ["attempt 1: The answer must be a boolean."]
  })
  await process.kill()
})

test("a run killed while it asks wakes on the engine that receives the answer", async () => {
  const store = Durable.makeMemoryStore()
  const wall = makeWallClock(start)
  const run = await runOf(Release, { build: "b7" })
  const first = boot(store, wall, questions)
  await first.run(Release.execute({ build: "b7" }, { discard: true }))
  await asking(first, run, "ship", 1)
  await first.kill()

  wall.advance(5 * hour)
  const second = boot(store, wall, questions)
  // The waiting row is in the store, so the new process finds the open attempt.
  expect((await second.run(Durable.waiting(run))).map((wait) => wait.attempt)).toEqual([1])
  await second.run(Human.answer(Release, run, "ship", true))
  expect(await finished(second, Release, run)).toEqual(Exit.succeed("shipped:b7"))
  // Asked once: the restart replayed the question and did not ask it again.
  expect((await journal(second, run)).filter(([type, step]) => type === "StepStarted" && step === "Human/ship#1/asked").length).toBe(1)
  await second.kill()
})

test("a deadline that passes while the run is down still ends the question", async () => {
  const store = Durable.makeMemoryStore()
  const wall = makeWallClock(start)
  const run = await runOf(Release, { build: "b8" })
  const first = boot(store, wall, questions)
  await first.run(Release.execute({ build: "b8" }, { discard: true }))
  await asking(first, run, "ship", 1)
  await first.kill()

  wall.advance(7 * hour)
  const second = boot(store, wall, questions)
  await second.run(Release.resume(run))
  expect(failure(await finished(second, Release, run))).toMatchObject({ code: "timeout", attempts: 1 })
  await second.kill()
})

test("an answer in the journal wins over a deadline that also passed while the run was down", async () => {
  const store = Durable.makeMemoryStore()
  const wall = makeWallClock(start)
  const run = await runOf(Release, { build: "b9" })
  const first = boot(store, wall, questions)
  await first.run(Release.execute({ build: "b9" }, { discard: true }))
  await asking(first, run, "ship", 1)
  await first.kill()

  // An inbox process that does not run the workflow records the answer in time.
  wall.advance(5 * hour)
  const inbox = boot(store, wall, Layer.empty)
  await inbox.run(Human.answer(Release, run, "ship", true))
  await inbox.kill()

  wall.advance(2 * hour)
  const worker = boot(store, wall, questions)
  await worker.run(Release.resume(run))
  expect(await finished(worker, Release, run)).toEqual(Exit.succeed("shipped:b9"))
  await worker.kill()
})

test("a deadline that won stays won: an answer that reaches the journal later does not flip it on replay", async () => {
  const store = Durable.makeMemoryStore()
  const wall = makeWallClock(start)
  const run = await runOf(Patient, { id: "p1" })
  const process = boot(store, wall, questions)
  await process.run(Patient.execute({ id: "p1" }, { discard: true }))
  await asking(process, run, "ok", 1)

  // The deadline passes. The workflow takes its timeout branch and parks on a signal.
  wall.advance(hour)
  for (let waited = 0; waited < 2000; waited++) {
    const waits = await process.run(Durable.waiting(run))
    if (waits.some((wait) => wait.reason === "event")) break
    await Effect.runPromise(tick())
  }
  expect((await process.run(Durable.waiting(run))).map((wait) => wait.reason)).toEqual(["event"])

  // An answer that was in flight when the deadline won reaches the journal
  // now, without the open check: the write an inbox makes after reading.
  const deferred = DurableDeferred.make("Human/ok#1", { success: Schema.Json })
  await process.run(DurableDeferred.succeed(deferred, {
    token: DurableDeferred.tokenFromExecutionId(deferred, { workflow: Patient, executionId: run }),
    value: true
  }))

  // The signal replays the body. The question is still the timeout it recorded.
  await process.run(go.send(Patient, run, "now"))
  expect(await finished(process, Patient, run)).toEqual(Exit.succeed("p1:timeout:now"))
  await process.kill()
})

test("select returns one of its choices and refuses anything else", async () => {
  const process = boot(Durable.makeMemoryStore(), makeWallClock(start), questions)
  const run = await runOf(Triage, { issue: "i1" })
  await process.run(Triage.execute({ issue: "i1" }, { discard: true }))
  const first = await asking(process, run, "severity", 1)
  expect(first.request).toEqual({ kind: "select", prompt: "How bad is i1?", maxAttempts: 10, choices: ["low", "high"] })
  expect(first.wakeAt).toBeUndefined()
  expect(Human.validate("medium", first.request as Human.Request)).toBe("The answer \"medium\" is not one of low, high.")

  await process.run(Human.answer(Triage, run, "severity", "medium"))
  await asking(process, run, "severity", 2)
  await process.run(Human.answer(Triage, run, "severity", "high"))
  expect(await finished(process, Triage, run)).toEqual(Exit.succeed("i1:high"))
  await process.kill()
})

test("json decodes the answer with its one schema and publishes the derived JSON Schema", async () => {
  const process = boot(Durable.makeMemoryStore(), makeWallClock(start), questions)
  const run = await runOf(Review, { id: "r1" })
  await process.run(Review.execute({ id: "r1" }, { discard: true }))
  const first = await asking(process, run, "verdict", 1)
  const request = first.request as Human.Question
  expect(request.kind).toBe("json")
  expect(JSON.stringify(request.jsonSchema)).toContain("score")

  // The same schema checks an answer before it is sent.
  expect(Human.validate({ score: "high" }, { kind: "json", schema: Verdict })).toContain("does not fit the schema")
  expect(Human.validate({ score: 4, due: "2026-06-01T12:00:00.000Z" }, { kind: "json", schema: Verdict })).toBeUndefined()

  await process.run(Human.answer(Review, run, "verdict", { score: "high" }))
  await asking(process, run, "verdict", 2)
  await process.run(Human.answer(Review, run, "verdict", { score: 4, due: "2026-06-01T12:00:00.000Z" }))
  expect(await finished(process, Review, run)).toEqual(Exit.succeed("r1:4:2026-06-01T12:00:00.000Z"))
  await process.kill()
})

test("a question that cannot be answered fails with request_invalid before anyone is asked", async () => {
  const process = boot(Durable.makeMemoryStore(), makeWallClock(start), questions)
  for (const how of ["no-choices", "no-attempts", "too-many-attempts", "negative-timeout", "negative-duration", "unreachable-deadline", "endless-timeout", "nan-timeout"]) {
    const run = await runOf(Broken, { how })
    await process.run(Broken.execute({ how }, { discard: true }))
    expect(failure(await finished(process, Broken, run))).toMatchObject({ code: "request_invalid", question: "pick", attempts: 0 })
    expect((await journal(process, run)).some(([, step]) => step !== null && step.endsWith("/asked"))).toBe(false)
  }
  await process.kill()
})

test("a question with a malformed name fails with request_invalid instead of throwing", async () => {
  const process = boot(Durable.makeMemoryStore(), makeWallClock(start), questions)
  const run = await runOf(Malformed, { id: "m1" })
  await process.run(Malformed.execute({ id: "m1" }, { discard: true }))
  expect(failure(await finished(process, Malformed, run))).toMatchObject({ code: "request_invalid", attempts: 0 })
  await process.kill()
})

test("an answer whose wake was lost can be sent again: it is not recorded twice, and the run wakes", async () => {
  const store = Durable.makeMemoryStore()
  const wall = makeWallClock(start)
  const run = await runOf(Release, { build: "b10" })
  const first = boot(store, wall, questions)
  await first.run(Release.execute({ build: "b10" }, { discard: true }))
  await asking(first, run, "ship", 1)
  await first.kill()

  // The answer reaches the journal, and the process that wrote it dies before the run wakes.
  const inbox = boot(store, wall, Layer.empty)
  await inbox.run(Human.answer(Release, run, "ship", true))
  await inbox.kill()

  const worker = boot(store, wall, questions)
  // A different answer is still too late: the first delivery wins.
  const other = await worker.run(Effect.exit(Human.answer(Release, run, "ship", false)))
  expect(Option.getOrUndefined(Exit.findErrorOption(other))).toMatchObject({ code: "answer_not_open" })
  // The same answer, sent again, wakes the run.
  await worker.run(Human.answer(Release, run, "ship", true))
  expect(await finished(worker, Release, run)).toEqual(Exit.succeed("shipped:b10"))
  expect((await journal(worker, run)).filter(([type, name]) => type === "DeferredDone" && name === "Human/ship#1").length).toBe(1)
  await worker.kill()
})

test("answer refuses a value that is not JSON and a question that is not open", async () => {
  const process = boot(Durable.makeMemoryStore(), makeWallClock(start), questions)
  const run = await runOf(Explain, { id: "e1" })
  await process.run(Explain.execute({ id: "e1" }, { discard: true }))
  await asking(process, run, "why", 1)

  const code = async (effect: Effect.Effect<void, Human.AnswerInvalid, any>) =>
    (Option.getOrUndefined(Exit.findErrorOption(await process.run(Effect.exit(effect)))) as Human.AnswerInvalid | undefined)?.code
  const cycle: Record<string, unknown> = {}
  cycle.self = cycle
  for (const value of [undefined, () => 1, Number.NaN, 10n, new Date(0), cycle, "x".repeat(Human.maxAnswerBytes)]) {
    expect(await code(Human.answer(Explain, run, "why", value))).toBe("answer_invalid")
  }
  expect(await code(Human.answer(Explain, run, "who", "me"))).toBe("answer_not_open")
  expect(await code(Human.answer(Explain, "no-such-run", "why", "me"))).toBe("answer_not_open")
  // The address holds the workflow: another workflow's name does not reach this run.
  expect(await code(Human.answer(Release, run, "why", "me"))).toBe("answer_not_open")
  // Nothing above was recorded.
  expect((await journal(process, run)).some(([type]) => type === "DeferredDone")).toBe(false)

  await process.run(Human.answer(Explain, run, "why", "because"))
  expect(await finished(process, Explain, run)).toEqual(Exit.succeed("e1:because"))
  expect(await code(Human.answer(Explain, run, "why", "again"))).toBe("answer_not_open")
  await process.kill()
})

// The invariant: the question returns the first answer that fits, each refused
// answer is one recorded rejection, and the budget bounds the attempts.
const firstFittingAnswer = async ({ answers, maxAttempts }: { readonly answers: ReadonlyArray<unknown>; readonly maxAttempts: number }) => {
  const process = boot(Durable.makeMemoryStore(), makeWallClock(start), questions)
  const payload = { id: "p", maxAttempts }
  const run = await runOf(Budget, payload)
  await process.run(Budget.execute(payload, { discard: true }))
  const tried = answers.slice(0, maxAttempts)
  const fitting = tried.findIndex((value) => typeof value === "boolean")
  const sent = fitting === -1 ? tried : tried.slice(0, fitting + 1)
  for (const [index, value] of sent.entries()) {
    await asking(process, run, "ok", index + 1)
    expect(Human.validate(value, { kind: "confirm" }) === undefined).toBe(typeof value === "boolean")
    await process.run(Human.answer(Budget, run, "ok", value))
  }
  const refused = (await journal(process, run)).filter(([type, step]) => type === "StepCompleted" && step !== null && step.endsWith("/rejected"))
  if (fitting !== -1) {
    expect(await finished(process, Budget, run)).toEqual(Exit.succeed(tried[fitting] as boolean))
    expect(refused.length).toBe(fitting)
  } else if (tried.length === maxAttempts) {
    expect(failure(await finished(process, Budget, run))).toMatchObject({ code: "rejected", attempts: maxAttempts })
  } else {
    const open = await asking(process, run, "ok", tried.length + 1)
    expect(open.attempt).toBe(tried.length + 1)
    expect(await parked(process, Budget, run, 3)).toBe(true)
  }
  await process.kill()
}

test("a question returns the first answer that fits, under any answers and budget", async () => {
  await checkProperty(fc, {
    name: "human-first-fitting-answer",
    rule: "VIP-56 Experimental.Human: a refused answer is recorded, and the run parks on the next attempt",
    command: "bun test tests/experimental-human.test.ts",
    arbitrary: fc.record({
      answers: fc.array(fc.oneof(fc.boolean(), fc.string({ maxLength: 8 }), fc.integer(), fc.constant(null), fc.constant({ yes: true })), {
        maxLength: 6
      }),
      maxAttempts: fc.integer({ min: 1, max: 4 })
    }),
    numRuns: 40,
    check: firstFittingAnswer
  })
}, 120000)
