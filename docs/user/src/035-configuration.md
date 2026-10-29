# Configuration

`Config` loads typed settings with Effect's validation and error types; `ConfigProvider` chooses their source. A call returning `Config.Config<T>` builds a descriptor; `try descriptor` loads its value.

## Declare typed configuration

```vibe
// pending: VIP-1, VIP-5, VIP-12, VIP-14
// run: provide ConfigProvider.layer(ConfigProvider.fromUnknown({ HOST: "localhost", PORT: 9091 })) { try Console.log(JSON.stringify(try serverSettings())) }
const Host = Config.NonEmptyString("HOST")
const Port = Config.Port("PORT")

effect function serverSettings() {
  const host = try Host
  const port = try Port
  return { host, port }
}
// { host: string; port: number }!ConfigError!
// Output: {"host":"localhost","port":9091}
```

`try Host` and `try Port` load from the active provider, by default the environment; constructing the descriptors reads nothing. Missing or invalid input fails with `ConfigError`. `.vibe` files need no direct environment access.

| Constructor | Decoded value |
| --- | --- |
| `Config.String`, `Config.NonEmptyString` | A string, optionally nonempty |
| `Config.Finite`, `Config.Int`, `Config.Port` | A finite number, integer, or port from 1 to 65535 |
| `Config.Boolean` | A boolean |
| `Config.Literal`, `Config.Literals` | One literal, or one of several |
| `Config.Duration`, `Config.Date`, `Config.URL` | The corresponding value type |
| `Config.LogLevel` | A log severity |
| `Config.Redacted` | A protected string |

Prefer `Finite` to `Number` for ordinary numeric settings: `Number` also accepts non-finite values. Boolean text is case sensitive: `true`/`false`, `yes`/`no`, `on`/`off`, `1`/`0`, and `y`/`n`.

`Config.all`, `Config.nested`, and `Config.withDefault` compose descriptors as data in `.vibe`. Descriptors are Effect values; `try` runs them and returns their decoded settings.

## Parse with schemas

```vibe
// pending: VIP-1, VIP-3, VIP-5, VIP-12, VIP-14
// run: provide ConfigProvider.layer(ConfigProvider.fromUnknown({ TEAM_NAME: "search" })) { try Console.log(try teamName()) }; provide ConfigProvider.layer(ConfigProvider.fromUnknown({ TEAM_NAME: "ab" })) { teamName() catch effect (error) => { try Console.log(error._tag) } }
effect function teamName() {
  return try Config.schema(
    Schema.String.check(Schema.isMinLength(3)),
    "TEAM_NAME"
  )
}
// string!ConfigError!
// Output: search
// Output: ConfigError
```

`Config.schema` builds a descriptor that decodes the provider's representation with the schema; `try` runs it and returns the decoded value. Put constraints in the schema so invalid input reports a configuration failure. A structured schema can describe a whole object, its field paths mapping to environment keys or object properties.

```vibe
// descriptors.vibe
// pending: VIP-5, VIP-14
// run: try Console.log(JSON.stringify(try server.parse(ConfigProvider.fromUnknown({ server: { host: "localhost", port: 9091 } }))))
export const server = Config.schema(Schema.Struct({
  host: Schema.String,
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))
}), "server")
// Output: {"host":"localhost","port":9091}
```

```vibe
// pending: VIP-1, VIP-5, VIP-14
// run: try Console.log(JSON.stringify(try localServer()))
import { server } from "./descriptors.vibe"

effect function localServer() {
  return try server.parse(ConfigProvider.fromUnknown({
    server: { host: "127.0.0.1", port: 9091 }
  }))
}
// Output: {"host":"127.0.0.1","port":9091}
```

Use `descriptor.parse(provider)` for an explicit source, especially in tests; it returns an `Effect`, so run it with `try`. `try server` instead uses the active provider.

## Read arrays and records

```vibe
// pending: VIP-1, VIP-5, VIP-12, VIP-14
// run: provide ConfigProvider.layer(ConfigProvider.fromUnknown({ REGIONS: "north,south", LABELS: "team=search,tier=internal" })) { try Console.log(JSON.stringify(try routingSettings())) }
effect function routingSettings() {
  const regions = try Config.Array(Schema.String, "REGIONS")
  const labels = try Config.Record(Schema.String, Schema.String, "LABELS")
  return { regions, labels }
}
// Output: {"regions":["north","south"],"labels":{"team":"search","tier":"internal"}}
```

