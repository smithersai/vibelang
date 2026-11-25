/**
 * Provisioned machines behind the ordinary platform services (VIP-67).
 *
 * A sandbox is a layer: inside `provide Experimental.Sandbox.container({ image }) { … }`
 * the `ChildProcessSpawner`, `FileSystem` and `Path` belong to another
 * machine, and the code in the block does not change.
 *
 * ```ts
 * provide Experimental.Sandbox.container({ image: "node:22" }) {
 *   const spawner = try ChildProcessSpawner.ChildProcessSpawner
 *   return try spawner.string(ChildProcess.make("node", ["--version"]))
 * }
 * ```
 *
 * | Layer | Machine | Isolation it gives |
 * | --- | --- | --- |
 * | {@link directory} | A scratch directory on this machine | None: a separate workspace in the host's own security domain |
 * | {@link command} | Whatever the prefix reaches: `ssh host`, `docker exec id` | The target's |
 * | {@link container} | A container this call starts and removes | The container engine's, as configured. No network unless `network` is set |
 * | {@link kubernetes} | One Pod per layer | The cluster's |
 * | {@link interpreter} | An in-process shell interpreter | No real processes exist |
 *
 * Rules:
 *
 * 1. **Opening is scoped.** The machine lives as long as the layer.
 *    Interruption closes the scope and runs the provider's cleanup. A
 *    cleanup that fails is logged with code `sandbox_cleanup_failed` and
 *    counted on {@link cleanupFailures}; it is never counted as done.
 * 2. **The default is closed.** {@link container} passes `--network none`
 *    unless `network` names a mode.
 * 3. **The environment is replaced, not inherited.** A child sees `PATH`,
 *    `HOME`, `USER`, `LANG`, `LC_*`, `TERM`, `TMPDIR`, `SHELL` and what the
 *    caller declares.
 * 4. **Unsupported process features fail loudly.** Extra file descriptors,
 *    `stdin: "inherit"`, detached processes and custom shells fail with a
 *    `BadArgument` `PlatformError`. Standard input is delivered whole or
 *    refused before the spawn; it is never dropped.
 * 5. **"Sandbox" is three different claims.** A directory separates a
 *    workspace. A container or a virtual machine confines a process. The
 *    interpreter runs no process at all.
 * 6. **A sandbox and a policy stack.** `Capability.guard` inside a sandbox
 *    checks each operation; the sandbox confines the process.
 * 7. **A process handle is not durable.** A command that must outlive the
 *    host that started it is a {@link job}. A job the machine cannot account
 *    for is `Lost`; it is never rerun under a new key.
 * 8. **A new provider proves itself** through one of two seams, a command
 *    runner ({@link fromRunner}) or a machine ({@link make}), and passes
 *    {@link check}.
 * 9. **Failures** are `PlatformError` for an operation and
 *    {@link SandboxError} for the machine.
 *
 * Ported, reduced, from the reference engine's sandbox package. The module
 * adapts a provider and owns no host access of its own: every host provider
 * reaches its machine through the `ChildProcessSpawner` around it.
 *
 * @since 0.0.14
 */
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import type * as Metric from "effect/Metric"
import * as Path from "effect/Path"
import * as PlatformError from "effect/PlatformError"
import * as Schedule from "effect/Schedule"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as ChildProcess from "effect/process/ChildProcess"
import { ChildProcessSpawner, make as makeSpawner, makeHandle } from "effect/process/ChildProcessSpawner"
import * as internal from "./internal/sandbox.js"
import * as conformance from "./internal/sandboxConformance.js"
import { interpreterMachine } from "./internal/sandboxInterpreter.js"
import * as providers from "./internal/sandboxProviders.js"

/**
 * @since 0.0.14
 */
export type TypeId = "~vibelang/experimental/Sandbox"

/**
 * @since 0.0.14
 */
export const TypeId: TypeId = "~vibelang/experimental/Sandbox"

/**
 * Why a machine failed.
 *
 * @category errors
 * @since 0.0.14
 */
export type SandboxErrorCode = internal.SandboxErrorCode

/**
 * A machine could not be opened, reached or retired. An operation on a
 * machine fails with a `PlatformError` instead.
 *
 * @category errors
 * @since 0.0.14
 */
export const SandboxError: typeof internal.SandboxError = internal.SandboxError

/**
 * @category errors
 * @since 0.0.14
 */
export type SandboxError = internal.SandboxError

/**
 * The services a sandbox provides.
 *
 * @category models
 * @since 0.0.14
 */
