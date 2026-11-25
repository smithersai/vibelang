import { afterEach, beforeEach, expect, test } from "bun:test"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Deferred, Effect, Exit, Fiber, FileSystem, Layer, Logger, Metric, Path, PlatformError, References, Stream } from "effect"
import * as ChildProcess from "effect/process/ChildProcess"
import { ChildProcessSpawner, make as makeSpawner } from "effect/process/ChildProcessSpawner"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Capability from "../src/experimental/Capability.js"
import * as Sandbox from "../src/experimental/Sandbox.js"
import { containerRunArgv } from "../src/experimental/internal/sandboxProviders.js"

let base = ""
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "vibe-sandbox-test-")))
})
afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

const host = NodeServices.layer

const string = (command: ChildProcess.Command) =>
  Effect.flatMap(Effect.service(ChildProcessSpawner), (spawner) => spawner.string(command))

const failedWith = (exit: Exit.Exit<unknown, unknown>, tag: string): boolean =>
  Exit.isFailure(exit) && exit.cause.reasons.some((reason) =>
    reason._tag === "Fail" && PlatformError.isPlatformError(reason.error) && reason.error.reason._tag === tag
  )

test("VIP-67 rule 8: the interpreter, a directory, a command prefix and a runner pass the conformance suite", async () => {
  const providers: ReadonlyArray<readonly [string, Sandbox.Sandbox<Sandbox.SandboxError, never>]> = [
    ["interpreter", Sandbox.interpreter()],
    ["directory", Sandbox.directory().pipe(Layer.provide(host))],
    ["command", Sandbox.command(["env"], { workdir: join(base, "command") }).pipe(Layer.provide(host))],
    [
      "runner",
      Sandbox.fromRunner({
        provider: "runner",
        workdir: base,
        run: (script, stdin) =>
          Effect.gen(function*() {
            const spawner = yield* ChildProcessSpawner
            const handle = yield* spawner.spawn(ChildProcess.make("/bin/sh", ["-c", script], {
              stdin: stdin === undefined ? "ignore" : Stream.make(stdin)
            }))
            const failed = (cause: unknown) => new Sandbox.SandboxError({ code: "unknown", provider: "runner", reason: "broke off", cause })
            return {
              stdout: Stream.mapError(handle.stdout, failed),
              stderr: Stream.mapError(handle.stderr, failed),
              exitCode: Effect.mapError(Effect.map(handle.exitCode, Number), failed)
            }
          }).pipe(Effect.mapError((cause) => new Sandbox.SandboxError({ code: "spawn_error", provider: "runner", reason: "no sh", cause })))
      }).pipe(Layer.provide(host))
    ]
  ]
  for (const [name, provider] of providers) {
    const report = await Effect.runPromise(Sandbox.check(provider))
    expect([name, report.results.filter((result) => !result.passed)]).toEqual([name, []])
    expect(report.passed).toBe(true)
  }
}, 60_000)

test("VIP-67: the same code runs unchanged on another machine", async () => {
  const program = Effect.map(string(ChildProcess.make("pwd", [])), (out) => out.trim())
  const inRoot = await Effect.runPromise(Effect.provide(program, Sandbox.directory(join(base, "root")).pipe(Layer.provide(host))))
  expect(inRoot).toBe(join(base, "root"))
  const inInterpreter = await Effect.runPromise(Effect.provide(program, Sandbox.interpreter()))
  expect(inInterpreter).toBe("/workspace")
})

test("VIP-67 rule 1: a scratch directory lives as long as the layer; a named root is kept", async () => {
  let seen = ""
  await Effect.runPromise(Effect.provide(
    Effect.gen(function*() {
      const path = yield* Path.Path
      seen = path.resolve(".")
      expect(existsSync(seen)).toBe(true)
    }),
    Sandbox.directory().pipe(Layer.provide(host))
  ))
  expect(seen.startsWith("/")).toBe(true)
  expect(existsSync(seen)).toBe(false)

  const root = join(base, "kept")
  await Effect.runPromise(Effect.provide(
    Effect.flatMap(Effect.service(FileSystem.FileSystem), (fs) => fs.writeFileString("note.txt", "hello")),
    Sandbox.directory(root).pipe(Layer.provide(host))
  ))
  expect(readFileSync(join(root, "note.txt"), "utf8")).toBe("hello")
})

