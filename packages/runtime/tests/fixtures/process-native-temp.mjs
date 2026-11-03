import * as Effect from "effect/Effect"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { Process } from "vibelang-runtime/experimental"
let stage = "native-reference"
try {
  const native = tmpdir()
  const witness = process.argv[2]
  const before = existsSync(witness)
  const layer = process.versions.bun
    ? (await import("vibelang-runtime/experimental/platform-bun")).ExperimentalBunProcess.layer
    : (await import("vibelang-runtime/experimental/platform-node")).ExperimentalNodeProcess.layer
  stage = "service-query"
  const result = await Effect.runPromise(Effect.gen(function*() {
    const service = yield* Process.Process
    if (!Effect.isEffect(service.temporaryDirectory)) return { available: false, same: false }
    const value = yield* service.temporaryDirectory
    return { available: true, same: value === native }
  }).pipe(Effect.provide(layer)))
  process.stdout.write(JSON.stringify({ ...result, noCreation: !before && !existsSync(witness) }))
} catch {
  process.stderr.write("temporary directory probe failed at " + stage + "\n")
  process.exitCode = 1
}
