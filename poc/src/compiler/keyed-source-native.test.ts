import { beforeAll, expect, test } from "bun:test"
import { getNativeCompiler, type NativeCompiler } from "./native.ts"
import type { NativeKeyedSourceRequest } from "./protocol.ts"

let native: NativeCompiler
beforeAll(() => { native = getNativeCompiler() }, 300_000)
const source = `import { Action, durable } from "vibelang:flows";
class Work extends Action<(n:number)=>Result<number,never>> {}
export const Build = durable((n:number)=>{
  const first = Work.run(n)!;
  const second = Work.run(n)!;
  return { second, first };
});`
const provider = {actionId: "flow.vibe#Work", implementationId: "work/v1", implementationDigest: "a".repeat(64), tier: "sealed",
  effects: {boundaryMode: "hard", reads: [], writes: []}, layers: [], capabilities: []}
const request: NativeKeyedSourceRequest = {source, fileName: "flow.vibe", flowId: "example/Build", flowVersion: 1,
  planId: "example/plan", inputJson: "41", providersJson: JSON.stringify([provider])}
const compile = (input: NativeKeyedSourceRequest) => {
  const result = native.compileKeyedPlanSource(input)
  expect(result.diagnostics).toEqual([])
  expect(result.ok).toBe(true)
  const verified = native.keyedPlan({operation: "verify", inputJson: result.planJson})
  expect(verified.ok).toBe(true)
  expect(verified.planJson).toBe(result.planJson)
  return JSON.parse(result.planJson)
}

test("SDK checked-source Plan binds contracts and leaves independent work ready", () => {
  const plan = compile(request)
  expect(plan.nodes.map((node: {id: string}) => node.id)).toEqual(["action/0", "action/1", "result"])
  expect(plan.nodes.map((node: {dependsOn: string[]}) => node.dependsOn)).toEqual([[], [], ["action/1", "action/0"]])
  expect(plan.nodes[0].key).toBe(plan.nodes[1].key)
  expect(plan.nodes[0].material.body.contract.id).toBe(provider.actionId)
  expect(plan.nodes[0].material.body.implementationDigest).toBe(provider.implementationDigest)
  expect(plan.nodes[0].material.inputs).toEqual([{_tag: "Literal", value: 41}])
  expect(plan.nodes[2].material.body.expression.entries.map((entry: {name: string}) => entry.name)).toEqual(["second", "first"])
  expect(plan.nodes[0].material.body.source.sourceDigest).toMatch(/^[a-f0-9]{64}$/)
})

test("data edges and explicit sequential edges remain distinct", () => {
  const linked = compile({...request, source: source.replace("const second = Work.run(n)!", "const second = Work.run(first)!")})
  expect(linked.nodes[1].dependsOn).toEqual(["action/0"])
  expect(linked.nodes[1].material.inputs).toEqual([{_tag: "Ref", from: "action/0", path: []}])
  const ordered = compile({...request, source: `import {Action,durable,sequential} from "vibelang:flows";
class Work extends Action<(n:number)=>Result<number,never>>{};
export const Build=durable((n:number)=>{return sequential(Work.run(n),Work.run(n))})`})
  expect(ordered.nodes[1].material.inputs.some((input: {_tag: string}) => input._tag === "Pending")).toBe(true)
  expect(ordered.nodes[1].dependsOn).toEqual(["action/0"])
})

test("declared filesystem conflicts sequence only the affected work", () => {
  const plan = compile({...request, providersJson: JSON.stringify([{...provider, effects: {...provider.effects, writes: ["shared.txt"]}}])})
  expect(plan.nodes[1].dependsOn).toContain("action/0")
  expect(plan.nodes[0].effects.writes).toEqual(["shared.txt"])
})

test("source and input object construction order survive extraction", () => {
  for (const [source, input, names] of [
    [`return { z:n, a:n }`, "4", ["z", "a"]],
    [`return n`, `{"z":4,"a":5}`, ["z", "a"]],
    [`return n`, `{"a":5,"z":4}`, ["a", "z"]],
  ] as const) {
    const shape = input === "4" ? "number" : "{z:number;a:number}"
    const plan = compile({...request, providersJson: "[]", inputJson: input,
      source: `import {durable} from "vibelang:flows";export const Build=durable((n:${shape})=>{${source}})`})
    expect(plan.nodes[0].material.body.expression.entries.map((entry: {name: string}) => entry.name)).toEqual(names)
  }
})

test("every declared tier is explicit and influences the Plan approval identity", () => {
  const plans = ["sealed", "compensable", "irreversible"].map(tier => compile({...request, providersJson: JSON.stringify([{...provider, tier}])}))
  expect(new Set(plans.map(plan => plan.digest)).size).toBe(3)
  expect(plans.map(plan => plan.nodes[0].material.kind)).toEqual(["sealed", "compensable", "irreversible"])
})

for (const [name, patch] of [
  ["missing provider", {providersJson: "[]"}],
  ["wrong input", {inputJson: `"wrong"`}],
  ["negative zero input", {inputJson: "-0"}],
  ["duplicate provider", {providersJson: JSON.stringify([provider, provider])}],
  ["duplicate JSON", {inputJson: `{"a":1,"a":2}`}],
  ["empty effects", {providersJson: JSON.stringify([{...provider, effects: {}}])}],
  ["missing tier", {providersJson: JSON.stringify([{...provider, tier: undefined}])}],
  ["unproved code", {providersJson: JSON.stringify([{...provider, implementationDigest: "version1"}])}],
  ["missing source type", {source: source.replace("input: number", "input: Missing").replace("n:number", "n:Missing")}],
  ["module mutation", {source: `const state={v:1};state.v=2;` + source}],
] as const) test(`checked keyed source refuses ${name} without artifacts`, () => {
  const result = native.compileKeyedPlanSource({...request, ...patch})
  expect(result.ok).toBe(false)
  expect(result.planJson).toBe("")
  expect(result.diagnostics.length).toBeGreaterThan(0)
})

for (const [source, code] of [
  ["export const", "TS1123"],
  ['import {durable} from "vibelang:flows";export const Build=durable((n:number)=>{return n;', "VIBE1000"],
  ["/*", "VIBE1000"],
  ["// 🚀\n/*", "VIBE1000"],
] as const) test(`incomplete keyed source retains its authored EOF diagnostic: ${source}`, () => {
  const result = native.compileKeyedPlanSource({...request, source, providersJson: "[]"})
  expect(result.ok).toBe(false)
  expect(result.planJson).toBe("")
  expect(result.diagnostics).toHaveLength(1)
  expect(result.diagnostics[0]).toMatchObject({code, file: request.fileName, span: {start: source.length, length: 1}})
})