test("VIP-67 rule 1: interruption closes the scope and runs the provider's cleanup", async () => {
  let seen = ""
  const started = Effect.runSync(Deferred.make<void>())
  const fiber = Effect.runFork(Effect.provide(
    Effect.gen(function*() {
      seen = (yield* Path.Path).resolve(".")
      yield* Deferred.succeed(started, undefined)
      return yield* string(ChildProcess.make("sleep", ["30"]))
    }),
    Sandbox.directory().pipe(Layer.provide(host))
  ))
  await Effect.runPromise(Deferred.await(started))
  const before = Date.now()
  await Effect.runPromise(Fiber.interrupt(fiber))
  expect(Date.now() - before).toBeLessThan(10_000)
  expect(existsSync(seen)).toBe(false)
})

test("VIP-67 rule 3: the environment is replaced, not inherited", async () => {
  process.env["VIBE_SANDBOX_CANARY"] = "leaked"
  try {
    const out = await Effect.runPromise(Effect.provide(
      string(ChildProcess.make("env", [], { env: { DECLARED: "1" }, extendEnv: true })),
      Sandbox.directory(join(base, "env")).pipe(Layer.provide(host))
    ))
    expect(out).not.toContain("VIBE_SANDBOX_CANARY")
    expect(out).toContain("DECLARED=1")
    expect(out).toContain(`PATH=${process.env["PATH"]}`)
  } finally {
    delete process.env["VIBE_SANDBOX_CANARY"]
  }
})

test("VIP-67 rule 4: unsupported process features fail with BadArgument before anything runs", async () => {
  const marker = join(base, "ran")
  const touched = (options: ChildProcess.CommandOptions) => ChildProcess.make("touch", [marker], options)
  const cases: ReadonlyArray<ChildProcess.CommandOptions> = [
    { detached: true },
    { stdin: "inherit" },
    { shell: "/bin/bash" },
    { additionalFds: { fd3: { type: "output" } } } as ChildProcess.CommandOptions,
    { env: { "BAD-NAME": "x" } }
  ]
  for (const options of cases) {
    for (const provider of [Sandbox.directory(base).pipe(Layer.provide(host)), Sandbox.interpreter()]) {
      const exit = await Effect.runPromiseExit(Effect.provide(string(touched(options)), provider))
      expect([JSON.stringify(options), failedWith(exit, "BadArgument")]).toEqual([JSON.stringify(options), true])
    }
  }
  expect(existsSync(marker)).toBe(false)
  const piped = ChildProcess.make("cat", [], { cwd: "a" }).pipe(ChildProcess.pipeTo(ChildProcess.make("cat", [], { cwd: "b" })))
  expect(failedWith(await Effect.runPromiseExit(Effect.provide(string(piped), Sandbox.interpreter())), "BadArgument")).toBe(true)
})

test("VIP-67 rule 4: standard input over 16 MiB is refused before the spawn, never truncated", async () => {
  const big = new Uint8Array(16 * 1024 * 1024 + 1)
  const exit = await Effect.runPromiseExit(Effect.provide(
    string(ChildProcess.make("cat", [], { stdin: Stream.make(big) })),
    Sandbox.interpreter()
  ))
  expect(failedWith(exit, "BadArgument")).toBe(true)
})

