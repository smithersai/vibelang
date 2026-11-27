export default [
  {
    id: "err-01-tagged-fallback",
    category: "typed-errors",
    title: "Tagged error fallback recovery",
    prompt: "Define tagged error NotFound { id: string }. Write findName(id) that returns 'Ada' for '1' and fails with NotFound otherwise. In run(), recover missing id '99' to 'Guest' while keeping found '1' as 'Ada', returning { found, fallback }.",
    features: ["error", "throw", "catch"],
    expectedOutput: { found: "Ada", fallback: "Guest" },
    vibe: `error NotFound { id: string }

effect function findName(id: string): string!NotFound {
  if (id === "1") return "Ada"
  throw new NotFound({ id })
}

export effect function run() {
  const found = findName("1") catch () => "Guest"
  const fallback = findName("99") catch () => "Guest"
  return { found, fallback }
}
`,
    effectTs: `import { Data, Effect } from "effect"

class NotFound extends Data.TaggedError("NotFound")<{ readonly id: string }> {}

const findName = (id: string): Effect.Effect<string, NotFound> =>
  id === "1" ? Effect.succeed("Ada") : Effect.fail(new NotFound({ id }))

export const run = (): Effect.Effect<{ found: string; fallback: string }> =>
  Effect.gen(function* () {
    const found = yield* findName("1").pipe(Effect.catch(() => Effect.succeed("Guest")))
    const fallback = yield* findName("99").pipe(Effect.catch(() => Effect.succeed("Guest")))
    return { found, fallback }
  })
`,
    fault: {
      description: "Throws inside a plain catch handler instead of using catch effect (EK0401)",
      kind: "compile-error",
      expectedPattern: "EK0401",
      vibe: `error NotFound { id: string }
error Fatal { id: string }

effect function findName(id: string): string!NotFound {
  throw new NotFound({ id })
}

export effect function run() {
  return findName("99") catch (e) => { throw new Fatal({ id: e.id }) }
}
`,
    },
  },
  {
    id: "err-02-selective-match",
    category: "typed-errors",
    title: "Selective tagged error matching without swallowing",
    prompt: "Given NotFound, RateLimited { retryAfter: number }, and AuthDenied { role: string }, recover NotFound -> 'missing' and RateLimited -> 'retry:<n>', while re-throwing AuthDenied typed. Return an array of outcomes for all three error cases.",
    features: ["error", "catch effect", "match", "throw"],
    expectedOutput: ["missing", "retry:5", "denied:guest"],
    vibe: `error NotFound { id: string }
error RateLimited { retryAfter: number }
error AuthDenied { role: string }

effect function callApi(kind: "nf" | "rl" | "auth"): string!(NotFound | RateLimited | AuthDenied) {
  if (kind === "nf") throw new NotFound({ id: "u1" })
  if (kind === "rl") throw new RateLimited({ retryAfter: 5 })
  throw new AuthDenied({ role: "guest" })
}

effect function handle(kind: "nf" | "rl" | "auth"): string!AuthDenied {
  return callApi(kind) catch effect (e) => match (e) {
    when NotFound: "missing";
    when RateLimited: \`retry:\${e.retryAfter}\`;
    default: throw e;
  }
}

export effect function run() {
  const a = handle("nf") catch (e) => \`denied:\${e.role}\`
  const b = handle("rl") catch (e) => \`denied:\${e.role}\`
  const c = handle("auth") catch (e) => \`denied:\${e.role}\`
  return [a, b, c]
}
`,
    effectTs: `import { Data, Effect } from "effect"

class NotFound extends Data.TaggedError("NotFound")<{ readonly id: string }> {}
class RateLimited extends Data.TaggedError("RateLimited")<{ readonly retryAfter: number }> {}
class AuthDenied extends Data.TaggedError("AuthDenied")<{ readonly role: string }> {}

const callApi = (kind: "nf" | "rl" | "auth"): Effect.Effect<string, NotFound | RateLimited | AuthDenied> =>
  kind === "nf"
    ? Effect.fail(new NotFound({ id: "u1" }))
    : kind === "rl"
      ? Effect.fail(new RateLimited({ retryAfter: 5 }))
      : Effect.fail(new AuthDenied({ role: "guest" }))

const handle = (kind: "nf" | "rl" | "auth"): Effect.Effect<string, AuthDenied> =>
  callApi(kind).pipe(
    Effect.catch((e) => {
      if (e._tag === "NotFound") return Effect.succeed("missing")
      if (e._tag === "RateLimited") return Effect.succeed(\`retry:\${e.retryAfter}\`)
      return Effect.fail(e)
    })
  )

export const run = (): Effect.Effect<readonly string[]> =>
  Effect.gen(function* () {
    const a = yield* handle("nf").pipe(Effect.catch((e) => Effect.succeed(\`denied:\${e.role}\`)))
    const b = yield* handle("rl").pipe(Effect.catch((e) => Effect.succeed(\`denied:\${e.role}\`)))
    const c = yield* handle("auth").pipe(Effect.catch((e) => Effect.succeed(\`denied:\${e.role}\`)))
    return [a, b, c]
  })
`,
    fault: {
      description: "Swallows AuthDenied into a generic string instead of re-throwing typed error",
      kind: "runtime-fail",
      vibe: `error NotFound { id: string }
error RateLimited { retryAfter: number }
error AuthDenied { role: string }

effect function callApi(kind: "nf" | "rl" | "auth"): string!(NotFound | RateLimited | AuthDenied) {
  if (kind === "nf") throw new NotFound({ id: "u1" })
  if (kind === "rl") throw new RateLimited({ retryAfter: 5 })
  throw new AuthDenied({ role: "guest" })
}

export effect function run() {
  const a = callApi("nf") catch () => "missing"
  const b = callApi("rl") catch () => "retry:5"
  const c = callApi("auth") catch () => "swallowed"
  return [a, b, c]
}
`,
    },
  },
  {
    id: "err-03-retry-transient",
    category: "typed-errors",
    title: "Retry transient failures without retrying permanent errors",
    prompt: "Retry an operation up to 3 times ONLY when it fails with Unavailable; fail immediately on InvalidInput without retrying. Return { okValue, transientAttempts, permanentAttempts }.",
    features: ["error", "retry", "while"],
    expectedOutput: { okValue: "ok-on-3", transientAttempts: 3, permanentAttempts: 1 },
    vibe: `error Unavailable { attempt: number }
error InvalidInput { field: string }

export effect function run() {
  let transientAttempts = 0
  const flaky = effect {
    transientAttempts++
    if (transientAttempts < 3) throw new Unavailable({ attempt: transientAttempts })
    return \`ok-on-\${transientAttempts}\`
  }
  const okValue = try retry(flaky, {
    times: 3,
    while: (e) => e instanceof Unavailable,
  })

  let permanentAttempts = 0
  const bad = effect {
    permanentAttempts++
    throw new InvalidInput({ field: "email" })
  }
  const _ignored = retry(bad, {
    times: 3,
    while: (e) => e instanceof Unavailable,
  }) catch () => "stopped"

  return { okValue, transientAttempts, permanentAttempts }
}
`,
    effectTs: `import { Data, Effect } from "effect"

class Unavailable extends Data.TaggedError("Unavailable")<{ readonly attempt: number }> {}
class InvalidInput extends Data.TaggedError("InvalidInput")<{ readonly field: string }> {}

export const run = (): Effect.Effect<{ okValue: string; transientAttempts: number; permanentAttempts: number }, Unavailable> =>
  Effect.gen(function* () {
    let transientAttempts = 0
    const flaky = Effect.suspend(() => {
      transientAttempts++
      if (transientAttempts < 3) return Effect.fail(new Unavailable({ attempt: transientAttempts }))
      return Effect.succeed(\`ok-on-\${transientAttempts}\`)
    })
    const okValue = yield* Effect.retry(flaky, {
      times: 3,
      while: (e) => e instanceof Unavailable,
    })

    let permanentAttempts = 0
    const bad = Effect.suspend(() => {
      permanentAttempts++
      return Effect.fail(new InvalidInput({ field: "email" }))
    })
    yield* Effect.retry(bad, {
      times: 3,
      while: (e) => e instanceof Unavailable,
    }).pipe(Effect.catch(() => Effect.succeed("stopped")))

    return { okValue, transientAttempts, permanentAttempts }
  })
`,
    fault: {
      description: "Retries unconditionally, causing permanent InvalidInput to run 4 times instead of 1",
      kind: "runtime-fail",
      vibe: `error Unavailable { attempt: number }
error InvalidInput { field: string }

export effect function run() {
  let transientAttempts = 0
  const flaky = effect {
    transientAttempts++
    if (transientAttempts < 3) throw new Unavailable({ attempt: transientAttempts })
    return \`ok-on-\${transientAttempts}\`
  }
  const okValue = try retry(flaky, { times: 3 })

  let permanentAttempts = 0
  const bad = effect {
    permanentAttempts++
    throw new InvalidInput({ field: "email" })
  }
  const _ignored = retry(bad, { times: 3 }) catch () => "stopped"
  return { okValue, transientAttempts, permanentAttempts }
}
`,
    },
  },
  {
    id: "err-04-error-enrichment",
    category: "typed-errors",
    title: "Domain error enrichment across boundaries",
    prompt: "Wrap low-level ParseFailure { raw } into domain ConfigError { key, detail } preserving context via catch effect, returning { key, detail } for a bad integer config.",
    features: ["error", "catch effect", "throw"],
    expectedOutput: { key: "PORT", detail: "bad-int:abc" },
    vibe: `error ParseFailure { raw: string }
error ConfigError { key: string; detail: string }

effect function parseIntStrict(raw: string): number!ParseFailure {
  if (!/^\\d+$/.test(raw)) throw new ParseFailure({ raw })
  return Number(raw)
}

effect function readPort(key: string, raw: string): number!ConfigError {
  return parseIntStrict(raw) catch effect (e) => {
    throw new ConfigError({ key, detail: \`bad-int:\${e.raw}\` })
  }
}

export effect function run() {
  return readPort("PORT", "abc") catch (e) => ({ key: e.key, detail: e.detail })
}
`,
    effectTs: `import { Data, Effect } from "effect"

class ParseFailure extends Data.TaggedError("ParseFailure")<{ readonly raw: string }> {}
class ConfigError extends Data.TaggedError("ConfigError")<{ readonly key: string; readonly detail: string }> {}

const parseIntStrict = (raw: string): Effect.Effect<number, ParseFailure> =>
  /^\\d+$/.test(raw) ? Effect.succeed(Number(raw)) : Effect.fail(new ParseFailure({ raw }))

const readPort = (key: string, raw: string): Effect.Effect<number, ConfigError> =>
  parseIntStrict(raw).pipe(
    Effect.catch((e) => Effect.fail(new ConfigError({ key, detail: \`bad-int:\${e.raw}\` })))
  )

export const run = (): Effect.Effect<number | { key: string; detail: string }> =>
  readPort("PORT", "abc").pipe(
    Effect.catch((e) => Effect.succeed({ key: e.key, detail: e.detail }))
  )
`,
    fault: {
      description: "Throws inside a synchronous plain helper instead of declaring it effect (EK0401)",
      kind: "compile-error",
      expectedPattern: "EK0401",
      vibe: `error ParseFailure { raw: string }

function parseIntStrict(raw: string): number {
  if (!/^\\d+$/.test(raw)) throw new ParseFailure({ raw })
  return Number(raw)
}

export effect function run() {
  return parseIntStrict("42")
}
`,
    },
  },
  {
    id: "err-05-exit-inspection",
    category: "typed-errors",
    title: "Structured Exit inspection with exhaustive match",
    prompt: "Run two operations through exit() and match Exit.Success vs Exit.Failure to return structured audit records [{ status: 'ok', value: 42 }, { status: 'failed', empty: false }].",
    features: ["exit", "match", "Exit.Success", "Exit.Failure"],
    expectedOutput: [
      { status: "ok", value: 42 },
      { status: "failed", empty: false },
    ],
    vibe: `error Boom { code: number }

effect function compute(fail: boolean): number!Boom {
  if (fail) throw new Boom({ code: 500 })
  return 42
}

effect function audit(fail: boolean) {
  const outcome = try exit(compute(fail))
  return match (outcome) {
    when Exit.Success(let value): { status: "ok", value };
    when Exit.Failure(let cause): { status: "failed", empty: cause.reasons.length === 0 };
  }
}

export effect function run() {
  return [try audit(false), try audit(true)]
}
`,
    effectTs: `import { Data, Effect, Exit } from "effect"

class Boom extends Data.TaggedError("Boom")<{ readonly code: number }> {}

const compute = (fail: boolean): Effect.Effect<number, Boom> =>
  fail ? Effect.fail(new Boom({ code: 500 })) : Effect.succeed(42)

const audit = (fail: boolean) =>
  Effect.gen(function* () {
    const outcome = yield* Effect.exit(compute(fail))
    if (Exit.isSuccess(outcome)) {
      return { status: "ok" as const, value: outcome.value }
    }
    return { status: "failed" as const, empty: outcome.cause.reasons.length === 0 }
  })

export const run = () =>
  Effect.gen(function* () {
    return [yield* audit(false), yield* audit(true)]
  })
`,
    fault: {
      description: "Uses try expression outside an effect function (EK0501)",
      kind: "compile-error",
      expectedPattern: "EK0501",
      vibe: `function bad() {
  return try Effect.succeed(42)
}
export effect function run() {
  return bad()
}
`,
    },
  },
]