Arrays accept structural values or a separated string such as `north,south`; records accept objects or text such as `team=search,tier=internal`. Both constructors take separator options. To accept only structural input, use plain schema arrays or records through `Config.schema`.

## Nest and combine configuration

```vibe
// database-config.vibe
// pending: VIP-5, VIP-14
// run: try Console.log(JSON.stringify(try database.parse(ConfigProvider.fromEnv({ env: { DATABASE_HOST: "db.internal", DATABASE_PORT: "5433" } }))))
export const database = Config.nested(Config.all({
  host: Config.NonEmptyString("HOST"),
  port: Config.Port("PORT")
}), "DATABASE")
// Output: {"host":"db.internal","port":5433}
```

```vibe
// pending: VIP-1, VIP-5, VIP-14
// run: try Console.log(JSON.stringify(try testDatabaseSettings()))
import { database } from "./database-config.vibe"

effect function testDatabaseSettings() {
  return try database.parse(ConfigProvider.fromEnv({
    env: { DATABASE_HOST: "db.internal", DATABASE_PORT: "5433" }
  }))
}
// Output: {"host":"db.internal","port":5433}
```

`Config.all` keeps the input's tuple or named-object shape. `Config.nested` prepends a path to every lookup; the environment provider joins segments with `_`. A library accepting nested records of descriptors can type its input `Config.Wrap<T>` and build the combined descriptor with `Config.unwrap`.

## Defaults and fallbacks

```vibe
// optional-config.vibe
// pending: VIP-1, VIP-5, VIP-14
// run: const provider = ConfigProvider.fromUnknown({ BACKUP_HOST: "standby.internal" }); try Console.log(try port.parse(provider), Option.isNone(try apiKey.parse(provider)), try host.parse(provider)); port.parse(ConfigProvider.fromUnknown({ PORT: "invalid" })) catch effect (error) => { try Console.log(error._tag) }
export const port = Config.withDefault(Config.Port("PORT"), 9091)
export const apiKey = Config.option(Config.String("API_KEY"))
export const host = Config.orElse(
  Config.NonEmptyString("HOST"),
  () => Config.NonEmptyString("BACKUP_HOST")
)
// Output: 9091 true standby.internal
// Output: ConfigError
```

```vibe
// pending: VIP-1, VIP-5, VIP-14
// run: const result = try defaultsExample(); try Console.log(result.port, Option.isNone(result.apiKey), result.host)
import { port, apiKey, host } from "./optional-config.vibe"

effect function defaultsExample() {
  const provider = ConfigProvider.fromUnknown({ BACKUP_HOST: "standby.internal" })
  return {
    port: try port.parse(provider),
    apiKey: try apiKey.parse(provider),
    host: try host.parse(provider)
  }
}
// Output: 9091 true standby.internal
```

`withDefault` replaces missing input and keeps validation failures. `option` returns `Option.none()` for absence. `orElse` tries another descriptor after any `ConfigError`, invalid input included, so use that broader recovery deliberately.

A default on a `Config.all` group replaces the whole group when any child is absent, unless another child fails validation or its source fails. Put defaults on individual children to keep supplied siblings.

## Transform parsed values

```vibe
// origin-config.vibe
// pending: VIP-5, VIP-14
// run: try Console.log(try origin.parse(ConfigProvider.fromUnknown({ HOST: "example.test", PORT: 9091 })))
export const origin = Config.map(Config.all({
  host: Config.NonEmptyString("HOST"),
  port: Config.Port("PORT")
}), ({ host, port }) => `https://${host}:${port}`)
// Output: https://example.test:9091
```

```vibe
// pending: VIP-1, VIP-5, VIP-12, VIP-14
// run: provide ConfigProvider.layer(ConfigProvider.fromUnknown({ HOST: "example.test", PORT: 9091 })) { try reportOrigin() }
import { origin } from "./origin-config.vibe"

