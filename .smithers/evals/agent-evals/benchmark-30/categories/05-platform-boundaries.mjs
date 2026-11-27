export default [
  {
    id: "plat-01-json-parse-bridge",
    category: "platform-boundaries",
    title: "Wrap throwing JSON.parse via Effect.try into a typed error",
    prompt: "Write safeParse(raw) that wraps JSON.parse(raw) via Effect.try mapping failures into InvalidJson { raw }. Return { ok: safeParse('{\"a\":1}'), bad: safeParse('{bad') catch (e) => e._tag }.",
    features: ["Effect.try", "error", "catch"],
    expectedOutput: { ok: { a: 1 }, bad: "InvalidJson" },
    vibe: `error InvalidJson { raw: string }

effect function safeParse(raw: string): unknown!InvalidJson {
  return try Effect.try({
    try: () => JSON.parse(raw) as unknown,
    catch: () => new InvalidJson({ raw }),
  })
}

export effect function run() {
  const ok = try safeParse('{"a":1}')
  const bad = safeParse("{bad") catch (e) => e._tag
  return { ok, bad }
}
`,
    effectTs: `import { Data, Effect } from "effect"

class InvalidJson extends Data.TaggedError("InvalidJson")<{ readonly raw: string }> {}

const safeParse = (raw: string): Effect.Effect<unknown, InvalidJson> =>
  Effect.try({
    try: () => JSON.parse(raw) as unknown,
    catch: () => new InvalidJson({ raw }),
  })

export const run = () =>
  Effect.gen(function* () {
    const ok = yield* safeParse('{"a":1}')
    const bad = yield* safeParse("{bad").pipe(Effect.catch((e) => Effect.succeed(e._tag)))
    return { ok, bad }
  })
`,
    fault: {
      description: "Calls throwing JSON.parse directly in effect code without Effect.try (EK0403)",
      kind: "compile-error",
      expectedPattern: "EK0403",
      vibe: `export effect function run() {
  return JSON.parse('{"a":1}')
}
`,
    },
  },
  {
    id: "plat-02-module-throws-boundary",
    category: "platform-boundaries",
    title: "Typed throwing TypeScript module block (VIP-40) bridged into Effect",
    prompt: "Declare a local module boundary { /** @throws {RangeError} */ export function parsePort(raw: string): number { ... } }, import parsePort from boundary, wrap it with Effect.try, and return { valid: 8080, invalid: 'RangeError' }.",
    features: ["module", "@throws", "Effect.try"],
    expectedOutput: { valid: 8080, invalid: "RangeError" },
    vibe: `module boundary {
  /** @throws {RangeError} */
  export function parsePort(raw: string): number {
    if (!/^\\d+$/.test(raw)) throw new RangeError(raw)
    const n = Number(raw)
    if (n < 1 || n > 65535) throw new RangeError(raw)
    return n
  }
}

import { parsePort } from boundary

error BadPort { reason: string }

effect function loadPort(raw: string): number!BadPort {
  return try Effect.try({
    try: () => parsePort(raw),
    catch: (e) => new BadPort({ reason: e instanceof RangeError ? "RangeError" : "Other" }),
  })
}

export effect function run() {
  const valid = try loadPort("8080")
  const invalid = loadPort("99999") catch (e) => e.reason
  return { valid, invalid }
}
`,
    effectTs: `import { Data, Effect } from "effect"

function parsePort(raw: string): number {
  if (!/^\\d+$/.test(raw)) throw new RangeError(raw)
  const n = Number(raw)
  if (n < 1 || n > 65535) throw new RangeError(raw)
  return n
}

class BadPort extends Data.TaggedError("BadPort")<{ readonly reason: string }> {}

const loadPort = (raw: string): Effect.Effect<number, BadPort> =>
  Effect.try({
    try: () => parsePort(raw),
    catch: (e) => new BadPort({ reason: e instanceof RangeError ? "RangeError" : "Other" }),
  })

export const run = () =>
  Effect.gen(function* () {
    const valid = yield* loadPort("8080")
    const invalid = yield* loadPort("99999").pipe(Effect.catch((e) => Effect.succeed(e.reason)))
    return { valid, invalid }
  })
`,
    fault: {
      description: "Throws RangeError directly inside a plain Vibe function outside a module block (EK0401)",
      kind: "compile-error",
      expectedPattern: "EK0401",
      vibe: `function parsePort(raw: string): number {
  if (!/^\\d+$/.test(raw)) throw new RangeError(raw)
  return Number(raw)
}

export effect function run() {
  return parsePort("8080")
}
`,
    },
  },
  {
    id: "plat-03-config-provider-no-process",
    category: "platform-boundaries",
    title: "Effect Config + ConfigProvider instead of ambient process.env",
    prompt: "Read APP_ENV (default 'dev') and APP_REGION (default 'us-east') using Config.withDefault(Config.String(...), ...) provided via ConfigProvider.layer(ConfigProvider.fromUnknown({ APP_ENV: 'staging' })). Return { env: 'staging', region: 'us-east' }.",
    features: ["Config", "ConfigProvider", "provide"],
    expectedOutput: { env: "staging", region: "us-east" },
    vibe: `export effect function run() {
  const provider = ConfigProvider.layer(ConfigProvider.fromUnknown({ APP_ENV: "staging" }))
  provide provider {
    const env = try Config.withDefault(Config.String("APP_ENV"), "dev")
    const region = try Config.withDefault(Config.String("APP_REGION"), "us-east")
    return { env, region }
  }
}
`,
    effectTs: `import { Config, ConfigProvider, Effect } from "effect"

export const run = () => {
  const provider = ConfigProvider.layer(ConfigProvider.fromUnknown({ APP_ENV: "staging" }))
  return Effect.gen(function* () {
    const env = yield* Config.withDefault(Config.String("APP_ENV"), "dev")
    const region = yield* Config.withDefault(Config.String("APP_REGION"), "us-east")
    return { env, region }
  }).pipe(Effect.provide(provider))
}
`,
    fault: {
      description: "Reads ambient Node global process.env directly in a .vibe file (EK4402)",
      kind: "compile-error",
      expectedPattern: "EK4402",
      vibe: `export effect function run() {
  return { env: process.env.APP_ENV ?? "dev" }
}
`,
    },
  },
  {
    id: "plat-04-deterministic-clock-service",
    category: "platform-boundaries",
    title: "Injectable Clock service instead of ambient Date.now()",
    prompt: "Provide a deterministic Clock.Clock implementation fixed at 1700000000000 ms, read Clock.currentTimeMillis, and return { timestamp: 1700000000000 }.",
    features: ["Clock", "provide"],
    expectedOutput: { timestamp: 1700000000000 },
    vibe: `export effect function run() {
  const fixedClock: Clock.Clock = {
    currentTimeMillisUnsafe: () => 1700000000000,
    currentTimeMillis: Effect.succeed(1700000000000),
    monotonicTimeNanosUnsafe: () => 1700000000000000000n,
    monotonicTimeNanos: Effect.succeed(1700000000000000000n),
    currentTimeNanosUnsafe: () => 1700000000000000000n,
    currentTimeNanos: Effect.succeed(1700000000000000000n),
    sleep: () => Effect.void,
  }
  provide Clock.Clock = fixedClock {
    const timestamp = try Clock.currentTimeMillis
    return { timestamp }
  }
}
`,
    effectTs: `import { Clock, Effect } from "effect"

export const run = () => {
  const fixedClock: Clock.Clock = {
    currentTimeMillisUnsafe: () => 1700000000000,
    currentTimeMillis: Effect.succeed(1700000000000),
    monotonicTimeNanosUnsafe: () => 1700000000000000000n,
    monotonicTimeNanos: Effect.succeed(1700000000000000000n),
    currentTimeNanosUnsafe: () => 1700000000000000000n,
    currentTimeNanos: Effect.succeed(1700000000000000000n),
    sleep: () => Effect.void,
  }
  return Effect.gen(function* () {
    const timestamp = yield* Clock.currentTimeMillis
    return { timestamp }
  }).pipe(Effect.provideService(Clock.Clock, fixedClock))
}
`,
    fault: {
      description: "Imports node:fs directly inside a .vibe module instead of using Effect services (EK4402)",
      kind: "compile-error",
      expectedPattern: "EK4402",
      vibe: `import * as fs from "node:fs"

export effect function run() {
  return { hasRead: typeof fs.readFileSync === "function" }
}
`,
    },
  },
  {
    id: "plat-05-promise-bridge-typed",
    category: "platform-boundaries",
    title: "Bridge Promise-returning boundary SDK with tryPromise",
    prompt: "Wrap a Promise-returning function fetchToken(id) using tryPromise mapping rejections into UpstreamError { id, message }. Return { ok: 'tok:1', failed: 'UpstreamError:bad' }.",
    features: ["tryPromise", "error", "catch"],
    expectedOutput: { ok: "tok:1", failed: "UpstreamError:bad" },
    vibe: `error UpstreamError { id: string; message: string }

function fetchToken(id: string): Promise<string> {
  return id === "1" ? Promise.resolve("tok:1") : Promise.reject("bad")
}

effect function getToken(id: string): string!UpstreamError {
  return try tryPromise({
    try: () => fetchToken(id),
    catch: (cause) => new UpstreamError({ id, message: String(cause) }),
  })
}

export effect function run() {
  const ok = try getToken("1")
  const failed = getToken("2") catch (e) => \`\${e._tag}:\${e.message}\`
  return { ok, failed }
}
`,
    effectTs: `import { Data, Effect } from "effect"

class UpstreamError extends Data.TaggedError("UpstreamError")<{ readonly id: string; readonly message: string }> {}

function fetchToken(id: string): Promise<string> {
  return id === "1" ? Promise.resolve("tok:1") : Promise.reject("bad")
}

const getToken = (id: string): Effect.Effect<string, UpstreamError> =>
  Effect.tryPromise({
    try: () => fetchToken(id),
    catch: (cause) => new UpstreamError({ id, message: String(cause) }),
  })

export const run = () =>
  Effect.gen(function* () {
    const ok = yield* getToken("1")
    const failed = yield* getToken("2").pipe(Effect.catch((e) => Effect.succeed(\`\${e._tag}:\${e.message}\`)))
    return { ok, failed }
  })
`,
    fault: {
      description: "Uses await on a Promise directly inside an effect function instead of tryPromise",
      kind: "compile-error",
      expectedPattern: "EK",
      vibe: `function fetchToken(id: string): Promise<string> {
  return Promise.resolve(\`tok:\${id}\`)
}

export effect function run() {
  const ok = await fetchToken("1")
  return { ok }
}
`,
    },
  },
]
