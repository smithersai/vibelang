import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { Process } from "vibelang-runtime/experimental"
try {
  const pid = Number(process.argv[2])
  const group = process.argv[3] === "true"
  let native = true
  try { process.kill(0, 0) } catch (error) {
    if (error?.code === "ESRCH") native = false
    else if (error?.code !== "EPERM") throw error
  }
  const layer = process.versions.bun
    ? (await import("vibelang-runtime/experimental/platform-bun")).ExperimentalBunProcess.layer
    : (await import("vibelang-runtime/experimental/platform-node")).ExperimentalNodeProcess.layer
  const exit = await Effect.runPromiseExit(Effect.gen(function*() {
    const service = yield* Process.Process
    return yield* service.isRunning(pid, { group })
  }).pipe(Effect.provide(layer)))
  process.stdout.write(JSON.stringify({ same: Exit.isSuccess(exit) && exit.value === native }))
} catch {
  process.stderr.write("pid-zero query probe failed\n")
  process.exitCode = 1
}
