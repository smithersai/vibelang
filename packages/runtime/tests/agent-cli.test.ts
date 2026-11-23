import { expect, test } from "bun:test"
import fc from "fast-check"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Cause, Effect, Exit, Fiber, Layer, Stream } from "effect"
import { Agent } from "vibelang-runtime/experimental"
import * as Acp from "../dist/experimental/internal/agentAcp.js"
import { checkProperty } from "../../../scripts/testing/property.mjs"

// Experimental.Agent.cli (VIP-63 rules 7 and 8) drives a coding-agent CLI over
// the Agent Client Protocol. The CLI here is a real process,
// fixtures/acp-agent.mjs: it speaks the protocol on its stdio and does what
// its prompt's instruction lines say, with real file edits and no model. The
// services are Node's own: real spawning, a real file system, real time.

const agent = fileURLToPath(new URL("./fixtures/acp-agent.mjs", import.meta.url))

const profiles = (env: Record<string, string> = {}) =>
  Agent.layerCli({
    coder: { command: process.execPath, args: [agent], env },
    // Injected faults: a command that does not exist, a program that is not an
    // agent, and an agent that answers `initialize` with nothing.
    missing: { command: join(tmpdir(), "no-such-cli-binary") },
    silent: { command: process.execPath, args: ["-e", "process.stdin.resume(); setTimeout(() => process.exit(0), 200)"] },
    broken: { command: process.execPath, args: [agent], env: { ACP_AGENT_MODE: "bad-initialize" } },
    // More injected faults: an agent that stays alive and answers nothing, one
    // that agrees to a protocol version this client does not speak, and one
    // that ignores the signal asking it to stop.
    mute: { command: process.execPath, args: [agent], env: { ...env, ACP_AGENT_MODE: "mute" }, startMs: 300 },
    other: { command: process.execPath, args: [agent], env: { ACP_AGENT_MODE: "other-version" } },
    stubborn: { command: process.execPath, args: [agent], env: { ...env, ACP_AGENT_MODE: "stubborn" } },
    hasty: { command: process.execPath, args: [agent], startMs: 0 }
  })

const workspace = (files: Record<string, string> = {}): string => {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-agent-cli-"))
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true })
    writeFileSync(join(dir, name), content)
  }
  return dir
}

const run = <A, E>(effect: Effect.Effect<A, E, any>, env: Record<string, string> = {}): Promise<Exit.Exit<A, E>> =>
  Effect.runPromiseExit(Effect.provide(effect, Layer.mergeAll(NodeServices.layer, profiles(env))) as Effect.Effect<A, E>)

const failure = <A, E>(exit: Exit.Exit<A, E>): unknown => Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined

