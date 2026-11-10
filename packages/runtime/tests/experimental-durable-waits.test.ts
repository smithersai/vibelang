import { expect, test } from "bun:test"
import fc from "fast-check"
import { Effect, Exit, Layer, Schema, Stream } from "effect"
import { DurableDeferred } from "effect/workflow"
import { Durable } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { boot, droppingStore, finished, hangingStore, journal, makeWallClock, parked, settled, tick } from "./experimental-durable-waits-support.ts"

const start = Date.UTC(2026, 0, 1)
const minute = 60_000
const hour = 60 * minute

// Timers.

const Remind = Durable.workflow("waits#Remind", { payload: { id: Schema.String, millis: Schema.Number }, success: Schema.String })
const Twice = Durable.workflow("waits#Twice", { payload: { id: Schema.String }, success: Schema.String })
const Until = Durable.workflow("waits#Until", { payload: { id: Schema.String, at: Schema.Number }, success: Schema.String })

const timers = Layer.mergeAll(
  Remind.toLayer(({ id, millis }) => Effect.as(Durable.sleep(millis), `remind:${id}`)),
  Twice.toLayer(({ id }) => Effect.as(Effect.andThen(Durable.sleep("1 hour"), Durable.sleep("1 hour")), `twice:${id}`)),
  Until.toLayer(({ id, at }) => Effect.as(Durable.until(at), `until:${id}`))
)

const runOf = <P>(W: { readonly executionId: (payload: P) => Effect.Effect<string> }, payload: P) =>
  Effect.runPromise(W.executionId(payload))

test("a sleep parks the run, journals its wake time, and the clock wakes it", async () => {
  const store = Durable.makeMemoryStore()
  const wall = makeWallClock(start)
  const process = boot(store, wall, timers)
  const run = await runOf(Remind, { id: "a", millis: hour })
  await process.run(Remind.execute({ id: "a", millis: hour }, { discard: true }))

  expect(await parked(process, Remind, run)).toBe(true)
  // Parked means suspended in the store: no fiber of this process holds the run.
  const suspended = await process.run(Stream.runCollect(Durable.runs({ status: "suspended" })))
  expect(Array.from(suspended).map((row) => row.run)).toEqual([run])
  const waits = await process.run(Durable.waiting(run))
  expect(waits.map((wait) => [wait.reason, wait.name, wait.wakeAt])).toEqual([["timer", "Durable.sleep#1", start + hour]])

  wall.advance(hour - 1)
  expect(await parked(process, Remind, run)).toBe(true)
  wall.advance(1)
  expect(await finished(process, Remind, run)).toEqual(Exit.succeed("remind:a"))
  expect(await process.run(Durable.waiting(run))).toEqual([])
  await process.kill()
})

test("a run killed while it sleeps wakes when the timer was due, whatever the clock did meanwhile", async () => {
  const store = Durable.makeMemoryStore()
  const wall = makeWallClock(start)
  const run = await runOf(Remind, { id: "b", millis: hour })

  const first = boot(store, wall, timers)
  await first.run(Remind.execute({ id: "b", millis: hour }, { discard: true }))
  expect(await parked(first, Remind, run)).toBe(true)
  await first.kill()

  // The process is down for 40 minutes. Its restart must not start the hour again.
  wall.advance(40 * minute)
  const second = boot(store, wall, timers)
  await second.run(Remind.resume(run))
  expect(await parked(second, Remind, run)).toBe(true)
  expect((await second.run(Durable.waiting(run))).map((wait) => wait.wakeAt)).toEqual([start + hour])
  await second.kill()

  // A faulty clock: the host comes back set ten minutes before the run began.
  wall.set(start - 10 * minute)
  const third = boot(store, wall, timers)
  await third.run(Remind.resume(run))
  expect(await parked(third, Remind, run)).toBe(true)
  // Twenty minutes after the restart at 40 is the hour. From here it is 70 minutes away.
  wall.advance(69 * minute)
  expect(await parked(third, Remind, run)).toBe(true)
  wall.advance(1 * minute)
  expect(await finished(third, Remind, run)).toEqual(Exit.succeed("remind:b"))

  const steps = (await journal(third, run)).filter(([type]) => type === "StepStarted").map(([, step]) => step)
  expect(steps).toEqual(["Durable.sleep#1"])
  await third.kill()
})

