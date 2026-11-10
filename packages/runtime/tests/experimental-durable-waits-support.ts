import { Clock, Duration, Effect, Layer, ManagedRuntime, Option, Stream } from "effect"
import type { Workflow } from "effect/workflow"
import { Durable } from "vibelang-runtime/experimental"

/**
 * A wall clock a test moves by hand. Like a real wall clock it outlives a
 * process, and it can be set wrong: backward, or far ahead. The sleeps
 * pending on it belong to a process and die with it.
 */
export const makeWallClock = (start: number) => {
  let now = start
  let sleepers: Array<{ readonly at: number; readonly wake: () => void }> = []
  const nanos = () => BigInt(Math.trunc(now)) * 1_000_000n
  const clock: Clock.Clock = {
    currentTimeMillisUnsafe: () => now,
    currentTimeMillis: Effect.sync(() => now),
    currentTimeNanosUnsafe: nanos,
    currentTimeNanos: Effect.sync(nanos),
    monotonicTimeNanosUnsafe: nanos,
    monotonicTimeNanos: Effect.sync(nanos),
    sleep: (duration) =>
      Effect.callback<void>((resume) => {
        const sleeper = { at: now + Duration.toMillis(duration), wake: () => resume(Effect.void) }
        sleepers.push(sleeper)
        return Effect.sync(() => {
          sleepers = sleepers.filter((other) => other !== sleeper)
        })
      })
  }
  const set = (time: number) => {
    now = time
    const due = sleepers.filter((sleeper) => sleeper.at <= now)
    sleepers = sleepers.filter((sleeper) => sleeper.at > now)
    for (const sleeper of due) sleeper.wake()
  }
  return { clock, now: () => now, set, advance: (millis: number) => set(now + millis), pending: () => sleepers.length }
}

export type WallClock = ReturnType<typeof makeWallClock>

/** Real time, for the test itself: the workflows under test read the wall clock above. */
export const tick = (millis = 1) => Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, millis)))

/**
 * One process: an engine over `store`, the workflows in `workflows`, and the
 * wall clock. `kill` is a crash: every fiber of the process stops, and only
 * the store and the wall clock remain.
 */
export const boot = <R>(
  store: Durable.Store,
  wall: WallClock,
  workflows: Layer.Layer<R, never, any>
) => {
  const runtime = ManagedRuntime.make(
    workflows.pipe(
      Layer.provideMerge(Durable.layerStore(store)),
      Layer.provideMerge(Layer.succeed(Clock.Clock, wall.clock))
    ) as Layer.Layer<any>
  )
  return {
    run: <A, E>(effect: Effect.Effect<A, E, any>) => runtime.runPromise(effect as Effect.Effect<A, E>),
    kill: () => runtime.dispose()
  }
}

export type Process = ReturnType<typeof boot>

type AnyWorkflow = Workflow.Any & {
  readonly poll: (run: string) => Effect.Effect<Option.Option<Workflow.Result<any, any>>, never, any>
}

/** The run's result once it has finished. Fails the test if it does not finish in real time. */
export const finished = (process: Process, W: AnyWorkflow, run: string, withinMillis = 4000) =>
  process.run(Effect.gen(function*() {
    for (let waited = 0; waited < withinMillis; waited++) {
      const result = yield* W.poll(run)
      if (Option.isSome(result) && result.value._tag === "Complete") return result.value.exit
      yield* tick()
    }
    return yield* Effect.die(new Error(`run ${run} did not finish`))
  }))

/** Waits until the run stops moving, and says whether it parked or finished. */
export const settled = (process: Process, W: AnyWorkflow, run: string) =>
  process.run(Effect.gen(function*() {
    for (let waited = 0; waited < 2000; waited++) {
      const result = yield* W.poll(run)
      if (Option.isSome(result)) return result.value._tag === "Complete" ? "finished" as const : "parked" as const
      yield* tick()
    }
    return yield* Effect.die(new Error(`run ${run} neither parked nor finished`))
  }))

/** True when the run is parked and stays parked: it is given real time to finish and does not. */
export const parked = (process: Process, W: AnyWorkflow, run: string, forMillis = 25) =>
  process.run(Effect.gen(function*() {
    let suspended = false
    for (let waited = 0; waited < 2000; waited++) {
      const result = yield* W.poll(run)
      if (Option.isSome(result)) {
        if (result.value._tag === "Complete") return false
        suspended = true
        break
      }
      yield* tick()
    }
    if (!suspended) return yield* Effect.die(new Error(`run ${run} neither parked nor finished`))
    yield* tick(forMillis)
    const result = yield* W.poll(run)
    return Option.isSome(result) && result.value._tag === "Suspended"
  }))

/** The run's journal as `[eventType, step or deferred name]` pairs. */
export const journal = (process: Process, run: string) =>
  process.run(
    Stream.runCollect(Durable.history(run)).pipe(
      Effect.map((entries) =>
        Array.from(entries).map((entry) => {
          const payload = entry.payload as { readonly step?: string; readonly name?: string }
          return [entry.eventType, payload.step ?? payload.name ?? null] as const
        })
      )
    )
  )

/**
 * A store that stops answering at one write, as a database does when its
 * host dies mid-commit: the write of the first event `match` accepts never
 * returns, and `hung` resolves so the test can kill the process.
 */
export const hangingStore = (store: Durable.Store, match: (eventType: string, payload: unknown) => boolean) => {
  let armed = true
  let signal!: () => void
  const hung = new Promise<void>((resolve) => {
    signal = resolve
  })
  const faulty: Durable.Store = {
    ...store,
    commit: (run, commit, at) => {
      if (armed && commit.events.some((event) => match(event.eventType, event.payload))) {
        armed = false
        signal()
        return Effect.never
      }
      return store.commit(run, commit, at)
    }
  }
  return { store: faulty, hung }
}

/** A store whose next signal delivery is lost: the append dies, and nothing is written. */
export const droppingStore = (store: Durable.Store) => {
  let drop = true
  const faulty: Durable.Store = {
    ...store,
    append: (run, events, at) => {
      if (drop && events.some((event) => event.eventType === "DeferredDone")) {
        drop = false
        return Effect.die(new Error("the store is unreachable"))
      }
      return store.append(run, events, at)
    }
  }
  return faulty
}
