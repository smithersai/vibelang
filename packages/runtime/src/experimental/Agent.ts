/**
 * Agents (VIP-63).
 *
 * {@link cli} drives a coding-agent CLI, a program that speaks the Agent
 * Client Protocol on its stdio, through one task, and says which files the
 * CLI changed. The host names its CLIs with {@link layerCli}.
 *
 * {@link detect} reports which coding-agent CLIs the machine has.
 *
 * {@link run} runs a model in a loop until it produces a typed answer: each
 * turn the model writes a short JavaScript cell that runs in a QuickJS
 * sandbox and reaches the world only through the tools it was handed.
 * {@link stream} is the same run as a stream of events.
 *
 * @experimental
 * @since 0.0.13
 */
import type * as Cause from "effect/Cause"
import * as Config from "effect/Config"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as ChildProcess from "effect/process/ChildProcess"
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import type * as AiError from "effect/ai/AiError"
import type * as LanguageModel from "effect/ai/LanguageModel"
import type * as Tool from "effect/ai/Tool"
import type * as Toolkit from "effect/ai/Toolkit"
import * as Acp from "./internal/agentAcp.js"
import * as Loop from "./internal/agentLoop.js"

/**
 * @category type ids
 * @since 0.0.13
 */
export type TypeId = "~vibelang/experimental/Agent"

/**
 * @category type ids
 * @since 0.0.13
 */
export const TypeId: TypeId = "~vibelang/experimental/Agent"

// -----------------------------------------------------------------------------
// Failures
// -----------------------------------------------------------------------------

/**
 * Why an agent failed.
 *
 * - `profile_unknown`: {@link cli} was given a profile the host did not
 *   configure. Nothing was started.
 * - `cli_unavailable`: the profile's command could not be started, or it is
 *   not an agent that speaks the protocol.
 * - `cli_failed`: the CLI's session broke: its process ended, it answered
 *   with an error, or it sent what the protocol does not allow.
 * - `cli_stopped`: the CLI ended its turn without finishing the task: it
 *   refused, or ran out of tokens or turns.
 * - `invalid_options`: {@link run} was given a limit, budget or prompt it
 *   cannot use. No model was asked.
 * - `sandbox_unavailable`: the QuickJS sandbox could not be loaded, or broke.
 * - `turns_exhausted`: {@link run} spent `maxTurns` without a valid answer.
 * - `output_invalid`: the answer missed `output` and the corrections were
 *   spent.
 * - `judge_unavailable`: `judge` is positive and the decision model could
 *   not be reached. A run is never approved without it.
 *
 * @category errors
 * @since 0.0.13
 */
export const AgentFailedReason = Schema.Literals([
  "profile_unknown",
  "cli_unavailable",
  "cli_failed",
  "cli_stopped",
  "invalid_options",
  "sandbox_unavailable",
  "turns_exhausted",
  "output_invalid",
  "judge_unavailable"
])

/**
 * @category errors
 * @since 0.0.13
 */
export type AgentFailedReason = typeof AgentFailedReason.Type

/**
 * An agent that ended without doing its task.
 *
 * @category errors
 * @since 0.0.13
 */
export class AgentFailed extends Schema.TaggedError<AgentFailed>()("AgentFailed", {
  reason: AgentFailedReason,
  message: Schema.String,
  /** Model turns taken before the failure. A CLI session counts none. */
  turns: Schema.Number
}) {}

// -----------------------------------------------------------------------------
// Coding-agent CLIs
// -----------------------------------------------------------------------------

/**
 * How the host starts one coding-agent CLI: a command that speaks the Agent
 * Client Protocol (ACP) on its stdio, its arguments, and environment
 * variables added to the host's.
 *
 * @category cli
 * @since 0.0.13
 */
export interface CliProfile {
  readonly command: string
  readonly args?: ReadonlyArray<string> | undefined
  readonly env?: Readonly<Record<string, string>> | undefined
  /**
   * Milliseconds the CLI has to start a session, from its start to its
   * answer to `session/new`. 120,000 unless set.
   */
  readonly startMs?: number | undefined
}