test("VIP-67 rule 5: the interpreter runs no real process and touches no host file", async () => {
  const marker = join(base, "host-file")
  const out = await Effect.runPromise(Effect.provide(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner
      const node = yield* spawner.exitCode(ChildProcess.make("node", ["--version"]))
      const fs = yield* FileSystem.FileSystem
      yield* fs.writeFileString(marker, "x").pipe(Effect.ignore)
      yield* fs.makeDirectory(base, { recursive: true })
      yield* fs.writeFileString(marker, "inside")
      const shell = yield* spawner.string(ChildProcess.make("cat", [marker]))
      return { node: Number(node), shell }
    }),
    Sandbox.interpreter()
  ))
  expect(out.node).toBe(127)
  expect(out.shell).toBe("inside")
  expect(existsSync(marker)).toBe(false)
})

test("VIP-67 rule 5: a directory sandbox separates a workspace and nothing more", async () => {
  const root = join(base, "workspace")
  const outside = join(base, "outside.txt")
  await Effect.runPromise(Effect.provide(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      yield* fs.writeFileString("relative.txt", "in")
      // An absolute path is the host's: a directory confines nothing.
      yield* fs.writeFileString(outside, "out")
    }),
    Sandbox.directory(root).pipe(Layer.provide(host))
  ))
  expect(readFileSync(join(root, "relative.txt"), "utf8")).toBe("in")
  expect(readFileSync(outside, "utf8")).toBe("out")
})

test("VIP-67 rule 6: a sandbox and a capability policy stack", async () => {
  const root = join(base, "guarded")
  mkdirSync(root)
  const exit = await Effect.runPromiseExit(Effect.provide(
    Effect.provide(
      Effect.flatMap(Effect.service(FileSystem.FileSystem), (fs) => fs.writeFileString("secret.txt", "x")),
      Capability.guard({ allow: [`fs:read:${root}/*`], deny: [`fs:write:${root}/*`] })
    ),
    Sandbox.directory(root).pipe(Layer.provide(host))
  ))
  expect(Exit.isFailure(exit)).toBe(true)
  expect(existsSync(join(root, "secret.txt"))).toBe(false)
})

// A container engine that runs `exec` on this machine, so the container's
// lifecycle can be watched without an engine.
const fakeEngine = (options: { readonly removeFails?: boolean } = {}) => {
  const calls: Array<ReadonlyArray<string>> = []
  const layer = Layer.effect(ChildProcessSpawner)(Effect.gen(function*() {
    const real = yield* ChildProcessSpawner
    return makeSpawner((command) => Effect.suspend(() => {
      if (command._tag !== "StandardCommand") return real.spawn(command)
      const argv = [command.command, ...command.args.map(String)]
      calls.push(argv)
      const [program, verb] = argv
      if (program === "docker" && verb === "run") return real.spawn(ChildProcess.make("/bin/sh", ["-c", "echo cid123"]))
      if (program === "docker" && verb === "rm") return real.spawn(ChildProcess.make("/bin/sh", ["-c", options.removeFails ? "echo engine down >&2; exit 1" : "true"]))
      if (program === "docker" && verb === "exec") return real.spawn(ChildProcess.make(argv[4]!, argv.slice(5), { stdin: command.options.stdin }))
      if (program === "kubectl" && (argv[3] === "run" || argv[3] === "wait" || argv[3] === "delete")) {
        return real.spawn(ChildProcess.make("/bin/sh", ["-c", "true"]))
      }
      if (program === "kubectl" && argv[3] === "exec") {
        return real.spawn(ChildProcess.make(argv[7]!, argv.slice(8), { stdin: command.options.stdin }))
      }
      return real.spawn(command)
    }))
  })).pipe(Layer.provide(host))
  return { calls, layer }
}

test("VIP-67 rule 2: a container has no network unless network names a mode", () => {
  const closed = containerRunArgv({ image: "node:22" }, "n")
  expect(closed.slice(closed.indexOf("--network"), closed.indexOf("--network") + 2)).toEqual(["--network", "none"])
  const open = containerRunArgv({ image: "node:22", network: "bridge" }, "n")
  expect(open.slice(open.indexOf("--network"), open.indexOf("--network") + 2)).toEqual(["--network", "bridge"])
  expect(closed).toContain("--rm")
  expect(closed).toContain("node:22")
})

