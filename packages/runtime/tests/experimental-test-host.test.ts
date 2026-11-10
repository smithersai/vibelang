import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import fc from "fast-check"
import { Effect, Exit, FileSystem, Path } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { Test } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const onHost = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner>,
  options: Test.HostOptions = {}
) => Effect.runPromiseExit(Effect.scoped(Effect.provide(effect, Test.host(options))))

const failureTag = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) && exit.cause.reasons[0]?._tag === "Fail"
    ? ((exit.cause.reasons[0] as { error: { reason: { _tag: string } } }).error.reason._tag)
    : Exit.isFailure(exit) ? "defect" : "succeeded"

test("Test.host serves the files it was given and keeps what the program writes", async () => {
  const exit = await onHost(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const config = yield* fs.readFileString("/repo/config.json")
    yield* fs.writeFileString("/repo/out/report.txt", "ok").pipe(Effect.exit)
    yield* fs.makeDirectory("/repo/out")
    yield* fs.writeFileString("/repo/out/report.txt", "ok")
    yield* fs.writeFileString("/repo/out/report.txt", "!", { flag: "a" })
    return {
      config,
      report: yield* fs.readFileString("/repo/out/report.txt"),
      listing: yield* fs.readDirectory("/repo"),
      relative: yield* fs.readFileString("repo/config.json"),
      size: Number((yield* fs.stat("/repo/out/report.txt")).size)
    }
  }), { files: { "/repo/config.json": `{"name":"x"}` } })
  expect(exit).toEqual(Exit.succeed({ config: `{"name":"x"}`, report: "ok!", listing: ["config.json", "out"], relative: `{"name":"x"}`, size: 3 }))
})

test("Test.host fails a missing file with NotFound and starts each build from its options", async () => {
  const host = Test.host({ files: { "/a.txt": "a" } })
  const write = Effect.flatMap(Effect.service(FileSystem.FileSystem), (fs) => fs.writeFileString("/b.txt", "b"))
  const read = Effect.flatMap(Effect.service(FileSystem.FileSystem), (fs) => fs.readFileString("/b.txt"))
  expect(Exit.isSuccess(await Effect.runPromiseExit(Effect.provide(write, host)))).toBe(true)
  expect(failureTag(await Effect.runPromiseExit(Effect.provide(read, host)))).toBe("NotFound")
})

test("Test.host answers scripted commands and fails an unscripted one as a missing binary", async () => {
  const commands = {
    "git status --short": { stdout: " M src/a.ts\n" },
    "make test": { stderr: "1 failed\n", exitCode: 2 }
  }
  const exit = await onHost(Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const status = yield* spawner.string(ChildProcess.make("git", ["status", "--short"]))
    const code = yield* spawner.exitCode(ChildProcess.make("make", ["test"]))
    const missing = yield* Effect.exit(spawner.string(ChildProcess.make("rm", ["-rf", "/"])))
    return { status, code: Number(code), missing: failureTag(missing) }
  }), { commands })
  expect(exit).toEqual(Exit.succeed({ status: " M src/a.ts\n", code: 2, missing: "NotFound" }))
})

// The memory file system is a stand-in for the real one, so it must agree with
// the real one. Random operation sequences run on Test.host and on Node's file
// system in a fresh directory; each operation succeeds on both or fails on
// both, and every read and listing returns the same value.
type Op =
  | { readonly op: "write"; readonly path: string; readonly text: string }
  | { readonly op: "append"; readonly path: string; readonly text: string }
  | { readonly op: "read"; readonly path: string }
  | { readonly op: "mkdir"; readonly path: string; readonly recursive: boolean }
  | { readonly op: "remove"; readonly path: string; readonly recursive: boolean }
  | { readonly op: "exists"; readonly path: string }
  | { readonly op: "list"; readonly path: string }
  | { readonly op: "rename"; readonly path: string; readonly to: string }

const paths = ["a", "a/b", "a/b/c.txt", "a/d.txt", "e.txt", "f"]
const opArbitrary: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ op: fc.constant("write" as const), path: fc.constantFrom(...paths), text: fc.string({ maxLength: 5 }) }),
  fc.record({ op: fc.constant("append" as const), path: fc.constantFrom(...paths), text: fc.string({ maxLength: 5 }) }),
  fc.record({ op: fc.constant("read" as const), path: fc.constantFrom(...paths) }),
  fc.record({ op: fc.constant("mkdir" as const), path: fc.constantFrom(...paths), recursive: fc.boolean() }),
  fc.record({ op: fc.constant("remove" as const), path: fc.constantFrom(...paths), recursive: fc.boolean() }),
  fc.record({ op: fc.constant("exists" as const), path: fc.constantFrom(...paths) }),
  fc.record({ op: fc.constant("list" as const), path: fc.constantFrom("", ...paths) }),
  fc.record({ op: fc.constant("rename" as const), path: fc.constantFrom(...paths), to: fc.constantFrom(...paths) })
)

const runOps = (root: string, ops: ReadonlyArray<Op>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const at = (path: string) => (path === "" ? root : `${root}/${path}`)
    const outcomes: Array<unknown> = []
    for (const op of ops) {
      const effect: Effect.Effect<unknown, unknown> = op.op === "write"
        ? fs.writeFileString(at(op.path), op.text)
        : op.op === "append"
        ? fs.writeFileString(at(op.path), op.text, { flag: "a" })
        : op.op === "read"
        ? fs.readFileString(at(op.path))
        : op.op === "mkdir"
        ? Effect.asVoid(fs.makeDirectory(at(op.path), { recursive: op.recursive }))
        : op.op === "remove"
        ? fs.remove(at(op.path), { recursive: op.recursive })
        : op.op === "exists"
        ? fs.exists(at(op.path))
        : op.op === "list"
        ? Effect.map(fs.readDirectory(at(op.path)), (names) => [...names].sort())
        : fs.rename(at(op.path), at(op.to))
      const exit = yield* Effect.exit(effect)
      outcomes.push(Exit.isSuccess(exit) ? { ok: exit.value ?? null } : failureTag(exit))
    }
    return outcomes
  })

test("property: Test.host's file system agrees with the real one", async () => {
  await checkProperty(fc, {
    name: "test-host-filesystem-agrees",
    rule: "VIP-71: Test.host is a deterministic machine standing in for FileSystem",
    command: "bun test tests/experimental-test-host.test.ts",
    arbitrary: fc.array(opArbitrary, { maxLength: 12 }),
    numRuns: 150,
    check: async (ops: ReadonlyArray<Op>) => {
      const portable = ops
      const dir = mkdtempSync(join(tmpdir(), "vibelang-test-host-"))
      try {
        const real = await Effect.runPromise(runOps(dir, portable).pipe(Effect.provide(NodeFileSystem.layer)))
        const memory = await Effect.runPromise(
          Effect.flatMap(Effect.service(FileSystem.FileSystem), (fs) => fs.makeDirectory("/root")).pipe(
            Effect.andThen(runOps("/root", portable)),
            Effect.provide(Test.host())
          )
        )
        expect(memory).toEqual(real)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  })
}, 120000)
