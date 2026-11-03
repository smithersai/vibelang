import * as Effect from "effect/Effect"
import { Process } from "vibelang-runtime/experimental"
const mode = process.argv[2]
const descriptor = Object.getOwnPropertyDescriptor(process, "getuid")
const sentinel = { code: "UID_PROBE_UNVERIFIED" }
try {
  if (mode === "absent") Object.defineProperty(process, "getuid", { configurable: true, value: undefined })
  else if (mode === "zero") Object.defineProperty(process, "getuid", { configurable: true, value: () => 0 })
  else if (mode === "throw-method") Object.defineProperty(process, "getuid", { configurable: true, value: () => { throw sentinel } })
  else if (mode === "throw-getter") Object.defineProperty(process, "getuid", { configurable: true, get: () => { throw sentinel } })
  let reference
  try { reference = { kind: "success", value: process.getuid?.() } }
  catch (error) { reference = { kind: "failure", error } }
  const layer = process.versions.bun
    ? (await import("vibelang-runtime/experimental/platform-bun")).ExperimentalBunProcess.layer
    : (await import("vibelang-runtime/experimental/platform-node")).ExperimentalNodeProcess.layer
  const current = await Effect.runPromise(Effect.provide(Effect.service(Process.Process), layer))
  const actual = await Effect.runPromise(Effect.catch(
    Effect.map(current.currentUid, (value) => ({ kind: "success", value })),
    (error) => Effect.succeed({ kind: "failure", error })
  ))
  process.stdout.write(JSON.stringify({
    matchesNative: actual.kind === reference.kind && (actual.kind === "success" ? Object.is(actual.value, reference.value) : true),
    rawFailure: actual.kind !== "failure" || actual.error === reference.error
  }))
} catch {
  process.stderr.write("optional uid probe failed\n")
  process.exitCode = 1
} finally {
  if (descriptor) Object.defineProperty(process, "getuid", descriptor)
  else delete process.getuid
}
