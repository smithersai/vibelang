import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as fc from "fast-check"
import * as os from "node:os"
import { fileURLToPath } from "node:url"
import { Process } from "vibelang-runtime/experimental"
import { ExperimentalNodeProcess } from "vibelang-runtime/experimental/platform-node"
import corpus from "./fixtures/foldkit-relay-registry-native-home.json"

const withHome = <A>(read: () => string, body: (host: object) => A): A => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "getBuiltinModule")!
  const original = process.getBuiltinModule
  const host = { ...os, homedir: read }
  Object.defineProperty(process, "getBuiltinModule", {
    ...descriptor,
    value: (id: string) => id === "node:os" ? host : original.call(process, id)
  })
  try { return body(host) } finally { Object.defineProperty(process, "getBuiltinModule", descriptor) }
}

const service = () => Effect.runSync(Effect.provide(Effect.service(Process.Process), ExperimentalNodeProcess.layer))

// VIP-33 section2: "What Effect lacks goes under Experimental.X".
// Oracle: a host fact is cold and reads the native host on each execution.
// Changing the host value between reads must be visible; no environment resolver or cache.
test("Process.homeDirectory: seeded native delegation stays cold, fresh and exact", () => {
  fc.assert(fc.property(
    fc.array(fc.oneof(fc.string({ maxLength: 32 }), fc.constant("\uD800"), fc.constant("\0")), { minLength: 1, maxLength: 6 }),
    (values) => {
      let reads = 0
      let receiver = true
      let expectedHost: object
      withHome(function(this: object) {
        receiver &&= this === expectedHost
        return values[reads++]!
      }, (host) => {
        expectedHost = host
        const instance = service()
        expect(reads).toBe(0)
        expect(Effect.isEffect(instance.homeDirectory)).toBe(true)
        const query = instance.homeDirectory
        expect(reads).toBe(0)
        for (const value of values) expect(Effect.runSync(query)).toBe(value)
        expect(reads).toBe(values.length)
        expect(receiver).toBe(true)
      })
    }
  ), { numRuns: 120, seed: 151031 })
})

test("Process.homeDirectory: a native lookup defect is kept on execution", () => {
  let reads = 0
  withHome(() => { reads++; throw new Error("native home unavailable") }, () => {
    const instance = service()
    expect(reads).toBe(0)
    expect(Effect.isEffect(instance.homeDirectory)).toBe(true)
    const exit = Effect.runSyncExit(instance.homeDirectory)
    expect(Exit.isFailure(exit)).toBe(true)
    expect(String(exit)).toContain("native home unavailable")
    expect(reads).toBe(1)
  })
})

test("Process.homeDirectory: layerTest provides a fixed home and accepts generated replacements", () => {
  const read = Effect.flatMap(Effect.service(Process.Process), (service) => service.homeDirectory)
  expect(Effect.runSync(Effect.provide(read, Process.layerTest()))).toBe("/test/home")
  fc.assert(fc.property(fc.string({ maxLength: 48 }), (home) => {
    expect(Effect.runSync(Effect.provide(read, Process.layerTest({ homeDirectory: Effect.succeed(home) })))).toBe(home)
  }), { numRuns: 100, seed: 151032 })
})

test("Process.homeDirectory: Node and Bun retain native HOME fallback and ignore ConfigProvider overrides", () => {
  const fixture = fileURLToPath(new URL("./fixtures/process-native-home.mjs", import.meta.url))
  for (const runtime of ["node", "bun"]) {
    for (const witness of corpus.cases) {
      const environment = { ...process.env }
      if ("unsetHome" in witness) delete environment.HOME
      else environment.HOME = witness.home
      const child = Bun.spawnSync([runtime, fixture], { env: environment, stdout: "pipe", stderr: "pipe", timeout: 15_000 })
      expect(child.exitCode).toBe(0)
      expect(child.stderr.toString()).toBe("")
      expect(JSON.parse(child.stdout.toString())).toEqual({ available: true, equalsNative: true, resolverUsesProvider: true })
    }
  }
}, 60_000)
