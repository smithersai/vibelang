import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as fc from "fast-check"
import { fileURLToPath } from "node:url"
import { Process } from "vibelang-runtime/experimental"
import { ExperimentalNodeProcess } from "vibelang-runtime/experimental/platform-node"
import corpus from "./fixtures/foldkit-relay-registry-process-group-zero.json"

const withHost = <A>(platform: string, code: string, body: (calls: Array<readonly [number, string | number]>) => A): A => {
  const kill = Object.getOwnPropertyDescriptor(process, "kill")!
  const hostPlatform = Object.getOwnPropertyDescriptor(process, "platform")!
  const calls: Array<readonly [number, string | number]> = []
  Object.defineProperty(process, "platform", { ...hostPlatform, value: platform })
  // Never send an actual signal in a validation test, even if the guard regresses.
  Object.defineProperty(process, "kill", { ...kill, value: (pid: number, signal: string | number) => {
    calls.push([pid, signal])
    if (code !== "ok") throw Object.assign(new Error("probe error"), { code })
    return true
  } })
  try { return body(calls) } finally {
    Object.defineProperty(process, "kill", kill)
    Object.defineProperty(process, "platform", hostPlatform)
  }
}
const service = () => Effect.runSync(Effect.provide(Effect.service(Process.Process), ExperimentalNodeProcess.layer))
const outcome = <A>(query: Effect.Effect<A, any>) => Effect.runSync(Effect.match(query, {
  onSuccess: (value) => ({ ok: true, value }),
  onFailure: (error) => ({ ok: false, reason: error.reason._tag })
}))

// VIP-33 section2: the missing host query belongs in the injected Experimental service.
// Signal zero tests existence; query-zero targets the current POSIX group. A real
// signal still requires a positive id. EPERM means alive; ESRCH means absent.
test("Process.isRunning: zero and its numeric neighbourhood preserve query targets, errors and coldness", () => {
  const ids = fc.oneof(fc.integer({ min: -3, max: 40 }), fc.constantFrom(-0, NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1))
  fc.assert(fc.property(
    ids, fc.constantFrom("linux", "darwin", "win32"), fc.option(fc.boolean(), { nil: undefined }),
    fc.constantFrom("ok", "EPERM", "ESRCH", "EINVAL", "EIO"),
    (pid, platform, group, code) => withHost(platform, code, (calls) => {
      const current = service()
      const query = current.isRunning(pid, { group })
      expect(calls).toEqual([])
      const result = outcome(query)
      const valid = Number.isSafeInteger(pid) && pid >= 0 && !(group === true && platform === "win32")
      if (!valid) {
        expect(result).toEqual({ ok: false, reason: "BadArgument" })
        expect(calls).toEqual([])
      } else {
        const target = pid === 0 ? 0 : group === true ? -pid : pid
        expect(calls).toEqual([[target, 0]])
        expect(result).toEqual(code === "ok" || code === "EPERM"
          ? { ok: true, value: true }
          : code === "ESRCH" ? { ok: true, value: false }
          : { ok: false, reason: code === "EINVAL" ? "BadArgument" : "Unknown" })
      }
    })
  ), { numRuns: 300, seed: 152031 })
})

test("Process.kill: zero stays refused before the host receives any real signal", () => {
  for (const platform of ["linux", "darwin", "win32"]) {
    for (const group of [undefined, false, true]) {
      for (const pid of [0, -0]) withHost(platform, "ok", (calls) => {
        expect(outcome(service().kill(pid, { group }))).toEqual({ ok: false, reason: "BadArgument" })
        expect(calls).toEqual([])
      })
    }
  }
})

test("Process.isRunning: consumed relayRegistry zero witnesses match Node and Bun signal-zero queries", () => {
  const fixture = fileURLToPath(new URL("./fixtures/process-pid-zero.mjs", import.meta.url))
  for (const runtime of ["node", "bun"]) {
    for (const witness of corpus.cases) {
      if (process.platform === "win32" && witness.group) continue
      const pid = Object.is(witness.pid, -0) ? "-0" : String(witness.pid)
      const child = Bun.spawnSync([runtime, fixture, pid, String(witness.group)], { stdout: "pipe", stderr: "pipe", timeout: 15_000 })
      expect(child.exitCode).toBe(0)
      expect(child.stderr.toString()).toBe("")
      expect(JSON.parse(child.stdout.toString())).toEqual({ same: true })
    }
  }
}, 60_000)
