import { afterAll, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  DenoSubprocessSandbox,
  PoisonModel,
  ScriptedModel,
  SqliteTurnJournal,
  TurnJournalDivergenceError,
  TurnJournalIntegrityError,
  actionToolTable,
  callableSurfaceManifest,
  compileActionTool,
  defineFunction,
  poisonFunctionTable,
  sha256Text,
} from "../../src/agent/bun.ts"
import type { HostCallIdentity, ModelCallIdentity } from "../../src/agent/bun.ts"
import { FIRST_TURN_SOURCE, createDurableAgent, createProject } from "./durable-demo.ts"

const root = mkdtempSync(join(tmpdir(), "smithers-agent-journal-"))
let databaseCount = 0

function databasePath(name: string): string {
  databaseCount += 1
  return join(root, `${databaseCount}-${name}.sqlite`)
}

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

const componentIdentity = Object.freeze({
  name: "agent-function/test",
  artifactDigest: "a".repeat(64),
  configDigest: "b".repeat(64),
})

function hostCallIdentity(overrides: Partial<HostCallIdentity> = {}): HostCallIdentity {
  return Object.freeze({
    turnId: "turn_unit",
    sourceDigest: "c".repeat(64),
    functionName: "readFile",
    ordinal: 1,
    callId: 1,
    functionIdentity: componentIdentity,
    contract: { mode: "compiler-derived", contractDigest: "d".repeat(64) },
    inputDigest: sha256Text('{"path":"README.md"}'),
    ...overrides,
  })
}

function modelCallIdentity(overrides: Partial<ModelCallIdentity> = {}): ModelCallIdentity {
  return Object.freeze({
    turnId: "turn_unit",
    attempt: 0,
    requestDigest: "e".repeat(64),
    modelIdentity: componentIdentity,
    model: { provider: "scripted", name: "scripted", version: "1" },
    ...overrides,
  })
}