/**
 * The profiles {@link cli} can start, by name. It is empty by default: this
 * module names no vendor, and the host says which CLIs it has with
 * {@link layerCli}.
 *
 * @category cli
 * @since 0.0.13
 */
export const CliProfiles: Context.Reference<Readonly<Record<string, CliProfile>>> = /* @__PURE__ */ Context.Reference<
  Readonly<Record<string, CliProfile>>
>("vibelang/experimental/Agent/CliProfiles", { defaultValue: () => ({}) })

/**
 * Configures the CLIs {@link cli} can start, for the program inside it.
 *
 * **Example** (One profile)
 *
 * ```ts
 * import { Agent } from "vibelang-runtime/experimental"
 *
 * const Clis = Agent.layerCli({ coder: { command: "coder-acp", args: ["--stdio"] } })
 * ```
 *
 * @category cli
 * @since 0.0.13
 */
export const layerCli = (profiles: Readonly<Record<string, CliProfile>>): Layer.Layer<never> =>
  Layer.succeed(CliProfiles, { ...profiles })

/**
 * The options of {@link cli}.
 *
 * @category cli
 * @since 0.0.13
 */
export interface CliOptions {
  /** The task. */
  readonly prompt: string
  /** The directory the CLI works in. */
  readonly cwd: string
  /**
   * How the CLI's permission requests are answered: `"allow"`, the default,
   * picks an allow option, for one use when the CLI offers that, and
   * `"reject"` picks a reject option.
   */
  readonly permission?: "allow" | "reject" | undefined
}

/**
 * What a finished CLI session gives. Both fields come from outside the
 * program: `summary` is text a model wrote and is not trusted.
 *
 * @category cli
 * @since 0.0.13
 */
export interface CliResult {
  /** The CLI's message text in the turn, cut at 1,048,576 characters. */
  readonly summary: string
  /**
   * The files under `cwd` that the session added, changed or removed, as
   * paths relative to `cwd` with `/` separators, sorted. Files under `.git`,
   * `.jj` and `node_modules` are not listed. A file counts as changed when
   * its size or modification time differs. A symbolic link is one entry and
   * is not followed.
   */
  readonly changed: ReadonlyArray<string>
}

const untracked = new Set([".git", ".jj", "node_modules"])

// Every file under `root` with its size and modification time. A file that
// vanishes while it is read is not there. A symbolic link is one entry,
// whatever it points at: following it could leave `root`, or never end.
const snapshot = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string
): Effect.Effect<Map<string, string>> =>
  Effect.gen(function*() {
    const files = new Map<string, string>()
    const walk = (directory: string, relative: string): Effect.Effect<void> =>
      Effect.gen(function*() {
        const names = yield* Effect.orElseSucceed(fs.readDirectory(directory), (): Array<string> => [])
        yield* Effect.forEach(names, (name) =>
          Effect.gen(function*() {
            if (untracked.has(name)) return
            const full = path.join(directory, name)
            const at = relative === "" ? name : `${relative}/${name}`
            const link = yield* Effect.option(fs.readLink(full))
            if (Option.isSome(link)) return void files.set(at, `link:${link.value}`)
            const info = yield* Effect.option(fs.stat(full))
            if (Option.isNone(info)) return
            if (info.value.type === "Directory") return yield* walk(full, at)
            const modified = Option.match(info.value.mtime, { onNone: () => 0, onSome: (date) => date.getTime() })
            files.set(at, `${info.value.size}:${modified}`)
          }), { concurrency: 16, discard: true })
      })
    yield* walk(root, "")
    return files
  })

const changedBetween = (before: Map<string, string>, after: Map<string, string>): Array<string> => {
  const changed = new Set<string>()
  for (const [file, stamp] of after) if (before.get(file) !== stamp) changed.add(file)
  for (const file of before.keys()) if (!after.has(file)) changed.add(file)
  return [...changed].sort()
}

