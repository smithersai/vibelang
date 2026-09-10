import { beforeAll, expect, test } from "bun:test"
import { getNativeCompiler, type NativeCompiler } from "../compiler/native.ts"
import { KeyedSourceInterpreter, KeyedSourceInterpreterError } from "./keyed-interpreter.ts"
import { decodeKeyedValue, encodeKeyedValue, keyedValuePath, KEYED_VALUE_LIMITS } from "./keyed-value.ts"
import { canonicalJson } from "./value.ts"

let native: NativeCompiler, artifact: string, interpreter: KeyedSourceInterpreter
const provider = {actionId: "flow.vibe#Work", implementationId: "work/v1", implementationDigest: "a".repeat(64), tier: "sealed",
  effects: {boundaryMode: "hard", reads: [], writes: []}, layers: [], capabilities: []}
const header = 'import {Action,durable,sequential} from "vibelang:flows";'
const source = header + 'class Work extends Action<(n:number)=>Result<{nested:[{z:number;a:number}]},never>>{};' +
  'export const Flow=durable((n:number)=>{const a=Work.run(n)!;const b=Work.run(2)!;return {whole:a.nested[0],scalar:b.nested[0].z}})'
const compile = (source: string, inputJson = "1", providers: unknown[] = [provider]): string => {
  const result = native.compileKeyedPlanSource({source, inputJson, providersJson: JSON.stringify(providers), fileName: "flow.vibe",
    flowId: "example/Flow", flowVersion: 1, planId: "example/plan"})
  expect(result.diagnostics).toEqual([])
  expect(result.ok).toBe(true)
  return result.planJson
}
beforeAll(() => {
  native = getNativeCompiler()
  artifact = compile(source)
  interpreter = new KeyedSourceInterpreter(artifact)
}, 300_000)

test("native source Plan is interpreted as data, with fresh mutable Action inputs", () => {
  expect(interpreter.source.compilerRevision).toBe(native.identity.revision)
  expect(interpreter.nodes.map(node => node.dependsOn)).toEqual([[], [], ["action/0", "action/1"]])
  expect(Object.isFrozen(interpreter)).toBe(true)
  expect(Object.isFrozen(interpreter.nodes[0])).toBe(true)
  const prepared = interpreter.prepare("action/0", [])
  expect(prepared.operation).toBe("action")
  if (prepared.operation !== "action") throw new Error("expected Action")
  expect(prepared.input).toBe(1)
  expect(prepared.contract.id).toBe(provider.actionId)
  expect(prepared.implementationId).toBe(provider.implementationId)
  expect(prepared.implementationDigest).toBe(provider.implementationDigest)
})

test("stored outputs and projected Ref subtrees retain authored order", () => {
  const first = interpreter.encodeSuccess("action/0", {nested: [{z: 41, a: 2}]})
  const second = interpreter.encodeSuccess("action/1", {nested: [{z: 42, a: 3}]})
  const values = [first, second].map(value => JSON.parse(canonicalJson(value)))
  const plan = JSON.parse(artifact)
  const references = plan.nodes[2].material.inputs.filter((input: any) => input._tag === "Ref").map((input: any) => {
    let value: any = values[input.from === "action/0" ? 0 : 1]
    for (const key of input.path) value = value[key]
    return {from: input.from, path: input.path, value}
  })
  expect(references.map((ref: any) => ref.path)).toEqual([keyedValuePath(["nested", "0"]), keyedValuePath(["nested", "0", "z"])])
  const result = interpreter.prepare("result", references)
  if (result.operation !== "result") throw new Error("expected result")
  expect(JSON.stringify(decodeKeyedValue(result.value))).toBe('{"whole":{"z":41,"a":2},"scalar":42}')
  expect(JSON.stringify(decodeKeyedValue(JSON.parse(canonicalJson(result.value))))).toBe('{"whole":{"z":41,"a":2},"scalar":42}')
})