test("cli drives the CLI through one task and gives its message and the files it changed", async () => {
  const cwd = workspace({ "README.md": "# app\n", "src/a.ts": "export const a = 1\n", "old.txt": "remove me\n" })
  try {
    const exit = await run(Agent.cli("coder", {
      cwd,
      prompt: [
        "Fix the build.",
        "write `src/b.ts` `export const b = 2`",
        "add the line `export const c = 3` to `src/a.ts`",
        "delete `old.txt`",
        "say `Added b and c.`"
      ].join("\n")
    }))
    expect(exit).toEqual(Exit.succeed({ summary: "Added b and c.Done.", changed: ["old.txt", "src/a.ts", "src/b.ts"] }))
    expect(readFileSync(join(cwd, "src/a.ts"), "utf8")).toBe("export const a = 1\nexport const c = 3\n")
    expect(existsSync(join(cwd, "old.txt"))).toBe(false)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test("changed is read from the directory, and leaves out .git, .jj and node_modules", async () => {
  const cwd = workspace({ "a.txt": "a\n", ".git/HEAD": "ref\n" })
  try {
    const exit = await run(Agent.cli("coder", {
      cwd,
      prompt: [
        "write `.git/index` `x`",
        "write `.jj/op` `x`",
        "write `node_modules/pkg/index.js` `x`",
        "write `deep/er/file.txt` `x`"
      ].join("\n")
    }))
    expect(Exit.isSuccess(exit) && exit.value.changed).toEqual(["deep/er/file.txt"])
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test("rule 7: the CLI runs in cwd with the host's environment and the profile's", async () => {
  const cwd = workspace()
  try {
    const exit = await run(
      Agent.cli("coder", { cwd, prompt: "say env CODER_TOKEN_NAME\nsay ` `\nsay env PATH\nsay ` `\nsay cwd" }),
      { CODER_TOKEN_NAME: "from-profile" }
    )
    if (!Exit.isSuccess(exit)) throw new Error(Cause.pretty(exit.cause))
    expect(exit.value.summary.startsWith("CODER_TOKEN_NAME=from-profile PATH=")).toBe(true)
    expect(exit.value.summary).not.toContain("PATH=(unset)")
    expect(exit.value.summary).toContain("vibelang-agent-cli-")
    expect(exit.value.changed).toEqual([])
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test("rule 7: the client offers the CLI no file system and no terminal", async () => {
  const cwd = workspace({ "README.md": "secret\n" })
  try {
    const exit = await run(Agent.cli("coder", { cwd, prompt: "read a file\nsay ` `\nopen a terminal\nsay ` `" }))
    expect(Exit.isSuccess(exit) && exit.value.summary).toBe("fs/read_text_file: -32601 terminal/create: -32601 Done.")
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test("a permission request is answered by the permission option: allow by default", async () => {
  const cwd = workspace()
  try {
    const allowed = await run(Agent.cli("coder", { cwd, prompt: "ask permission\nsay ` `" }))
    const rejected = await run(Agent.cli("coder", { cwd, prompt: "ask permission\nsay ` `", permission: "reject" }))
    expect(Exit.isSuccess(allowed) && allowed.value.summary).toBe("permission: yes Done.")
    expect(Exit.isSuccess(rejected) && rejected.value.summary).toBe("permission: no Done.")
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test("rule 7: cli names no vendor: a profile the host did not configure fails, and nothing starts", async () => {
  const cwd = workspace()
  try {
    const exit = await run(Agent.cli("claude", { cwd, prompt: "write `a.txt` `x`" }))
    expect(failure(exit)).toMatchObject({ _tag: "AgentFailed", reason: "profile_unknown", turns: 0 })
    expect((failure(exit) as Agent.AgentFailed).message).toContain(`Experimental.Agent.layerCli({ "claude": { command } })`)
    expect(existsSync(join(cwd, "a.txt"))).toBe(false)
    // A name that every object has is still not a profile.
    expect(failure(await run(Agent.cli("constructor", { cwd, prompt: "" })))).toMatchObject({ reason: "profile_unknown" })
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

for (const profile of ["missing", "silent", "broken"] as const) {
  test(`a ${profile} command is cli_unavailable`, async () => {
    const cwd = workspace()
    try {
      const exit = await run(Agent.cli(profile, { cwd, prompt: "write `a.txt` `x`" }))
      expect(failure(exit)).toMatchObject({ _tag: "AgentFailed", reason: "cli_unavailable", turns: 0 })
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
}

test("a CLI whose process ends mid-turn, answers with an error or breaks the protocol is cli_failed, by code", async () => {
  const cwd = workspace()
  try {
    const exited = failure(await run(Agent.cli("coder", { cwd, prompt: "write `kept.txt` `x`\nexit" })))
    expect(exited).toMatchObject({ _tag: "AgentFailed", reason: "cli_failed" })
    expect((exited as Agent.AgentFailed).message).toBe("The coder CLI's session broke: session/prompt ended closed.")
    // The work it did before it died is still on disk.
    expect(existsSync(join(cwd, "kept.txt"))).toBe(true)

    const refusedLogin = failure(await run(Agent.cli("coder", { cwd, prompt: "the secret task\nfail the prompt" })))
    expect(refusedLogin).toMatchObject({ reason: "cli_failed" })
    // The CLI's own error text quoted the task, and none of it is kept.
    expect((refusedLogin as Agent.AgentFailed).message).toBe("The coder CLI's session broke: session/prompt ended remote (-32000).")

    const nonsense = failure(await run(Agent.cli("coder", { cwd, prompt: "answer badly" })))
    expect((nonsense as Agent.AgentFailed).message).toBe("The coder CLI's session broke: session/prompt ended protocol.")
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test("a CLI that refuses or runs out ends cli_stopped with its stop reason", async () => {
  const cwd = workspace()
  try {
    expect(failure(await run(Agent.cli("coder", { cwd, prompt: "refuse" })))).toMatchObject({
      _tag: "AgentFailed",
      reason: "cli_stopped",
      message: "The coder CLI ended its turn without finishing: refusal."
    })
    expect(failure(await run(Agent.cli("coder", { cwd, prompt: "run out" })))).toMatchObject({
      reason: "cli_stopped",
      message: "The coder CLI ended its turn without finishing: max_tokens."
    })
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test("lines that are not the protocol are skipped, and the session goes on", async () => {
  const cwd = workspace()
  try {
    const exit = await run(Agent.cli("coder", { cwd, prompt: "say garbage\nwrite `a.txt` `x`" }))
    expect(exit).toEqual(Exit.succeed({ summary: "Done.", changed: ["a.txt"] }))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test("rule 8: interrupting the step ends the CLI's process", async () => {
  const cwd = workspace()
  const pidFile = join(cwd, "..", `agent-${Date.now()}-${Math.random().toString(36).slice(2)}.pid`)
  try {
    const exit = await run(
      Effect.gen(function*() {
        const fiber = yield* Effect.forkChild(Agent.cli("coder", { cwd, prompt: "write `started.txt` `x`\nwait" }))
        // Wait until the CLI is in its turn: the file it wrote first exists.
        yield* Effect.repeat(Effect.sleep(20), { until: () => existsSync(join(cwd, "started.txt")) })
        const pid = Number(readFileSync(pidFile, "utf8"))
        const before = alive(pid)
        yield* Fiber.interrupt(fiber)
        yield* Effect.repeat(Effect.sleep(20), { until: () => !alive(pid), times: 250 })
        return { before, after: alive(pid) }
      }),
      { ACP_AGENT_PID_FILE: pidFile }
    )
    expect(exit).toEqual(Exit.succeed({ before: true, after: false }))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
    rmSync(pidFile, { force: true })
  }
}, 30_000)

test("a CLI that stays alive and never answers is cli_unavailable once its start time is up, and its process ends", async () => {
  const cwd = workspace()
  const pidFile = join(cwd, "..", `agent-${Date.now()}-${Math.random().toString(36).slice(2)}.pid`)
  try {
    const exit = await run(Agent.cli("mute", { cwd, prompt: "write `a.txt` `x`" }), { ACP_AGENT_PID_FILE: pidFile })
    expect(failure(exit)).toMatchObject({
      _tag: "AgentFailed",
      reason: "cli_unavailable",
      message: "The mute CLI did not start a session within 300 milliseconds."
    })
    expect(alive(Number(readFileSync(pidFile, "utf8")))).toBe(false)
    expect(failure(await run(Agent.cli("hasty", { cwd, prompt: "" })))).toMatchObject({
      reason: "cli_unavailable",
      message: "The hasty CLI profile's startMs must be a whole number of milliseconds, at least 1."
    })
  } finally {
    rmSync(cwd, { recursive: true, force: true })
    rmSync(pidFile, { force: true })
  }
}, 30_000)

test("a CLI that agrees to a protocol version this client does not speak is cli_unavailable", async () => {
  const cwd = workspace()
  try {
    const exit = await run(Agent.cli("other", { cwd, prompt: "write `a.txt` `x`" }))
    expect(failure(exit)).toMatchObject({
      reason: "cli_unavailable",
      message: "The other CLI did not start a session: initialize ended protocol."
    })
    expect(existsSync(join(cwd, "a.txt"))).toBe(false)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test("rule 8: a line with no end and an error that names no request end the session as cli_failed, not a wait", async () => {
  const cwd = workspace()
  try {
    const endless = failure(await run(Agent.cli("coder", { cwd, prompt: "write an endless line" })))
    expect(endless).toMatchObject({ reason: "cli_failed", message: "The coder CLI's session broke: session/prompt ended protocol." })
    const unreadable = failure(await run(Agent.cli("coder", { cwd, prompt: "answer with no id" })))
    expect(unreadable).toMatchObject({ reason: "cli_failed", message: "The coder CLI's session broke: session/prompt ended protocol." })
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}, 30_000)

test("rule 8: summary is this session's text, cut at its bound", async () => {
  const cwd = workspace()
  try {
    const exit = await run(Agent.cli("coder", { cwd, prompt: "say `theirs` as another session\nsay `ab` 600000 times" }))
    if (!Exit.isSuccess(exit)) throw new Error(Cause.pretty(exit.cause))
    expect(exit.value.summary.length).toBe(1024 * 1024)
    expect(exit.value.summary.startsWith("abab")).toBe(true)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test("rule 8: interrupting the step asks the CLI to cancel before its process ends", async () => {
  const cwd = workspace()
  const cancelFile = join(cwd, "..", `agent-${Date.now()}-${Math.random().toString(36).slice(2)}.cancel`)
  try {
    const exit = await run(
      Effect.gen(function*() {
        const fiber = yield* Effect.forkChild(Agent.cli("coder", { cwd, prompt: "write `started.txt` `x`\nwait" }))
        yield* Effect.repeat(Effect.sleep(20), { until: () => existsSync(join(cwd, "started.txt")) })
        yield* Fiber.interrupt(fiber)
        return existsSync(cancelFile) ? readFileSync(cancelFile, "utf8") : "never asked"
      }),
      { ACP_AGENT_CANCEL_FILE: cancelFile }
    )
    expect(exit).toEqual(Exit.succeed("session-1"))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
    rmSync(cancelFile, { force: true })
  }
}, 30_000)

test("rule 8: a CLI that ignores both the cancel and the request to stop is killed", async () => {
  const cwd = workspace()
  const pidFile = join(cwd, "..", `agent-${Date.now()}-${Math.random().toString(36).slice(2)}.pid`)
  try {
    const exit = await run(
      Effect.gen(function*() {
        const fiber = yield* Effect.forkChild(Agent.cli("stubborn", { cwd, prompt: "write `started.txt` `x`\nwait forever" }))
        yield* Effect.repeat(Effect.sleep(20), { until: () => existsSync(join(cwd, "started.txt")) })
        const pid = Number(readFileSync(pidFile, "utf8"))
        yield* Fiber.interrupt(fiber)
        yield* Effect.repeat(Effect.sleep(20), { until: () => !alive(pid), times: 250 })
        return alive(pid)
      }),
      { ACP_AGENT_PID_FILE: pidFile }
    )
    expect(exit).toEqual(Exit.succeed(false))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
    rmSync(pidFile, { force: true })
  }
}, 30_000)

test("changed does not follow a symbolic link: a link to its own directory or out of cwd is one entry", async () => {
  const cwd = workspace({ "kept.txt": "kept\n" })
  const outside = workspace({ "far.txt": "far\n" })
  try {
    symlinkSync(".", join(cwd, "loop"))
    symlinkSync(outside, join(cwd, "out"))
    const exit = await run(Agent.cli("coder", { cwd, prompt: "write `a.txt` `x`\nwrite `out/far.txt` `changed through the link`" }))
    expect(exit).toEqual(Exit.succeed({ summary: "Done.", changed: ["a.txt"] }))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

// Property: for any text cut into any chunks, the lines read are the text's
// lines when none is longer than the limit, and otherwise the reading fails
// `protocol`.
test("property: an agent's output is read as its lines, or refused once one line passes the limit", async () => {
  await checkProperty(fc, {
    name: "agent-acp-lines-bounded",
    rule: "VIP-63 rule 8: a CLI's output is untrusted text",
    command: "bun test tests/agent-cli.test.ts",
    arbitrary: fc.record({
      lines: fc.array(fc.string({ maxLength: 24 }).map((line) => line.replace(/[\r\n]/g, "")), { maxLength: 8 }),
      cuts: fc.array(fc.nat(64), { maxLength: 12 }),
      limit: fc.integer({ min: 1, max: 24 })
    }),
    numRuns: 200,
    check: async (input: { lines: ReadonlyArray<string>; cuts: ReadonlyArray<number>; limit: number }) => {
      const text = input.lines.map((line) => line + "\n").join("")
      const at = [...new Set(input.cuts.map((cut) => cut % (text.length + 1)))].sort((left, right) => left - right)
      const chunks = [0, ...at].map((start, index, starts) => text.slice(start, starts[index + 1] ?? text.length)).filter((chunk) => chunk !== "")
      const exit = await Effect.runPromiseExit(Stream.runCollect(Acp.lines(Stream.fromIterable(chunks), input.limit)))
      if (input.lines.every((line) => line.length <= input.limit)) {
        expect(exit).toEqual(Exit.succeed([...input.lines]))
      } else {
        expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({ _tag: "AcpError", code: "protocol", method: "output" })
      }
    }
  })
})

test("two sessions at once keep their own directories and messages", async () => {
  const one = workspace()
  const two = workspace()
  try {
    const exit = await run(Effect.all([
      Agent.cli("coder", { cwd: one, prompt: "write `one.txt` `1`\nsay `first`" }),
      Agent.cli("coder", { cwd: two, prompt: "write `two.txt` `2`\nsay `second`" })
    ], { concurrency: 2 }))
    expect(exit).toEqual(Exit.succeed([
      { summary: "firstDone.", changed: ["one.txt"] },
      { summary: "secondDone.", changed: ["two.txt"] }
    ]))
  } finally {
    rmSync(one, { recursive: true, force: true })
    rmSync(two, { recursive: true, force: true })
  }
})

// Property (rule 8): `changed` lists the files the session touched. For any
// sequence of writes, appends and deletes over a few paths, it is exactly the
// set of paths whose content or existence differs from before the session.
test("property: changed is the set of files that differ after the session", async () => {
  const names = ["a.txt", "b.txt", "dir/c.txt", "dir/d.txt"]
  const step = fc.oneof(
    fc.record({ op: fc.constant("write" as const), file: fc.constantFrom(...names), text: fc.constantFrom("x", "yy", "zzz") }),
    fc.record({ op: fc.constant("append" as const), file: fc.constantFrom(...names), text: fc.constantFrom("x", "yy") }),
    fc.record({ op: fc.constant("delete" as const), file: fc.constantFrom(...names), text: fc.constant("") })
  )
  await checkProperty(fc, {
    name: "agent-cli-changed",
    rule: "VIP-63 rule 8: a CLI session is one step; `changed` lists the files it touched",
    command: "bun test tests/agent-cli.test.ts",
    arbitrary: fc.record({
      present: fc.subarray(names),
      steps: fc.array(step, { maxLength: 6 })
    }),
    numRuns: 25,
    check: async (input: { present: ReadonlyArray<string>; steps: ReadonlyArray<{ op: "write" | "append" | "delete"; file: string; text: string }> }) => {
      const initial = Object.fromEntries(input.present.map((name) => [name, "start\n"]))
      const cwd = workspace(initial)
      try {
        // The model of the directory: what each step leaves in each file.
        const model = new Map<string, string>(Object.entries(initial))
        for (const entry of input.steps) {
          if (entry.op === "write") model.set(entry.file, entry.text)
          else if (entry.op === "append") model.set(entry.file, (model.get(entry.file) ?? "") + entry.text + "\n")
          else model.delete(entry.file)
        }
        const prompt = input.steps.map((entry) =>
          entry.op === "write"
            ? `write \`${entry.file}\` \`${entry.text}\``
            : entry.op === "append"
            ? `add the line \`${entry.text}\` to \`${entry.file}\``
            : `delete \`${entry.file}\``
        ).join("\n")
        // A rewrite within the clock's resolution keeps a file's time, so the
        // session starts a moment after the files were made.
        await new Promise((resolve) => setTimeout(resolve, 15))
        const exit = await run(Agent.cli("coder", { cwd, prompt }))
        if (!Exit.isSuccess(exit)) throw new Error(Cause.pretty(exit.cause))
        const expected = names.filter((name) => model.get(name) !== initial[name]).sort()
        // A file rewritten with its own content is touched and may be listed;
        // every listed file was written by a step, and every differing file is listed.
        const touched = new Set(input.steps.map((entry) => entry.file))
        for (const file of expected) expect(exit.value.changed).toContain(file)
        for (const file of exit.value.changed) expect(touched.has(file)).toBe(true)
        for (const name of names) {
          expect(existsSync(join(cwd, name)) ? readFileSync(join(cwd, name), "utf8") : undefined).toBe(model.get(name))
        }
      } finally {
        rmSync(cwd, { recursive: true, force: true })
      }
    }
  })
}, 120_000)
