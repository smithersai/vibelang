import { describe, expect, test } from "bun:test"
import {
  DenoSubprocessSandbox,
  InMemoryTypeScriptCompiler,
  MemoryTurnJournal,
  declareCallableSurface,
  defineActionFunction,
  defineFunction,
  functionTableIdentity,
} from "../../src/agent/index.ts"
import { compileActionContract } from "../../src/durable/schema.ts"
import type { ActionDescriptor } from "../../src/durable/ir.ts"

const actionSource = `
import { Action } from "smithers:flows"

type Request =
  | { readonly kind: "read"; readonly path: string }
  | { readonly kind: "count"; readonly amount: number }

type Reply =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "total"; readonly value: number }

class Rejected extends Error {
  constructor(readonly field: string) { super(field) }
}

class Unavailable extends Error {
  constructor(readonly retry: boolean) { super("unavailable") }
}

export abstract class HostOperation extends Action<
  (input: Request) => Promise<Result<Reply, Rejected | Unavailable>>
> {}
`

function contract(
  id = "test/agent/HostOperation",
  source = actionSource,
): ActionDescriptor {
  const compiled = compileActionContract(source, {
    fileName: "agent/host-operation.sm",
    exportName: "HostOperation",
    id,
    version: 1,
  })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  return compiled.descriptor
}

const implementation = async (
  input: { readonly kind: "read"; readonly path: string } | { readonly kind: "count"; readonly amount: number },
): Promise<{ readonly kind: "text"; readonly value: string } | { readonly kind: "total"; readonly value: number }> =>
  input.kind === "read"
    ? { kind: "text", value: input.path }
    : { kind: "total", value: input.amount }