test("VIP-67: a container is started, reached by exec, and removed when the layer closes", async () => {
  const engine = fakeEngine()
  const out = await Effect.runPromise(Effect.provide(
    Effect.gen(function*() {
      const stdout = yield* string(ChildProcess.make("echo", ["inside"]))
      const fs = yield* FileSystem.FileSystem
      yield* fs.writeFileString("from-exec.txt", "bytes")
      return stdout
    }),
    Sandbox.container({ image: "node:22", workdir: base }).pipe(Layer.provide(engine.layer))
  ))
  expect(out).toBe("inside\n")
  expect(readFileSync(join(base, "from-exec.txt"), "utf8")).toBe("bytes")
  const verbs = engine.calls.map((argv) => argv.slice(0, 2).join(" "))
  expect(verbs[0]).toBe("docker run")
  expect(verbs.at(-1)).toBe("docker rm")
  expect(engine.calls.at(-1)).toEqual(["docker", "rm", "-f", "cid123"])
  expect(engine.calls.filter((argv) => argv[1] === "exec").every((argv) => argv.slice(2, 6).join(" ") === "-i cid123 /bin/sh -c")).toBe(true)
  expect(engine.calls[0]).toContain("none")
})

test("VIP-67 rule 1: a cleanup that fails is reported, never counted as done", async () => {
  const engine = fakeEngine({ removeFails: true })
  const logged: Array<Record<string, unknown>> = []
  const logger = Logger.make((options) => {
    logged.push({ level: options.logLevel, ...options.fiber.getRef(References.CurrentLogAnnotations) })
  })
  const before = (await Effect.runPromise(Metric.value(Sandbox.cleanupFailures))).count
  await Effect.runPromise(Effect.provide(
    string(ChildProcess.make("true", [])),
    Sandbox.container({ image: "node:22", workdir: base }).pipe(Layer.provide(engine.layer), Layer.provide(Logger.layer([logger])))
  ))
  const after = (await Effect.runPromise(Metric.value(Sandbox.cleanupFailures))).count
  expect(after - before).toBe(1)
  expect(logged.some((entry) => entry["code"] === "sandbox_cleanup_failed" && entry["level"] === "Error")).toBe(true)
})

test("VIP-67: a Kubernetes Pod is created, waited for, reached by exec, and deleted", async () => {
  const engine = fakeEngine()
  const out = await Effect.runPromise(Effect.provide(
    string(ChildProcess.make("echo", ["pod"])),
    Sandbox.kubernetes({ image: "node:22", namespace: "agents", workdir: base }).pipe(Layer.provide(engine.layer))
  ))
  expect(out).toBe("pod\n")
  const verbs = engine.calls.map((argv) => argv[3])
  expect(verbs[0]).toBe("run")
  expect(verbs[1]).toBe("wait")
  expect(verbs).toContain("exec")
  expect(verbs.at(-1)).toBe("delete")
  expect(engine.calls.every((argv) => argv[1] === "-n" && argv[2] === "agents")).toBe(true)
})

test("VIP-67: a machine that cannot open fails with SandboxError", async () => {
  const broken = Layer.effect(ChildProcessSpawner)(Effect.gen(function*() {
    const real = yield* ChildProcessSpawner
    return makeSpawner(() => real.spawn(ChildProcess.make("/bin/sh", ["-c", "echo 'Unable to find image node:99' >&2; exit 125"])))
  })).pipe(Layer.provide(host))
  const exit = await Effect.runPromiseExit(Effect.provide(Effect.void, Sandbox.container({ image: "node:99" }).pipe(Layer.provide(broken))))
  expect(Exit.isFailure(exit)).toBe(true)
  expect(JSON.stringify(exit)).toContain("SandboxError")
  expect(JSON.stringify(exit)).toContain("not_found")
})

