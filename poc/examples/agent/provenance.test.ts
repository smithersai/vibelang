import { describe, expect, test } from "bun:test"
import {
  CodingAgent,
  DenoSubprocessSandbox,
  InMemoryTypeScriptCompiler,
  MemoryTurnJournal,
  ScriptedModel,
  defineComponentIdentity,
  defineFunction,
  sha256Json,
  textPrompt,
} from "../../src/agent/index.ts"
import type {
  AgentFunction,
  AgentFunctionTable,
  ComponentIdentity,
  JsonValue,
  ModelDescriptor,
  SandboxExecution,
  TypeScriptCompiler,
  TypeScriptSandbox,
} from "../../src/agent/index.ts"

const generatedSource = "export default () => 'generated'"

function identity(name: string, artifact: string, config: JsonValue): ComponentIdentity {
  return defineComponentIdentity({ name, artifact, config })
}

function fakeCompiler(config: JsonValue = null): TypeScriptCompiler {
  return {
    identity: identity("compiler/test", "test compiler implementation v1", config),
    async compile(source) {
      return { ok: true, diagnostics: [], javascript: source, compiler: "test compiler" }
    },
  }
}

function fakeSandbox(config: JsonValue = null, invokeName?: string): TypeScriptSandbox {
  const component = identity("sandbox/test", "test sandbox implementation v1", config)
  return {
    kind: component.name,
    identity: component,
    async execute(_javascript, functions, options): Promise<SandboxExecution> {
      let result: JsonValue = "sandbox-result"
      if (invokeName) {
        const fn = functions[invokeName]
        if (!fn) throw new Error(`missing snapshotted function ${invokeName}`)
        result = await fn.invoke(null, {
          signal: new AbortController().signal,
          turnId: options.turnId,
          sourceDigest: options.sourceDigest,
          callId: 1,
          functionName: invokeName,
          ordinal: 1,
          inputDigest: sha256Json(null),
        }) as JsonValue
      }
      return { ok: true, result, logs: [], stderr: "", durationMs: 0 }
    },
  }
}

const implementationOne = (_input: null): string => "one"
const implementationTwo = (_input: null): string => "two"

interface TurnOptions {
  readonly task?: string
  readonly implementation?: (input: null) => string
  readonly implementationId?: string
  readonly functionConfig?: JsonValue
  readonly modelConfig?: JsonValue
  readonly modelVersion?: ModelDescriptor
  readonly compilerConfig?: JsonValue
  readonly sandboxConfig?: JsonValue
  readonly maxRepairs?: number
  readonly journal?: MemoryTurnJournal
}

async function runTurn(options: TurnOptions = {}) {
  const fn = defineFunction<null, string>(
    "(input: null) => string",
    options.implementation ?? implementationOne,
    "return a stable test value",
    {
      name: "agent-function/test-value",
      implementationId: options.implementationId ?? "test/agent/stable-value",
      implementationVersion: "1",
      config: options.functionConfig ?? null,
    },
  )
  const agent = CodingAgent.make<{ task: string }, string>({
    model: new ScriptedModel([generatedSource], {
      config: options.modelConfig ?? null,
      ...(options.modelVersion === undefined ? {} : { model: options.modelVersion }),
    }),
    prompt: textPrompt({ system: "test system", task: ({ task }) => task }),
    functions: { value: fn },
    compiler: fakeCompiler(options.compilerConfig ?? null),
    sandbox: fakeSandbox(options.sandboxConfig ?? null),
    maxRepairs: options.maxRepairs ?? 0,
    journal: options.journal,
  })
  return agent.run({ task: options.task ?? "same task" })
}

