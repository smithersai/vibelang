import { expect, test } from "bun:test"
import { decodeNativePlanSource, NATIVE_API_VERSION, type NativePlanSourceRequest } from "./protocol.ts"

const revision = "1".repeat(40)
const request: NativePlanSourceRequest = { source: "class Work {}", fileName: "source.vibe", flowId: "test/Flow", flowVersion: 2, mode: "plan" }
const artifact = JSON.stringify({ flowId: request.flowId, flowVersion: request.flowVersion })
const success = () => ({ status: "plan", diagnostics: [] as unknown[], planJson: artifact, manifestJson: artifact, manifestFailure: "",
  derivedActions: [{ name: "Work", id: "source.vibe#Work", start: 0, end: request.source.length }] })
const decode = (result: unknown, input = request) => decodeNativePlanSource(JSON.stringify({
  apiVersion: NATIVE_API_VERSION, compilerRevision: revision, result,
}), revision, input)

test("Plan source protocol distinguishes data artifacts, independent manifests, refusals and representability", () => {
  expect(decode(success()).status).toBe("plan")
  expect(decode({ ...success(), manifestJson: "", manifestFailure: "unknown imported child effects" }).status).toBe("plan")
  expect(decode({ ...success(), status: "manifest", planJson: "" }, { ...request, mode: "manifest" }).status).toBe("manifest")
  expect(decode({ ...success(), status: "unrepresentable", planJson: "", manifestJson: "", derivedActions: [] }).status).toBe("unrepresentable")
  expect(decode({ ...success(), status: "refused", planJson: "", manifestJson: "", derivedActions: [],
    diagnostics: [{ code: "VIBE4100", category: "error", file: request.fileName, message: "expected token", phase: "parse",
      span: { start: request.source.length, length: 1 } }] }).status).toBe("refused")
})

test("Plan source protocol refuses inconsistent completion and partial evidence", () => {
  const cases = [
    { ...success(), status: "other" },
    { ...success(), status: "manifest" },
    { ...success(), status: "refused" },
    { ...success(), status: "unrepresentable" },
    { ...success(), planJson: "" },
    { ...success(), manifestJson: "" },
    { ...success(), manifestFailure: "failed despite a manifest" },
    { ...success(), diagnostics: null },
    { ...success(), derivedActions: null },
    { ...success(), extra: true },
    { ...success(), planJson: "not JSON" },
    { ...success(), planJson: "null" },
    { ...success(), planJson: "[]" },
    { ...success(), planJson: JSON.stringify({ flowId: "other", flowVersion: 2 }) },
    { ...success(), planJson: JSON.stringify({ flowId: "test/Flow", flowVersion: 3 }) },
    { ...success(), planJson: '{"flowId":"test/Flow","flowVersion":2,"n":-0}' },
    { ...success(), planJson: '{"flowId":"test/Flow","flowVersion":2,"s":"\\ud800"}' },
    ...[-1, request.source.length + 1].map(start => ({ ...success(), derivedActions: [{ ...success().derivedActions[0], start }] })),
    { ...success(), derivedActions: [{ ...success().derivedActions[0], end: request.source.length + 1 }] },
    { ...success(), derivedActions: [{ ...success().derivedActions[0], id: "other#Work" }] },
  ]
  for (const value of cases) expect(() => decode(value)).toThrow()
  expect(() => decode({ ...success(), status: "unrepresentable", planJson: "", manifestJson: "", derivedActions: [] }, { ...request, mode: "manifest" })).toThrow()
})

test("Plan source protocol checks every diagnostic against the authored source", () => {
  const issue = { code: "VIBE4100", category: "error", file: request.fileName, message: "invalid source", phase: "bind", span: { start: 0, length: 1 } }
  const refused = { ...success(), status: "refused", planJson: "", manifestJson: "", derivedActions: [] }
  for (const change of [
    { category: "warning" }, { file: "other.vibe" }, { message: "" }, { code: "" }, { phase: "emit" },
    { span: null }, { span: { start: 0, length: 0 } }, { span: { start: request.source.length + 1, length: 1 } },
    { span: { start: 0, length: request.source.length + 1 } },
  ]) expect(() => decode({ ...refused, diagnostics: [{ ...issue, ...change }] })).toThrow()
})