describe("SQLite turn journal", () => {
  test("commits and digest-checks model calls, host calls, artifacts, and the event chain", () => {
    const path = databasePath("primitives")
    const journal = new SqliteTurnJournal(path)
    journal.append({ type: "turn.started", turnId: "turn_unit", details: { schema: "test" } })
    journal.putArtifact({
      kind: "generated-source",
      turnId: "turn_unit",
      digest: sha256Text("export default () => null"),
      content: "export default () => null",
    })
    journal.recordModelCall(modelCallIdentity(), { text: "hello" })
    journal.recordHostCall(hostCallIdentity(), { outcome: "success", output: { contents: "x" } })
    journal.append({
      type: "function.completed",
      turnId: "turn_unit",
      functionName: "readFile",
      callId: 1,
      ordinal: 1,
      ok: true,
      details: { source: "live" },
    })
    journal.close()

    // A fresh instance over the same file sees every committed row.
    const reopened = new SqliteTurnJournal(path)
    expect(reopened.recallModelCall(modelCallIdentity())?.text).toBe("hello")
    expect(reopened.recallHostCall(hostCallIdentity())).toEqual({
      outcome: "success",
      output: { contents: "x" },
    })
    expect(reopened.readArtifact(sha256Text("export default () => null"))?.content)
      .toBe("export default () => null")
    expect(reopened.readEvents("turn_unit").map((event) => event.type))
      .toEqual(["turn.started", "function.completed"])
    expect(reopened.readHostCalls("turn_unit")).toEqual([{
      turnId: "turn_unit",
      sourceDigest: "c".repeat(64),
      functionName: "readFile",
      ordinal: 1,
      callId: 1,
      inputDigest: sha256Text('{"path":"README.md"}'),
      recordedAt: expect.any(Number),
      call: { outcome: "success", output: { contents: "x" } },
    }])
    reopened.close()
  })

  test("the first committed result stays canonical for its identity", () => {
    const journal = new SqliteTurnJournal(databasePath("canonical"))
    journal.recordHostCall(hostCallIdentity(), { outcome: "success", output: 1 })
    journal.recordHostCall(hostCallIdentity(), { outcome: "success", output: 2 })
    expect(journal.recallHostCall(hostCallIdentity())).toEqual({ outcome: "success", output: 1 })

    journal.recordModelCall(modelCallIdentity(), { text: "first" })
    journal.recordModelCall(modelCallIdentity(), { text: "second" })
    expect(journal.recallModelCall(modelCallIdentity())?.text).toBe("first")
    journal.close()
  })

  test("a diverged replay fails closed instead of answering with the wrong recording", () => {
    const journal = new SqliteTurnJournal(databasePath("divergence"))
    journal.recordHostCall(hostCallIdentity(), { outcome: "success", output: 1 })
    journal.recordModelCall(modelCallIdentity(), { text: "recorded" })

    expect(() => journal.recallHostCall(hostCallIdentity({ inputDigest: "f".repeat(64) })))
      .toThrow(TurnJournalDivergenceError)
    expect(() => journal.recallHostCall(hostCallIdentity({
      functionIdentity: { ...componentIdentity, configDigest: "0".repeat(64) },
    }))).toThrow("different binding identity")
    expect(() => journal.recallHostCall(hostCallIdentity({ contract: { mode: "legacy-json-only" } })))
      .toThrow("different RPC contract")
    expect(() => journal.recallModelCall(modelCallIdentity({ requestDigest: "0".repeat(64) })))
      .toThrow("different model request")
    expect(() => journal.recallModelCall(modelCallIdentity({
      model: { provider: "scripted", name: "scripted", version: "2" },
    }))).toThrow("different model identity")

    // A miss is still an ordinary miss, not an error.
    expect(journal.recallHostCall(hostCallIdentity({ ordinal: 2 }))).toBeUndefined()
    expect(journal.recallModelCall(modelCallIdentity({ attempt: 1 }))).toBeUndefined()
    journal.close()
  })

  test("tampered rows fail their digest check on read", () => {
    const path = databasePath("corruption")
    const journal = new SqliteTurnJournal(path)
    journal.append({ type: "turn.started", turnId: "turn_unit", details: { schema: "test" } })
    journal.append({ type: "turn.completed", turnId: "turn_unit", ok: true })
    journal.recordHostCall(hostCallIdentity(), { outcome: "success", output: { contents: "x" } })
    journal.recordModelCall(modelCallIdentity(), { text: "hello" })
    journal.putArtifact({
      kind: "generated-source",
      turnId: "turn_unit",
      digest: sha256Text("original"),
      content: "original",
    })
    journal.close()

    const raw = new Database(path, { strict: true })
    raw.query("UPDATE agent_host_calls SET output_json = '{\"contents\":\"tampered\"}'").run()
    raw.query("UPDATE agent_model_calls SET response_json = '{\"text\":\"tampered\"}'").run()
    raw.query("UPDATE agent_turn_artifacts SET content = 'tampered'").run()
    raw.query("UPDATE agent_turn_events SET details_json = '{\"schema\":\"tampered\"}' WHERE sequence = 1").run()
    raw.close()

    const reopened = new SqliteTurnJournal(path)
    expect(() => reopened.recallHostCall(hostCallIdentity())).toThrow(TurnJournalIntegrityError)
    expect(() => reopened.recallModelCall(modelCallIdentity())).toThrow(TurnJournalIntegrityError)
    expect(() => reopened.readArtifact(sha256Text("original"))).toThrow(TurnJournalIntegrityError)
    expect(() => reopened.readEvents()).toThrow("failed persisted digest verification")
    reopened.close()
  })

  test("refuses a database written under a different journal schema", () => {
    const path = databasePath("schema")
    new SqliteTurnJournal(path).close()
    const raw = new Database(path, { strict: true })
    raw.query("UPDATE agent_journal_meta SET value = 'other/v9' WHERE key = 'schema'").run()
    raw.close()
    expect(() => new SqliteTurnJournal(path)).toThrow(TurnJournalIntegrityError)
  })
})