const cliFailed = (reason: AgentFailedReason, message: string): AgentFailed =>
  new AgentFailed({ reason, message, turns: 0 })

// An error of the conversation, by code. The CLI's own message is never
// kept: it can quote the task.
const acpFailed = (profile: string, before: boolean) => (error: Acp.AcpError): AgentFailed =>
  before
    ? cliFailed(
      "cli_unavailable",
      `The ${profile} CLI did not start a session: ${error.method} ended ${error.code}${error.rpcCode === undefined ? "" : ` (${error.rpcCode})`}.`
    )
    : cliFailed(
      "cli_failed",
      `The ${profile} CLI's session broke: ${error.method} ended ${error.code}${error.rpcCode === undefined ? "" : ` (${error.rpcCode})`}.`
    )

const encoder = /* @__PURE__ */ new TextEncoder()

const defaultStartMs = 120_000
// How long an interrupted session's CLI has to end its turn after it is asked
// to cancel, and then to exit after it is asked to stop.
const cancelMs = 2000
const killAfterMs = 2000
const summaryChars = 1024 * 1024
// Messages waiting to be written to the CLI. Past this the client stops
// reading the CLI's output until the CLI reads its input.
const outgoingMessages = 64

/**
 * Drives a coding-agent CLI through one task. `profile` names a
 * {@link CliProfile} the host configured with {@link layerCli}; the CLI
 * speaks the Agent Client Protocol on its stdio.
 *
 * - The CLI runs in whatever `ChildProcessSpawner` is in context, in `cwd`,
 *   with the host's environment and the profile's.
 * - The client offers the CLI no file system and no terminal, so it works
 *   with its own tools. Its permission requests are answered by `permission`.
 * - The session is one step. Interrupting it asks the CLI to cancel, gives
 *   it two seconds to end its turn, and ends its process.
 * - What the CLI writes is untrusted and bounded: a protocol line longer
 *   than 16,777,216 characters ends the session as `cli_failed`, and a CLI
 *   that starts no session within the profile's `startMs` is
 *   `cli_unavailable`.
 * - `changed` is read from `cwd` before and after, not from what the CLI
 *   reports.
 *
 * It fails with {@link AgentFailed}: `profile_unknown`, `cli_unavailable`,
 * `cli_failed` or `cli_stopped`.
 *
 * @category cli
 * @since 0.0.13
 */
