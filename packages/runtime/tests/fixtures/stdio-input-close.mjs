import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Experimental from "vibelang-runtime/experimental"
const input = process.stdin
const endBefore = input.listenerCount("end")
const closeBefore = input.listenerCount("close")
try {
  const layer = process.versions.bun
    ? (await import("vibelang-runtime/experimental/platform-bun")).ExperimentalBunStdio.layer
    : (await import("vibelang-runtime/experimental/platform-node")).ExperimentalNodeStdio.layer
  const stdio = await Effect.runPromise(Effect.provide(Effect.service(Experimental.Stdio.Stdio), layer))
  const fiber = Effect.runFork(stdio.awaitInputClosed)
  const untouchedBeforeConsumer = input.readableFlowing === null && input.listenerCount("data") === 0
    && input.listenerCount("readable") === 0 && input.listenerCount("error") === 0
  const chunks = []
  // The transport alone enables consumption and owns the error lifecycle.
  const consumed = new Promise((resolve, reject) => {
    input.on("data", (chunk) => chunks.push(chunk))
    input.once("end", resolve)
    input.once("error", reject)
  })
  await consumed
  await Effect.runPromise(Fiber.join(fiber))
  process.stdout.write(JSON.stringify({
    untouchedBeforeConsumer,
    bytesPreserved: Buffer.concat(chunks).toString() === "foldkit-mcp-owned-input\n",
    detached: input.listenerCount("end") === endBefore && input.listenerCount("close") === closeBefore
  }))
} catch {
  process.stderr.write("stdin closure ownership probe failed\n")
  process.exitCode = 1
}