describe("durable agent component provenance", () => {
  test("is reproducible and every behavior-affecting component changes turnId", async () => {
    const baseline = await runTurn()
    const repeated = await runTurn()
    expect(repeated.turnId).toBe(baseline.turnId)

    const variants = await Promise.all([
      runTurn({ task: "different task" }),
      runTurn({ implementation: implementationTwo }),
      runTurn({ implementationId: "test/agent/stable-value-other-deployment" }),
      runTurn({ functionConfig: { revision: 2 } }),
      runTurn({ modelConfig: { temperature: 1 } }),
      runTurn({ modelVersion: { provider: "scripted", name: "scripted", version: "2" } }),
      runTurn({ compilerConfig: { policy: 2 } }),
      runTurn({ sandboxConfig: { timeoutMs: 2 } }),
      runTurn({ maxRepairs: 1 }),
    ])
    expect(new Set(variants.map((result) => result.turnId)).size).toBe(variants.length)
    expect(variants.every((result) => result.turnId !== baseline.turnId)).toBe(true)
  })

  test("journals the complete immutable identity envelope", async () => {
    const journal = new MemoryTurnJournal()
    const result = await runTurn({ journal })
    const started = journal.events.find((event) => event.type === "turn.started")
    expect(started?.turnId).toBe(result.turnId)
    expect(started?.details).toMatchObject({
      schema: "smithers.agent.turn/v3",
      promptDigest: result.provenance.promptDigest,
      callableDigest: result.provenance.callableDigest,
      functionTableDigest: result.provenance.functionTableDigest,
      agentConfigDigest: result.provenance.agentConfigDigest,
      modelIdentity: { name: "model/scripted" },
      modelVersion: { provider: "scripted", name: "scripted", version: "1" },
      compilerIdentity: { name: "compiler/test" },
      sandboxIdentity: { name: "sandbox/test" },
      functionIdentities: { value: { name: "agent-function/test-value" } },
      callableManifestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      callableManifest: [{ exposedAs: "value", kind: "legacy", durable: false }],
    })
    expect(Object.isFrozen(result.provenance)).toBe(true)
    expect(Object.isFrozen(result.provenance.model)).toBe(true)
    expect(result.provenance.model.artifactDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(result.provenance.functions.value?.configDigest).toMatch(/^[a-f0-9]{64}$/)
  })

  test("pins real compiler, Deno runtime/runner, and sandbox policy configuration", () => {
    const compiler = new InMemoryTypeScriptCompiler()
    const defaultSandbox = new DenoSubprocessSandbox({ timeoutMs: 1_000 })
    const changedLimit = new DenoSubprocessSandbox({ timeoutMs: 2_000 })

    for (const component of [compiler.identity, defaultSandbox.identity, changedLimit.identity]) {
      expect(Object.isFrozen(component)).toBe(true)
      expect(component.artifactDigest).toMatch(/^[a-f0-9]{64}$/)
      expect(component.configDigest).toMatch(/^[a-f0-9]{64}$/)
    }
    expect(defaultSandbox.identity.artifactDigest).toBe(changedLimit.identity.artifactDigest)
    expect(defaultSandbox.identity.configDigest).not.toBe(changedLimit.identity.configDigest)
  })
})

describe("AgentFunction table snapshots", () => {
  test("makes later mutable-table replacement inert for identity and execution", async () => {
    const first = defineFunction<null, string>(
      "(input: null) => string",
      implementationOne,
      undefined,
      {
        name: "agent-function/snapshot",
        implementationId: "test/agent/snapshot-one",
        implementationVersion: "1",
        config: null,
      },
    )
    const second = defineFunction<null, string>(
      "(input: null) => string",
      implementationTwo,
      undefined,
      {
        name: "agent-function/snapshot",
        implementationId: "test/agent/snapshot-two",
        implementationVersion: "1",
        config: null,
      },
    )
    const table: AgentFunctionTable = { value: first }
    const model = new ScriptedModel([generatedSource])
    const agent = CodingAgent.make<null, string>({
      model,
      prompt: textPrompt({ system: "snapshot", task: () => "snapshot" }),
      functions: table,
      compiler: fakeCompiler(),
      sandbox: fakeSandbox(null, "value"),
      maxRepairs: 0,
    })
    table.value = second

    const result = await agent.run(null)
    expect(result.result).toBe("one")
    expect(result.provenance.functions.value?.artifactDigest).toBe(first.identity.artifactDigest)
    expect(result.provenance.functions.value?.artifactDigest).not.toBe(second.identity.artifactDigest)
  })

  test("rejects accessors and malformed identities without invoking hostile code", () => {
    let tableGetterCalled = false
    const accessorTable = {}
    Object.defineProperty(accessorTable, "value", {
      enumerable: true,
      get() {
        tableGetterCalled = true
        return defineFunction("(input: null) => string", implementationOne, undefined, {
          implementationId: "test/agent/hostile", implementationVersion: "1",
        })
      },
    })
    const common = {
      model: new ScriptedModel([generatedSource]),
      prompt: textPrompt({ system: "hostile", task: () => "hostile" }),
      compiler: fakeCompiler(),
      sandbox: fakeSandbox(),
      maxRepairs: 0,
    }
    expect(() => CodingAgent.make({ ...common, functions: accessorTable as AgentFunctionTable }))
      .toThrow("enumerable data property")
    expect(tableGetterCalled).toBe(false)

    let signatureGetterCalled = false
    const hostileFunction = {
      identity: identity("agent-function/hostile", "hostile", null),
      invoke: implementationOne,
      get signature() {
        signatureGetterCalled = true
        return "(input: null) => string"
      },
    } as unknown as AgentFunction
    expect(() => CodingAgent.make({ ...common, functions: { value: hostileFunction } }))
      .toThrow("enumerable data property")
    expect(signatureGetterCalled).toBe(false)

    const invalidIdentity = {
      identity: { name: "agent-function/bad", artifactDigest: "not-a-digest", configDigest: "x" },
      signature: "(input: null) => string",
      invoke: implementationOne,
    } as unknown as AgentFunction
    expect(() => CodingAgent.make({ ...common, functions: { value: invalidIdentity } }))
      .toThrow("SHA-256")
  })
})