test("a timer that came due while the run was down settles at once and is no longer a wait", async () => {
  const store = Durable.makeMemoryStore()
  const wall = makeWallClock(start)
  const run = await runOf(Twice, { id: "c" })

  const first = boot(store, wall, timers)
  await first.run(Twice.execute({ id: "c" }, { discard: true }))
  expect(await parked(first, Twice, run)).toBe(true)
  await first.kill()

  // Down past the first hour. The second sleep starts when the run reaches it.
  wall.advance(90 * minute)
  const second = boot(store, wall, timers)
  await second.run(Twice.resume(run))
  expect(await parked(second, Twice, run)).toBe(true)
  const waits = await second.run(Durable.waiting(run))
  expect(waits.map((wait) => [wait.name, wait.wakeAt])).toEqual([["Durable.sleep#2", start + 90 * minute + hour]])

  wall.advance(hour)
  expect(await finished(second, Twice, run)).toEqual(Exit.succeed("twice:c"))
  // Two sleeps of one length are two waits, and the overdue one closed with one step.
  const steps = (await journal(second, run)).filter(([type]) => type === "StepStarted").map(([, step]) => step)
  expect(steps).toEqual(["Durable.sleep#1", "Durable.sleep#1/elapsed", "Durable.sleep#2"])
  await second.kill()
})

test("a crash while the run parks keeps the journaled wake time", async () => {
  const memory = Durable.makeMemoryStore()
  const wall = makeWallClock(start)
  const run = await runOf(Remind, { id: "d", millis: hour })

  // The injected fault: the store stops answering as the run records that it parked.
  const { store: faulty, hung } = hangingStore(memory, (eventType) => eventType === "RunSuspended")
  const first = boot(faulty, wall, timers)
  await first.run(Remind.execute({ id: "d", millis: hour }, { discard: true }))
  await hung
  await first.kill()

  wall.advance(59 * minute)
  const second = boot(memory, wall, timers)
  await second.run(Remind.resume(run))
  expect(await parked(second, Remind, run)).toBe(true)
  wall.advance(1 * minute)
  expect(await finished(second, Remind, run)).toEqual(Exit.succeed("remind:d"))
  await second.kill()
})

test("until parks to an instant, and an instant that has passed settles at once", async () => {
  const store = Durable.makeMemoryStore()
  const wall = makeWallClock(start)
  const process = boot(store, wall, timers)

  const future = await runOf(Until, { id: "e", at: start + 5 * minute })
  await process.run(Until.execute({ id: "e", at: start + 5 * minute }, { discard: true }))
  expect(await parked(process, Until, future)).toBe(true)
  expect((await process.run(Durable.waiting(future))).map((wait) => wait.wakeAt)).toEqual([start + 5 * minute])
  wall.advance(5 * minute)
  expect(await finished(process, Until, future)).toEqual(Exit.succeed("until:e"))

  const past = await runOf(Until, { id: "f", at: start })
  await process.run(Until.execute({ id: "f", at: start }, { discard: true }))
  expect(await finished(process, Until, past)).toEqual(Exit.succeed("until:f"))

  const never = await runOf(Until, { id: "g", at: Number.NaN })
  await process.run(Until.execute({ id: "g", at: Number.NaN }, { discard: true }))
  const exit = await finished(process, Until, never)
  expect(Exit.isFailure(exit) && String(exit.cause)).toContain("Durable.until was asked to wake at NaN")
  await process.kill()
})

// The invariant: a timer writes its absolute wake time before it parks, so a
// restart does not restart the delay.
const wakesOnTime = async ({ millis, readings }: { readonly millis: number; readonly readings: ReadonlyArray<number> }) => {
  const store = Durable.makeMemoryStore()
  const wall = makeWallClock(start)
  const payload = { id: "p", millis }
  const run = await runOf(Remind, payload)
  let process = boot(store, wall, timers)
  await process.run(Remind.execute(payload, { discard: true }))
  let due = millis === 0
  for (const reading of readings) {
    // Each reading is a crash and a restart with the wall clock at `reading`.
    // The crash comes once the run has recorded its wait or finished.
    expect(await settled(process, Remind, run)).toBe(due ? "finished" : "parked")
    await process.kill()
    wall.set(start + reading)
    due = due || reading >= millis
    process = boot(store, wall, timers)
    await process.run(Remind.resume(run))
  }
  if (due) {
    expect(await finished(process, Remind, run)).toEqual(Exit.succeed("remind:p"))
  } else {
    expect(await parked(process, Remind, run, 3)).toBe(true)
    wall.set(start + millis)
    expect(await finished(process, Remind, run)).toEqual(Exit.succeed("remind:p"))
  }
  const steps = (await journal(process, run)).filter(([type, step]) => type === "StepStarted" && step === "Durable.sleep#1")
  expect(steps.length).toBe(1)
  await process.kill()
}