test("duplicate references are separate scheduler inputs, not deduplicated or confused with Pending", () => {
  const flow = new KeyedSourceInterpreter(compile(header + 'class Work extends Action<(n:number)=>Result<number,never>>{};' +
    'export const Flow=durable((n:number)=>{const a=Work.run(n)!;return {z:a,a}})'))
  const refs = [{from: "action/0", path: [], value: 41}, {from: "action/0", path: [], value: 41}]
  const output = flow.prepare("result", refs)
  if (output.operation !== "result") throw new Error("expected result")
  expect(JSON.stringify(decodeKeyedValue(output.value))).toBe('{"z":41,"a":41}')
  expect(() => flow.prepare("result", [refs[0], {...refs[1], value: 42}])).toThrow(/inconsistent values/)
  expect(() => flow.prepare("result", refs.slice(0, 1))).toThrow(/resolved Ref/)
  expect(() => flow.prepare("result", [...refs, {from: "action/0", path: [], value: null}])).toThrow(/extra data/)
})

test("sequential dependencies supply no input data", () => {
  const flow = new KeyedSourceInterpreter(compile(header + 'class Work extends Action<(n:number)=>Result<number,never>>{};' +
    'export const Flow=durable((n:number)=>{return sequential(Work.run(n),Work.run(2))})'))
  expect(flow.nodes[1].dependsOn).toEqual(["action/0"])
  const action = flow.prepare("action/1", [])
  if (action.operation !== "action") throw new Error("expected Action")
  expect(action.input).toBe(2)
  expect(() => flow.prepare("action/1", [{from: "action/0", path: [], value: 1}])).toThrow(/extra data/)
})

test("literal and input object/array construction use normal objects and own prototype fields", () => {
  for (const [shape, input, body, expected] of [
    ["number", "1", "return {z:n,a:n}", '{"z":1,"a":1}'],
    ["{z:number;a:number}", '{"z":1,"a":2}', "return n", '{"z":1,"a":2}'],
    ["{__proto__:number;constructor:number}", '{"__proto__":1,"constructor":2}', "return n", '{"__proto__":1,"constructor":2}'],
    ["number", "1", 'return {"2":n,"1":n,z:n,a:n}', '{"1":1,"2":1,"z":1,"a":1}'],
    ["number", "1", 'return [n,{z:n,a:n}]', '[1,{"z":1,"a":1}]'],
  ]) {
    const flow = new KeyedSourceInterpreter(compile(header + `export const Flow=durable((n:${shape})=>{${body}})`, input, []))
    const result = flow.prepare("result", [])
    if (result.operation !== "result") throw new Error("expected result")
    expect(JSON.stringify(decodeKeyedValue(result.value))).toBe(expected)
  }
})

test("Action input validation does not replace order with the legacy codec's sorted view", () => {
  const flow = new KeyedSourceInterpreter(compile(header + 'class Work extends Action<(n:{z:number;a:number})=>Result<number,never>>{};' +
    'export const Flow=durable((n:number)=>{return Work.run({z:n,a:n})})'))
  const prepared = flow.prepare("action/0", [])
  if (prepared.operation !== "action") throw new Error("expected Action")
  expect(JSON.stringify(prepared.input)).toBe('{"z":1,"a":1}')
  expect(Object.getPrototypeOf(prepared.input)).toBe(Object.prototype)
  expect(Object.isFrozen(prepared.input)).toBe(false)
  ;(prepared.input as any).z = 9
  expect((flow.prepare("action/0", []) as any).input.z).toBe(1)
})

test("wrong input/success/failure values are refused by native-derived structural contracts", () => {
  expect(() => interpreter.encodeSuccess("action/0", {nested: [{z: "wrong", a: 2}]})).toThrow(/durable number/)
  expect(() => interpreter.encodeSuccess("action/0", {nested: [{z: 1, a: 2}], extra: true})).toThrow(/unexpected field/)
  expect(() => interpreter.encodeFailure("action/0", {})).toThrow(/durable never/)
  expect(() => interpreter.encodeFailure("result", {})).toThrow(/no recoverable failure/)
  const flow = new KeyedSourceInterpreter(compile(header + 'class Work extends Action<(n:number)=>Result<number,never>>{};' +
    'export const Flow=durable((n:number)=>{const a=Work.run(n)!;return Work.run(a)})'))
  expect(() => flow.prepare("action/1", [{from: "action/0", path: [], value: "wrong"}])).toThrow(/durable number/)
})