export type Host = internal.Host

/**
 * A sandbox: a layer that provides the platform services of one machine.
 *
 * @category models
 * @since 0.0.14
 */
export type Sandbox<E = SandboxError, R = never> = Layer.Layer<Host, E, R>

/**
 * One command on a machine, as a provider reports it.
 *
 * @category seams
 * @since 0.0.14
 */
export type RemoteProcess = internal.RemoteProcess

/**
 * A machine a provider holds: the full-lifecycle seam.
 *
 * @category seams
 * @since 0.0.14
 */
export type Machine = internal.Machine

/**
 * The ambient variables a child keeps, with what its caller declares.
 *
 * @category constants
 * @since 0.0.14
 */
export const keptVariables: ReadonlyArray<string> = internal.keptVariables

/**
 * Sandbox teardowns that failed.
 *
 * @category observability
 * @since 0.0.14
 */
export const cleanupFailures: Metric.Counter<number> = providers.cleanupFailures

/**
 * A sandbox over a machine a scoped effect opens: the machine seam. Closing
 * the layer's scope runs the finalizers the effect added.
 *
 * A machine's `spawn` runs in its caller's context, where the platform
 * services are the sandbox's own. Read every host service while opening,
 * as {@link fromRunner} does, or `spawn` reaches itself.
 *
 * @category seams
 * @since 0.0.14
 */
export const make = <E, R>(open: Effect.Effect<Machine, E, R>): Sandbox<E, Exclude<R, Scope.Scope>> =>
  Layer.effectContext(Effect.map(open, internal.hostContext))

/**
 * A sandbox over a command runner: something that runs one `/bin/sh`
 * script on the machine with whole standard input. Files, paths and the
 * environment rule are derived from it.
 *
 * `run` runs in the context the layer was built in, so a runner that reads
 * the host's `ChildProcessSpawner` reads the host's, never the sandbox's
 * own. Only the scope is the caller's: closing it ends the command.
 *
 * @category seams
 * @since 0.0.14
 */
export const fromRunner = <E = never, R = never, RR = never>(options: {
  readonly provider: string
  readonly workdir: string
  readonly run: (
    script: string,
    stdin: Uint8Array | undefined
  ) => Effect.Effect<RemoteProcess, SandboxError, Scope.Scope | RR>
  readonly open?: Effect.Effect<void, E, R> | undefined
}): Sandbox<E, Exclude<R | RR, Scope.Scope>> =>
  make(Effect.gen(function*() {
    if (options.open !== undefined) yield* options.open
    const built = Context.omit(Scope.Scope)(yield* Effect.context<RR>())
    return internal.commandMachine({
      provider: options.provider,
      id: options.provider,
      workdir: options.workdir,
      run: (script, stdin) => Effect.provide(options.run(script, stdin), built) as Effect.Effect<RemoteProcess, SandboxError, Scope.Scope>
    })
  }))

const hosted = <A>(open: (spawner: ChildProcessSpawner["Service"]) => Effect.Effect<Machine, SandboxError, A>) =>
  make(Effect.flatMap(Effect.service(ChildProcessSpawner), open))

/**
 * A scratch directory on this machine. With `root`, that directory, made
 * if missing and kept; without it, a fresh temporary directory removed when
 * the layer closes. Isolation: none. Relative paths resolve inside it, and
 * an absolute path is the host's.
 *
 * @category providers
 * @since 0.0.14
 */
export const directory = (root?: string): Sandbox<SandboxError, ChildProcessSpawner> =>
  hosted((spawner) => providers.directory(spawner, root))

/**
 * Whatever `prefix` reaches: `["ssh", "host"]`, `["docker", "exec", "-i", id]`.
 * The guest command follows the prefix as `/bin/sh -c script`; for `ssh`,
 * or when `joinsArguments` is set, as one quoted command line. Isolation:
 * the target's.
 *
 * @category providers
 * @since 0.0.14
 */
export const command = (
  prefix: ReadonlyArray<string>,
  options?: { readonly workdir?: string | undefined; readonly joinsArguments?: boolean | undefined }
): Sandbox<SandboxError, ChildProcessSpawner> => hosted((spawner) => providers.command(spawner, prefix, options ?? {}))

/**
 * How {@link container} starts its container.
 *
 * @category providers
 * @since 0.0.14
 */
export type ContainerOptions = providers.ContainerOptions