test("a timer wakes at its journaled time under any crashes and any clock readings", async () => {
  await checkProperty(fc, {
    name: "durable-timer-wake-time",
    rule: "VIP-56 Timers: a timer writes its absolute wake time before it parks, so a restart does not restart the delay",
    command: "bun test tests/experimental-durable-waits.test.ts",
    arbitrary: fc.record({
      millis: fc.integer({ min: 0, max: 10 * hour }),
      // Wall-clock readings at each restart, relative to the start: early, late, or before the start.
      readings: fc.array(fc.integer({ min: -hour, max: 12 * hour }), { maxLength: 4 })
    }),
    numRuns: 40,
    check: wakesOnTime
  })
}, 120000)

// Signals.

const Paid = Schema.Struct({ amount: Schema.Number, at: Schema.Date })
const paid = Durable.signal("paid", Paid)
const note = Durable.signal("note", Schema.String)

const Checkout = Durable.workflow("waits#Checkout", { payload: { order: Schema.String }, success: Schema.String })
const Refund = Durable.workflow("waits#Refund", { payload: { order: Schema.String }, success: Schema.String })
const Notes = Durable.workflow("waits#Notes", { payload: { id: Schema.String }, success: Schema.String })
const Bounded = Durable.workflow("waits#Bounded", { payload: { order: Schema.String }, success: Schema.String })

const signals = Layer.mergeAll(
  Checkout.toLayer(({ order }) =>
    Effect.map(paid.wait(), (payment) => `${order}:${payment.amount}:${payment.at instanceof Date ? payment.at.toISOString() : "not a date"}`)
  ),
  Refund.toLayer(({ order }) => Effect.map(paid.wait(), (payment) => `refund:${order}:${payment.amount}`)),
  Notes.toLayer(({ id }) =>
    Effect.gen(function*() {
      const first = yield* note.wait()
      const second = yield* note.wait("second")
      return `${id}:${first}:${second}`
    })
  ),
  // try.race [paid.wait(), Experimental.Durable.sleep("1 day")]: the winner is recorded.
  Bounded.toLayer(({ order }) =>
    Durable.race({
      name: "payment",
      success: Schema.String,
      effects: [
        Effect.map(paid.wait(), (payment) => `${order}:paid:${payment.amount}`),
        Effect.as(Durable.sleep("1 day"), `${order}:expired`)
      ]
    })
  )
)

// A bounded wait, then another timer: the race numbers its own timer, so the
// later one is the run's first whether or not the race runs its arms.
const Grace = Durable.workflow("waits#Grace", { payload: { order: Schema.String }, success: Schema.String })
const Unstable = Durable.workflow("waits#Unstable", { payload: { order: Schema.String }, success: Schema.String })
const graced = Layer.mergeAll(
  Grace.toLayer(({ order }) =>
    Effect.gen(function*() {
      const outcome = yield* Durable.race({
        name: "payment",
        success: Schema.String,
        effects: [Effect.map(paid.wait(), (payment) => `paid:${payment.amount}`), Effect.as(Durable.sleep("1 day"), "expired")]
      })
      yield* Durable.sleep("10 minutes")
      return `${order}:${outcome}`
    })
  ),
  Unstable.toLayer(({ order }) =>
    Effect.gen(function*() {
      yield* DurableDeferred.raceAll({
        name: "payment",
        success: Schema.String,
        error: Schema.Never,
        effects: [Effect.as(paid.wait(), "paid"), Effect.as(Durable.sleep("1 day"), "expired")]
      })
      yield* Durable.sleep("10 minutes")
      return order
    })
  )
)

const when = new Date(Date.UTC(2026, 5, 1, 12))