export const cli = (
  profile: string,
  options: CliOptions
): Effect.Effect<
  CliResult,
  AgentFailed,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const profiles = yield* CliProfiles
    const configured = Object.hasOwn(profiles, profile) ? profiles[profile] : undefined
    if (configured === undefined) {
      return yield* cliFailed(
        "profile_unknown",
        `No CLI profile named ${JSON.stringify(profile)} is configured on this host. Provide Experimental.Agent.layerCli({ ${
          JSON.stringify(profile)
        }: { command } }).`
      )
    }
    const startMs = configured.startMs ?? defaultStartMs
    if (!Number.isSafeInteger(startMs) || startMs < 1) {
      return yield* cliFailed(
        "cli_unavailable",
        `The ${profile} CLI profile's startMs must be a whole number of milliseconds, at least 1.`
      )
    }
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const before = yield* snapshot(fs, path, options.cwd)

    const child = yield* ChildProcess.make(configured.command, [...(configured.args ?? [])], {
      cwd: options.cwd,
      env: { ...configured.env },
      extendEnv: true,
      // A CLI that ignores the request to stop is killed, so ending the step never waits on it.
      forceKillAfter: killAfterMs
    }).pipe(
      Effect.mapError(() => cliFailed("cli_unavailable", `The ${profile} CLI could not be started.`))
    )
    const outgoing = yield* Queue.bounded<Uint8Array, Cause.Done>(outgoingMessages)
    yield* Effect.forkScoped(Effect.ignore(Stream.run(Stream.fromQueue(outgoing), child.stdin)))
    // What the CLI writes to its error stream is read and dropped, so a CLI
    // that logs there never blocks on a full pipe.
    yield* Effect.forkScoped(Effect.ignore(Stream.runDrain(child.stderr)))
    let summary = ""
    let current: string | undefined
    const client = yield* Acp.make(
      {
        incoming: Acp.lines(child.stdout.pipe(Stream.decodeText())),
        send: (line) => Effect.asVoid(Queue.offer(outgoing, encoder.encode(`${line}\n`)))
      },
      {
        onUpdate: (update) =>
          Effect.sync(() => {
            // Only this session's text, and only as much as the bound keeps.
            if (update.sessionId !== current || summary.length >= summaryChars) return
            const piece = Acp.messageText(update)
            if (Option.isSome(piece)) summary = (summary + piece.value).slice(0, summaryChars)
          }),
        permission: options.permission ?? "allow",
        clientInfo: { name: "vibelang-runtime", version: "0" }
      }
    )
    const session = yield* client.initialize.pipe(
      Effect.andThen(client.newSession(options.cwd)),
      Effect.mapError(acpFailed(profile, true)),
      Effect.timeoutOrElse({
        duration: startMs,
        orElse: () =>
          Effect.fail(cliFailed("cli_unavailable", `The ${profile} CLI did not start a session within ${startMs} milliseconds.`))
      })
    )
    current = session
    // The turn runs on its own fiber, so an interrupted step can ask the CLI
    // to cancel and wait a moment for the turn to end before the scope ends
    // the process.
    const turn = yield* Effect.forkScoped(client.prompt(session, options.prompt))
    const stop = yield* Fiber.join(turn).pipe(
      Effect.onInterrupt(() =>
        client.cancel(session).pipe(
          Effect.andThen(Effect.interruptible(Fiber.await(turn))),
          Effect.timeout(cancelMs),
          Effect.ignore
        )
      ),
      Effect.mapError(acpFailed(profile, false))
    )
    if (stop !== "end_turn") {
      return yield* cliFailed("cli_stopped", `The ${profile} CLI ended its turn without finishing: ${stop}.`)
    }
    const after = yield* snapshot(fs, path, options.cwd)
    return { summary: summary.trim(), changed: changedBetween(before, after) }
  }).pipe(Effect.scoped)

// -----------------------------------------------------------------------------
// Which CLIs a machine has
// -----------------------------------------------------------------------------

/**
 * How a coding-agent CLI stands on this machine.
 *
 * - `unavailable`: its binary was not found.
 * - `binary-only`: the binary is there, with no sign that it can reach a model.
 * - `api-key`: a key variable it reads is set. `account.label` is the
 *   variable's name, never its value.
 * - `signed-in`: its sign-in state exists on disk.
 *
 * @category detect
 * @since 0.0.13
 */
export type CliStatus = "unavailable" | "binary-only" | "api-key" | "signed-in"

/**
 * One coding-agent CLI, as {@link detect} found it.
 *
 * @category detect
 * @since 0.0.13
 */
export interface DetectedCli {
  /** A stable id: `claude`, `codex` or `opencode`. */
  readonly id: string
  /** The product's name. */
  readonly name: string
  /** The binary's absolute path, when it was found. */
  readonly binary: string | undefined
  /** The version its `--version` printed, when it answered in three seconds. */
  readonly version: string | undefined
  readonly status: CliStatus
  /** Who is signed in, or which key variable is set, when that is known without reading a credential. */
  readonly account: { readonly email?: string; readonly label?: string } | undefined
}

interface Host {
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
  readonly home: string
  /** The value of a host variable that is set and not empty. */
  readonly variable: (name: string) => Effect.Effect<string | undefined>
}

interface Signal {
  readonly status: Exclude<CliStatus, "unavailable">
  readonly account: DetectedCli["account"]
}

interface Detector {
  readonly id: string
  readonly name: string
  readonly binary: string
  readonly signal: (host: Host) => Effect.Effect<Signal>
}

const isFile = (host: Host, file: string): Effect.Effect<boolean> =>
  Effect.orElseSucceed(Effect.map(host.fs.stat(file), (info) => info.type === "File"), () => false)

