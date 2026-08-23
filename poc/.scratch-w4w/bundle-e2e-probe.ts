import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { Action, compileActionContract, compileActionImplementationContract } from "../src/durable/index.ts"
import { buildWorkerPoolBundle } from "../src/durable/pool-bundle.ts"

const ACTION_FILE = "probe-action.sm"
const compiled = compileActionContract(`
import { Action } from "smithers:flows"
class Missing extends Error {
  constructor(readonly code: string) { super(code) }
}
export abstract class Work extends Action<
  (input: { mode: string; value: number }) => Result<{ value: number }, Missing>
> {}
`, { fileName: ACTION_FILE, exportName: "Work", id: "probe/Work", version: 1 })
if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
const Work = Action.fromDescriptor<{ mode: string; value: number }, { value: number }, { code: string }>(compiled.descriptor)

const implementationSource = `
import { Panic, panic } from "smithers:exceptions"
import { double } from "./probe-helper.sm"
class Missing extends Error {
  constructor(readonly code: string) { super(code) }
}
export function work(
  input: { mode: string; value: number }
): Result<{ value: number }, Missing | Panic> {
  if (input.mode === "typed") throw new Missing("missing")
  if (input.mode === "panic") panic("unexpected")
  return { value: double(input.value) }
}
`
const helperSource = `
export function double(value: number): number {
  return value * 2
}
`
function work(input: { mode: string; value: number }) { return { value: input.value * 2 } }
const contract = compileActionImplementationContract({
  action: Work.descriptor,
  implementationId: "probe-work",
  implementationVersion: "1",
  entryFile: ACTION_FILE,
  exportName: "work",
  implementation: work,
  sources: [
    { fileName: ACTION_FILE, source: implementationSource },
    { fileName: "probe-helper.sm", source: helperSource }
  ]
})

const bundle = buildWorkerPoolBundle({
  poolId: "probe-pool",
  target: "typescript-bun",
  sandbox: "remote-http-poc",
  selections: [{ action: Work.descriptor, contract }]
})
const bundle2 = buildWorkerPoolBundle({
  poolId: "probe-pool",
  target: "typescript-bun",
  sandbox: "remote-http-poc",
  selections: [{ action: Work.descriptor, contract }]
})
console.log("digest:", bundle.digest)
console.log("deterministic:", bundle.javascript === bundle2.javascript, bundle.digest === bundle2.digest)
console.log("bytes:", Buffer.byteLength(bundle.javascript, "utf8"))
const dir = mkdtempSync(join(tmpdir(), "smithers-bundle-probe-"))
const file = join(dir, "bundle.mjs")
writeFileSync(file, bundle.javascript)
console.log("wrote:", file)

const loaded = await import(pathToFileURL(file).href)
console.log("meta poolId:", loaded.__smithersPoolBundle.poolId, "actions:", loaded.__smithersPoolBundle.actionIds)
const invoke = loaded.__smithersInvokeAction
const base = {
  actionId: "probe/Work",
  actionVersion: 1,
  actionContractDigest: Work.descriptor.contractDigest
}
console.log("success:", JSON.stringify(await invoke({ ...base, input: { mode: "ok", value: 21 } })))
console.log("typed:", JSON.stringify(await invoke({ ...base, input: { mode: "typed", value: 1 } })))
console.log("panic:", JSON.stringify(await invoke({ ...base, input: { mode: "panic", value: 1 } })))
console.log("unknown action:", JSON.stringify(await invoke({ ...base, actionId: "nope", input: {} })))
console.log("wrong contract:", JSON.stringify(await invoke({ ...base, actionContractDigest: "0".repeat(64), input: {} })))