effect function reportOrigin() {
  const value = try origin
  try Console.log(value)
  return value
}
// Output: https://example.test:9091
```

Use `Config.map` for a transformation that can't fail, a schema for validation, and `Config.mapEffect` when the transformation needs an Effect with `ConfigError`. When you don't need a reusable descriptor, load first and transform with ordinary statements.

## Protect secrets

```vibe
// pending: VIP-1, VIP-5, VIP-12, VIP-14
// run: provide ConfigProvider.layer(ConfigProvider.fromUnknown({ ACCESS_TOKEN: "documentation-placeholder" })) { try Console.log(String(try secretSetting())) }
effect function secretSetting() {
  const token = try Config.Redacted("ACCESS_TOKEN")
  try Console.log(String(token))
  return token
}
// Output: <redacted>
// Output: <redacted>
```

`Redacted` hides its contents in ordinary string representations. Call `Redacted.value(token)` only where the raw secret is needed. For a decoded secret, combine `Config.schema` with `Schema.RedactedFromValue`, as in a protected number decoded with `Schema.FiniteFromString`.

## Load providers

```vibe
// pending: VIP-1, VIP-5, VIP-12, VIP-14, VIP-33
// run: try Console.log(try testPort(), try Config.Port("PORT").parse(EnvProvider), try Config.Port("PORT").parse(DotEnvProvider)); provide FileSystem.layerNoop({ readFileString: effect (path) => { try Console.log(path); return "PORT=9095" } }) { try Console.log(try Config.Port("PORT").parse(try fileProvider())) }
const TestProvider = ConfigProvider.fromUnknown({ PORT: 9091 })
const EnvProvider = ConfigProvider.fromEnv({ env: { PORT: "9092" } })
const DotEnvProvider = ConfigProvider.fromDotEnvContents("PORT=9093")

effect function testPort() {
  provide ConfigProvider.layer(TestProvider) { return try Config.Port("PORT") }
}

effect function fileProvider() {
  return try ConfigProvider.fromDotEnv({ path: ".env.local" })
}
// Output: 9091 9092 9093
// Output: .env.local
// Output: 9095
```

`fromUnknown` reads object properties and array indexes as path segments. `fromEnv()` reads the host environment; an explicit `{ env }` replaces it for tests. Both treat empty strings as missing; pass `preserveEmptyStrings: true` when empty text has meaning.

`fromDotEnvContents` parses text in memory. `fromDotEnv` reads a file through `FileSystem`, and `fromDir` a directory tree through `FileSystem` and `Path`; provide their platform layers before running them. `ConfigProvider.make` supports a custom backing store.

## Remap provider paths

```vibe
// pending: VIP-1, VIP-5, VIP-12, VIP-14
// run: try Console.log(try deploymentPort())
const DeploymentProvider = ConfigProvider.constantCase(
  ConfigProvider.fromEnv({ env: { SERVICE_PORT: "9094" } })
)

effect function deploymentPort() {
  provide ConfigProvider.layer(DeploymentProvider) { return try Config.Port("servicePort") }
}
// Output: 9094
```

`constantCase` converts requested string segments to environment-style names, `ConfigProvider.nested` adds a fixed prefix, and `ConfigProvider.mapInput` transforms a requested path. Adapt the provider when a whole source follows a naming convention; nest a descriptor when one settings group has a prefix.

## Compose and install providers

```vibe
// pending: VIP-1, VIP-5, VIP-12, VIP-14
// run: try Console.log(JSON.stringify(try configuredServer()))
const Combined = ConfigProvider.orElse(
  ConfigProvider.fromEnv({ env: { HOST: "edge.internal" } }),
  ConfigProvider.fromUnknown({ HOST: "localhost", PORT: 9091 })
)

effect function configuredServer() {
  provide ConfigProvider.layer(Combined) {
    return { host: try Config.String("HOST"), port: try Config.Port("PORT") }
  }
}
// Output: {"host":"edge.internal","port":9091}
```

Provider fallback fills absent paths; it doesn't recover from source or validation errors. `ConfigProvider.layer` replaces the active provider for its region. `layerAdd` adds a fallback to the current provider, or with `{ asPrimary: true }` gives the added source precedence.

## Coming from Effect

Compose Config descriptors directly in `.vibe`; run a descriptor with `try` to load it, or run its `parse` Effect with an explicit provider. Returning a descriptor doesn't read it, just as returning an `Exit`, a Context key, or an error instance doesn't run it. `new` constructs an instance and never runs it.

[Upstream Effect page](https://effect.website/docs/v4/configuration)