describe("tool to Action adapter", () => {
  const source = `
import { Action } from "smithers:flows"

type Request = { readonly text: string }
type Reply = { readonly text: string }

class Rejected extends Error {
  constructor(readonly text: string) { super(text) }
}

export abstract class Echo extends Action<
  (input: Request) => Promise<Result<Reply, Rejected>>
> {}
`

  test("compiles a tool contract, derives the callable surface, and marks it durable", () => {
    let calls = 0
    const echo = compileActionTool<{ readonly text: string }, { readonly text: string }>(
      {
        source,
        exportName: "Echo",
        id: "smthrs/agent-demo/Echo",
        version: 3,
        description: "echo text",
        implementationId: "test/agent/echo-text",
        implementationVersion: "1",
      },
      async ({ text }) => {
        calls += 1
        return { text }
      },
    )

    expect(echo.identity.name).toBe("action/smthrs/agent-demo/Echo@3")
    expect(echo.actionContract?.id).toBe("smthrs/agent-demo/Echo")
    expect(echo.actionContract?.version).toBe(3)
    expect(echo.signature).toBe('(input: { readonly "text": string }) => Promise<{ readonly "text": string }>')

    const legacy = defineFunction<null, null>(
      "(input: null) => Promise<null>",
      async () => null,
      undefined,
      { implementationId: "test/agent/legacy-null", implementationVersion: "1" },
    )
    const manifest = callableSurfaceManifest({ echo, legacy })
    expect(manifest.entries).toEqual([
      {
        exposedAs: "echo",
        kind: "action",
        actionId: "smthrs/agent-demo/Echo",
        actionVersion: 3,
        flowId: null,
        flowVersion: null,
        planDigest: null,
        contractDigest: echo.actionContract!.contractDigest,
        durable: true,
      },
      {
        exposedAs: "legacy",
        kind: "legacy",
        actionId: null,
        actionVersion: null,
        flowId: null,
        flowVersion: null,
        planDigest: null,
        contractDigest: null,
        durable: false,
      },
    ])
    expect(manifest.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(calls).toBe(0)
  })

  test("assembles a table and rejects invalid or duplicated exposures", () => {
    const tool = {
      exposedAs: "echo",
      action: compileActionTool<{ readonly text: string }, { readonly text: string }>(
        {
          source,
          exportName: "Echo",
          id: "smthrs/agent-demo/Echo",
          version: 3,
          implementationId: "test/agent/echo",
          implementationVersion: "1",
        },
        async (input) => input,
      ).actionContract!,
      call: async (input: { readonly text: string }) => input,
      implementationId: "test/agent/echo",
      implementationVersion: "1",
    }
    expect(Object.keys(actionToolTable([tool]))).toEqual(["echo"])
    expect(() => actionToolTable([tool, tool])).toThrow("exposed twice")
    expect(() => actionToolTable([{ ...tool, exposedAs: "not an identifier" }]))
      .toThrow("not a TypeScript identifier")
  })

  test("surfaces contract diagnostics instead of binding an unchecked tool", () => {
    expect(() => compileActionTool(
      { source: "export const NotAnAction = 1", exportName: "NotAnAction", id: "x/y", version: 1 },
      async () => null,
    )).toThrow("did not compile")
  })
})

describe("durable turns over the SQLite journal", () => {
  test("journals every boundary of a real sandboxed turn", async () => {
    const path = databasePath("turn")
    const project = createProject()
    const journal = new SqliteTurnJournal(path)
    const model = new ScriptedModel([`\`\`\`ts\n${FIRST_TURN_SOURCE}\n\`\`\``])
    const run = await createDurableAgent({ project, model, journal }).run({
      task: "Copy README.md into GREETING.md.",
    })

    expect(run.ok).toBe(true)
    expect(run.result).toEqual({ wrote: "GREETING.md", bytes: 34, revision: 1 })
    expect(project.invocations).toEqual({ readFile: 1, writeFile: 1 })

    const events = journal.readEvents(run.turnId)
    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "model.requested",
      "model.responded",
      "compile.completed",
      "sandbox.started",
      "function.called",
      "function.completed",
      "function.called",
      "function.completed",
      "sandbox.completed",
      "turn.completed",
    ])
    expect(events[0].details.callableManifestDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(events[1].details.requestDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(events[2].details).toMatchObject({
      source: "live",
      modelVersion: { provider: "scripted", name: "scripted", version: "1" },
    })
    expect(events[3].details).toMatchObject({ diagnosticsDigest: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(events.at(-2)?.details).toMatchObject({ resultDigest: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(events.filter((event) => event.type === "function.called").map((event) => ({
      functionName: event.functionName,
      ordinal: event.ordinal,
      durable: event.details.durable,
    }))).toEqual([
      { functionName: "readFile", ordinal: 1, durable: true },
      { functionName: "writeFile", ordinal: 1, durable: true },
    ])

    // The accepted source is a content-addressed artifact, byte-for-byte.
    expect(journal.readArtifact(run.sourceDigest!)?.content).toBe(run.source)
    expect(journal.readHostCalls(run.turnId).map((call) => `${call.functionName}#${call.ordinal}`))
      .toEqual(["readFile#1", "writeFile#1"])
    expect(journal.readHostCalls(run.turnId)[1].call).toEqual({
      outcome: "success",
      output: { path: "GREETING.md", bytes: 34, revision: 1 },
    })
    journal.close()
  })

  test("replays a turn after a restart without invoking the model or the host functions", async () => {
    const path = databasePath("restart")
    const live = createProject()
    const liveJournal = new SqliteTurnJournal(path)
    const liveModel = new ScriptedModel([FIRST_TURN_SOURCE])
    const first = await createDurableAgent({ project: live, model: liveModel, journal: liveJournal }).run({
      task: "Copy README.md into GREETING.md.",
    })
    expect(first.ok).toBe(true)
    // Simulate the process dying: the journal handle is gone, only the file remains.
    liveJournal.close()

    const restarted = createProject()
    const restartedJournal = new SqliteTurnJournal(path)
    const replay = await createDurableAgent({
      project: restarted,
      model: new PoisonModel(liveModel),
      functions: poisonFunctionTable(restarted.functions),
      journal: restartedJournal,
    }).run({ task: "Copy README.md into GREETING.md." })

    expect(replay.ok).toBe(true)
    expect(replay.turnId).toBe(first.turnId)
    expect(replay.sourceDigest).toBe(first.sourceDigest)
    expect(replay.result).toEqual(first.result)
    // Nothing ran: no model call, no host call, no host state change.
    expect(restarted.invocations).toEqual({ readFile: 0, writeFile: 0 })
    expect(restarted.revision()).toBe(0)
    expect(restarted.files.has("GREETING.md")).toBe(false)

    const events = restartedJournal.readEvents(replay.turnId)
    const replayed = events.filter((event) => event.details.source === "replay")
    expect(replayed.map((event) => event.type)).toEqual([
      "model.responded",
      "function.completed",
      "function.completed",
    ])
    expect(events.at(-1)?.details).toMatchObject({ replayedModelResponses: 1 })
    restartedJournal.close()
  })

  test("replays every attempt of a repaired turn, diagnostics included", async () => {
    const path = databasePath("repair")
    const project = createProject()
    const task = { task: "Copy README.md into GREETING.md." }
    const rejected = `
export default async function turn(functions: Functions) {
  return functions.readFile({ pat: "README.md" })
}
`
    const model = new ScriptedModel([rejected, FIRST_TURN_SOURCE])
    const journal = new SqliteTurnJournal(path)
    const first = await createDurableAgent({ project, model, journal, maxRepairs: 1 }).run(task)
    expect(first.ok).toBe(true)
    expect(first.attempts).toHaveLength(2)
    expect(first.attempts[0].diagnostics.length).toBeGreaterThan(0)
    journal.close()

    const restarted = createProject()
    const reopened = new SqliteTurnJournal(path)
    const replay = await createDurableAgent({
      project: restarted,
      model: new PoisonModel(model),
      functions: poisonFunctionTable(restarted.functions),
      journal: reopened,
      maxRepairs: 1,
    }).run(task)

    expect(replay.ok).toBe(true)
    expect(replay.turnId).toBe(first.turnId)
    expect(replay.result).toEqual(first.result)
    expect(replay.attempts.map((attempt) => attempt.sourceDigest))
      .toEqual(first.attempts.map((attempt) => attempt.sourceDigest))
    // Both the rejected draft and its repair came back from the journal. The
    // turn id is shared with the recorded run, so its events are here too.
    const responses = reopened.readEvents(replay.turnId)
      .filter((event) => event.type === "model.responded")
      .map((event) => event.details.source)
    expect(responses).toEqual(["live", "live", "replay", "replay"])
    expect(restarted.invocations).toEqual({ readFile: 0, writeFile: 0 })
    reopened.close()
  })

  test("a corrupted recording fails the replayed turn instead of answering with it", async () => {
    const path = databasePath("replay-corruption")
    const project = createProject()
    const task = { task: "Copy README.md into GREETING.md." }
    const model = new ScriptedModel([FIRST_TURN_SOURCE])
    const journal = new SqliteTurnJournal(path)
    const first = await createDurableAgent({ project, model, journal }).run(task)
    expect(first.ok).toBe(true)
    journal.close()

    const raw = new Database(path, { strict: true })
    raw.query(
      `UPDATE agent_host_calls
       SET output_json = '{"contents":"tampered","path":"README.md"}'
       WHERE function_name = 'readFile'`,
    ).run()
    raw.close()

    const restarted = createProject()
    const reopened = new SqliteTurnJournal(path)
    const replay = await createDurableAgent({
      project: restarted,
      model: new PoisonModel(model),
      functions: poisonFunctionTable(restarted.functions),
      journal: reopened,
    }).run(task)

    expect(replay.ok).toBe(false)
    expect(replay.error?.name).toBe("TurnJournalIntegrityError")
    expect(replay.error?.message).toContain("failed persisted digest verification")
    expect(JSON.stringify(replay.result ?? null)).not.toContain("tampered")
    expect(restarted.invocations).toEqual({ readFile: 0, writeFile: 0 })
    reopened.close()
  })

  test("records but never replays a legacy JSON-only binding", async () => {
    const path = databasePath("legacy")
    const project = createProject()
    let calls = 0
    const stamp = defineFunction<{ readonly note: string }, { readonly note: string; readonly call: number }>(
      "(input: { readonly note: string }) => Promise<{ readonly note: string; readonly call: number }>",
      async ({ note }) => {
        calls += 1
        return { note, call: calls }
      },
      "legacy JSON-only binding",
      {
        name: "demo/stamp",
        implementationId: "test/agent/stamp",
        implementationVersion: "1",
        config: null,
      },
    )
    const source = `
export default async function turn(functions: Functions) {
  return functions.stamp({ note: "hello" })
}
`
    const task = { task: "Stamp a note." }
    const model = new ScriptedModel([source])
    const journal = new SqliteTurnJournal(path)
    const functions = { ...project.functions, stamp }
    const run = await createDurableAgent({ project, model, functions, journal }).run(task)
    expect(run.ok).toBe(true)
    expect(run.result).toEqual({ note: "hello", call: 1 })
    journal.close()

    const reopened = new SqliteTurnJournal(path)
    const replay = await createDurableAgent({
      project,
      model: new PoisonModel(model),
      functions,
      journal: reopened,
    }).run(task)

    // The model response replayed; the ordinary closure ran again for real.
    expect(replay.ok).toBe(true)
    expect(replay.result).toEqual({ note: "hello", call: 2 })
    expect(calls).toBe(2)
    expect(reopened.readHostCalls(replay.turnId)).toEqual([])
    expect(reopened.readEvents(replay.turnId).find((event) => event.type === "function.called")?.details)
      .toMatchObject({ durable: false })
    reopened.close()
  })
})

/**
 * What may be committed as a replayable host-call result.
 *
 * The rule is the docblock's: a control-plane teardown describes how *this
 * process* was torn down, not what the host callback decided, so it is never
 * recorded — a restarted turn must be free to call the function again. It is
 * enforced by the identity of the thrown value and by the turn's abort signal,
 * never by the spelling of `error.name`, so these tests pin both directions:
 * every teardown stays out of the record, and an ordinary tool failure that
 * merely *spells* a teardown name stays in it.
 */
describe("replayable host-call outcomes", () => {
  const source = `
import { Action } from "smithers:flows"

type Request = { readonly path: string }
type Reply = { readonly path: string; readonly contents: string }

class Rejected extends Error {
  constructor(readonly path: string) { super(path) }
}

export abstract class ReadFile extends Action<
  (input: Request) => Promise<Result<Reply, Rejected>>
> {}
`

  function tool(
    call: (input: { readonly path: string }) => Promise<{ readonly path: string; readonly contents: string }>,
  ) {
    return compileActionTool<{ readonly path: string }, { readonly path: string; readonly contents: string }>(
      {
        source,
        exportName: "ReadFile",
        id: "smthrs/agent-replay/ReadFile",
        version: 1,
        implementationId: "test/agent/replay-read-file",
        implementationVersion: "1",
      },
      call,
    )
  }

  const TURN_SOURCE =
    'export default async (f) => { try { return { ok: true, v: await f.readFile({ path: "README.md" }) } } ' +
    "catch (e) { return { ok: false, name: e.name } } }"

  test("a protocol-violation teardown is not committed, and the restart re-invokes the host", async () => {
    const runnerRoot = await mkdtemp(join(tmpdir(), "smithers-agent-teardown-"))
    try {
      // A runner that answers the init handshake, issues one host call, and
      // then violates the protocol while that call is still in flight.
      const runner = join(runnerRoot, "protocol-runner.js")
      await writeFile(runner, [
        "const enc = new TextEncoder()",
        "const reader = Deno.stdin.readable.pipeThrough(new TextDecoderStream()).getReader()",
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
        'async function send(m) { await Deno.stdout.write(enc.encode(JSON.stringify(m) + "\\n")) }',
        "await readLine()",
        'await send({ type: "call", id: 1, name: "readFile", input: { path: "README.md" } })',
        "await new Promise((r) => setTimeout(r, 150))",
        'await send({ type: "totally-unknown-protocol-message" })',
        "await new Promise((r) => setTimeout(r, 5_000))",
        "",
      ].join("\n"))

      let invocations = 0
      const functions = {
        readFile: tool(async ({ path }) => {
          invocations += 1
          await new Promise((resolve) => setTimeout(resolve, 400))
          return { path, contents: "# hello" }
        }),
      }
      const journal = new SqliteTurnJournal(databasePath("teardown"))
      const turnId = "turn_teardown"
      const sourceDigest = sha256Text("teardown")
      try {
        const torn = await new DenoSubprocessSandbox({ runnerPath: runner, timeoutMs: 10_000 })
          .execute(TURN_SOURCE, functions, { turnId, sourceDigest, journal })
        expect(torn.ok).toBe(false)
        expect(torn.error?.name).toBe("SandboxProtocolError")
        expect(invocations).toBe(1)
        // The teardown is not a host-callback decision, so nothing replayable
        // was committed for the call site.
        expect(journal.readHostCalls(turnId)).toEqual([])

        // The restarted turn is free to call the function again, and succeeds.
        const restarted = await new DenoSubprocessSandbox({ timeoutMs: 10_000 })
          .execute(TURN_SOURCE, functions, { turnId, sourceDigest, journal })
        expect(restarted.ok).toBe(true)
        expect(restarted.result).toEqual({ ok: true, v: { path: "README.md", contents: "# hello" } })
        expect(invocations).toBe(2)
        expect(journal.readHostCalls(turnId)).toHaveLength(1)
      } finally {
        journal.close()
      }
    } finally {
      await rm(runnerRoot, { recursive: true, force: true })
    }
  })

  test.each([
    ["ToolFailure"],
    // Every one of these merely *spells* a control-plane name. They are
    // ordinary deterministic tool failures and must replay like any other.
    ["AbortError"],
    ["SandboxTimeout"],
    ["SandboxCancelled"],
    ["SandboxProtocolError"],
    ["SandboxClosed"],
    ["SandboxCallLimit"],
  ])("records a deterministic tool failure named %s and replays it", async (name) => {
    let invocations = 0
    const functions = {
      readFile: tool(async () => {
        invocations += 1
        const error = new Error("this tool always fails the same way")
        error.name = name
        throw error
      }),
    }
    const journal = new SqliteTurnJournal(databasePath(`spelling-${name}`))
    const turnId = "turn_spelling"
    const sourceDigest = sha256Text(`spelling-${name}`)
    try {
      for (const attempt of [1, 2]) {
        const execution = await new DenoSubprocessSandbox({ timeoutMs: 10_000 })
          .execute(TURN_SOURCE, functions, { turnId, sourceDigest, journal })
        expect(execution.ok).toBe(true)
        expect(execution.result).toEqual({ ok: false, name })
        expect(attempt).toBeGreaterThan(0)
      }
      expect(invocations).toBe(1)
      const recorded = journal.readHostCalls(turnId)
      expect(recorded).toHaveLength(1)
      expect(recorded[0].call).toMatchObject({ outcome: "failure", error: { name } })
    } finally {
      journal.close()
    }
  })

  test("settles only after the durable commit lands, and never inverts a lost commit", async () => {
    const functions = {
      readFile: tool(async ({ path }) => ({ path, contents: "sent" })),
    }
    const turnId = "turn_commit"

    // A store whose write is slow enough that an unawaited commit would land
    // after the caller had already finalized the turn.
    const backing = new SqliteTurnJournal(databasePath("commit-slow"))
    try {
      const slow = {
        append: (event: Parameters<SqliteTurnJournal["append"]>[0]) => { backing.append(event) },
        recallHostCall: (identity: HostCallIdentity) => backing.recallHostCall(identity),
        recordHostCall: async (
          identity: HostCallIdentity,
          outcome: Parameters<SqliteTurnJournal["recordHostCall"]>[1],
        ) => {
          await new Promise((resolve) => setTimeout(resolve, 250))
          backing.recordHostCall(identity, outcome)
        },
      }
      const execution = await new DenoSubprocessSandbox({ timeoutMs: 10_000 })
        .execute(TURN_SOURCE, functions, { turnId, sourceDigest: sha256Text("commit-slow"), journal: slow })
      expect(execution.ok).toBe(true)
      // Committed before execute() resolved, not after.
      expect(backing.readHostCalls(turnId)).toHaveLength(1)
      // ...and the append-order chain is causally possible.
      expect(backing.readEvents(turnId).map((event) => event.type))
        .toEqual(["function.called", "function.completed"])
    } finally {
      backing.close()
    }

    // A store that rejects the success commit. The host effect already
    // happened, so it must not be rewritten as a committed *failure*, and the
    // caller must not be told the turn finished.
    const rejecting = new SqliteTurnJournal(databasePath("commit-reject"))
    try {
      const store = {
        append: (event: Parameters<SqliteTurnJournal["append"]>[0]) => { rejecting.append(event) },
        recallHostCall: (identity: HostCallIdentity) => rejecting.recallHostCall(identity),
        recordHostCall: () => { throw new Error("durable store is unreachable") },
      }
      const execution = await new DenoSubprocessSandbox({ timeoutMs: 10_000 })
        .execute(TURN_SOURCE, functions, { turnId, sourceDigest: sha256Text("commit-reject"), journal: store })
      expect(execution.ok).toBe(false)
      expect(execution.error?.name).toBe("SandboxJournalCommitFailed")
      expect(execution.error?.message).toContain("durable store is unreachable")
      expect(rejecting.readHostCalls(turnId)).toEqual([])
    } finally {
      rejecting.close()
    }
  })

  test.each([
    ["a non-string name", { name: 1, message: "m" }],
    ["a non-string message", { name: "X", message: { nested: true } }],
    ["a null error", null],
    ["a non-object error", "just a string"],
    ["non-JSON fields", { name: "X", message: "m", fields: { bad: () => 1 } }],
  ])("fails closed on a replayed failure with %s", async (_label, error) => {
    const functions = { readFile: tool(async ({ path }) => ({ path, contents: "live" })) }
    const corrupted = {
      append: () => {},
      recallHostCall: () => ({ outcome: "failure", error }) as never,
      recordHostCall: () => {},
    }
    const execution = await new DenoSubprocessSandbox({ timeoutMs: 10_000 })
      .execute(TURN_SOURCE, functions, {
        turnId: "turn_corrupt",
        sourceDigest: sha256Text("corrupt"),
        journal: corrupted,
      })
    expect(execution.ok).toBe(true)
    expect(execution.result).toEqual({ ok: false, name: "AgentReplayIntegrityError" })
  })

  test("bounds a replayed failure exactly as a live one is bounded", async () => {
    const functions = { readFile: tool(async ({ path }) => ({ path, contents: "live" })) }
    const oversized = {
      append: () => {},
      recallHostCall: () => ({
        outcome: "failure",
        error: { name: "Rejected", message: "Q".repeat(400_000), fields: {} },
      }) as never,
      recordHostCall: () => {},
    }
    const execution = await new DenoSubprocessSandbox({
      timeoutMs: 10_000,
      maxOutputBytes: 4 * 1024 * 1024,
    }).execute(
      'export default async (f) => { try { await f.readFile({ path: "README.md" }); return { len: -1 } } ' +
      "catch (e) { return { len: e.message.length } } }",
      functions,
      { turnId: "turn_bound", sourceDigest: sha256Text("bound"), journal: oversized },
    )
    expect(execution.ok).toBe(true)
    expect(execution.result).toEqual({ len: 65_536 })
  })
})
