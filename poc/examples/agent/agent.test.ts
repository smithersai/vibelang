import { afterAll, describe, expect, test } from "bun:test"
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, unlink, utimes, writeFile } from "node:fs/promises"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  DenoSubprocessSandbox,
  InMemoryTypeScriptCompiler,
  PoisonModel,
  ScriptedModel,
  SqliteTurnJournal,
  declareCallableSurface,
  defineFunction,
  poisonFunctionTable,
} from "../../src/agent/bun.ts"
import { runAgentDemo } from "./demo.ts"
import {
  FIRST_TURN_SOURCE,
  SECOND_TURN_SOURCE,
  createDurableAgent,
  createProject,
} from "./durable-demo.ts"

const durableRoot = mkdtempSync(join(tmpdir(), "smithers-agent-e2e-"))
let databaseCount = 0

function databasePath(name: string): string {
  databaseCount += 1
  return join(durableRoot, `${databaseCount}-${name}.sqlite`)
}

afterAll(() => {
  rmSync(durableRoot, { recursive: true, force: true })
})

describe("CodingAgent POC", () => {
  test("repairs, type-checks, confines, RPC-calls, and journals a turn", async () => {
    const { result, model, journal } = await runAgentDemo()
    expect(result.echoed).toBe("AGENT LOOP WORKS")
    expect(model.requests).toHaveLength(2)
    expect(model.requests[0].messages[0]?.role).toBe("system")
    expect(model.requests[0].messages[1]?.content).toContain("effect-lang")
    expect(journal.events.some((event) => event.type === "sandbox.completed")).toBe(true)
    const called = journal.events.find((event) => event.type === "function.called")
    expect(called?.details?.functionIdentity).toMatchObject({
      artifactDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      configDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  })

  test("runs a multi-turn task, killing and reopening the journal between turns", async () => {
    const path = databasePath("multi-turn")
    const project = createProject()
    const firstTask = { task: "Copy README.md into GREETING.md." }
    const secondTask = { task: "Report the project's files and greeting size." }
    const firstModel = new ScriptedModel([FIRST_TURN_SOURCE])
    const secondModel = new ScriptedModel([SECOND_TURN_SOURCE])

    const journalOne = new SqliteTurnJournal(path)
    const first = await createDurableAgent({ project, model: firstModel, journal: journalOne }).run(firstTask)
    expect(first.ok).toBe(true)
    journalOne.close()

    const journalTwo = new SqliteTurnJournal(path)
    const second = await createDurableAgent({ project, model: secondModel, journal: journalTwo }).run(secondTask)
    expect(second.ok).toBe(true)
    expect(second.turnId).not.toBe(first.turnId)
    expect(second.result).toEqual({
      files: ["README.md", "GREETING.md"],
      greetingLines: 3,
    })
    expect(project.invocations).toEqual({ readFile: 3, writeFile: 1 })
    // Two calls to the same function in one turn take distinct per-site ordinals.
    expect(journalTwo.readHostCalls(second.turnId).map((call) => `${call.functionName}#${call.ordinal}`))
      .toEqual(["readFile#1", "readFile#2"])
    journalTwo.close()

    // Restart once more and replay both turns with poisoned components.
    const journalThree = new SqliteTurnJournal(path)
    const poisoned = {
      project,
      functions: poisonFunctionTable(project.functions),
      journal: journalThree,
    }
    const replayOne = await createDurableAgent({ ...poisoned, model: new PoisonModel(firstModel) }).run(firstTask)
    const replayTwo = await createDurableAgent({ ...poisoned, model: new PoisonModel(secondModel) }).run(secondTask)

    expect(replayOne.turnId).toBe(first.turnId)
    expect(replayTwo.turnId).toBe(second.turnId)
    expect(replayOne.result).toEqual(first.result)
    expect(replayTwo.result).toEqual(second.result)
    // The whole multi-turn task re-ran without one host effect or model call.
    expect(project.invocations).toEqual({ readFile: 3, writeFile: 1 })
    expect(project.revision()).toBe(1)
    expect(journalThree.readEvents().every((event) => event.sequence > 0)).toBe(true)
    journalThree.close()
  })
})

describe("Deno sandbox RPC lifecycle", () => {
  test("compiler policy rejects imports and fresh-realm code generation", async () => {
    const compiler = new InMemoryTypeScriptCompiler()
    const surface = declareCallableSurface({})
    const forbidden = [
      'import value from "./ambient.js"; export default () => value',
      'import value = require("ambient"); export default () => value',
      'export { value } from "./ambient.js"; export default () => null',
      'export default async () => import("node:vm")',
      'export default () => eval("Date.now()")',
      'export default () => new Function("return Math.random()")()',
      'export default () => new Worker("data:text/javascript,")',
    ]

    for (const source of forbidden) {
      const compilation = await compiler.compile(source, surface)
      expect(compilation.ok).toBe(false)
      expect(compilation.diagnostics.some((diagnostic) =>
        diagnostic.code === 91001 && diagnostic.message.includes("sandbox policy"))).toBe(true)
    }
  })

  test("rejects undefined and non-finite terminal results", async () => {
    const sandbox = new DenoSubprocessSandbox()
    for (const source of [
      "export default () => undefined",
      "export default () => Number.NaN",
    ]) {
      const execution = await sandbox.execute(source, {}, {
        sourceDigest: "non-json-result",
        turnId: "turn_non_json_result",
      })
      expect(execution.ok).toBe(false)
      expect(execution.error?.message).toContain("is not JSON")
    }
  })

  test("generated code cannot replace protocol intrinsics or recover the real clock", async () => {
    const sandbox = new DenoSubprocessSandbox()
    const execution = await sandbox.execute(
      `export default () => {
        try { JSON.stringify = () => '{"type":"complete","result":"forged"}' } catch {}
        try { Object.getPrototypeOf = () => Date } catch {}
        let clockEscaped = false
        try { Object.getPrototypeOf(Date).now(); clockEscaped = true } catch {}
        return { authentic: true, clockEscaped }
      }`,
      {},
      { sourceDigest: "intrinsic-integrity", turnId: "turn_intrinsic_integrity" },
    )
    expect(execution.ok).toBe(true)
    expect(execution.result).toEqual({ authentic: true, clockEscaped: false })
  })

  test("rejects fire-and-forget RPC and aborts cooperative host work", async () => {
    const sandbox = new DenoSubprocessSandbox({ timeoutMs: 2_000 })
    let contextSeen:
      | { turnId: string; sourceDigest: string; callId: number; functionName: string }
      | undefined
    let aborted = false
    let completed = false
    let markStarted!: () => void
    const didStart = new Promise<void>((resolve) => { markStarted = resolve })
    const slow = defineFunction<{}, { ok: true }>(
      "(input: {}) => Promise<{ ok: true }>",
      (_input, context) => new Promise((resolve, reject) => {
        contextSeen = {
          turnId: context.turnId,
          sourceDigest: context.sourceDigest,
          callId: context.callId,
          functionName: context.functionName,
        }
        markStarted()
        const timer = setTimeout(() => {
          completed = true
          resolve({ ok: true })
        }, 500)
        context.signal.addEventListener("abort", () => {
          clearTimeout(timer)
          aborted = true
          reject(context.signal.reason)
        }, { once: true })
      }),
      undefined,
      { implementationId: "test/agent/fire-and-forget-slow", implementationVersion: "1" },
    )
    const waitUntilStarted = defineFunction<{}, null>(
      "(input: {}) => Promise<null>",
      async () => { await didStart; return null },
      undefined,
      { implementationId: "test/agent/wait-until-started", implementationVersion: "1" },
    )

    const execution = await sandbox.execute(
      "export default async functions => { void functions.slow({}); await functions.waitUntilStarted({}); return { done: true } }",
      { slow, waitUntilStarted },
      { sourceDigest: "fire-and-forget", turnId: "turn_fire_and_forget" },
    )

    expect(execution.ok).toBe(false)
    expect(execution.error?.name).toBe("UnawaitedHostCalls")
    expect(contextSeen).toEqual({
      turnId: "turn_fire_and_forget",
      sourceDigest: "fire-and-forget",
      callId: 1,
      functionName: "slow",
    })
    expect(aborted).toBe(true)
    expect(completed).toBe(false)
  })

  /**
   * The timings here are load-bearing and deliberately generous. This test
   * proves that a host call still IN FLIGHT when the budget expires is aborted
   * and its late result discarded, so `slow` must actually be invoked before the
   * timeout fires. The invariant is:
   *
   *     spawn < timeoutMs < slowResolvesAfter < timeoutMs + settleWait
   *
   * `timeoutMs` is measured from `execute()`, which INCLUDES spawning a Deno
   * subprocess. It used to be 25 ms against a 75 ms `slow`, which held only while
   * spawn happened to beat 25 ms. Under load — several test gates running at once
   * on this repository — spawn does not, the budget expires before `slow` is ever
   * called, and the test fails on `aborted` while both timeout assertions still
   * pass: there was simply nothing to abort. Measured failing that way at a whole
   * 31 ms of wall clock.
   *
   * So the budget now sits far above any plausible spawn rather than just above
   * an idle one. Do not trim these back to make the suite faster; the ~3.5 s is
   * buying the absence of a heisentest, and the sibling at the top of this file
   * already uses a 2 s budget for the same reason.
   */
  test("aborts timeout calls and ignores late results after the channel closes", async () => {
    const timeoutMs = 1_500
    const slowResolvesAfter = 2_500
    const settleWait = 2_000
    const sandbox = new DenoSubprocessSandbox({ timeoutMs })
    let aborted = false
    let resolvedLate = false
    const slow = defineFunction<{}, { ok: true }>(
      "(input: {}) => Promise<{ ok: true }>",
      (_input, context) => new Promise((resolve) => {
        context.signal.addEventListener("abort", () => {
          aborted = true
        }, { once: true })
        setTimeout(() => {
          resolvedLate = true
          resolve({ ok: true })
        }, slowResolvesAfter)
      }),
      undefined,
      { implementationId: "test/agent/timeout-slow", implementationVersion: "1" },
    )

    const execution = await sandbox.execute(
      "export default async functions => functions.slow({})",
      { slow },
      { sourceDigest: "timeout", turnId: "turn_timeout" },
    )
    expect(execution.ok).toBe(false)
    expect(execution.error?.name).toBe("SandboxTimeout")
    expect(aborted).toBe(true)

    // Long enough that `slow` has resolved even though the channel closed at
    // `timeoutMs`: the point is that its late result is IGNORED, not that it
    // never arrives.
    await new Promise((resolve) => setTimeout(resolve, settleWait))
    expect(resolvedLate).toBe(true)
  })

  test("caller cancellation terminates the process and active host work", async () => {
    const controller = new AbortController()
    let hostAborted = false
    let markStarted!: () => void
    const didStart = new Promise<void>((resolve) => { markStarted = resolve })
    const slow = defineFunction<{}, null>(
      "(input: {}) => Promise<null>",
      (_input, context) => new Promise((_resolve, reject) => {
        markStarted()
        context.signal.addEventListener("abort", () => {
          hostAborted = true
          reject(context.signal.reason)
        }, { once: true })
      }),
      undefined,
      { implementationId: "test/agent/caller-cancel-slow", implementationVersion: "1" },
    )
    const pending = new DenoSubprocessSandbox().execute(
      "export default async f => f.slow({})",
      { slow },
      { sourceDigest: "caller-cancel", turnId: "turn_caller_cancel", signal: controller.signal },
    )
    await didStart
    controller.abort(new Error("caller stopped"))
    const execution = await pending
    expect(execution.ok).toBe(false)
    expect(execution.error).toMatchObject({ name: "SandboxCancelled", message: "caller stopped" })
    expect(hostAborted).toBe(true)
  })

  test("pre-aborted caller cancellation uses the same stable error channel", async () => {
    const controller = new AbortController()
    controller.abort(new Error("caller stopped before launch"))

    const execution = await new DenoSubprocessSandbox().execute(
      "export default () => null",
      {},
      {
        sourceDigest: "pre-cancelled",
        turnId: "turn_pre_cancelled",
        signal: controller.signal,
      },
    )

    expect(execution).toMatchObject({
      ok: false,
      error: { name: "SandboxCancelled", message: "caller stopped before launch" },
      durationMs: 0,
    })
  })

  test("rejects missing call inputs and non-JSON host results", async () => {
    const sandbox = new DenoSubprocessSandbox()
    let calls = 0
    const invalid = defineFunction<{}, undefined>(
      "(input: {}) => Promise<never>",
      () => {
        calls += 1
        return undefined
      },
      undefined,
      { implementationId: "test/agent/invalid-result", implementationVersion: "1" },
    )

    const missingInput = await sandbox.execute(
      "export default async functions => functions.invalid()",
      { invalid },
      { sourceDigest: "missing-input", turnId: "turn_missing_input" },
    )
    expect(missingInput.ok).toBe(false)
    expect(missingInput.error?.message).toContain("input is not JSON")
    expect(calls).toBe(0)

    const invalidResult = await sandbox.execute(
      "export default async functions => functions.invalid({})",
      { invalid },
      { sourceDigest: "invalid-result", turnId: "turn_invalid_result" },
    )
    expect(invalidResult.ok).toBe(false)
    expect(invalidResult.error?.message).toContain("result is not JSON")
    expect(calls).toBe(1)

    const hostileThrow = defineFunction<{}, never>(
      "(input: {}) => Promise<never>",
      () => {
        throw new Proxy({}, {
          get() { throw new Error("hostile get") },
          getPrototypeOf() { throw new Error("hostile prototype") },
          ownKeys() { throw new Error("hostile keys") },
        })
      },
      undefined,
      { implementationId: "test/agent/hostile-throw", implementationVersion: "1" },
    )
    const hostileError = await sandbox.execute(
      "export default async functions => functions.hostileThrow({})",
      { hostileThrow },
      { sourceDigest: "hostile-error", turnId: "turn_hostile_error" },
    )
    expect(hostileError.ok).toBe(false)
    expect(hostileError.error?.message).toContain("Unserializable thrown value")
  })

  test("bounds generated source and host JSON traversal before transport allocation", async () => {
    const sourceLimited = await new DenoSubprocessSandbox({ maxSourceBytes: 1_024 }).execute(
      "x".repeat(1_025),
      {},
      { sourceDigest: "source-limit", turnId: "turn_source_limit" },
    )
    expect(sourceLimited.ok).toBe(false)
    expect(sourceLimited.error?.name).toBe("SandboxInputLimit")
    expect(sourceLimited.durationMs).toBe(0)

    const wide = defineFunction<{}, null[]>(
      "(input: {}) => Promise<null[]>",
      async () => Array.from({ length: 100_001 }, () => null),
      undefined,
      { implementationId: "test/agent/wide-result", implementationVersion: "1" },
    )
    const jsonLimited = await new DenoSubprocessSandbox().execute(
      "export default async f => f.wide({})",
      { wide },
      { sourceDigest: "json-node-limit", turnId: "turn_json_node_limit" },
    )
    expect(jsonLimited.ok).toBe(false)
    expect(jsonLimited.error?.message).toContain("node limit exceeded")
  })

  test("detects an in-place runner rewrite even when size and mtime are restored", async () => {
    const root = await mkdtemp(join(tmpdir(), "smithers-agent-runner-pin-"))
    try {
      const runner = join(root, "deno-runner.js")
      await copyFile(join(import.meta.dir, "../../src/agent/deno-runner.js"), runner)
      const fixedTime = new Date(1_700_000_000_000)
      await utimes(runner, fixedTime, fixedTime)
      const sandbox = new DenoSubprocessSandbox({ runnerPath: runner })
      const source = await readFile(runner)
      const marker = source.indexOf(Buffer.from("only"))
      expect(marker).toBeGreaterThanOrEqual(0)
      source[marker] = "x".charCodeAt(0)
      await writeFile(runner, source)
      await utimes(runner, fixedTime, fixedTime)

      const execution = await sandbox.execute(
        "export default () => null",
        {},
        { sourceDigest: "runner-rewrite", turnId: "turn_runner_rewrite" },
      )
      expect(execution.ok).toBe(false)
      expect(execution.error?.message).toContain("runner changed after identity pinning")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("bounds total calls, concurrent calls, and host response transport", async () => {
    const echo = defineFunction<{}, { ok: true }>(
      "(input: {}) => Promise<{ ok: true }>",
      async () => ({ ok: true }),
      undefined,
      { implementationId: "test/agent/call-limit-echo", implementationVersion: "1" },
    )
    const total = await new DenoSubprocessSandbox({ maxCalls: 2 }).execute(
      "export default async f => { await f.echo({}); await f.echo({}); await f.echo({}); return null }",
      { echo },
      { sourceDigest: "call-limit", turnId: "turn_call_limit" },
    )
    expect(total.ok).toBe(false)
    expect(total.error?.name).toBe("SandboxCallLimit")
    expect(total.error?.message).toContain("2 host calls")

    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const slow = defineFunction<{}, null>(
      "(input: {}) => Promise<null>",
      async (_input, context) => {
        await Promise.race([
          gate,
          new Promise<never>((_resolve, reject) => {
            context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true })
          }),
        ])
        return null
      },
      undefined,
      { implementationId: "test/agent/concurrency-limit-slow", implementationVersion: "1" },
    )
    const concurrent = await new DenoSubprocessSandbox({ maxConcurrentCalls: 1 }).execute(
      "export default async f => Promise.all([f.slow({}), f.slow({})])",
      { slow },
      { sourceDigest: "concurrency-limit", turnId: "turn_concurrency_limit" },
    )
    release()
    expect(concurrent.ok).toBe(false)
    expect(concurrent.error?.name).toBe("SandboxCallLimit")
    expect(concurrent.error?.message).toContain("1 concurrent")

    const large = defineFunction<{}, string>(
      "(input: {}) => Promise<string>",
      async () => "x".repeat(2_000),
      undefined,
      { implementationId: "test/agent/transport-limit-large", implementationVersion: "1" },
    )
    const transport = await new DenoSubprocessSandbox({ maxOutputBytes: 1_024 }).execute(
      "export default async f => f.large({})",
      { large },
      { sourceDigest: "transport-limit", turnId: "turn_transport_limit" },
    )
    expect(transport.ok).toBe(false)
    expect(transport.error?.name).toBe("SandboxTransportLimit")
  })
})

describe("Deno sandbox raw stdout accounting", () => {
  // A child that streams newline-free bytes must be bounded at the byte layer.
  // The fixture writes ~64 MiB with no "\n" and then keeps its event loop alive,
  // so the terminating newline never arrives and the stdout stream never closes
  // on its own. Before the raw-stdout counter existed, readline buffered the
  // whole ~64 MiB host-side without ever hitting the per-line check, so the
  // breach was only "discovered" when the wall-clock timeout SIGKILLed the child
  // and readline flushed its buffered partial line on close — i.e. the turn ran
  // for the full timeout (~4 s) after having buffered the entire payload. With
  // byte-level accounting the breach trips after ~256 KiB, so the child is
  // SIGKILLed almost immediately (durationMs well under the timeout) and only a
  // few hundred KiB is ever buffered.
  test("kills a newline-free stdout flood at the byte layer, not at the timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "smithers-agent-raw-stdout-"))
    try {
      const runner = join(root, "flood-runner.js")
      await writeFile(
        runner,
        [
          'const chunk = new TextEncoder().encode("A".repeat(65536))',
          "async function writeAll(bytes) {",
          "  let offset = 0",
          "  while (offset < bytes.length) {",
          "    offset += await Deno.stdout.write(bytes.subarray(offset))",
          "  }",
          "}",
          "// Keep the event loop alive so the stream never closes and Deno never",
          "// flushes a synthetic trailing line: the newline genuinely never comes.",
          "setInterval(() => {}, 3_600_000)",
          "for (let i = 0; i < 1024; i++) {",
          "  await writeAll(chunk)",
          "}",
          "await new Promise(() => {})",
          "",
        ].join("\n"),
      )

      const timeoutMs = 4_000
      const execution = await new DenoSubprocessSandbox({
        runnerPath: runner,
        maxOutputBytes: 256 * 1_024,
        timeoutMs,
      }).execute(
        "export default () => null",
        {},
        { sourceDigest: "raw-stdout-flood", turnId: "turn_raw_stdout_flood" },
      )

      expect(execution.ok).toBe(false)
      expect(execution.error?.name).toBe("SandboxOutputLimit")
      expect(execution.error?.message).toContain("output bytes")
      // Without byte-level accounting this only resolves once the timeout fires;
      // the fix must terminate an order of magnitude sooner.
      expect(execution.durationMs).toBeLessThan(timeoutMs / 2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // The reachable generated-code vector: a single oversized protocol line. Any
  // embedded newlines are JSON-escaped, so the terminating "\n" is the first
  // real newline in the stream. The raw-byte layer trips before the whole line
  // is buffered; the policy result is a stable output-limit failure.
  test("rejects an oversized single protocol log line emitted by generated code", async () => {
    const execution = await new DenoSubprocessSandbox({
      maxOutputBytes: 64 * 1_024,
      timeoutMs: 5_000,
    }).execute(
      'export default () => { console.log("A".repeat(5_000_000)); return null }',
      {},
      { sourceDigest: "oversized-log-line", turnId: "turn_oversized_log_line" },
    )

    expect(execution.ok).toBe(false)
    expect(execution.error?.name).toBe("SandboxOutputLimit")
  })
})

/**
 * The pinned artifacts are identified by *one* canonical path each, so the
 * value that is digested, the value that is re-verified, and the value that is
 * spawned cannot be different files. The in-place-rewrite case above covers a
 * mutation of the pinned file; these cover a mutation of the *path to* it,
 * which is the half that used to be pinned at the realpath and spawned at the
 * unresolved path.
 */
describe("Deno sandbox runner path canonicalization", () => {
  const runnerSource = (tag: string) => [
    "const runtime = globalThis.Deno",
    "const enc = new TextEncoder()",
    'const reader = runtime.stdin.readable.pipeThrough(new TextDecoderStream()).getReader()',
    'let buf = ""',
    "async function readLine() {",
    "  for (;;) {",
    '    const i = buf.indexOf("\\n")',
    "    if (i >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); return l }",
    "    const n = await reader.read()",
    "    if (n.done) return undefined",
    "    buf += n.value",
    "  }",
    "}",
    'async function send(m) { await runtime.stdout.write(enc.encode(JSON.stringify(m) + "\\n")) }',
    "await readLine()",
    `await send({ type: "complete", result: { ranRunner: ${JSON.stringify(tag)} } })`,
    "runtime.exit(0)",
    "",
  ].join("\n")

  test("runs the pinned runner after the symlink it was named through is repointed", async () => {
    const root = await mkdtemp(join(tmpdir(), "smithers-agent-runner-symlink-"))
    try {
      await writeFile(join(root, "honest.js"), runnerSource("HONEST"))
      await writeFile(join(root, "evil.js"), runnerSource("EVIL"))
      await symlink(join(root, "honest.js"), join(root, "runner.js"))

      const sandbox = new DenoSubprocessSandbox({ runnerPath: join(root, "runner.js") })
      // Repointing the link leaves the pinned realpath untouched, so identity
      // verification has nothing to complain about. The spawn must still use
      // the file that was pinned.
      await unlink(join(root, "runner.js"))
      await symlink(join(root, "evil.js"), join(root, "runner.js"))

      const execution = await sandbox.execute(
        "export default () => null",
        {},
        { sourceDigest: "runner-symlink", turnId: "turn_runner_symlink" },
      )
      expect(execution.ok).toBe(true)
      expect(execution.result).toEqual({ ranRunner: "HONEST" })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("runs the pinned runner after a symlinked parent directory is repointed", async () => {
    const root = await mkdtemp(join(tmpdir(), "smithers-agent-runner-dirlink-"))
    try {
      await mkdir(join(root, "good"))
      await mkdir(join(root, "bad"))
      await writeFile(join(root, "good", "runner.js"), runnerSource("HONEST"))
      await writeFile(join(root, "bad", "runner.js"), runnerSource("EVIL"))
      await symlink(join(root, "good"), join(root, "live"))

      const sandbox = new DenoSubprocessSandbox({ runnerPath: join(root, "live", "runner.js") })
      await unlink(join(root, "live"))
      await symlink(join(root, "bad"), join(root, "live"))

      const execution = await sandbox.execute(
        "export default () => null",
        {},
        { sourceDigest: "runner-dirlink", turnId: "turn_runner_dirlink" },
      )
      expect(execution.ok).toBe(true)
      expect(execution.result).toEqual({ ranRunner: "HONEST" })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // `path.resolve` and both Node's and Bun's `realpath` collapse ".."
  // lexically; the kernel does not when the preceding segment is a symlink. A
  // canonical path that names a different file than the caller's path opens is
  // refused rather than digested and executed.
  test("refuses a path whose canonical form is a different file", async () => {
    const root = await mkdtemp(join(tmpdir(), "smithers-agent-runner-dotdot-"))
    try {
      await mkdir(join(root, "real"))
      await mkdir(join(root, "real", "sub"))
      await mkdir(join(root, "a"))
      await writeFile(join(root, "real", "runner.js"), runnerSource("HONEST"))
      await writeFile(join(root, "a", "runner.js"), runnerSource("EVIL"))
      await symlink(join(root, "real", "sub"), join(root, "a", "link"))

      // Built by concatenation: join() would collapse ".." before the sandbox
      // ever saw the segment under test.
      expect(() => new DenoSubprocessSandbox({ runnerPath: `${root}/a/link/../runner.js` }))
        .toThrow(/is a different file/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects a runner path that names a directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "smithers-agent-runner-slash-"))
    try {
      await writeFile(join(root, "runner.js"), runnerSource("HONEST"))
      expect(() => new DenoSubprocessSandbox({ runnerPath: `${join(root, "runner.js")}/` })).toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