// The first of these variables that is set. Its name is reported; its value
// is dropped here.
const keyVariable = (host: Host, names: ReadonlyArray<string>): Effect.Effect<Signal> =>
  Effect.gen(function*() {
    for (const name of names) {
      if ((yield* host.variable(name)) !== undefined) return { status: "api-key", account: { label: name } } as const
    }
    return { status: "binary-only", account: undefined } as const
  })

const textField = (value: unknown): string | undefined => typeof value === "string" && value !== "" ? value : undefined

// The table of CLIs. Each row reads only what says whether the CLI is signed
// in: whether its credential file exists, never what is in it.
const detectors: ReadonlyArray<Detector> = [
  {
    id: "claude",
    name: "Claude Code",
    binary: "claude",
    signal: (host) =>
      Effect.gen(function*() {
        const custom = yield* host.variable("CLAUDE_CONFIG_DIR")
        const directory = custom ?? host.path.join(host.home, ".claude")
        // The CLI's state file names the signed-in account. The file can hold
        // other settings too; only the account's name and organization are
        // taken from it, and nothing else in it is kept.
        for (const file of [...(custom === undefined ? [] : [host.path.join(custom, ".claude.json")]), host.path.join(host.home, ".claude.json")]) {
          const state = yield* Effect.option(host.fs.readFileString(file))
          if (Option.isNone(state)) continue
          let account: unknown
          try {
            account = (JSON.parse(state.value) as { readonly oauthAccount?: unknown } | null)?.oauthAccount
          } catch {
            account = undefined
          }
          if (typeof account === "object" && account !== null) {
            const { emailAddress, organizationName } = account as Record<string, unknown>
            const email = textField(emailAddress)
            const label = textField(organizationName)
            return {
              status: "signed-in",
              account: { ...(email === undefined ? {} : { email }), ...(label === undefined ? {} : { label }) }
            } as const
          }
          break
        }
        if (yield* isFile(host, host.path.join(directory, ".credentials.json"))) {
          return { status: "signed-in", account: undefined } as const
        }
        return yield* keyVariable(host, ["ANTHROPIC_API_KEY"])
      })
  },
  {
    id: "codex",
    name: "Codex",
    binary: "codex",
    signal: (host) =>
      Effect.gen(function*() {
        const directory = (yield* host.variable("CODEX_HOME")) ?? host.path.join(host.home, ".codex")
        if (yield* isFile(host, host.path.join(directory, "auth.json"))) return { status: "signed-in", account: undefined } as const
        return yield* keyVariable(host, ["OPENAI_API_KEY"])
      })
  },
  {
    id: "opencode",
    name: "OpenCode",
    binary: "opencode",
    signal: (host) =>
      Effect.gen(function*() {
        if (yield* isFile(host, host.path.join(host.home, ".local", "share", "opencode", "auth.json"))) {
          return { status: "signed-in", account: undefined } as const
        }
        return yield* keyVariable(host, [
          "OPENCODE_API_KEY",
          "ANTHROPIC_API_KEY",
          "OPENAI_API_KEY",
          "GEMINI_API_KEY",
          "GOOGLE_API_KEY",
          "KIMI_API_KEY"
        ])
      })
  }
]

const nodeVersion = /^v?(\d+)\.(\d+)\.(\d+)$/

// Where a CLI's binary is looked for: the usual install directories, newest
// nvm Node first, then the absolute entries of PATH.
const searchDirectories = (host: Host): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function*() {
    const { join } = host.path
    const nvmRoot = join(host.home, ".nvm", "versions", "node")
    const nvm = (yield* Effect.orElseSucceed(host.fs.readDirectory(nvmRoot), (): Array<string> => []))
      .map((entry) => ({ entry, version: nodeVersion.exec(entry) }))
      .filter((row): row is { entry: string; version: RegExpExecArray } => row.version !== null)
      .sort((left, right) => {
        for (let index = 1; index <= 3; index++) {
          const difference = Number(right.version[index]) - Number(left.version[index])
          if (difference !== 0) return difference
        }
        return 0
      })
      .map((row) => join(nvmRoot, row.entry, "bin"))
    const fromPath = ((yield* host.variable("PATH")) ?? "").split(":").filter((directory) => host.path.isAbsolute(directory))
    return [
      join(host.home, ".local", "bin"),
      join(host.home, ".bun", "bin"),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      ...nvm,
      join(host.home, ".cargo", "bin"),
      join(host.home, ".opencode", "bin"),
      ...fromPath
    ]
  })

