/**
 * The providers of `Experimental.Sandbox` (VIP-67) that reach a machine
 * through the host's `ChildProcessSpawner`: a directory, a command prefix,
 * a container and a Kubernetes Pod. Each is a command runner
 * ({@link commandMachine}); its files, paths and processes are derived.
 * Ported, reduced, from the reference engine's `DirectorySandbox`,
 * `CommandSandbox`, `ContainerSandbox` and `KubernetesSandbox`.
 *
 * @internal
 */
import * as Effect from "effect/Effect"
import * as Metric from "effect/Metric"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as ChildProcess from "effect/process/ChildProcess"
import type { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { commandMachine, concat, fromHandle, type Machine, type RemoteProcess, SandboxError } from "./sandbox.js"

type Spawner = ChildProcessSpawner["Service"]

const decoder = new TextDecoder()

/** Teardowns that failed. A cleanup that fails is reported, never counted as done (VIP-67 rule 1). */
export const cleanupFailures: Metric.Counter<number> = Metric.counter("sandbox_cleanup_failures", {
  description: "Sandbox teardowns that failed",
  incremental: true
})

/** Runs `argv` on the host with whole standard input. */
export const hostRun = (provider: string, spawner: Spawner, argv: ReadonlyArray<string>, stdin?: Uint8Array) =>
  Effect.map(
    Effect.mapError(
      spawner.spawn(ChildProcess.make(argv[0]!, argv.slice(1), {
        stdin: stdin === undefined ? "ignore" : Stream.make(stdin),
        stdout: "pipe",
        stderr: "pipe"
      })),
      (cause) =>
        new SandboxError({
          code: "spawn_error",
          provider,
          reason: `${argv[0]} could not start on this machine`,
          cause
        })
    ),
    (handle) => fromHandle(provider, handle)
  )

export interface Gathered {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** One process run to its end, its output collected. */
export const gather = (process: Effect.Effect<RemoteProcess, SandboxError, Scope.Scope>): Effect.Effect<Gathered, SandboxError> =>
  Effect.scoped(Effect.gen(function*() {
    const started = yield* process
    const [stdout, stderr, code] = yield* Effect.all([
      Stream.runCollect(started.stdout).pipe(Effect.map((chunks) => decoder.decode(concat(Array.from(chunks))))),
      Stream.runCollect(started.stderr).pipe(Effect.map((chunks) => decoder.decode(concat(Array.from(chunks))))),
      started.exitCode
    ], { concurrency: "unbounded" })
    return { code, stdout, stderr }
  }))

const brief = (text: string) => text.trim().split("\n").slice(-3).join(" ").slice(0, 300)

/** A teardown in the scope: its failure is logged with code `sandbox_cleanup_failed` and counted. */
const teardown = (provider: string, id: string, work: Effect.Effect<Gathered, SandboxError>) =>
  Effect.addFinalizer(() =>
    work.pipe(
      Effect.flatMap((result) =>
        result.code === 0
          ? Effect.void
          : Effect.fail(new SandboxError({ code: "cleanup", provider, reason: `teardown of ${id} exited ${result.code}: ${brief(result.stderr)}` }))
      ),
      Effect.catch((error: SandboxError) =>
        Metric.update(cleanupFailures, 1).pipe(
          Effect.andThen(Effect.logError("A sandbox teardown failed").pipe(
            Effect.annotateLogs({ code: "sandbox_cleanup_failed", provider, id, reason: error.reason })
          ))
        )
      )
    )
  )

const unavailable = (provider: string, step: string, result: Gathered) =>
  new SandboxError({
    code: /unable to find image|pull access denied|not found|no such|manifest unknown|ErrImagePull/i.test(result.stderr)
      ? "not_found"
      : "unavailable",
    provider,
    reason: `${step} exited ${result.code}: ${brief(result.stderr)}`
  })

const randomName = () =>
  `vibe-sandbox-${Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`

const keepAlive = `trap 'exit 0' TERM INT; while :; do sleep 3600 & wait $!; done`

export const directory = (spawner: Spawner, root: string | undefined): Effect.Effect<Machine, SandboxError, Scope.Scope> =>
  Effect.gen(function*() {
    const run = (script: string, stdin?: Uint8Array) => hostRun("directory", spawner, ["/bin/sh", "-c", script], stdin)
    let workdir: string
    if (root === undefined) {
      const made = yield* gather(run(`mktemp -d "\${TMPDIR:-/tmp}/vibe-sandbox-XXXXXX"`))
      if (made.code !== 0) return yield* Effect.fail(unavailable("directory", "mktemp", made))
      const created = made.stdout.trim()
      const real = yield* gather(run(`cd -P -- '${created.replaceAll("'", `'\\''`)}' && pwd -P`))
      workdir = real.code === 0 ? real.stdout.trim() : created
      yield* teardown("directory", workdir, gather(run(`rm -rf -- '${workdir.replaceAll("'", `'\\''`)}'`)))
    } else {
      const quoted = `'${root.replaceAll("'", `'\\''`)}'`
      const made = yield* gather(run(`mkdir -p -- ${quoted} && cd -P -- ${quoted} && pwd -P`))
      if (made.code !== 0) return yield* Effect.fail(unavailable("directory", "mkdir", made))
      workdir = made.stdout.trim()
    }
    return commandMachine({ provider: "directory", id: workdir, workdir, run })
  })

export const command = (
  spawner: Spawner,
  prefix: ReadonlyArray<string>,
  options: { readonly workdir?: string | undefined; readonly joinsArguments?: boolean | undefined }
): Effect.Effect<Machine, SandboxError, Scope.Scope> =>
  Effect.gen(function*() {
    if (prefix.length === 0) {
      return yield* Effect.fail(new SandboxError({ code: "unavailable", provider: "command", reason: "the prefix names no program" }))
    }
    const joins = options.joinsArguments ?? /(^|\/)ssh(\.exe)?$/.test(prefix[0]!)
    const quote = (word: string) => `'${word.replaceAll("'", `'\\''`)}'`
    const run = (script: string, stdin?: Uint8Array) =>
      hostRun("command", spawner, [...prefix, ...(joins ? [`/bin/sh -c ${quote(script)}`] : ["/bin/sh", "-c", script])], stdin)
    const located = yield* gather(run(options.workdir === undefined ? "pwd -P" : `mkdir -p -- ${quote(options.workdir)} && cd -P -- ${quote(options.workdir)} && pwd -P`))
    if (located.code !== 0) return yield* Effect.fail(unavailable("command", prefix[0]!, located))
    const workdir = located.stdout.trim()
    return commandMachine({ provider: "command", id: prefix[0]!, workdir, run })
  })

export interface ContainerOptions {
  readonly image: string
  /** A `--network` mode. Absent, the container has none (VIP-67 rule 2). */
  readonly network?: string | undefined
  readonly workdir?: string | undefined
  /** The container engine's program: `docker` by default, or `podman`. */
  readonly engine?: string | undefined
}

/** The `run` argv that starts a container for `options`. Exported for tests. */
export const containerRunArgv = (options: ContainerOptions, name: string): ReadonlyArray<string> => [
  options.engine ?? "docker",
  "run",
  "-d",
  "--rm",
  "--name",
  name,
  "--label",
  "vibe.sandbox=1",
  "--network",
  options.network ?? "none",
  "-w",
  options.workdir ?? "/workspace",
  "--entrypoint",
  "/bin/sh",
  options.image,
  "-c",
  keepAlive
]

export const container = (spawner: Spawner, options: ContainerOptions): Effect.Effect<Machine, SandboxError, Scope.Scope> =>
  Effect.gen(function*() {
    const engine = options.engine ?? "docker"
    const workdir = options.workdir ?? "/workspace"
    const name = randomName()
    const started = yield* gather(hostRun("container", spawner, containerRunArgv(options, name)))
    if (started.code !== 0) return yield* Effect.fail(unavailable("container", `${engine} run`, started))
    const id = started.stdout.trim() || name
    yield* teardown("container", id, gather(hostRun("container", spawner, [engine, "rm", "-f", id])))
    const run = (script: string, stdin?: Uint8Array) =>
      hostRun("container", spawner, [engine, "exec", "-i", id, "/bin/sh", "-c", script], stdin)
    return commandMachine({ provider: "container", id, workdir, run })
  })

export interface KubernetesOptions {
  readonly image: string
  readonly namespace?: string | undefined
  readonly workdir?: string | undefined
  /** The `kubectl` program. */
  readonly kubectl?: string | undefined
  /** How long the Pod may take to become ready. */
  readonly readyTimeout?: string | undefined
}

export const kubernetes = (spawner: Spawner, options: KubernetesOptions): Effect.Effect<Machine, SandboxError, Scope.Scope> =>
  Effect.gen(function*() {
    const kubectl = options.kubectl ?? "kubectl"
    const namespace = options.namespace ?? "default"
    const workdir = options.workdir ?? "/workspace"
    const name = randomName()
    const base = [kubectl, "-n", namespace]
    const created = yield* gather(hostRun("kubernetes", spawner, [
      ...base,
      "run",
      name,
      `--image=${options.image}`,
      "--restart=Never",
      "--labels=vibe.sandbox=1",
      "--command",
      "--",
      "/bin/sh",
      "-c",
      `mkdir -p '${workdir.replaceAll("'", `'\\''`)}'; ${keepAlive}`
    ]))
    if (created.code !== 0) return yield* Effect.fail(unavailable("kubernetes", "kubectl run", created))
    yield* teardown("kubernetes", name, gather(hostRun("kubernetes", spawner, [...base, "delete", "pod", name, "--wait=false", "--grace-period=0"])))
    const ready = yield* gather(hostRun("kubernetes", spawner, [
      ...base,
      "wait",
      "--for=condition=Ready",
      `pod/${name}`,
      `--timeout=${options.readyTimeout ?? "120s"}`
    ]))
    if (ready.code !== 0) return yield* Effect.fail(unavailable("kubernetes", "kubectl wait", ready))
    const run = (script: string, stdin?: Uint8Array) =>
      hostRun("kubernetes", spawner, [...base, "exec", "-i", name, "--", "/bin/sh", "-c", script], stdin)
    return commandMachine({ provider: "kubernetes", id: name, workdir, run })
  })
