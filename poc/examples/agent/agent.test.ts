import { describe, expect, test } from "bun:test"
import {
  DenoSubprocessSandbox,
  InMemoryTypeScriptCompiler,
  declareCallableSurface,
  defineFunction,
} from "../../src/agent/index.ts"
import { runAgentDemo } from "./demo.ts"

describe("CodingAgent POC", () => {
  test("repairs, type-checks, confines, RPC-calls, and journals a turn", async () => {
    const { result, model, journal } = await runAgentDemo()
    expect(result.echoed).toBe("AGENT LOOP WORKS")
    expect(model.requests).toHaveLength(2)
    expect(model.requests[0].messages[0]?.role).toBe("system")
    expect(model.requests[0].messages[1]?.content).toContain("effect-lang")
    expect(journal.events.some((event) => event.type === "sandbox.completed")).toBe(true)
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

  test("rejects fire-and-forget RPC and aborts cooperative host work", async () => {
    const sandbox = new DenoSubprocessSandbox({ timeoutMs: 2_000 })
    let contextSeen:
      | { turnId: string; sourceDigest: string; callId: number; functionName: string }
      | undefined
    let aborted = false
    let completed = false
    const slow = defineFunction<{}, { ok: true }>(
      "(input: {}) => Promise<{ ok: true }>",
      (_input, context) => new Promise((resolve, reject) => {
        contextSeen = {
          turnId: context.turnId,
          sourceDigest: context.sourceDigest,
          callId: context.callId,
          functionName: context.functionName,
        }
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
    )

    const execution = await sandbox.execute(
      "export default functions => { void functions.slow({}); return { done: true } }",
      { slow },
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

  test("aborts timeout calls and ignores late results after the channel closes", async () => {
    const sandbox = new DenoSubprocessSandbox({ timeoutMs: 25 })
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
        }, 75)
      }),
    )

    const execution = await sandbox.execute(
      "export default async functions => functions.slow({})",
      { slow },
      { sourceDigest: "timeout", turnId: "turn_timeout" },
    )
    expect(execution.ok).toBe(false)
    expect(execution.error?.name).toBe("SandboxTimeout")
    expect(aborted).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(resolvedLate).toBe(true)
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
  })
})