test("literal-backed Action input must fit the full value codec budget before handoff", () => {
  const flow = new KeyedSourceInterpreter(compile(header + 'class Work extends Action<(n:string)=>Result<number,never>>{};' +
    'export const Flow=durable((n:string)=>{return Work.run(n)})', JSON.stringify("x".repeat(KEYED_VALUE_LIMITS.bytes))))
  expect(() => flow.prepare("action/0", [])).toThrow(/byte budget/)
})

test("nominal failure payloads preserve order through canonical storage", () => {
  const flow = new KeyedSourceInterpreter(compile(header + 'class Failed extends Error { declare readonly z:number; declare readonly a:number };' +
    'class Work extends Action<(n:number)=>Result<number,Failed>>{};export const Flow=durable((n:number)=>{return Work.run(n)})'))
  const request = flow.prepare("action/0", [])
  if (request.operation !== "action" || request.contract.errorSchema.shape !== "structural") throw new Error("expected structural Action")
  const descriptor = request.contract.errorSchema.descriptor as any
  const failure = {version: 1, identity: descriptor.identity, payload: {z: 1, a: 2}}
  const encoded = flow.encodeFailure("action/0", failure)
  expect(JSON.stringify(decodeKeyedValue(JSON.parse(canonicalJson(encoded))))).toBe(JSON.stringify(failure))
  expect(() => flow.encodeFailure("action/0", {...failure, identity: "forged"})).toThrow(/nominal Error/)
})

test("inspection refuses changed Plan digests and unknown ids without running values", () => {
  const changed = JSON.parse(artifact); changed.nodes[0].priority++
  expect(() => new KeyedSourceInterpreter(JSON.stringify(changed))).toThrow(/verification failed/)
  expect(() => interpreter.prepare("absent", [])).toThrow(/unknown keyed source node/)
  let ran = false
  expect(() => interpreter.prepare({toString() {ran = true; return "result"}} as any, [])).toThrow(/must be a string/)
  expect(() => interpreter.prepare("result", new Proxy([], {get() {ran = true; return 0}}))).toThrow()
  expect(() => interpreter.encodeSuccess("action/0", {get nested() {ran = true; return []}})).toThrow()
  expect(ran).toBe(false)
})

for (const [name, mutate] of [
  ["ABI", (plan: any) => {plan.nodes[0].material.body.abi = "vibelang/keyed-source/v1"}],
  ["operation", (plan: any) => {plan.nodes[0].material.body.operation = "invokeJavaScript"}],
  ["body field", (plan: any) => {plan.nodes[0].material.body.javascript = "while(true){}"}],
  ["source mismatch", (plan: any) => {plan.nodes[0].material.body.source.sourceDigest = "b".repeat(64)}],
  ["source project digest", (plan: any) => {plan.nodes[0].material.body.source.projectDigest = "not-a-digest"}],
  ["source project mismatch", (plan: any) => {plan.nodes[0].material.body.source.projectDigest = "a".repeat(64)}],
  ["compiler identity", (plan: any) => {plan.nodes[0].material.body.source.compilerAPI = "39"}],
  ["unsafe file name", (plan: any) => {plan.nodes[0].material.body.source.fileName = "../flow.vibe"}],
  ["inconsistent provider", (plan: any) => {plan.nodes[1].material.body.implementationDigest = "b".repeat(64)}],
  ["code commitment", (plan: any) => {plan.nodes[0].material.body.implementationDigest = "not-code"}],
  ["contract digest", (plan: any) => {plan.nodes[0].material.body.contract.contractDigest = "0".repeat(64)}],
  ["slot bounds", (plan: any) => {plan.nodes[0].material.body.expression.index = 500}],
  ["slot integer", (plan: any) => {plan.nodes[0].material.body.expression.index = 0.1}],
  ["slot negative", (plan: any) => {plan.nodes[0].material.body.expression.index = -1}],
  ["duplicate slot", (plan: any) => {plan.nodes[0].material.body.expression = {kind: "array", items: [{kind: "slot", index: 0}, {kind: "slot", index: 0}]}}],
  ["unused input", (plan: any) => {plan.nodes[0].material.body.expression = {kind: "array", items: []}}],
  ["unknown expression", (plan: any) => {plan.nodes[0].material.body.expression = {kind: "eval", text: "42"}}],
  ["duplicate property", (plan: any) => {plan.nodes[2].material.body.expression.entries[1].name = "whole"}],
  ["Pending as data", (plan: any) => {plan.nodes[2].material.body.expression.entries[0].value.index = 2}],
  ["data after Pending", (plan: any) => {plan.nodes[2].material.inputs.push({_tag: "Literal", value: 1})}],
  ["unordered literal object", (plan: any) => {plan.nodes[0].material.inputs[0].value = {z: 1, a: 2}}],
  ["plain Ref projection", (plan: any) => {plan.nodes[2].material.inputs[0].path = ["nested", "0"]}],
  ["result effects", (plan: any) => {plan.nodes[2].effects.writes = ["unexpected.txt"]}],
  ["result tier", (plan: any) => {plan.nodes[2].material.kind = "irreversible"}],
] as const) test(`even a rekeyed Plan refuses invalid interpreter data: ${name}`, () => {
  const plan = JSON.parse(artifact); mutate(plan)
  const compiled = native.keyedPlan({operation: "compile", inputJson: JSON.stringify(plan)})
  expect(compiled.ok).toBe(true)
  expect(() => new KeyedSourceInterpreter(compiled.planJson)).toThrow()
})

