export default [
  {
    id: "conc-01-try-all-fanout",
    category: "structured-concurrency",
    title: "Parallel tuple fan-out with try.all",
    prompt: "Fetch user, permissions, and quota concurrently using try.all [fetchUser(), fetchPerms(), fetchQuota()] and return { user, perms, quota }.",
    features: ["try.all", "effect function"],
    expectedOutput: { user: "Ada", perms: ["read", "write"], quota: 100 },
    vibe: `effect function fetchUser() { return "Ada" }
effect function fetchPerms() { return ["read", "write"] }
effect function fetchQuota() { return 100 }

export effect function run() {
  const [user, perms, quota] = try.all [fetchUser(), fetchPerms(), fetchQuota()]
  return { user, perms, quota }
}
`,
    effectTs: `import { Effect } from "effect"

const fetchUser = () => Effect.succeed("Ada")
const fetchPerms = () => Effect.succeed(["read", "write"])
const fetchQuota = () => Effect.succeed(100)

export const run = () =>
  Effect.gen(function* () {
    const [user, perms, quota] = yield* Effect.all(
      [fetchUser(), fetchPerms(), fetchQuota()],
      { concurrency: "unbounded" }
    )
    return { user, perms, quota }
  })
`,
    fault: {
      description: "Reorders tuple elements when destructuring concurrent results",
      kind: "runtime-fail",
      vibe: `effect function fetchUser() { return "Ada" }
effect function fetchPerms() { return ["read", "write"] }
effect function fetchQuota() { return 100 }

export effect function run() {
  const [perms, user, quota] = try.all [fetchPerms(), fetchUser(), fetchQuota()]
  return { user: String(perms), perms: [user], quota }
}
`,
    },
  },
  {
    id: "conc-02-try-race-cancel",
    category: "structured-concurrency",
    title: "Structured race with automatic loser interruption",
    prompt: "Race a fast Effect against a slow sleeping Effect using try.race. Track loser cancellation via onInterrupt and return { winner: 'fast', loserInterrupted: true }.",
    features: ["try.race", "onInterrupt", "sleep"],
    expectedOutput: { winner: "fast", loserInterrupted: true },
    vibe: `export effect function run() {
  let loserInterrupted = false
  const fast = effect {
    try sleep("5 millis")
    return "fast"
  }
  const slow = onInterrupt(
    effect {
      try sleep("5 seconds")
      return "slow"
    },
    () => sync(() => { loserInterrupted = true })
  )
  const winner = try.race [fast, slow]
  return { winner, loserInterrupted }
}
`,
    effectTs: `import { Effect } from "effect"

export const run = () =>
  Effect.gen(function* () {
    let loserInterrupted = false
    const fast = Effect.gen(function* () {
      yield* Effect.sleep("5 millis")
      return "fast"
    })
    const slow = Effect.gen(function* () {
      yield* Effect.sleep("5 seconds")
      return "slow"
    }).pipe(Effect.onInterrupt(() => Effect.sync(() => { loserInterrupted = true })))
    const winner = yield* Effect.raceAllFirst([fast, slow])
    return { winner, loserInterrupted }
  })
`,
    fault: {
      description: "Runs sequentially instead of racing, never interrupting the slow fiber",
      kind: "runtime-fail",
      vibe: `export effect function run() {
  let loserInterrupted = false
  const winner = "fast"
  return { winner, loserInterrupted }
}
`,
    },
  },
  {
    id: "conc-03-try-all-settled",
    category: "structured-concurrency",
    title: "Partial failure collection with try.allSettled",
    prompt: "Run three tasks concurrently (succeed 10, fail BadItem, succeed 30) using try.allSettled so one failure does not abort the others. Return { successes: [10, 30], failures: 1 }.",
    features: ["try.allSettled", "match", "Exit.Success", "Exit.Failure"],
    expectedOutput: { successes: [10, 30], failures: 1 },
    vibe: `error BadItem { id: number }

effect function work(n: number): number!BadItem {
  if (n === 20) throw new BadItem({ id: n })
  return n
}

export effect function run() {
  const exits = try.allSettled [work(10), work(20), work(30)]
  const successes: number[] = []
  let failures = 0
  for (const ex of exits) {
    match (ex) {
      when Exit.Success(let v): successes.push(v);
      when Exit.Failure: failures++;
    }
  }
  return { successes, failures }
}
`,
    effectTs: `import { Data, Effect, Exit } from "effect"

class BadItem extends Data.TaggedError("BadItem")<{ readonly id: number }> {}

const work = (n: number): Effect.Effect<number, BadItem> =>
  n === 20 ? Effect.fail(new BadItem({ id: n })) : Effect.succeed(n)

export const run = () =>
  Effect.gen(function* () {
    const exits = yield* Effect.all(
      [Effect.exit(work(10)), Effect.exit(work(20)), Effect.exit(work(30))],
      { concurrency: "unbounded" }
    )
    const successes: number[] = []
    let failures = 0
    for (const ex of exits) {
      if (Exit.isSuccess(ex)) successes.push(ex.value)
      else failures++
    }
    return { successes, failures }
  })
`,
    fault: {
      description: "Uses try.all instead of try.allSettled, aborting the whole batch on one item error",
      kind: "runtime-fail",
      vibe: `error BadItem { id: number }

effect function work(n: number): number!BadItem {
  if (n === 20) throw new BadItem({ id: n })
  return n
}

export effect function run() {
  const values = try.all [work(10), work(20), work(30)]
  return { successes: values, failures: 0 }
}
`,
    },
  },
  {
    id: "conc-04-for-concurrent-bounded",
    category: "structured-concurrency",
    title: "Bounded worker pool with for concurrent(2)",
    prompt: "Process 6 items with for concurrent(2), tracking active and peak in-flight concurrency while sleeping 5 millis per item. Return { processed: 6, respectedBound: true } where respectedBound is peak <= 2.",
    features: ["for concurrent", "sleep"],
    expectedOutput: { processed: 6, respectedBound: true },
    vibe: `export effect function run() {
  const items = [1, 2, 3, 4, 5, 6]
  let active = 0
  let peak = 0
  let processed = 0
  for concurrent(2) (const item of items) {
    active++
    if (active > peak) peak = active
    try sleep("5 millis")
    processed += item > 0 ? 1 : 0
    active--
  }
  return { processed, respectedBound: peak <= 2 }
}
`,
    effectTs: `import { Effect } from "effect"

export const run = () =>
  Effect.gen(function* () {
    const items = [1, 2, 3, 4, 5, 6]
    let active = 0
    let peak = 0
    let processed = 0
    yield* Effect.forEach(
      items,
      (item) =>
        Effect.gen(function* () {
          active++
          if (active > peak) peak = active
          yield* Effect.sleep("5 millis")
          processed += item > 0 ? 1 : 0
          active--
        }),
      { concurrency: 2, discard: true }
    )
    return { processed, respectedBound: peak <= 2 }
  })
`,
    fault: {
      description: "Runs unbounded concurrency so peak exceeds the required limit of 2",
      kind: "runtime-fail",
      vibe: `export effect function run() {
  const items = [1, 2, 3, 4, 5, 6]
  let active = 0
  let peak = 0
  let processed = 0
  for concurrent (const item of items) {
    active++
    if (active > peak) peak = active
    try sleep("10 millis")
    processed += item > 0 ? 1 : 0
    active--
  }
  return { processed, respectedBound: peak <= 2 }
}
`,
    },
  },
  {
    id: "conc-05-fork-join-deferred",
    category: "structured-concurrency",
    title: "Child fiber fork, Deferred handshake, and join",
    prompt: "Create a Deferred<string>, fork a child fiber that waits on the Deferred and returns 'done:' + signal, complete the Deferred with 'go', and join the fiber.",
    features: ["fork", "join", "Deferred"],
    expectedOutput: { result: "done:go" },
    vibe: `export effect function run() {
  const gate = try Deferred.make<string>()
  const fiber = fork effect {
    const signal = try Deferred.await(gate)
    return \`done:\${signal}\`
  }
  try Deferred.succeed(gate, "go")
  const result = join fiber
  return { result }
}
`,
    effectTs: `import { Deferred, Effect, Fiber } from "effect"

export const run = () =>
  Effect.gen(function* () {
    const gate = yield* Deferred.make<string>()
    const fiber = yield* Effect.forkChild(
      Effect.gen(function* () {
        const signal = yield* Deferred.await(gate)
        return \`done:\${signal}\`
      })
    )
    yield* Deferred.succeed(gate, "go")
    const result = yield* Fiber.join(fiber)
    return { result }
  })
`,
    fault: {
      description: "Uses Promise await inside an effect function instead of try/join",
      kind: "compile-error",
      expectedPattern: "EK",
      vibe: `export effect function run() {
  const value = await Promise.resolve("go")
  return { result: value }
}
`,
    },
  },
]