const versionTimeoutMs = 3000
const versionChars = 64
// eslint-disable-next-line no-control-regex -- control characters are what this strips.
const escapeSequence = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g
// eslint-disable-next-line no-control-regex -- control characters are what this strips.
const controlCharacter = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

// A version from what `--version` printed: the first version number on the
// first line that has text, or that line, with terminal escapes removed.
const versionOf = (output: string): string | undefined => {
  const line = output.split("\n")
    .map((each) => each.replace(escapeSequence, "").replace(controlCharacter, "").trim())
    .find((each) => each !== "")
  if (line === undefined) return undefined
  const match = /\d+\.\d+(?:\.\d+)?[0-9A-Za-z.+-]*/.exec(line)
  return (match === null ? line : match[0]).slice(0, versionChars)
}

// The variables a version probe runs with: enough to find the binary and
// its interpreter, and no key.
const probeVariables = ["HOME", "PATH", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TZ"]

const versionProbe = (host: Host, binary: string) =>
  Effect.gen(function*() {
    const env: Record<string, string> = { NO_COLOR: "1" }
    for (const name of probeVariables) {
      const value = yield* host.variable(name)
      if (value !== undefined) env[name] = value
    }
    const child = yield* ChildProcess.make(binary, ["--version"], { env, extendEnv: false })
    yield* Effect.forkScoped(Effect.ignore(Stream.runDrain(child.stderr)))
    const output = yield* child.stdout.pipe(
      Stream.decodeText(),
      Stream.runFold(() => "", (all, piece) => all.length > 4096 ? all : all + piece)
    )
    return (yield* child.exitCode) === 0 ? versionOf(output) : undefined
  }).pipe(
    Effect.scoped,
    Effect.timeoutOption(versionTimeoutMs),
    Effect.map(Option.getOrUndefined),
    Effect.orElseSucceed(() => undefined)
  )

/**
 * Which coding-agent CLIs this machine has: for Claude Code, Codex and
 * OpenCode, where its binary is, the version it prints, and whether it is
 * signed in.
 *
 * It grants nothing and reads no token. It looks for each binary in the
 * usual install directories and `PATH`, runs it once with `--version` and
 * no key in its environment, and reads sign-in state as facts about files:
 * whether a credential file exists, never its contents. A key variable that
 * is set is reported by name. The host's variables come from Effect's
 * `Config`.
 *
 * It never fails: a CLI it cannot find is `unavailable`.
 *
 * @category detect
 * @since 0.0.13
 */
export const detect = (): Effect.Effect<
  ReadonlyArray<DetectedCli>,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const variable = (name: string): Effect.Effect<string | undefined> =>
      Effect.orElseSucceed(Effect.map(Config.option(Config.NonEmptyString(name)), Option.getOrUndefined), () => undefined)
    const host: Host = { fs, path, home: (yield* variable("HOME")) ?? "/", variable }
    const directories = yield* searchDirectories(host)
    return yield* Effect.forEach(detectors, (detector) =>
      Effect.gen(function*() {
        let binary: string | undefined
        for (const directory of directories) {
          const candidate = path.join(directory, detector.binary)
          if (yield* isFile(host, candidate)) {
            binary = candidate
            break
          }
        }
        if (binary === undefined) {
          return { id: detector.id, name: detector.name, binary, version: undefined, status: "unavailable", account: undefined } as const
        }
        const [version, signal] = yield* Effect.all([versionProbe(host, binary), detector.signal(host)], { concurrency: 2 })
        return { id: detector.id, name: detector.name, binary, version, status: signal.status, account: signal.account }
      }), { concurrency: 3 })
  })