test("a signal's wait parks the run until send delivers a typed value, in its JSON form", async () => {
  const store = Durable.makeMemoryStore()
  const process = boot(store, makeWallClock(start), signals)
  const run = await runOf(Checkout, { order: "o1" })
  await process.run(Checkout.execute({ order: "o1" }, { discard: true }))
  expect(await parked(process, Checkout, run)).toBe(true)

  const waits = await process.run(Durable.waiting(run))
  expect(waits.map((wait) => [wait.reason, wait.name])).toEqual([["event", "paid"]])
  // The address is the workflow, the run and the name: anyone can rebuild it.
  expect(DurableDeferred.TokenParsed.fromString(waits[0]!.token as DurableDeferred.Token)).toMatchObject({
    workflowName: "waits#Checkout",
    executionId: run
  })

  await process.run(paid.send(Checkout, run, { amount: 12, at: when }))
  expect(await finished(process, Checkout, run)).toEqual(Exit.succeed(`o1:12:${when.toISOString()}`))
  // The value crossed as JSON: the journal holds the date as text.
  const entries = Array.from(await process.run(Stream.runCollect(Durable.history(run))))
  const delivered = entries.find((entry) => entry.eventType === "DeferredDone")!
  expect(JSON.stringify(delivered.payload)).toContain(when.toISOString())
  await process.kill()
})

test("the first delivery wins, and a later one changes nothing", async () => {
  const store = Durable.makeMemoryStore()
  const process = boot(store, makeWallClock(start), signals)
  const run = await runOf(Checkout, { order: "o2" })
  await process.run(Checkout.execute({ order: "o2" }, { discard: true }))
  expect(await parked(process, Checkout, run)).toBe(true)
  await process.run(paid.send(Checkout, run, { amount: 1, at: when }))
  await process.run(paid.send(Checkout, run, { amount: 2, at: when }))
  expect(await finished(process, Checkout, run)).toEqual(Exit.succeed(`o2:1:${when.toISOString()}`))
  await process.run(paid.send(Checkout, run, { amount: 3, at: when }))
  expect(await finished(process, Checkout, run)).toEqual(Exit.succeed(`o2:1:${when.toISOString()}`))
  await process.kill()
})

test("a name is local to a run: two workflows and two runs each get their own delivery", async () => {
  const store = Durable.makeMemoryStore()
  const process = boot(store, makeWallClock(start), signals)
  const checkout = await runOf(Checkout, { order: "o3" })
  const other = await runOf(Checkout, { order: "o4" })
  const refund = await runOf(Refund, { order: "o3" })
  await process.run(Checkout.execute({ order: "o3" }, { discard: true }))
  await process.run(Checkout.execute({ order: "o4" }, { discard: true }))
  await process.run(Refund.execute({ order: "o3" }, { discard: true }))
  expect(await parked(process, Refund, refund)).toBe(true)

  await process.run(paid.send(Refund, refund, { amount: 7, at: when }))
  expect(await finished(process, Refund, refund)).toEqual(Exit.succeed("refund:o3:7"))
  expect(await parked(process, Checkout, checkout)).toBe(true)
  expect(await parked(process, Checkout, other)).toBe(true)

  // The Run handle sends to its own run.
  await process.run(Durable.run(Checkout, other).send(paid, { amount: 9, at: when }))
  expect(await finished(process, Checkout, other)).toEqual(Exit.succeed(`o4:9:${when.toISOString()}`))
  expect(await parked(process, Checkout, checkout)).toBe(true)
  await process.kill()
})

test("a second wait point is its own wait, and a delivery made early is kept", async () => {
  const store = Durable.makeMemoryStore()
  const process = boot(store, makeWallClock(start), signals)
  const run = await runOf(Notes, { id: "n1" })
  await process.run(Notes.execute({ id: "n1" }, { discard: true }))
  expect(await parked(process, Notes, run)).toBe(true)

  // The run has not reached the second wait point yet.
  await process.run(note.send(Notes, run, "late", "second"))
  expect(await parked(process, Notes, run)).toBe(true)
  expect((await process.run(Durable.waiting(run))).map((wait) => wait.name)).toEqual(["note"])

  await process.run(note.send(Notes, run, "early"))
  expect(await finished(process, Notes, run)).toEqual(Exit.succeed("n1:early:late"))
  await process.kill()
})