/**
 * A container this layer starts and removes. No network unless `network`
 * names a mode (VIP-67 rule 2). Isolation: the container engine's, as
 * configured.
 *
 * @category providers
 * @since 0.0.14
 */
export const container = (options: ContainerOptions): Sandbox<SandboxError, ChildProcessSpawner> =>
  hosted((spawner) => providers.container(spawner, options))

/**
 * How {@link kubernetes} starts its Pod.
 *
 * @category providers
 * @since 0.0.14
 */
export type KubernetesOptions = providers.KubernetesOptions

/**
 * One Pod for the life of the layer, deleted when it closes. Isolation: the
 * cluster's.
 *
 * @category providers
 * @since 0.0.14
 */
export const kubernetes = (options: KubernetesOptions): Sandbox<SandboxError, ChildProcessSpawner> =>
  hosted((spawner) => providers.kubernetes(spawner, options))

/**
 * An in-process shell interpreter over an in-memory file system, for hosts
 * that cannot spawn. No real process exists, so it needs nothing from the
 * host and runs in a browser and a Worker. It runs a small POSIX-shell
 * subset; anything else exits 127.
 *
 * @category providers
 * @since 0.0.14
 */
export const interpreter = (options?: { readonly workdir?: string | undefined }): Sandbox<never> =>
  make(Effect.sync(() => interpreterMachine(options)))

// ---------------------------------------------------------------------------
// run

const shell = (script: string, env: Record<string, string> = {}) =>
  Effect.scoped(Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner
    const handle = yield* spawner.spawn(ChildProcess.make("/bin/sh", ["-c", script], { env }))
    const decoder = new TextDecoder()
    const [stdout, stderr, code] = yield* Effect.all([
      Stream.mkString(Stream.decodeText(handle.stdout)),
      Stream.runCollect(handle.stderr).pipe(Effect.map((chunks) => decoder.decode(internal.concat(Array.from(chunks))))),
      handle.exitCode
    ], { concurrency: "unbounded" })
    return { stdout, stderr, code: Number(code) }
  }))

const snapshotScript = `idx="$(git rev-parse --git-dir)/vibe-sandbox-$$.index" || exit 1
rm -f "$idx"
GIT_INDEX_FILE="$idx" git add -A . && GIT_INDEX_FILE="$idx" git write-tree; s=$?
rm -f "$idx"
exit $s`

/**
 * What {@link run} gives: the work's result, and what its checkout gained,
 * as a binary git diff. An empty diff means nothing changed.
 *
 * @category run
 * @since 0.0.14
 */
export interface Ran<A> {
  readonly result: A
  readonly diff: string
}

/**
 * Holds one machine for one unit of work and answers its result with the
 * diff of the machine's directory from before the work to after it,
 * untracked files included. It needs `git` on the machine; a directory that
 * is not a repository gets a repository of its own outside it, so the
 * checkout is not changed. The interpreter has no `git`.
 *
 * @category run
 * @since 0.0.14
 */
