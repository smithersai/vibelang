import { expect, test } from "bun:test"
import { decodeNativeKeyedSource, NATIVE_API_VERSION, type NativeKeyedSourceRequest } from "./protocol.ts"

const revision = "a".repeat(40)
const request: NativeKeyedSourceRequest = {source: "export const flow = 1", fileName: "flow.vibe", flowId: "flow", flowVersion: 1,
  planId: "plan", inputJson: "1", providersJson: "[]"}
const key = `key1_${"0".repeat(64)}`
const plan = {planId: "plan", flow: "flow", generation: 0, baseDigest: key, digest: key, nodes: []}
const success = {ok: true, planJson: JSON.stringify(plan), diagnostics: []}
const issue = {code: "VIBE4199", category: "error", message: "refused", file: "flow.vibe", phase: "lower", span: {start: 0, length: 1}} as const
const failure = {ok: false, planJson: "", diagnostics: [issue]}
const decode = (result: unknown, envelope = {}) => decodeNativeKeyedSource(JSON.stringify({apiVersion: NATIVE_API_VERSION,
  compilerRevision: revision, result, ...envelope}), revision, request)

test("checked keyed source transport distinguishes declarations from approval", () => {
  expect(decode(success).ok).toBe(true)
  expect(decode(failure).diagnostics).toEqual([issue])
})
for (const [name, patch] of [
  ["non-boolean", {ok: "true"}], ["failure with artifacts", {ok: false}], ["empty plan", {planJson: ""}],
  ["null plan", {planJson: null}], ["malformed JSON", {planJson: "{"}], ["invalid artifact", {planJson: "[]"}],
  ["missing diagnostics", {diagnostics: undefined}], ["null diagnostics", {diagnostics: null}],
  ["success with error", {diagnostics: [issue]}], ["approved", {approved: true}],
  ["wrong Plan", {planJson: JSON.stringify({...plan, planId: "other"})}],
  ["wrong Flow", {planJson: JSON.stringify({...plan, flow: "other"})}],
] as const) test(`keyed source protocol refuses ${name}`, () => expect(() => decode({...success, ...patch})).toThrow())

for (const [name, patch] of [
  ["empty code", {code: ""}], ["empty message", {message: ""}], ["wrong file", {file: "other.vibe"}],
  ["warning-only", {category: "warning"}], ["unknown phase", {phase: "execute"}], ["absent span", {span: undefined}],
  ["past source", {span: {start: request.source.length+1, length: 1}}], ["empty span", {span: {start: 0, length: 0}}],
  ["overlong span", {span: {start: 0, length: request.source.length+1}}],
] as const) test(`keyed source protocol refuses diagnostic ${name}`, () => expect(() => decode({...failure, diagnostics: [{...issue, ...patch}]})).toThrow())

test("keyed source protocol refuses stale native identity and unauditable failure", () => {
  expect(() => decode(success, {apiVersion: NATIVE_API_VERSION-1})).toThrow()
  expect(() => decode(success, {compilerRevision: "other"})).toThrow()
  expect(() => decode({...failure, diagnostics: []})).toThrow()
  expect(() => decode({...failure, planJson: success.planJson})).toThrow()
})
