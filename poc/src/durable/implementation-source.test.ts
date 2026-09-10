import { expect, test } from "bun:test"
import { compileActionContract } from "./schema.ts"
import {
  compileActionImplementationContract,
  compileActionImplementationSourceContract,
  requireCompilerAuthenticatedImplementation,
  requireCompilerCheckedValueBoundary,
  retainedCheckedImplementationProject,
} from "./implementation-contract.ts"
import { buildWorkerPoolBundle, bundleInvocationDriver, validateWorkerPoolBundle } from "./pool-bundle.ts"
import { DenoSubprocessSandbox } from "../agent/sandbox.ts"

const action = () => {
  const result = compileActionContract(`
import { Action } from "vibelang:flows";
export abstract class Work extends Action<(input: { z: number; a: number }) => Result<{ value: number }, never>> {}
`, { fileName: "work.vibe", exportName: "Work", id: "source/Work", version: 1 })
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result.descriptor
}
const source = `export function work(input: { z: number; a: number }): { value: number } {
  return { value: input.z + input.a };
}`
const options = () => ({ action: action(), implementationId: "source/provider", implementationVersion: "1",
  entryFile: "work.vibe", exportName: "work", sources: [{ fileName: "work.vibe", source }] })

test("source-only compilation checks values and retains exact sources without a callback", () => {
  const input = options()
  // Even a host-supplied callback getter is irrelevant to this source-only API.
  Object.defineProperty(input, "implementation", { get() { throw new Error("must not inspect callbacks") } })
  const contract = compileActionImplementationSourceContract(input)
  expect(requireCompilerCheckedValueBoundary(contract)).toBe(contract)
  expect(retainedCheckedImplementationProject(contract).sources).toEqual(input.sources)
  expect(Object.isFrozen(contract)).toBe(true)
  expect(() => requireCompilerAuthenticatedImplementation(contract, () => 0)).toThrow("exact runtime callback")
  for (const copy of [{ ...contract }, JSON.parse(JSON.stringify(contract)), Object.create(contract), new Proxy(contract, {})]) {
    expect(() => requireCompilerCheckedValueBoundary(copy)).toThrow()
    expect(() => retainedCheckedImplementationProject(copy)).toThrow()
  }
  input.sources[0].source = "invalid changed input"
  expect(retainedCheckedImplementationProject(contract).sources[0].source).toBe(source)
})

test("legacy callback row checking is not a durable value proof", () => {
  const input = options(), callback = () => 0
  const contract = compileActionImplementationContract({ ...input, implementation: callback })
  expect(() => requireCompilerAuthenticatedImplementation(contract, callback)).not.toThrow()
  expect(() => requireCompilerCheckedValueBoundary(contract)).toThrow("value-boundary")
})

for (const [name, replacement, message] of [
  ["wrong input", "export function work(n: number): { value: number } { return { value: n }; }", "input schema"],
  ["wrong success", "export function work(input: { z: number; a: number }): number { return input.z; }", "success schema"],
  ["unchecked input", "export function work(input: any): { value: number } { return { value: 1 }; }", "structurally encodable"],
  ["unchecked success", "export function work(input: { z: number; a: number }): any { return 1; }", "structurally encodable"],
  ["multiple parameters", "export function work(n: number, m: number) { return n + m; }", "one required input"],
  ["missing closure", "import { helper } from './missing'; export function work(n: number) { return helper(n); }", "missing relative import"],
  ["type error", "export function work(input: { z: number; a: number }): { value: number } { return { value: 'bad' }; }", "checked lowering"],
] as const) test(`source-only provider refuses ${name} before retaining a proof`, () => {
  const input = options()
  input.sources[0].source = replacement
  expect(() => compileActionImplementationSourceContract(input)).toThrow(message)
})

test("a source-only checked project emits executable bytes and preserves module initialization", async () => {
  const input = options()
  input.sources[0].source = `const state = { value: 1 }; state.value = 2;
export function work(input: { z: number; a: number }): { value: number } {
  return { value: state.value + input.z + input.a };
}`
  const contract = compileActionImplementationSourceContract(input)
  const build = () => buildWorkerPoolBundle({ poolId: "source-only", target: "typescript-deno", sandbox: "deno-subprocess/no-permissions",
    selections: [{ action: input.action, contract }] })
  const bundle = build()
  expect(build()).toEqual(bundle)
  expect(validateWorkerPoolBundle(bundle)).toEqual(bundle)
  // Real zero-permission subprocess execution of a local test artifact; this
  // is not an approved deployment, scheduler admission or durable commit.
  const invocation = { actionId: input.action.id, actionVersion: input.action.version,
    actionContractDigest: input.action.contractDigest, input: { z: 30, a: 10 } }
  const sandbox = new DenoSubprocessSandbox({ timeoutMs: 3_000 })
  const execution = await sandbox.execute(bundle.javascript + bundleInvocationDriver(JSON.stringify(invocation)), {},
    { sourceDigest: bundle.digest, turnId: "source-only-test" })
  expect(execution.error).toBeUndefined()
  expect(execution.ok).toBe(true)
  expect(execution.result).toEqual({ kind: "success", value: { value: 42 } })
  expect(() => validateWorkerPoolBundle({ ...bundle, javascript: bundle.javascript + "\n// changed" })).toThrow("digest")
})