export const run = <A, E, R, E2, R2>(
  provider: Layer.Layer<Host, E2, R2>,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<Ran<A>, E | E2 | SandboxError | PlatformError.PlatformError, Exclude<R, Host> | R2> => {
  const failed = (step: string, result: { readonly code: number; readonly stderr: string }) =>
    new internal.SandboxError({
      code: "unavailable",
      provider: "run",
      reason: `${step} exited ${result.code}: ${result.stderr.trim().slice(0, 300)}`
    })
  const work = Effect.gen(function*() {
    const probe = yield* shell("git rev-parse --is-inside-work-tree 2>/dev/null")
    const env: Record<string, string> = {}
    let scratch: string | undefined
    if (probe.code !== 0 || probe.stdout.trim() !== "true") {
      const made = yield* shell(`d=$(mktemp -d "\${TMPDIR:-/tmp}/vibe-sandbox-git-XXXXXX") && git init -q --bare "$d" && printf '%s' "$d"`)
      if (made.code !== 0) return yield* Effect.fail(failed("git init", made))
      scratch = made.stdout
      env["GIT_DIR"] = scratch
      env["GIT_WORK_TREE"] = "."
    }
    const snapshot = Effect.flatMap(shell(snapshotScript, env), (result) =>
      result.code === 0 ? Effect.succeed(result.stdout.trim()) : Effect.fail(failed("git write-tree", result)))
    const cleanup = scratch === undefined ? Effect.void : Effect.ignore(shell(`rm -rf -- '${scratch.replaceAll("'", `'\\''`)}'`))
    return yield* Effect.gen(function*() {
      const before = yield* snapshot
      const result = yield* effect
      const after = yield* snapshot
      const diff = yield* shell(`git diff --binary --no-color --no-ext-diff ${before} ${after}`, env)
      if (diff.code !== 0) return yield* Effect.fail(failed("git diff", diff))
      return { result, diff: diff.stdout }
    }).pipe(Effect.ensuring(cleanup))
  })
  return Effect.provide(work, provider) as never
}

// ---------------------------------------------------------------------------
// supervised

/**
 * How {@link supervised} probes its machine.
 *
 * @category supervision
 * @since 0.0.14
 */
export interface SupervisionOptions {
  /** Time between probes, and each probe's deadline. */
  readonly interval: Duration.Input
  /** Failed probes in a row that retire the machine. */
  readonly tolerance: number
}

const unhealthy = (method: string) =>
  PlatformError.systemError({
    _tag: "Unknown",
    module: "ChildProcess",
    method,
    description: "the sandbox was retired as unhealthy; a retry runs on a fresh machine",
    cause: new internal.SandboxError({ code: "unhealthy", provider: "supervised", reason: "probes failed" })
  })

/**
 * `provider`, probed every `interval` with `true`. After `tolerance` failed
 * probes in a row the machine is retired: its commands in flight fail, its
 * scope closes, and the next command runs on a fresh machine from the same
 * provider.
 *
 * @category supervision
 * @since 0.0.14
 */
export const supervised = <E, R>(
  provider: Layer.Layer<Host, E, R>,
  options: SupervisionOptions
): Layer.Layer<Host, E, R> =>
  Layer.effectContext(Effect.gen(function*() {
    const outer = yield* Effect.context<R>()
    interface Generation {
      readonly context: Context.Context<Host>
      readonly scope: Scope.Closeable
      readonly retired: Deferred.Deferred<void>
    }
    const open = Effect.gen(function*() {
      const scope = yield* Scope.make()
      const context = yield* Layer.buildWithScope(provider, scope).pipe(
        Effect.provideContext(outer),
        Effect.onError(() => Scope.close(scope, Exit.void))
      )
      const retired = yield* Deferred.make<void>()
      return { context, scope, retired } satisfies Generation
    })
    let current: Generation = yield* open
    yield* Effect.addFinalizer(() => Scope.close(current.scope, Exit.void))
    const tolerance = Math.max(1, Math.floor(options.tolerance))
    const interval = Duration.fromInputUnsafe(options.interval)
    // The fresh machine is installed before the old one's commands fail, so
    // a caller that retries on that failure lands on the fresh one. A fresh
    // machine that cannot open leaves the old one retired: its commands fail
    // until a later probe opens one.
    const retire = Effect.gen(function*() {
      const old = current
      const fresh = yield* Effect.exit(open)
      if (Exit.isSuccess(fresh)) current = fresh.value
      yield* Deferred.succeed(old.retired, undefined)
      yield* Scope.close(old.scope, Exit.void)
      yield* Effect.logWarning("A sandbox was retired as unhealthy").pipe(Effect.annotateLogs({ code: "sandbox_unhealthy" }))
    })
    let failures = 0
    const probe = Effect.suspend(() => {
      const spawner = Context.get(current.context, ChildProcessSpawner)
      return spawner.exitCode(ChildProcess.make("true", [])).pipe(
        Effect.timeout(interval),
        Effect.flatMap((code) => Number(code) === 0 ? Effect.void : Effect.fail("nonzero")),
        Effect.matchEffect({
          onSuccess: () => Effect.sync(() => {
            failures = 0
          }),
          onFailure: () =>
            Effect.suspend(() => {
              failures++
              if (failures < tolerance) return Effect.void
              failures = 0
              return retire
            })
        })
      )
    })
    yield* Effect.forkScoped(Effect.repeat(Effect.andThen(Effect.sleep(interval), probe), Schedule.forever))
    const generationSpawner = makeSpawner((command) =>
      Effect.gen(function*() {
        const generation = current
        if (yield* Deferred.isDone(generation.retired)) return yield* Effect.fail(unhealthy("spawn"))
        const gone = Effect.andThen(Deferred.await(generation.retired), Effect.fail(unhealthy("exitCode")))
        const handle = yield* Effect.raceFirst(Context.get(generation.context, ChildProcessSpawner).spawn(command), gone)
        const ended = Stream.interruptWhen(Effect.andThen(Deferred.await(generation.retired), Effect.fail(unhealthy("stdout"))))
        const stdout = ended(handle.stdout)
        const stderr = ended(handle.stderr)
        return makeHandle({
          pid: handle.pid,
          exitCode: Effect.raceFirst(handle.exitCode, gone),
          isRunning: handle.isRunning,
          kill: handle.kill,
          stdin: handle.stdin,
          stdout,
          stderr,
          all: Stream.merge(stdout, stderr),
          getInputFd: handle.getInputFd,
          getOutputFd: handle.getOutputFd,
          unref: handle.unref
        })
      })
    )
    const files = new Proxy({} as FileSystem.FileSystem, {
      get: (_, key) => (Context.get(current.context, FileSystem.FileSystem) as unknown as Record<PropertyKey, unknown>)[key]
    })
    return Context.make(ChildProcessSpawner, generationSpawner).pipe(
      Context.add(FileSystem.FileSystem, files),
      Context.add(Path.Path, Context.get(current.context, Path.Path))
    )
  }))

// ---------------------------------------------------------------------------
// job

/**
 * Where a job stands. `Lost` is a job the machine cannot account for: it
 * was started and neither runs nor left an exit code. It is never rerun.
 *
 * @category jobs
 * @since 0.0.14
 */
export type JobStatus =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Running" }
  | { readonly _tag: "Done"; readonly exitCode: number }
  | { readonly _tag: "Cancelled" }
  | { readonly _tag: "Lost" }

/**
 * A finished job's exit code and output.
 *
 * @category jobs
 * @since 0.0.14
 */
export interface JobResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/**
 * A command as durable work on the machine in context, keyed so it starts
 * once. Every member runs on the `ChildProcessSpawner` in context.
 *
 * @category jobs
 * @since 0.0.14
 */
export interface Job {
  readonly key: string
  /** Starts the command unless a job with this key was started; answers which. */
  readonly start: Effect.Effect<"started" | "existing", SandboxError | PlatformError.PlatformError, ChildProcessSpawner>
  readonly probe: Effect.Effect<JobStatus, SandboxError | PlatformError.PlatformError, ChildProcessSpawner>
  /** Waits for the job to finish. Fails with a `lost` or `aborted` {@link SandboxError} for a job that will not. */
  readonly collect: Effect.Effect<JobResult, SandboxError | PlatformError.PlatformError, ChildProcessSpawner>
  /** Ends the job and its children. A cancelled job stays cancelled. */
  readonly cancel: Effect.Effect<void, SandboxError | PlatformError.PlatformError, ChildProcessSpawner>
}

const jobKey = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/**
 * A command as durable work: start once by key, probe, collect, cancel. The
 * job's state lives on the machine under `$TMPDIR/vibe-sandbox-jobs/<key>`,
 * so a host that restarts finds it by its key. `command` is a `/bin/sh`
 * script, or an argument list quoted into one. It needs a POSIX shell with
 * job control, so the interpreter cannot run one.
 *
 * @category jobs
 * @since 0.0.14
 */
export const job = (
  command: string | ReadonlyArray<string>,
  options: { readonly key: string; readonly poll?: Duration.Input | undefined }
): Job => {
  const script = typeof command === "string" ? command : command.map(internal.quote).join(" ")
  const key = options.key
  const invalid = Effect.fail(new internal.SandboxError({ code: "unavailable", provider: "job", reason: "a job key is 1 to 128 of A-Z a-z 0-9 . _ -, starting with a letter or digit" }))
  const dir = `"\${TMPDIR:-/tmp}/vibe-sandbox-jobs/${key}"`
  const fail = (step: string, result: { readonly code: number; readonly stderr: string }) =>
    new internal.SandboxError({ code: "unavailable", provider: "job", reason: `${step} exited ${result.code}: ${result.stderr.trim().slice(0, 300)}` })
  const valid = <A, E, R>(effect: Effect.Effect<A, E, R>) => (jobKey.test(key) ? effect : invalid)
  const start = valid(Effect.flatMap(
    shell(
      `d=${dir}; mkdir -p "$(dirname "$d")" || exit 1
if ! mkdir "$d" 2>/dev/null; then printf existing; exit 0; fi
printf '%s\\n' ${internal.quote(script)} > "$d/command" || exit 1
if command -v setsid >/dev/null 2>&1; then launcher=setsid; else set -m; launcher=nohup; fi
"$launcher" /bin/sh -c 'd="$1"; echo $$ > "$d/pid.tmp" && mv "$d/pid.tmp" "$d/pid" || exit 1; /bin/sh "$d/command" > "$d/stdout" 2> "$d/stderr"; echo $? > "$d/exit.tmp"; mv "$d/exit.tmp" "$d/exit"' sh "$d" > /dev/null 2>&1 < /dev/null &
attempt=0
while [ ! -s "$d/pid" ]; do
  attempt=$((attempt + 1)); [ "$attempt" -le 5 ] || exit 1
  sleep 1
done
printf started`
    ),
    (result) =>
      result.code === 0 && (result.stdout === "started" || result.stdout === "existing")
        ? Effect.succeed(result.stdout as "started" | "existing")
        : Effect.fail(fail("job start", result))
  ))
  const probe = valid(Effect.flatMap(
    shell(
      `d=${dir}; if [ ! -d "$d" ]; then printf absent; elif [ -f "$d/cancelled" ]; then printf cancelled; ` +
        `elif [ -f "$d/exit" ]; then printf 'done %s' "$(cat "$d/exit")"; ` +
        `elif [ -f "$d/pid" ] && kill -0 "$(cat "$d/pid")" 2>/dev/null; then printf running; ` +
        `elif [ ! -f "$d/pid" ]; then sleep 1; if [ -f "$d/pid" ]; then printf running; else printf lost; fi; else printf lost; fi`
    ),
    (result): Effect.Effect<JobStatus, SandboxError> => {
      if (result.code !== 0) return Effect.fail(fail("job probe", result))
      const answer = result.stdout.trim()
      if (answer === "absent") return Effect.succeed({ _tag: "Absent" })
      if (answer === "cancelled") return Effect.succeed({ _tag: "Cancelled" })
      if (answer === "running") return Effect.succeed({ _tag: "Running" })
      const done = /^done (\d+)$/.exec(answer)
      if (done !== null) return Effect.succeed({ _tag: "Done", exitCode: Number(done[1]) })
      return Effect.succeed({ _tag: "Lost" })
    }
  ))
  const poll = Duration.fromInputUnsafe(options.poll ?? "200 millis")
  const collect = valid(Effect.gen(function*() {
    while (true) {
      const status = yield* probe
      if (status._tag === "Done") {
        const out = yield* shell(`cat ${dir}/stdout`)
        const err = yield* shell(`cat ${dir}/stderr`)
        return { exitCode: status.exitCode, stdout: out.stdout, stderr: err.stdout }
      }
      if (status._tag === "Running") {
        yield* Effect.sleep(poll)
        continue
      }
      return yield* Effect.fail(new internal.SandboxError({
        code: status._tag === "Cancelled" ? "aborted" : status._tag === "Absent" ? "not_found" : "unknown",
        provider: "job",
        reason: status._tag === "Lost"
          ? `job ${key} is lost: it neither runs nor left an exit code, and it is not rerun`
          : status._tag === "Cancelled" ? `job ${key} was cancelled` : `job ${key} was never started`
      }))
    }
  }))
  const cancel = valid(Effect.flatMap(
    shell(
      `d=${dir}; [ -d "$d" ] || exit 0; : > "$d/cancelled"; ` +
        `if [ -f "$d/pid" ]; then p=$(cat "$d/pid"); kill -TERM -"$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null; fi; exit 0`
    ),
    (result) => result.code === 0 ? Effect.void : Effect.fail(fail("job cancel", result))
  ))
  return { key, start, probe, collect, cancel }
}

// ---------------------------------------------------------------------------
// check

/**
 * One case of the conformance suite.
 *
 * @category conformance
 * @since 0.0.14
 */
export type CheckResult = conformance.CheckResult

/**
 * What {@link check} found.
 *
 * @category conformance
 * @since 0.0.14
 */
export interface Report extends conformance.Report {
  /** VIP-67 follow-up 3: whether a guest's outbound requests can be routed through `Secrets.forward`. */
  readonly egress: "unsupported"
}

/**
 * Runs the conformance suite a provider must pass: output, exit codes,
 * argument quoting, whole standard input, the replaced environment, the
 * working directory, files, the refusals of rule 4, and interruption. A
 * provider that cannot be opened fails with its own error.
 *
 * @category conformance
 * @since 0.0.14
 */
export const check = <E, R>(provider: Layer.Layer<Host, E, R>): Effect.Effect<Report, E, R> =>
  Effect.map(Effect.provide(conformance.run, provider), (report) => ({ ...report, egress: "unsupported" as const }))