test("a run killed while it waits for a signal wakes on the engine that receives it", async () => {
  const store = Durable.makeMemoryStore()
  const wall = makeWallClock(start)
  const run = await runOf(Checkout, { order: "o5" })
  const first = boot(store, wall, signals)
  await first.run(Checkout.execute({ order: "o5" }, { discard: true }))
  expect(await parked(first, Checkout, run)).toBe(true)
  await first.kill()

  // A new process, a week later. Nothing executes the workflow: the delivery alone wakes it.
  wall.advance(7 * 24 * hour)
  const second = boot(store, wall, signals)
  await second.run(paid.send(Checkout, run, { amount: 30, at: when }))
  expect(await finished(second, Checkout, run)).toEqual(Exit.succeed(`o5:30:${when.toISOString()}`))
  // The wait was recorded once, by the first process.
  const steps = (await journal(second, run)).filter(([type]) => type === "StepStarted")
  expect(steps.length).toBe(1)
  await second.kill()
})

test("a delivery the store loses is not recorded, and the next one is the first", async () => {
  const memory = Durable.makeMemoryStore()
  const wall = makeWallClock(start)
  const run = await runOf(Checkout, { order: "o6" })
  const process = boot(droppingStore(memory), wall, signals)
  await process.run(Checkout.execute({ order: "o6" }, { discard: true }))
  expect(await parked(process, Checkout, run)).toBe(true)

  const lost = await process.run(Effect.exit(paid.send(Checkout, run, { amount: 1, at: when })))
  expect(Exit.isFailure(lost)).toBe(true)
  expect(await parked(process, Checkout, run)).toBe(true)
  expect((await journal(process, run)).some(([type]) => type === "DeferredDone")).toBe(false)

  await process.run(paid.send(Checkout, run, { amount: 2, at: when }))
  expect(await finished(process, Checkout, run)).toEqual(Exit.succeed(`o6:2:${when.toISOString()}`))
  await process.kill()
})

test("a fork of a parked run has its own wait: a delivery to the fork leaves the original parked", async () => {
  const store = Durable.makeMemoryStore()
  const process = boot(store, makeWallClock(start), signals)
  const run = await runOf(Checkout, { order: "o9" })
  await process.run(Checkout.execute({ order: "o9" }, { discard: true }))
  expect(await parked(process, Checkout, run)).toBe(true)

  const length = Array.from(await process.run(Stream.runCollect(Durable.history(run)))).length
  const copy = await process.run(Durable.fork({ run, seq: length + 1 }))
  const [wait] = await process.run(Durable.waiting(copy.run))
  // The fork's wait addresses the fork, not the run it was copied from.
  expect(DurableDeferred.TokenParsed.fromString(wait!.token as DurableDeferred.Token).executionId).toBe(copy.run)

  await process.run(paid.send(Checkout, copy.run, { amount: 44, at: when }))
  expect(await finished(process, Checkout, copy.run)).toEqual(Exit.succeed(`o9:44:${when.toISOString()}`))
  expect(await parked(process, Checkout, run)).toBe(true)
  await process.kill()
})

test("a signal raced against a durable sleep records its winner", async () => {
  const store = Durable.makeMemoryStore()
  const wall = makeWallClock(start)
  let process = boot(store, wall, signals)
  const payer = await runOf(Bounded, { order: "o7" })
  const sleeper = await runOf(Bounded, { order: "o8" })
  await process.run(Bounded.execute({ order: "o7" }, { discard: true }))
  await process.run(Bounded.execute({ order: "o8" }, { discard: true }))
  expect(await parked(process, Bounded, payer)).toBe(true)
  expect((await process.run(Durable.waiting(sleeper))).map((wait) => wait.reason).sort()).toEqual(["event", "timer"])

  await process.run(paid.send(Bounded, payer, { amount: 5, at: when }))
  expect(await finished(process, Bounded, payer)).toEqual(Exit.succeed("o7:paid:5"))
  expect(await parked(process, Bounded, sleeper)).toBe(true)

  // The day passes while the process is down. The late payment loses to the recorded deadline.
  await process.kill()
  wall.advance(24 * hour)
  process = boot(store, wall, signals)
  await process.run(Bounded.resume(sleeper))
  expect(await finished(process, Bounded, sleeper)).toEqual(Exit.succeed("o8:expired"))
  await process.run(paid.send(Bounded, sleeper, { amount: 6, at: when }))
  await tick(10)
  expect(await finished(process, Bounded, sleeper)).toEqual(Exit.succeed("o8:expired"))
  await process.kill()
})

