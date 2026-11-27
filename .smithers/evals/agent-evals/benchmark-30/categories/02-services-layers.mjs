export default [
  {
    id: "svc-01-di-lookup",
    category: "services-layers",
    title: "Service declaration, Layer.succeed, and provide block",
    prompt: "Declare service GreetingStore { get(key: string): string!MissingKey }. Provide a Layer.succeed implementation returning 'Hello, Ada' for 'ada' and return the fetched greeting.",
    features: ["service", "Layer.succeed", "provide", "try"],
    expectedOutput: { greeting: "Hello, Ada" },
    vibe: `error MissingKey { key: string }

service GreetingStore {
  get(key: string): string!MissingKey
}

const StoreLive = Layer.succeed(GreetingStore, {
  get: effect (key: string) => {
    if (key === "ada") return "Hello, Ada"
    throw new MissingKey({ key })
  },
})

effect function greet(key: string) {
  const store = try GreetingStore
  return try store.get(key)
}

export effect function run() {
  provide StoreLive {
    const greeting = try greet("ada")
    return { greeting }
  }
}
`,
    effectTs: `import { Context, Data, Effect, Layer } from "effect"

class MissingKey extends Data.TaggedError("MissingKey")<{ readonly key: string }> {}

class GreetingStore extends Context.Service<GreetingStore, {
  get(key: string): Effect.Effect<string, MissingKey>
}>()("eval/GreetingStore") {}

const StoreLive = Layer.succeed(GreetingStore, {
  get: (key: string) =>
    key === "ada" ? Effect.succeed("Hello, Ada") : Effect.fail(new MissingKey({ key })),
})

const greet = (key: string) =>
  Effect.gen(function* () {
    const store = yield* GreetingStore
    return yield* store.get(key)
  })

export const run = () =>
  Effect.gen(function* () {
    const greeting = yield* greet("ada")
    return { greeting }
  }).pipe(Effect.provide(StoreLive))
`,
    fault: {
      description: "Instantiates a service key with new Users() instead of reading it via try (EK3003)",
      kind: "compile-error",
      expectedPattern: "EK3003",
      vibe: `service Users {
  find(id: string): string!!
}

export effect function run() {
  const u = new Users()
  return u
}
`,
    },
  },
  {
    id: "svc-02-composed-layers",
    category: "services-layers",
    title: "Composed dependent layers with Layer.effect",
    prompt: "Define Prefix service and Formatter service whose Layer.effect reads Prefix. Compose them with Layer.provideMerge and format 'ready' as '[SYS] ready'.",
    features: ["service", "Layer.effect", "Layer.provideMerge", "provide"],
    expectedOutput: { formatted: "[SYS] ready" },
    vibe: `service Prefix {
  readonly value: string
}

service Formatter {
  format(msg: string): string!!
}

const PrefixLive = Layer.succeed(Prefix, { value: "[SYS]" })

const FormatterLive = Layer.effect(Formatter, effect {
  const p = try Prefix
  return {
    format: effect (msg: string) => \`\${p.value} \${msg}\`,
  }
})

const AppLive = Layer.provideMerge(FormatterLive, PrefixLive)

export effect function run() {
  provide AppLive {
    const fmt = try Formatter
    return { formatted: try fmt.format("ready") }
  }
}
`,
    effectTs: `import { Context, Effect, Layer } from "effect"

class Prefix extends Context.Service<Prefix, { readonly value: string }>()("eval/Prefix") {}
class Formatter extends Context.Service<Formatter, { format(msg: string): Effect.Effect<string> }>()("eval/Formatter") {}

const PrefixLive = Layer.succeed(Prefix, { value: "[SYS]" })
const FormatterLive = Layer.effect(Formatter, Effect.gen(function* () {
  const p = yield* Prefix
  return {
    format: (msg: string) => Effect.succeed(\`\${p.value} \${msg}\`),
  }
}))
const AppLive = Layer.provideMerge(FormatterLive, PrefixLive)

export const run = () =>
  Effect.gen(function* () {
    const fmt = yield* Formatter
    return { formatted: yield* fmt.format("ready") }
  }).pipe(Effect.provide(AppLive))
`,
    fault: {
      description: "Extends a service key as a class (EK3002)",
      kind: "compile-error",
      expectedPattern: "EK3002",
      vibe: `service Prefix {
  readonly value: string
}

class BadPrefix extends Prefix {}

export effect function run() {
  return Boolean(BadPrefix)
}
`,
    },
  },
  {
    id: "svc-03-scoped-provide",
    category: "services-layers",
    title: "Lexically scoped provide override without outer leakage",
    prompt: "Provide Tenant = { name: 'prod' } in the outer scope, temporarily override Tenant = { name: 'sandbox' } in an inner provide block, and return { before, inner, after } proving no leakage.",
    features: ["service", "provide"],
    expectedOutput: { before: "prod", inner: "sandbox", after: "prod" },
    vibe: `service Tenant {
  readonly name: string
}

effect function currentTenant() {
  return (try Tenant).name
}

export effect function run() {
  provide Tenant = { name: "prod" } {
    const before = try currentTenant()
    let inner = ""
    provide Tenant = { name: "sandbox" } {
      inner = try currentTenant()
    }
    const after = try currentTenant()
    return { before, inner, after }
  }
}
`,
    effectTs: `import { Context, Effect, Layer } from "effect"

class Tenant extends Context.Service<Tenant, { readonly name: string }>()("eval/Tenant") {}

const currentTenant = Effect.gen(function* () { return (yield* Tenant).name })

export const run = () =>
  Effect.gen(function* () {
    const before = yield* currentTenant
    const inner = yield* currentTenant.pipe(Effect.provide(Layer.succeed(Tenant, { name: "sandbox" })))
    const after = yield* currentTenant
    return { before, inner, after }
  }).pipe(Effect.provide(Layer.succeed(Tenant, { name: "prod" })))
`,
    fault: {
      description: "Mutates a shared outer binding so outer scope leaks the inner override",
      kind: "runtime-fail",
      vibe: `export effect function run() {
  let tenant = "prod"
  const before = tenant
  tenant = "sandbox"
  const inner = tenant
  const after = tenant
  return { before, inner, after }
}
`,
    },
  },
  {
    id: "svc-04-reference-default",
    category: "services-layers",
    title: "Context.Reference service with defaultValue and local override",
    prompt: "Declare service FeatureFlags with static readonly defaultValue = () => ({ beta: false }). Read the default without any provide, then override beta: true inside a provide block, returning { defaultBeta, overrideBeta }.",
    features: ["service", "defaultValue", "provide"],
    expectedOutput: { defaultBeta: false, overrideBeta: true },
    vibe: `service FeatureFlags {
  readonly beta: boolean
  static readonly defaultValue = () => ({ beta: false })
}

export effect function run() {
  const defaultBeta = (try FeatureFlags).beta
  let overrideBeta = false
  provide FeatureFlags = { beta: true } {
    overrideBeta = (try FeatureFlags).beta
  }
  return { defaultBeta, overrideBeta }
}
`,
    effectTs: `import { Context, Effect } from "effect"

const FeatureFlags = Context.Reference<{ readonly beta: boolean }>("eval/FeatureFlags", {
  defaultValue: () => ({ beta: false }),
})

export const run = () =>
  Effect.gen(function* () {
    const defaultBeta = (yield* FeatureFlags).beta
    const overrideBeta = yield* Effect.gen(function* () {
      return (yield* FeatureFlags).beta
    }).pipe(Effect.provideService(FeatureFlags, { beta: true }))
    return { defaultBeta, overrideBeta }
  })
`,
    fault: {
      description: "Uses retired 'service class' syntax instead of 'service Name' (EK0909)",
      kind: "compile-error",
      expectedPattern: "EK0909",
      vibe: `service class FeatureFlags {
  readonly beta: boolean
}

export effect function run() {
  return true
}
`,
    },
  },
  {
    id: "svc-05-test-layer-swap",
    category: "services-layers",
    title: "Deterministic test-layer swapping for cache hit and miss paths",
    prompt: "Write loadProfile(id) that reads Cache first and falls back to Db on CacheMiss. Run the same workflow under a hit layer and a miss layer, returning { hitPath, missPath }.",
    features: ["service", "Layer.succeed", "provide", "catch effect"],
    expectedOutput: { hitPath: "cached:u1", missPath: "db:u1" },
    vibe: `error CacheMiss { id: string }

service Cache {
  get(id: string): string!CacheMiss
}

service Db {
  get(id: string): string!!
}

effect function loadProfile(id: string) {
  const cache = try Cache
  const db = try Db
  return cache.get(id) catch effect () => try db.get(id)
}

export effect function run() {
  const dbLayer = Layer.succeed(Db, { get: effect (id: string) => \`db:\${id}\` })
  const hitLayer = Layer.succeed(Cache, { get: effect (id: string) => \`cached:\${id}\` })
  const missLayer = Layer.succeed(Cache, { get: effect (id: string) => { throw new CacheMiss({ id }) } })

  let hitPath = ""
  let missPath = ""
  provide dbLayer {
    provide hitLayer {
      hitPath = try loadProfile("u1")
    }
    provide missLayer {
      missPath = try loadProfile("u1")
    }
  }
  return { hitPath, missPath }
}
`,
    effectTs: `import { Context, Data, Effect, Layer } from "effect"

class CacheMiss extends Data.TaggedError("CacheMiss")<{ readonly id: string }> {}
class Cache extends Context.Service<Cache, { get(id: string): Effect.Effect<string, CacheMiss> }>()("eval/Cache") {}
class Db extends Context.Service<Db, { get(id: string): Effect.Effect<string> }>()("eval/Db") {}

const loadProfile = (id: string) =>
  Effect.gen(function* () {
    const cache = yield* Cache
    const db = yield* Db
    return yield* cache.get(id).pipe(Effect.catch(() => db.get(id)))
  })

export const run = () => {
  const dbLayer = Layer.succeed(Db, { get: (id: string) => Effect.succeed(\`db:\${id}\`) })
  const hitLayer = Layer.succeed(Cache, { get: (id: string) => Effect.succeed(\`cached:\${id}\`) })
  const missLayer = Layer.succeed(Cache, { get: (id: string) => Effect.fail(new CacheMiss({ id })) })
  return Effect.gen(function* () {
    const hitPath = yield* loadProfile("u1").pipe(Effect.provide(hitLayer))
    const missPath = yield* loadProfile("u1").pipe(Effect.provide(missLayer))
    return { hitPath, missPath }
  }).pipe(Effect.provide(dbLayer))
}
`,
    fault: {
      description: "Uses retired 'layer Name: Service' declaration syntax (EK2121)",
      kind: "compile-error",
      expectedPattern: "EK2121",
      vibe: `service Cache {
  get(id: string): string!!
}

layer MockCache: Cache {
  return { get: effect (id: string) => id }
}

export effect function run() {
  return "x"
}
`,
    },
  },
]