test("VIP-67: run gives the result and what the checkout gained, as a git diff, without touching it", async () => {
  const root = join(base, "plain")
  mkdirSync(root)
  writeFileSync(join(root, "kept.txt"), "before\n")
  const ran = await Effect.runPromise(Sandbox.run(
    Sandbox.directory(root).pipe(Layer.provide(host)),
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      yield* fs.writeFileString("kept.txt", "after\n")
      yield* fs.writeFileString("added.txt", "new\n")
      return 7
    })
  ))
  expect(ran.result).toBe(7)
  expect(ran.diff).toContain("diff --git a/kept.txt b/kept.txt")
  expect(ran.diff).toContain("-before")
  expect(ran.diff).toContain("+after")
  expect(ran.diff).toContain("new file mode")
  expect(ran.diff).toContain("+new")
  expect(existsSync(join(root, ".git"))).toBe(false)

  const unchanged = await Effect.runPromise(Sandbox.run(Sandbox.directory(root).pipe(Layer.provide(host)), Effect.succeed("same")))
  expect(unchanged.diff).toBe("")
})

test("VIP-67: run inside a repository diffs against its working tree and leaves its index alone", async () => {
  const root = join(base, "repo")
  mkdirSync(root)
  const git = (script: string) =>
    Effect.runPromise(Effect.provide(string(ChildProcess.make("/bin/sh", ["-c", script], { cwd: root })), host))
  await git("git init -q && git -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m base && echo dirty > wip.txt")
  const ran = await Effect.runPromise(Sandbox.run(
    Sandbox.directory(root).pipe(Layer.provide(host)),
    Effect.flatMap(Effect.service(FileSystem.FileSystem), (fs) => fs.writeFileString("made.txt", "made\n"))
  ))
  expect(ran.diff).toContain("made.txt")
  expect(ran.diff).not.toContain("wip.txt")
  expect(await git("git status --porcelain")).toBe("?? made.txt\n?? wip.txt\n")
})

test("VIP-67: supervision retires a dead machine, fails the hung command, and retries land on a fresh one", async () => {
  let opened = 0
  const machines: Array<string> = []
  let hung = false
  const provider = Sandbox.make(Effect.sync(() => {
    opened++
    const id = `machine-${opened}`
    machines.push(id)
    const self = id
    return {
      provider: "flaky",
      id,
      workdir: "/workspace",
      spawn: (line: string) =>
        Effect.succeed(
          self === "machine-1" && hung
            ? { stdout: Stream.never, stderr: Stream.empty, exitCode: Effect.never }
            : { stdout: Stream.make(new TextEncoder().encode(`${self}\n`)), stderr: Stream.empty, exitCode: Effect.succeed(line === "false" ? 1 : 0) }
        )
    } satisfies Sandbox.Machine
  }))
  const result = await Effect.runPromise(Effect.provide(
    Effect.gen(function*() {
      const first = yield* string(ChildProcess.make("echo", []))
      hung = true
      const stuck = yield* Effect.exit(string(ChildProcess.make("echo", [])))
      hung = false
      const retried = yield* string(ChildProcess.make("echo", []))
      return { first, stuck, retried }
    }),
    Sandbox.supervised(provider, { interval: "50 millis", tolerance: 2 })
  ))
  expect(result.first).toBe("machine-1\n")
  expect(Exit.isFailure(result.stuck)).toBe(true)
  expect(JSON.stringify(result.stuck)).toContain("unhealthy")
  expect(result.retried).toBe("machine-2\n")
  expect(machines).toEqual(["machine-1", "machine-2"])
}, 20_000)

const jobKey = () => `test-${Math.random().toString(36).slice(2)}`