test("a timer after a recorded race keeps its own wake time when the race stops running its arms", async () => {
  const store = Durable.makeMemoryStore()
  const wall = makeWallClock(start)
  let process = boot(store, wall, graced)
  const payer = await runOf(Grace, { order: "g1" })
  const sleeper = await runOf(Grace, { order: "g2" })
  await process.run(Grace.execute({ order: "g1" }, { discard: true }))
  await process.run(Grace.execute({ order: "g2" }, { discard: true }))
  expect(await parked(process, Grace, payer)).toBe(true)
  expect(await parked(process, Grace, sleeper)).toBe(true)

  // Five minutes in, the payment wins. The replay skips the race, and the
  // ten-minute timer is its own: due ten minutes from now, not in a day.
  wall.advance(5 * minute)
  await process.run(paid.send(Grace, payer, { amount: 3, at: when }))
  expect(await parked(process, Grace, payer)).toBe(true)
  expect((await process.run(Durable.waiting(payer))).filter((wait) => wait.name === "Durable.sleep#1").map((wait) => wait.wakeAt))
    .toEqual([start + 15 * minute])
  wall.advance(10 * minute)
  expect(await finished(process, Grace, payer)).toEqual(Exit.succeed("g1:paid:3"))

  // The other run's day passes, and its ten-minute timer survives a crash and a replay.
  wall.set(start + 24 * hour)
  expect(await parked(process, Grace, sleeper)).toBe(true)
  await process.kill()
  wall.advance(4 * minute)
  process = boot(store, wall, graced)
  await process.run(Grace.resume(sleeper))
  expect(await parked(process, Grace, sleeper)).toBe(true)
  wall.advance(6 * minute)
  expect(await finished(process, Grace, sleeper)).toEqual(Exit.succeed("g2:expired"))
  const steps = (await journal(process, sleeper)).filter(([type]) => type === "StepStarted").map(([, step]) => step)
  expect(steps).toContain("Durable.sleep#payment/1")
  expect(steps).toContain("Durable.sleep#1")
  await process.kill()
})

test("an unnamed timer inside Effect's own raceAll is refused, not left to shift the timers after it", async () => {
  const process = boot(Durable.makeMemoryStore(), makeWallClock(start), graced)
  const run = await runOf(Unstable, { order: "u1" })
  await process.run(Unstable.execute({ order: "u1" }, { discard: true }))
  // Refused when the race's arm reaches its timer, before anything parks on a number that would shift.
  const exit = await finished(process, Unstable, run)
  expect(String(Exit.isFailure(exit) && exit.cause)).toContain("Durable.sleep without a name is reached inside a DurableDeferred.raceAll or into")
  expect(String(Exit.isFailure(exit) && exit.cause)).toContain("or give the timer a name")
  await process.kill()
})

// The invariant: the first delivery wins, wherever crashes fall between deliveries.
const firstDeliveryWins = async ({ amounts, crashes }: { readonly amounts: ReadonlyArray<number>; readonly crashes: ReadonlyArray<boolean> }) => {
  const store = Durable.makeMemoryStore()
  const wall = makeWallClock(start)
  const payload = { order: "p" }
  const run = await runOf(Checkout, payload)
  let process = boot(store, wall, signals)
  await process.run(Checkout.execute(payload, { discard: true }))
  expect(await parked(process, Checkout, run, 3)).toBe(true)
  for (const [index, amount] of amounts.entries()) {
    if (crashes[index]) {
      await process.kill()
      process = boot(store, wall, signals)
    }
    await process.run(paid.send(Checkout, run, { amount, at: when }))
  }
  expect(await finished(process, Checkout, run)).toEqual(Exit.succeed(`p:${amounts[0]}:${when.toISOString()}`))
  await process.kill()
}

test("the first delivery wins under any later deliveries and crashes", async () => {
  await checkProperty(fc, {
    name: "durable-signal-first-delivery",
    rule: "VIP-56 Signals: the first delivery wins; a later one does not replace it",
    command: "bun test tests/experimental-durable-waits.test.ts",
    arbitrary: fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 5 }).chain((amounts) =>
      fc.record({ amounts: fc.constant(amounts), crashes: fc.array(fc.boolean(), { minLength: amounts.length, maxLength: amounts.length }) })
    ),
    numRuns: 40,
    check: firstDeliveryWins
  })
}, 120000)
