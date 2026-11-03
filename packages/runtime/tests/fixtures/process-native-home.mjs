import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as UserDirectories from "effect/persistence/UserDirectories"
import { homedir } from "node:os"
import { Process } from "vibelang-runtime/experimental"

let stage = "select-layer"
try {
  const layer = process.versions.bun
    ? (await import("vibelang-runtime/experimental/platform-bun")).ExperimentalBunProcess.layer
    : (await import("vibelang-runtime/experimental/platform-node")).ExperimentalNodeProcess.layer
  stage = "native-oracle"
  const native = homedir()
  const configured = native + "/config-provider-only-151"
  const result = await Effect.runPromise(Effect.gen(function*() {
    stage = "acquire-service"
    const service = yield* Process.Process
    if (!Effect.isEffect(service.homeDirectory)) {
      return { available: false, equalsNative: false, resolverUsesProvider: false }
    }
    stage = "native-query"
    const home = yield* service.homeDirectory
    stage = "environment-resolver"
    const resolved = yield* UserDirectories.make().home
    return { available: true, equalsNative: home === native, resolverUsesProvider: resolved === configured }
  }).pipe(
    Effect.provide(layer),
    Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({
      env: { HOME: configured, USERPROFILE: configured }
    }))
  ))
  // Only booleans cross the child boundary: never print a host path.
  process.stdout.write(JSON.stringify(result))
} catch {
  process.stderr.write("native home query failed at " + stage + "\n")
  process.exitCode = 1
}