describe("compiler-derived AgentFunction RPC contracts", () => {
  test("derives the callable surface and pins the complete Action contract identity", async () => {
    const first = defineActionFunction(
      contract(),
      implementation,
      "perform a checked operation",
      { name: "agent-function/checked", config: null },
    )
    const second = defineActionFunction(
      contract(
        "test/agent/HostOperation",
        actionSource.replace("readonly retry: boolean", "readonly retryAfter: number"),
      ),
      implementation,
      "perform a checked operation",
      { name: "agent-function/checked", config: null },
    )

    expect(first.signature).toBe(second.signature)
    expect(first.signature).toContain('readonly "kind": "count"')
    expect(first.signature).toContain('readonly "kind": "read"')
    expect(first.signature).toContain("=> Promise<")
    expect(first.actionContract?.inputSchema.shape).toBe("structural")
    expect(first.actionContract?.errorSchema).toMatchObject({
      shape: "structural",
      descriptor: { kind: "union" },
    })
    expect(Object.isFrozen(first.actionContract)).toBe(true)
    expect(first.actionContract?.inputSchema.digest).toBe(second.actionContract?.inputSchema.digest)
    expect(first.actionContract?.successSchema.digest).toBe(second.actionContract?.successSchema.digest)
    expect(first.actionContract?.errorSchema.digest).not.toBe(second.actionContract?.errorSchema.digest)
    expect(first.identity.artifactDigest).toBe(second.identity.artifactDigest)
    expect(first.identity.configDigest).not.toBe(second.identity.configDigest)
    expect(functionTableIdentity({ operation: first }).digest)
      .not.toBe(functionTableIdentity({ operation: second }).digest)
    expect(declareCallableSurface({ operation: first }))
      .not.toBe(declareCallableSurface({ operation: second }))
    expect(declareCallableSurface({ operation: first })).toContain(
      `contract=${first.actionContract?.contractDigest}`,
    )
    const compilation = await new InMemoryTypeScriptCompiler().compile(
      `export default async (functions: Functions) =>
        functions.operation({ kind: "read", path: "README.md" })`,
      declareCallableSurface({ operation: first }),
    )
    expect(compilation.ok).toBe(true)
  })

  test("rejects tampered or non-compiler schema envelopes before sandbox launch", () => {
    const descriptor = structuredClone(contract())
    ;(descriptor.inputSchema as { digest: string }).digest = "0".repeat(64)
    expect(() => defineActionFunction(descriptor, implementation))
      .toThrow("input schema digest mismatch")

    expect(() => defineFunction(
      "(input: string) => Promise<string>",
      async (input: string) => input,
      undefined,
      { actionContract: contract() },
    )).toThrow("signature does not exactly match")

    const checked = defineActionFunction(contract(), implementation)
    expect(() => functionTableIdentity({
      operation: { ...checked, signature: "(input: null) => Promise<null>" },
    })).toThrow("signature does not exactly match")

    const legacy = defineFunction("(input: null) => Promise<null>", async () => null)
    expect(declareCallableSurface({ legacy })).toContain("@smithersAgentContract legacy-json-only")
  })

  test("invalid structural input is journaled as a call failure and never invokes the host", async () => {
    let invocations = 0
    const binding = defineActionFunction(
      contract(),
      async (input: { readonly kind: "read"; readonly path: string }) => {
        invocations += 1
        return { kind: "text" as const, value: input.path }
      },
    )
    const journal = new MemoryTurnJournal()
    const execution = await new DenoSubprocessSandbox().execute(
      `export default async functions => functions.operation({ kind: "read", path: 42 })`,
      { operation: binding },
      { sourceDigest: "bad-input", turnId: "turn_bad_input", journal },
    )

    expect(execution.ok).toBe(false)
    expect(execution.result).toBeUndefined()
    expect(execution.error).toMatchObject({
      name: "AgentRpcContractError",
      fields: {
        phase: "input",
        contractDigest: binding.actionContract?.contractDigest,
        schemaDigest: binding.actionContract?.inputSchema.digest,
      },
    })
    expect(invocations).toBe(0)
    expect(journal.events.find((event) => event.type === "function.called")?.details?.rpcContract)
      .toMatchObject({
        mode: "compiler-derived",
        contractDigest: binding.actionContract?.contractDigest,
        inputSchemaDigest: binding.actionContract?.inputSchema.digest,
        outputSchemaDigest: binding.actionContract?.successSchema.digest,
        errorSchemaDigest: binding.actionContract?.errorSchema.digest,
      })
    expect(journal.events.find((event) => event.type === "function.completed")).toMatchObject({
      ok: false,
      details: { rpcContract: { mode: "compiler-derived" } },
    })
  })

  test("invalid structural output becomes a call failure and cannot escape to generated code", async () => {
    let invocations = 0
    const binding = defineActionFunction<
      { readonly kind: "count"; readonly amount: number },
      { readonly kind: "total"; readonly value: string }
    >(
      contract(),
      async ({ amount }) => {
        invocations += 1
        return { kind: "total", value: String(amount) }
      },
    )
    const execution = await new DenoSubprocessSandbox().execute(
      `export default async functions => {
        const value = await functions.operation({ kind: "count", amount: 4 })
        return { escaped: value }
      }`,
      { operation: binding },
      { sourceDigest: "bad-output", turnId: "turn_bad_output" },
    )

    expect(invocations).toBe(1)
    expect(execution.ok).toBe(false)
    expect(execution.result).toBeUndefined()
    expect(execution.error).toMatchObject({
      name: "AgentRpcContractError",
      fields: {
        phase: "output",
        schemaDigest: binding.actionContract?.successSchema.digest,
      },
    })
  })

  test("schema validation preserves cancellation of active host work", async () => {
    const controller = new AbortController()
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    let hostAborted = false
    const binding = defineActionFunction(
      contract(),
      (
        _input: { readonly kind: "count"; readonly amount: number },
        context,
      ) => new Promise<never>((_resolve, reject) => {
        markStarted()
        context.signal.addEventListener("abort", () => {
          hostAborted = true
          reject(context.signal.reason)
        }, { once: true })
      }),
    )
    const pending = new DenoSubprocessSandbox().execute(
      `export default async functions => functions.operation({ kind: "count", amount: 1 })`,
      { operation: binding },
      {
        sourceDigest: "checked-cancel",
        turnId: "turn_checked_cancel",
        signal: controller.signal,
      },
    )
    await started
    controller.abort(new Error("stop checked call"))

    const execution = await pending
    expect(execution).toMatchObject({
      ok: false,
      error: { name: "SandboxCancelled", message: "stop checked call" },
    })
    expect(hostAborted).toBe(true)
  })
})
