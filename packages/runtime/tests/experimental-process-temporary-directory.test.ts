import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as fc from "fast-check"
import { randomUUID } from "node:crypto"
import { existsSync, rmSync } from "node:fs"
import * as os from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Process } from "vibelang-runtime/experimental"
import { ExperimentalNodeProcess } from "vibelang-runtime/experimental/platform-node"
import corpus from "./fixtures/foldkit-relay-registry-temporary-directory.json"

const withTemp = <A>(read: () => string, body: (host: object) => A): A => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "getBuiltinModule")!
  const original = process.getBuiltinModule
  const host = { ...os, tmpdir: read }
  Object.defineProperty(process, "getBuiltinModule", {
    ...descriptor, value: (id: string) => id === "node:os" ? host : original.call(process, id)
  })
  try { return body(host) } finally { Object.defineProperty(process, "getBuiltinModule", descriptor) }
}
const service = () => Effect.runSync(Effect.provide(Effect.service(Process.Process), ExperimentalNodeProcess.layer))

// VIP-33 section2: "What Effect lacks goes under Experimental.X".
// Oracle: tmpdir is a cold native query; returned text, receiver and repeated
// lookups are preserved. No normalization or temporary-resource allocation.
test("Process.temporaryDirectory: seeded native delegation is cold, fresh and exact", () => {
  fc.assert(fc.property(fc.array(
    fc.oneof(fc.string({ maxLength: 40 }), fc.constant("\uD800"), fc.constant("\0"), fc.constant("a/")),
    { minLength: 1, maxLength: 6 }
  ), (values) => {
    let reads = 0
    let receiver = true
    let expectedHost: object
    withTemp(function(this: object) { receiver &&= this === expectedHost; return values[reads++]! }, (host) => {
      expectedHost = host
      const current = service()
      expect(reads).toBe(0)
      expect(Effect.isEffect(current.temporaryDirectory)).toBe(true)
      const query = current.temporaryDirectory
      expect(reads).toBe(0)
      for (const value of values) expect(Effect.runSync(query)).toBe(value)
      expect(reads).toBe(values.length)
      expect(receiver).toBe(true)
    })
  }), { numRuns: 120, seed: 153031 })
})

test("Process.temporaryDirectory: a host defect occurs on execution", () => {
  let reads = 0
  withTemp(() => { reads++; throw new Error("native temporary query unavailable") }, () => {
    const current = service()
    expect(reads).toBe(0)
    expect(Effect.isEffect(current.temporaryDirectory)).toBe(true)
    const exit = Effect.runSyncExit(current.temporaryDirectory)
    expect(Exit.isFailure(exit)).toBe(true)
    expect(String(exit)).toContain("native temporary query unavailable")
    expect(reads).toBe(1)
  })
})

test("Process.temporaryDirectory: default and generated fake values require no filesystem", () => {
  const read = Effect.flatMap(Effect.service(Process.Process), (current) => current.temporaryDirectory)
  expect(Effect.runSync(Effect.provide(read, Process.layerTest()))).toBe("/tmp")
  fc.assert(fc.property(fc.string({ maxLength: 48 }), (path) => {
    expect(Effect.runSync(Effect.provide(read, Process.layerTest({ temporaryDirectory: Effect.succeed(path) })))).toBe(path)
  }), { numRuns: 100, seed: 153032 })
})

test("Process.temporaryDirectory: Node and Bun preserve native environment lookup without creating directories", () => {
  const fixture = fileURLToPath(new URL("./fixtures/process-native-temp.mjs", import.meta.url))
  for (const runtime of ["node", "bun"]) {
    for (const witness of corpus.cases) {
      const target = join(os.tmpdir(), "foldkit-query-only-" + randomUUID())
      expect(existsSync(target)).toBe(false)
      const environment = { ...process.env }
      for (const key of ["TMPDIR", "TMP", "TEMP"]) delete environment[key]
      if (witness.variable !== null) environment[witness.variable] = target + "/"
      try {
        const child = Bun.spawnSync([runtime, fixture, target], { env: environment, stdout: "pipe", stderr: "pipe", timeout: 15_000 })
        expect(child.exitCode).toBe(0)
        expect(child.stderr.toString()).toBe("")
        expect(JSON.parse(child.stdout.toString())).toEqual({ available: true, same: true, noCreation: true })
      } finally {
        // Only an owned UUID witness can be removed if a broken implementation allocated it.
        rmSync(target, { recursive: true, force: true })
      }
    }
  }
}, 60_000)