test("VIP-67 rule 7: a job starts once by key, outlives its caller's scope, and is collected later", async () => {
  const root = join(base, "jobs")
  const key = jobKey()
  const job = Sandbox.job(`echo run >> ${join(root, "count")}; sleep 1; echo finished; echo note >&2; exit 4`, { key, poll: "50 millis" })
  const provider = () => Sandbox.directory(root).pipe(Layer.provide(host))
  const first = await Effect.runPromise(Effect.provide(job.start, provider()))
  expect(first).toBe("started")
  const again = await Effect.runPromise(Effect.provide(job.start, provider()))
  expect(again).toBe("existing")
  const result = await Effect.runPromise(Effect.provide(job.collect, provider()))
  expect(result).toEqual({ exitCode: 4, stdout: "finished\n", stderr: "note\n" })
  expect(readFileSync(join(root, "count"), "utf8")).toBe("run\n")
  expect(await Effect.runPromise(Effect.provide(job.probe, provider()))).toEqual({ _tag: "Done", exitCode: 4 })
  await Effect.runPromise(Effect.provide(Effect.flatMap(Effect.service(ChildProcessSpawner), (spawner) =>
    spawner.exitCode(ChildProcess.make("/bin/sh", ["-c", `rm -rf "\${TMPDIR:-/tmp}/vibe-sandbox-jobs/${key}"`]))), provider()))
}, 20_000)

test("VIP-67 rule 7: a job the machine cannot account for is lost, never rerun; a cancelled job stays cancelled", async () => {
  const root = join(base, "lost")
  const provider = Sandbox.directory(root).pipe(Layer.provide(host))
  const lost = jobKey()
  const sh = (script: string) =>
    Effect.flatMap(Effect.service(ChildProcessSpawner), (spawner) => spawner.string(ChildProcess.make("/bin/sh", ["-c", script])))
  const status = await Effect.runPromise(Effect.provide(
    Effect.gen(function*() {
      // A job directory whose process is gone and left no exit code.
      yield* sh(`d="\${TMPDIR:-/tmp}/vibe-sandbox-jobs/${lost}"; mkdir -p "$d"; echo 999999 > "$d/pid"`)
      const job = Sandbox.job("echo should-not-run", { key: lost })
      const probe = yield* job.probe
      const start = yield* job.start
      const collected = yield* Effect.exit(job.collect)
      return { probe, start, collected }
    }),
    provider
  ))
  expect(status.probe).toEqual({ _tag: "Lost" })
  expect(status.start).toBe("existing")
  expect(JSON.stringify(status.collected)).toContain("is lost")

  const cancelled = jobKey()
  const job = Sandbox.job(`sleep 30; touch ${join(root, "survived")}`, { key: cancelled })
  const after = await Effect.runPromise(Effect.provide(
    Effect.gen(function*() {
      yield* job.start
      expect(yield* job.probe).toEqual({ _tag: "Running" })
      yield* job.cancel
      return yield* job.probe
    }),
    provider
  ))
  expect(after).toEqual({ _tag: "Cancelled" })
  expect(existsSync(join(root, "survived"))).toBe(false)
  const invalid = await Effect.runPromiseExit(Effect.provide(Sandbox.job("true", { key: "../escape" }).start, provider))
  expect(JSON.stringify(invalid)).toContain("job key")
  await Effect.runPromise(Effect.provide(sh(`rm -rf "\${TMPDIR:-/tmp}/vibe-sandbox-jobs/${lost}" "\${TMPDIR:-/tmp}/vibe-sandbox-jobs/${cancelled}"`), provider))
}, 20_000)

test("VIP-67: Path resolves against the machine's directory in the guest's dialect", async () => {
  const resolved = await Effect.runPromise(Effect.provide(
    Effect.map(Effect.service(Path.Path), (path) => ({
      relative: path.resolve("a/../b"),
      absolute: path.resolve("/etc", "x"),
      join: path.join("a", "b")
    })),
    Sandbox.interpreter({ workdir: "/work/space" })
  ))
  expect(resolved).toEqual({ relative: "/work/space/b", absolute: "/etc/x", join: "a/b" })
})