// -----------------------------------------------------------------------------
// The cell loop
// -----------------------------------------------------------------------------

/**
 * The ceilings a run's sandbox enforces. Each is always set: a caller may
 * change one, and none can be removed.
 *
 * - `calls`: tool calls one cell may make. 64 unless set.
 * - `timeMs`: milliseconds one cell may compute, not counting time spent
 *   waiting on a tool. 30,000 unless set.
 * - `callMs`: milliseconds one tool call may take. 120,000 unless set.
 * - `memoryBytes`: bytes the whole run may hold, between 32 MiB and 4 GiB.
 *   128 MiB unless set.
 *
 * @category run
 * @since 0.0.13
 */
export interface Limits {
  readonly calls: number
  readonly timeMs: number
  readonly callMs: number
  readonly memoryBytes: number
}

/**
 * The limits a run applies when none are given.
 *
 * @category run
 * @since 0.0.13
 */
export const defaultLimits: Limits = Loop.defaultLimits

/**
 * The turns a run may take when `maxTurns` is not given.
 *
 * @category run
 * @since 0.0.13
 */
export const defaultMaxTurns: number = Loop.defaultMaxTurns

/**
 * The options of {@link run} and {@link stream}.
 *
 * @category run
 * @since 0.0.13
 */
export interface RunOptions<Output extends Schema.Top, E = never, R = never> {
  /** The task. */
  readonly prompt: string
  /** The answer is decoded with this schema. */
  readonly output: Output
  /** Instructions placed before the cell protocol. */
  readonly system?: string | undefined
  /**
   * The functions a cell may call: a toolkit with handlers, or an Effect that
   * gives one, such as `Experimental.Tools.filesystem`. None unless set.
   */
  readonly tools?: Toolkit.WithHandler<Record<string, Tool.Any>> | Effect.Effect<Toolkit.WithHandler<Record<string, Tool.Any>>, E, R> | undefined
  /** Turns before the run fails with `turns_exhausted`. {@link defaultMaxTurns} unless set. */
  readonly maxTurns?: number | undefined
  /** Re-prompts after an answer that fails `output`. 1 unless set. */
  readonly corrections?: number | undefined
  /** Changes to {@link defaultLimits}. */
  readonly limits?: Partial<Limits> | undefined
  /**
   * How many completion claims a decision model checks against the run's
   * evidence. 0 unless set; a positive value needs `DecisionModel`.
   */
  readonly judge?: number | undefined
}

/**
 * Token counts a run spent across its turns.
 *
 * @category run
 * @since 0.0.13
 */
export interface Usage {
  readonly inputTokens: number
  readonly outputTokens: number
}

/**
 * What a finished run gives: the decoded answer, the turns it took and the
 * tokens it spent.
 *
 * @category run
 * @since 0.0.13
 */
export interface RunResult<A> {
  readonly output: A
  readonly turns: number
  readonly usage: Usage
}

/**
 * One event of a run, in order:
 *
 * - `TurnStarted`: the model is asked for turn `turn`, counting from 1.
 * - `TextDelta`: a piece of the model's reply.
 * - `Cell`: the program the reply held.
 * - `ToolCall` and `ToolResult`: a call the cell made, and whether it
 *   succeeded.
 * - `CellEnded`: how the cell ended (`missing` when the reply held no cell)
 *   and what it printed.
 * - `Correction`: an answer missed `output`, and a correction was spent.
 * - `Judged`: the judge's verdict on a completion claim.
 * - `Finished`: the run's result. Always last.
 *
 * @category run
 * @since 0.0.13
 */
export type AgentEvent<A = unknown> =
  | Loop.Event
  | { readonly _tag: "Finished"; readonly result: RunResult<A> }

