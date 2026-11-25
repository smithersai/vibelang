/**
 * The conformance suite every `Experimental.Sandbox` provider passes
 * (VIP-67 rule 8). It runs inside the provider's layer and talks only to the
 * services the layer provides. Ported, reduced, from the reference engine's
 * `SandboxConformance.check` and `ProviderConformance.check`.
 *
 * @internal
 */
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import * as PlatformError from "effect/PlatformError"
import * as Stream from "effect/Stream"
import * as ChildProcess from "effect/process/ChildProcess"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { concat, type Host, keptVariables, shellVariables } from "./sandbox.js"

export interface CheckResult {
  readonly name: string
  readonly passed: boolean
  readonly detail?: string | undefined
}

export interface Report {
  readonly passed: boolean
  readonly results: ReadonlyArray<CheckResult>
}

const decoder = new TextDecoder()

const collect = (command: ChildProcess.Command) =>
  Effect.scoped(Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner
    const handle = yield* spawner.spawn(command)
    const [stdout, stderr, code] = yield* Effect.all([
      Stream.runCollect(handle.stdout).pipe(Effect.map((chunks) => concat(Array.from(chunks)))),
      Stream.runCollect(handle.stderr).pipe(Effect.map((chunks) => decoder.decode(concat(Array.from(chunks))))),
      handle.exitCode
    ], { concurrency: "unbounded" })
    return { stdout, text: decoder.decode(stdout), stderr, code: Number(code) }
  }))

const sh = (script: string, options?: ChildProcess.CommandOptions) => ChildProcess.make("/bin/sh", ["-c", script], options)

const expect = (condition: boolean, detail: string) => (condition ? Effect.void : Effect.fail(detail))

const isBadArgument = (exit: Exit.Exit<unknown, unknown>): boolean =>
  Exit.isFailure(exit) && exit.cause.reasons.some((reason) =>
    reason._tag === "Fail" && PlatformError.isPlatformError(reason.error) && reason.error.reason._tag === "BadArgument"
  )

const refused = (command: ChildProcess.Command) =>
  Effect.flatMap(Effect.exit(collect(command)), (exit) =>
    expect(isBadArgument(exit), "the command was not refused with a BadArgument PlatformError"))