test("resolved references require exact identity, path, order, count and codec", () => {
  const references = [
    {from: "action/0", path: keyedValuePath(["nested", "0"]), value: encodeKeyedValue({z: 1, a: 2})},
    {from: "action/1", path: keyedValuePath(["nested", "0", "z"]), value: 2},
  ]
  for (const refs of [[], references.slice(1), [...references].reverse(),
    [{...references[0], from: "other"}, references[1]],
    [{...references[0], path: ["nested", "0"]}, references[1]],
    [{...references[0], value: {z: 1, a: 2}}, references[1]],
    [{...references[0], extra: true}, references[1]],
  ]) expect(() => interpreter.prepare("result", refs)).toThrow()
})

for (const id of ["action/01", "action/10000", "action/-1", "perform/0",
  `fanout/00/key1_${"a".repeat(64)}/0`, `fanout/10000/key1_${"a".repeat(64)}/0`,
  `fanout/0/key1_${"A".repeat(64)}/0`, `fanout/0/key1_${"a".repeat(63)}/0`,
  `fanout/0/key1_${"a".repeat(64)}/01`, `fanout/0/key1_${"a".repeat(64)}/16`,
  "flow/01/action/0", "flow/10000/action/0", "flow/-1/action/0", "flow/0/result",
  "flow/0/action/01", "flow/0/", "flow/0/".repeat(8)+"action/0",
  `fanout/0/key1_${"a".repeat(64)}/0/result`, `fanout/0/key1_${"a".repeat(64)}/0/`,
  `fanout/0/key1_${"a".repeat(64)}/0/action/01`, `fanout/0/key1_${"a".repeat(64)}/16/action/0`,
  `fanout/0/key1_${"a".repeat(64)}/0/`.repeat(8)+"action/0",
  "flow/0/".repeat(7)+`fanout/0/key1_${"a".repeat(64)}/0/action/0`,
  "action/0\n", `fanout/0/key1_${"a".repeat(64)}\n/0/action/0`,
]) test(`rekeying cannot authorize an invalid source address: ${id}`, () => {
  const plan = JSON.parse(artifact)
  plan.nodes[0].id = id
  for (const node of plan.nodes) for (const input of node.material.inputs) {
    if (input.from === "action/0") input.from = id
  }
  const compiled = native.keyedPlan({operation: "compile", inputJson: JSON.stringify(plan)})
  expect(compiled.ok).toBe(true)
  expect(() => new KeyedSourceInterpreter(compiled.planJson)).toThrow("structural address")
})

test("appended rounds refuse explicitly until their source adapter exists", () => {
  const plan = JSON.parse(artifact)
  const appended = native.keyedPlan({operation: "append", inputJson: JSON.stringify({plan, nodes: [{...plan.nodes[0], id: "later"}]})})
  expect(appended.ok).toBe(true)
  expect(() => new KeyedSourceInterpreter(appended.planJson)).toThrow(/generation-zero/)
})
