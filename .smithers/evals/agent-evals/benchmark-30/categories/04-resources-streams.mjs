export default [
  {
    id: "res-01-scoped-acquire-release",
    category: "resources-streams",
    title: "Scoped acquireRelease cleanup on success and typed error",
    prompt: "Acquire a handle inside scoped(effect { ... }) using acquireRelease. Run both a succeeding operation and a failing operation, returning the lifecycle log proving release ran in both cases.",
    features: ["scoped", "acquireRelease", "error", "catch"],
    expectedOutput: {
      okEvents: ["acquire:h1", "use:h1", "release:h1"],
      errEvents: ["acquire:h2", "release:h2"],
      errTag: "WorkFailed",
    },
    vibe: `error WorkFailed { reason: string }

effect function withHandle(name: string, shouldFail: boolean, log: string[]): string!WorkFailed {
  return try scoped(effect {
    const h = try acquireRelease(
      effect {
        log.push(\`acquire:\${name}\`)
        return name
      },
      (id) => sync(() => { log.push(\`release:\${id}\`) })
    )
    if (shouldFail) throw new WorkFailed({ reason: "boom" })
    log.push(\`use:\${h}\`)
    return h
  })
}

export effect function run() {
  const okEvents: string[] = []
  const errEvents: string[] = []
  const _ok = try withHandle("h1", false, okEvents)
  const errTag = withHandle("h2", true, errEvents) catch (e) => e._tag
  return { okEvents, errEvents, errTag }
}
`,
    effectTs: `import { Data, Effect } from "effect"

class WorkFailed extends Data.TaggedError("WorkFailed")<{ readonly reason: string }> {}

const withHandle = (name: string, shouldFail: boolean, log: string[]): Effect.Effect<string, WorkFailed> =>
  Effect.scoped(
    Effect.gen(function* () {
      const h = yield* Effect.acquireRelease(
        Effect.sync(() => {
          log.push(\`acquire:\${name}\`)
          return name
        }),
        (id) => Effect.sync(() => { log.push(\`release:\${id}\`) })
      )
      if (shouldFail) return yield* Effect.fail(new WorkFailed({ reason: "boom" }))
      log.push(\`use:\${h}\`)
      return h
    })
  )

export const run = () =>
  Effect.gen(function* () {
    const okEvents: string[] = []
    const errEvents: string[] = []
    yield* withHandle("h1", false, okEvents)
    const errTag = yield* withHandle("h2", true, errEvents).pipe(Effect.catch((e) => Effect.succeed(e._tag)))
    return { okEvents, errEvents, errTag }
  })
`,
    fault: {
      description: "Manually releases only on the happy path so typed failure leaks the handle",
      kind: "runtime-fail",
      vibe: `error WorkFailed { reason: string }

effect function withHandle(name: string, shouldFail: boolean, log: string[]): string!WorkFailed {
  log.push(\`acquire:\${name}\`)
  if (shouldFail) throw new WorkFailed({ reason: "boom" })
  log.push(\`use:\${name}\`)
  log.push(\`release:\${name}\`)
  return name
}

export effect function run() {
  const okEvents: string[] = []
  const errEvents: string[] = []
  const _ok = try withHandle("h1", false, okEvents)
  const errTag = withHandle("h2", true, errEvents) catch (e) => e._tag
  return { okEvents, errEvents, errTag }
}
`,
    },
  },
  {
    id: "res-02-lifo-nested-resources",
    category: "resources-streams",
    title: "LIFO finalizer order for nested acquired resources",
    prompt: "Acquire 'db' then 'tx' inside one scoped block and fail with TxAborted. Verify finalizers run in strict LIFO order ['acquire:db', 'acquire:tx', 'release:tx', 'release:db'].",
    features: ["scoped", "acquireRelease", "error"],
    expectedOutput: {
      events: ["acquire:db", "acquire:tx", "release:tx", "release:db"],
      outcome: "aborted",
    },
    vibe: `error TxAborted { code: string }

export effect function run() {
  const events: string[] = []
  const work = scoped(effect {
    const _db = try acquireRelease(
      sync(() => { events.push("acquire:db"); return "db" }),
      () => sync(() => { events.push("release:db") })
    )
    const _tx = try acquireRelease(
      sync(() => { events.push("acquire:tx"); return "tx" }),
      () => sync(() => { events.push("release:tx") })
    )
    throw new TxAborted({ code: "rollback" })
  })
  const outcome = work catch () => "aborted"
  return { events, outcome }
}
`,
    effectTs: `import { Data, Effect } from "effect"

class TxAborted extends Data.TaggedError("TxAborted")<{ readonly code: string }> {}

export const run = () =>
  Effect.gen(function* () {
    const events: string[] = []
    const work = Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => { events.push("acquire:db"); return "db" }),
          () => Effect.sync(() => { events.push("release:db") })
        )
        yield* Effect.acquireRelease(
          Effect.sync(() => { events.push("acquire:tx"); return "tx" }),
          () => Effect.sync(() => { events.push("release:tx") })
        )
        return yield* Effect.fail(new TxAborted({ code: "rollback" }))
      })
    )
    const outcome = yield* work.pipe(Effect.catch(() => Effect.succeed("aborted")))
    return { events, outcome }
  })
`,
    fault: {
      description: "Releases resources in FIFO order instead of LIFO",
      kind: "runtime-fail",
      vibe: `export effect function run() {
  return {
    events: ["acquire:db", "acquire:tx", "release:db", "release:tx"],
    outcome: "aborted",
  }
}
`,
    },
  },
  {
    id: "res-03-uninterruptible-restore",
    category: "resources-streams",
    title: "Uninterruptible region with selective restore block",
    prompt: "Inside uninterruptible { ... }, record 'enter', run an interruptible step inside restore { ... } recording 'restored', then record 'commit' before returning the ordered steps.",
    features: ["uninterruptible", "restore"],
    expectedOutput: { steps: ["enter", "restored", "commit"] },
    vibe: `export effect function run() {
  const steps: string[] = []
  uninterruptible {
    steps.push("enter")
    restore {
      try sleep("1 millis")
      steps.push("restored")
    }
    steps.push("commit")
  }
  return { steps }
}
`,
    effectTs: `import { Effect } from "effect"

export const run = () =>
  Effect.gen(function* () {
    const steps: string[] = []
    yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        steps.push("enter")
        yield* restore(
          Effect.gen(function* () {
            yield* Effect.sleep("1 millis")
            steps.push("restored")
          })
        )
        steps.push("commit")
      })
    )
    return { steps }
  })
`,
    fault: {
      description: "Places restore { } outside an enclosing uninterruptible { } block",
      kind: "compile-error",
      expectedPattern: "EK",
      vibe: `export effect function run() {
  restore {
    try sleep("1 millis")
  }
  return { steps: [] }
}
`,
    },
  },
  {
    id: "res-04-producer-stream",
    category: "resources-streams",
    title: "Effect producer stream consumed with for try, continue, and break",
    prompt: "Write an effect function* integers(max: number) producer yielding 1..max. Consume it with for try, skipping odd numbers (continue) and stopping once collected length reaches 3 (break), returning { collected: [2, 4, 6] }.",
    features: ["effect function*", "yield", "for try", "continue", "break"],
    expectedOutput: { collected: [2, 4, 6] },
    vibe: `effect function* integers(max: number) {
  for (let i = 1; i <= max; i++) {
    yield i
  }
}

export effect function run() {
  const collected: number[] = []
  for try (const n of integers(20)) {
    if (n % 2 !== 0) continue
    collected.push(n)
    if (collected.length === 3) break
  }
  return { collected }
}
`,
    effectTs: `import { Effect, Stream } from "effect"

const integers = (max: number): Stream.Stream<number> =>
  Stream.fromIterable(Array.from({ length: max }, (_, i) => i + 1))

export const run = () =>
  Effect.gen(function* () {
    const collected: number[] = []
    yield* Stream.runForEachWhile(integers(20), (n) =>
      Effect.sync(() => {
        if (n % 2 !== 0) return true
        collected.push(n)
        return collected.length < 3
      })
    )
    return { collected }
  })
`,
    fault: {
      description: "Returns a value from an effect function* producer (EK2128)",
      kind: "compile-error",
      expectedPattern: "EK2128",
      vibe: `effect function* bad() {
  yield 1
  return 2
}

export effect function run() {
  for try (const _x of bad()) {}
  return { collected: [] }
}
`,
    },
  },
  {
    id: "res-05-ensuring-cleanup",
    category: "resources-streams",
    title: "Guaranteed finalizer with ensuring instead of JS try/finally",
    prompt: "Run a failing Effect wrapped with ensuring so cleanup records 'cleaned:true' before the error is caught as 'failed:boom'. Return { result, log }.",
    features: ["ensuring", "error", "catch"],
    expectedOutput: { result: "failed:boom", log: ["work", "cleaned:true"] },
    vibe: `error TaskErr { msg: string }

export effect function run() {
  const log: string[] = []
  const work = ensuring(
    effect {
      log.push("work")
      throw new TaskErr({ msg: "boom" })
    },
    sync(() => { log.push("cleaned:true") })
  )
  const result = work catch (e) => \`failed:\${e.msg}\`
  return { result, log }
}
`,
    effectTs: `import { Data, Effect } from "effect"

class TaskErr extends Data.TaggedError("TaskErr")<{ readonly msg: string }> {}

export const run = () =>
  Effect.gen(function* () {
    const log: string[] = []
    const work = Effect.gen(function* () {
      log.push("work")
      return yield* Effect.fail(new TaskErr({ msg: "boom" }))
    }).pipe(Effect.ensuring(Effect.sync(() => { log.push("cleaned:true") })))
    const result = yield* work.pipe(Effect.catch((e) => Effect.succeed(\`failed:\${e.msg}\`)))
    return { result, log }
  })
`,
    fault: {
      description: "Writes a JavaScript try/finally statement inside an effect function",
      kind: "compile-error",
      expectedPattern: "EK",
      vibe: `export effect function run() {
  const log: string[] = []
  try {
    log.push("work")
  } finally {
    log.push("cleaned:true")
  }
  return { result: "ok", log }
}
`,
    },
  },
]