const cases: ReadonlyArray<readonly [string, Effect.Effect<void, unknown, Host>]> = [
  ["stdout", Effect.flatMap(collect(sh("echo hello")), (out) => expect(out.text === "hello\n", `stdout was ${JSON.stringify(out.text)}`))],
  ["stderr", Effect.flatMap(collect(sh("echo oops >&2")), (out) => expect(out.stderr === "oops\n" && out.text === "", `stderr was ${JSON.stringify(out.stderr)}`))],
  ["exit code", Effect.flatMap(collect(sh("exit 3")), (out) => expect(out.code === 3, `the exit code was ${out.code}`))],
  [
    "arguments reach the program unchanged",
    Effect.flatMap(
      collect(ChildProcess.make("printf", ["%s|", "a b", "it's", "$HOME", ""])),
      (out) => expect(out.text === "a b|it's|$HOME||", `printf answered ${JSON.stringify(out.text)}`)
    )
  ],
  [
    "standard input is delivered whole",
    Effect.gen(function*() {
      const bytes = new Uint8Array(70_000)
      for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 31 + 7) & 0xff
      const out = yield* collect(ChildProcess.make("cat", [], { stdin: Stream.make(bytes.subarray(0, 1000), bytes.subarray(1000)) }))
      yield* expect(out.stdout.length === bytes.length && out.stdout.every((byte, index) => byte === bytes[index]), `cat answered ${out.stdout.length} bytes`)
    })
  ],
  [
    "the environment is replaced, not inherited",
    Effect.gen(function*() {
      const out = yield* collect(ChildProcess.make("env", [], { env: { VIBE_DECLARED: "yes" } }))
      const names = out.text.split("\n").filter((line) => line.includes("=")).map((line) => line.slice(0, line.indexOf("=")))
      const allowed = new Set([...keptVariables, ...shellVariables, "VIBE_DECLARED"])
      const stray = names.filter((name) => !allowed.has(name) && !name.startsWith("LC_"))
      yield* expect(names.includes("VIBE_DECLARED"), "a declared variable did not reach the child")
      yield* expect(stray.length === 0, `the child saw ${stray.join(", ")}`)
    })
  ],
  [
    "cwd resolves against the machine's directory",
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      yield* fs.makeDirectory("vibe-conformance/sub", { recursive: true })
      const out = yield* collect(ChildProcess.make("pwd", [], { cwd: "vibe-conformance/sub" }))
      yield* expect(out.text.trim().endsWith("/vibe-conformance/sub"), `pwd answered ${JSON.stringify(out.text)}`)
      yield* expect(path.resolve("vibe-conformance").startsWith("/"), "Path.resolve did not answer an absolute guest path")
    })
  ],
  [
    "files round-trip through FileSystem and the shell",
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const bytes = Uint8Array.from({ length: 4096 }, (_, index) => (index * 13) & 0xff)
      yield* fs.makeDirectory("vibe-conformance/files", { recursive: true })
      yield* fs.writeFile("vibe-conformance/files/data.bin", bytes)
      const back = yield* fs.readFile("vibe-conformance/files/data.bin")
      yield* expect(back.length === bytes.length && back.every((byte, index) => byte === bytes[index]), "readFile answered other bytes")
      const info = yield* fs.stat("vibe-conformance/files/data.bin")
      yield* expect(info.type === "File" && Number(info.size) === bytes.length, `stat answered ${info.type} ${info.size}`)
      yield* fs.writeFileString("vibe-conformance/files/note.txt", "from the host")
      const shell = yield* collect(sh("cat vibe-conformance/files/note.txt"))
      yield* expect(shell.text === "from the host", "a file FileSystem wrote is not the file the shell reads")
      const entries = yield* fs.readDirectory("vibe-conformance/files")
      yield* expect(JSON.stringify(entries) === JSON.stringify(["data.bin", "note.txt"]), `readDirectory answered ${entries.join(", ")}`)
      yield* fs.remove("vibe-conformance/files", { recursive: true })
      yield* expect(!(yield* fs.exists("vibe-conformance/files")), "remove left the directory")
      const missing = yield* Effect.exit(fs.readFile("vibe-conformance/missing"))
      yield* expect(
        Exit.isFailure(missing) && missing.cause.reasons.some((reason) =>
          reason._tag === "Fail" && PlatformError.isPlatformError(reason.error) && reason.error.reason._tag === "NotFound"
        ),
        "reading a missing file did not fail with NotFound"
      )
    })
  ],
  ["a detached process is refused", refused(ChildProcess.make("true", [], { detached: true }))],
  ["inherited standard input is refused", refused(ChildProcess.make("true", [], { stdin: "inherit" }))],
  ["a custom shell is refused", refused(ChildProcess.make("true", [], { shell: "/bin/zsh" }))],
  [
    "extra file descriptors are refused",
    refused(ChildProcess.make("true", [], { additionalFds: { fd3: { type: "output" } } } as ChildProcess.CommandOptions))
  ],
  [
    "interruption ends a command",
    Effect.gen(function*() {
      const started = Date.now()
      const exit = yield* Effect.exit(Effect.timeout(collect(sh("sleep 30")), Duration.millis(300)))
      yield* expect(Exit.isFailure(exit), "sleep 30 finished inside 300 ms")
      yield* expect(Date.now() - started < 10_000, "interrupting sleep 30 took more than ten seconds")
    })
  ]
]

/** Runs every case inside the services in context. A case that fails is reported; the suite goes on. */
export const run: Effect.Effect<Report, never, Host> = Effect.gen(function*() {
  const results: Array<CheckResult> = []
  for (const [name, work] of cases) {
    const exit = yield* Effect.exit(work)
    results.push(
      Exit.isSuccess(exit)
        ? { name, passed: true }
        : {
          name,
          passed: false,
          detail: exit.cause.reasons.map((reason) =>
            reason._tag === "Fail"
              ? typeof reason.error === "string" ? reason.error : String((reason.error as Error)?.message ?? reason.error)
              : reason._tag === "Die" ? String(reason.defect) : "interrupted"
          ).join("; ").slice(0, 500)
        }
    )
  }
  const fs = yield* FileSystem.FileSystem
  yield* Effect.ignore(fs.remove("vibe-conformance", { recursive: true, force: true }))
  return { passed: results.every((result) => result.passed), results }
})