const loopFailed = (error: Loop.LoopFailure | AiError.AiError): AgentFailed | AiError.AiError =>
  (error as Loop.LoopFailure)._tag === "LoopFailure"
    ? new AgentFailed({
      reason: (error as Loop.LoopFailure).reason,
      message: (error as Loop.LoopFailure).message,
      turns: (error as Loop.LoopFailure).turns
    })
    : error as AiError.AiError

/**
 * Runs a model in the cell loop until it gives an answer `output` decodes.
 *
 * Each turn the model writes a JavaScript cell. The cell runs in a QuickJS
 * sandbox with no file system, network, timers, `Date` or `Math.random`; it
 * acts only by `await tools[name](input)`, prints with `console.log`, and
 * ends the run with `done(answer)`.
 *
 * - The model is the `LanguageModel` in context: `Experimental.Model.use`.
 * - A cell can call only the tools it was handed; any other name fails
 *   inside the sandbox before the host sees it.
 * - Inside a workflow or one of its tasks, every tool call is a recorded
 *   step. A crash mid-cell re-runs the cell from the top; settled calls
 *   replay their recorded values.
 * - A miss against `output` spends one correction. A spent budget fails with
 *   {@link AgentFailed}.
 *
 * Fails with {@link AgentFailed} (`invalid_options`, `sandbox_unavailable`,
 * `turns_exhausted`, `output_invalid`, `judge_unavailable`), or with the
 * model's `AiError`.
 *
 * **Example** (A typed review)
 *
 * ```ts
 * import { Schema } from "effect"
 * import { Agent, Model, Tools } from "vibelang-runtime/experimental"
 *
 * const review = Agent.run({
 *   prompt: "Review src/index.ts",
 *   tools: Tools.readOnly,
 *   output: Schema.Struct({ approved: Schema.Boolean, issues: Schema.Array(Schema.String) })
 * })
 * ```
 *
 * @category run
 * @since 0.0.13
 */
export const run = <Output extends Schema.Top, E = never, R = never>(
  options: RunOptions<Output, E, R>
): Effect.Effect<
  RunResult<Output["Type"]>,
  AgentFailed | AiError.AiError | E,
  LanguageModel.LanguageModel | R | Output["DecodingServices"]
> =>
  Effect.mapError(
    Loop.run(options as unknown as Loop.Options, () => Effect.void, false),
    (error) => loopFailed(error as Loop.LoopFailure | AiError.AiError)
  ) as unknown as Effect.Effect<
    RunResult<Output["Type"]>,
    AgentFailed | AiError.AiError | E,
    LanguageModel.LanguageModel | R | Output["DecodingServices"]
  >

/**
 * The same run as {@link run}, as a stream of {@link AgentEvent}s ending in
 * `Finished`. The model is asked with `streamText`, so `TextDelta` events
 * arrive as it writes. A failure ends the stream with the same error
 * {@link run} gives.
 *
 * @category run
 * @since 0.0.13
 */
export const stream = <Output extends Schema.Top, E = never, R = never>(
  options: RunOptions<Output, E, R>
): Stream.Stream<
  AgentEvent<Output["Type"]>,
  AgentFailed | AiError.AiError | E,
  LanguageModel.LanguageModel | R | Output["DecodingServices"]
> =>
  Stream.callback<AgentEvent<Output["Type"]>, AgentFailed | AiError.AiError | E, LanguageModel.LanguageModel | R | Output["DecodingServices"]>((queue) =>
    Loop.run(options as unknown as Loop.Options, (event) => Effect.asVoid(Queue.offer(queue, event)), true).pipe(
      Effect.mapError((error) => loopFailed(error as Loop.LoopFailure | AiError.AiError)),
      Effect.matchCauseEffect({
        onFailure: (cause) => Queue.failCause(queue, cause as unknown as Cause.Cause<AgentFailed | AiError.AiError | E>),
        onSuccess: (result) =>
          Effect.andThen(
            Queue.offer(queue, { _tag: "Finished", result: result as RunResult<Output["Type"]> }),
            Queue.end(queue)
          )
      })
    ) as unknown as Effect.Effect<void, never, LanguageModel.LanguageModel | R | Output["DecodingServices"]>
  )
