import { expect, test } from "bun:test"
import { compileDurableBody as compileNativeDurableBody } from "./body-compiler.ts"
import { loadDurableBody, validateDurableBodyArtifact } from "./body-artifact.ts"
import { DurableStore } from "./store.ts"
import { ReplayDriver } from "./replay.ts"
import { digest } from "./value.ts"
import { __vsInspectResult } from "../runtime/result.ts"
import { getNativeCompiler } from "../compiler/native.ts"

function compile(source: string, name: string) {
  const result = compileNativeDurableBody(source, { fileName: `native-body-${name}.vibe` })
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  validateDurableBodyArtifact(result.body)
  return result
}

for (const [name, initialization, expression] of [
  ["pure", "", "input + 1"],
  ["capture", "const state = { value: 1 }; state.value = 2", "state.value"],
  ["alias", 'const table = new Map<string, number>(); const alias = table; alias.set("a", 1)', '(table.get("a") ?? 0) + input'],
  ["initializer", 'const table = new Map<string, number>(); function fill() { table.set("a", 1) }; fill()', '(table.get("a") ?? 0) + input'],
] as const) {
  test(`native body preserves ${name}`, async () => {
    const compiled = compile(`import { durable } from "vibelang:flows"\n${initialization}\nexport const Flow = durable((input: number) => ${expression})`, name)
    for (let attempt = 0; attempt < 2; attempt++) expect(await loadDurableBody(compiled.body).create(1).computation.next()).toEqual({ done: true, value: 2 })
  })
}

for (const async of [false, true]) {
  test(`native ${async ? "async" : "sync"} body delegates recursive helpers and replays without repeating requests`, async () => {
    const compiled = compile(`import { durable, Action } from "vibelang:flows"
class Read extends Action<(n: number) => Result<number, never>> {}
${async ? "async " : ""}function recurse(n: number): ${async ? "Promise<Result<number, never>>" : "Result<number, never>"} {
  if (n <= 0) return 2
  return Read.run(n)! + ${async ? "(await recurse(n - 1))!" : "recurse(n - 1)!"}
}
export const Flow = durable(${async ? "async " : ""}(input: number): ${async ? "Promise<Result<number, never>>" : "Result<number, never>"} => {
  const alias = recurse
  let sum = 0
  for (let n = 0; n < input; n++) sum += ${async ? "(await alias(n))!" : "alias(n)!"}
  return sum
})`, async ? "async-recursion" : "recursion")
    const store = new DurableStore()
    let calls = 0
    try {
      store.initializeBodyExecution("native", compiled.body, digest({ input: 3 }), 3)
      for (let count = 0; count < 2; count++) {
        const attempt = loadDurableBody(compiled.body).create(3)
        const result = await new ReplayDriver({ mode: "on", store, executionId: "native", owner: "test",
          dispatchRequest: attempt.dispatchRequest, validateRequest: attempt.validateRequest, decodeAnswer: attempt.decodeAnswer,
          perform: request => { calls++; if (typeof request.input !== "number") throw new TypeError("expected a numeric request"); return { kind: "success", value: request.input } },
        }).run(() => attempt.computation)
        expect(__vsInspectResult(result as never)).toEqual({ ok: true, value: 10 })
      }
      expect(calls).toBe(3)
    } finally { store.close() }
  })
}

test("native body keeps a provided capability across durable suspension", async () => {
  const compiled = compile(`import { durable, Action } from "vibelang:flows"
import { Context } from "vibelang/context"
import { Layer } from "vibelang/provider"
abstract class Bias extends Context { abstract value: number }
class Read extends Action<(n: number) => Result<number, never>> {}
export const Flow = durable((input: number) => Layer.provide(Layer.succeed(Bias, { value: 2 }), (): Result<number, never> => {
  const before = Bias.context().value
  const answer = Read.run(input)!
  return before + answer + Bias.context().value
}))`, "provided")
  const store = new DurableStore()
  try {
    store.initializeBodyExecution("provided", compiled.body, digest({ input: 3 }), 3)
    const attempt = loadDurableBody(compiled.body).create(3)
    const result = await new ReplayDriver({ mode: "on", store, executionId: "provided", owner: "test",
      dispatchRequest: attempt.dispatchRequest, validateRequest: attempt.validateRequest, decodeAnswer: attempt.decodeAnswer,
      perform: request => { if (typeof request.input !== "number") throw new TypeError("expected a numeric request"); return { kind: "success", value: request.input } },
    }).run(() => attempt.computation)
    expect(__vsInspectResult(result as never)).toEqual({ ok: true, value: 7 })
  } finally { store.close() }
})

test("native body refuses nested declarations and undriven callback consumers", () => {
  for (const [source, code] of [
    ['export function make() { const Flow = durable((input: number) => input); return Flow }', "VIBE4103"],
    ['class Read extends Action<(n: number) => Result<number, never>> {}\nexport const Flow = durable((input: number) => [input].map(n => Read.run(n)!).length)', "VIBE1301"],
    ['class Read extends Action<(n: number) => Result<number, never>> {}\nexport const Flow = durable((input: number) => { [input].forEach(n => { const result = Read.run(n); result.match({ok:()=>{}, error:(_e:never)=>{}}) }); return input })', "VIBE1802"],
    ['class Read extends Action<(n: number) => Result<number, never>> {}\nexport const Flow = durable((input: number) => Read.run(input)!)', "VIBE1202"],
    ['class Work extends Action<(input: { value: number; items: number[] }) => Result<number, never>> {}\nexport const Flow = durable((input: { value: number; items: number[] }) => Work.run(input)!)', "VIBE1202"],
  ]) {
    const result = compileNativeDurableBody(`import {durable, Action} from "vibelang:flows"\n${source}`, { fileName: "native-body-refusals.vibe" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.diagnostics.map(issue => issue.code)).toContain(code!)
  }
})

test("source refusals survive Manifest derivation and compiler-import erasure", () => {
  for (const [source, code] of [
    ['import { durable } from "vibelang:flows"; const durable = (value: unknown) => value; export const Flow = durable((n: number) => n)', "VIBE4100"],
    ['import type * as Flows from "vibelang:flows"; export const Flow = Flows.durable((n: number) => n)', "VIBE4102"],
    ['import type { durable } from "vibelang:flows"; export const Flow = durable((n: number) => n)', "VIBE4102"],
    ['import { durable } from "vibelang:flows"; function waitSignal<T>(name: string): T { throw new Error(name) }; export const Flow = durable((n: number) => waitSignal<string>("spoof"))', "VIBE1101"],
    ['import { durable } from "vibelang:flows"; class Action<T> { static run(n: number): number { throw new Error("spoof") } }; export const Flow = durable((n: number) => Action.run(n))', "VIBE1101"],
  ]) {
    const result = compileNativeDurableBody(source!, { fileName: "native-body-authority.vibe" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.diagnostics.map(issue => issue.code)).toContain(code!)
  }
})

test("an unsupported driver is distinct from an underivable authored output", () => {
  const result = compileNativeDurableBody('import { durable, fanOut } from "vibelang:flows"; export const Flow = durable((input: number[]) => fanOut(input, item => item, item => item))', { fileName: "native-body-unsupported.vibe" })
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.unsupported).toBe(true)
    expect(result.invalidBoundary).toBeUndefined()
  }
})

test("the public durable-body compiler loads, checks and executes with compiler-library imports prohibited", () => {
  const compilerURL = new URL("./body-compiler.ts", import.meta.url).href
  const artifactURL = new URL("./body-artifact.ts", import.meta.url).href
  const resultURL = new URL("../runtime/result.ts", import.meta.url).href
  const source = 'import {durable,Action} from "vibelang:flows"; class Read extends Action<(n:number)=>Result<number,never>>{}; const state={value:1}; state.value=2; export const Flow=durable((n:number):Result<number,never>=>state.value+Read.run(n)!)'
  const child = Bun.spawnSync([process.execPath, "--eval", `
    import {plugin} from "bun";
    plugin({name:"native-body-only",setup(build){
      build.onResolve({filter:/^typescript(?:-js)?(?:\\/|$)/},()=>{throw new Error("retired compiler dependency")});
    }});
    const {compileDurableBody}=await import(${JSON.stringify(compilerURL)});
    const {loadDurableBody}=await import(${JSON.stringify(artifactURL)});
    const {__vsResultSuccess,__vsInspectResult}=await import(${JSON.stringify(resultURL)});
    const compiled=compileDurableBody(${JSON.stringify(source)},{fileName:"native-only-body.vibe"});
    if(!compiled.ok)throw new Error(JSON.stringify(compiled));
    const attempt=loadDurableBody(compiled.body).create(3);
    const first=await attempt.computation.next();
    if(first.done||first.value.kind!=="perform"||first.value.input!==3)throw new Error("durable request was lost");
    const last=await attempt.computation.next(__vsResultSuccess(3));
    const value=__vsInspectResult(last.value);
    if(!last.done||!value.ok||value.value!==5)throw new Error("durable completion changed");
    console.log("native-only body");
  `], { env: { ...process.env, VIBELANG_NATIVE_COMPILER: getNativeCompiler().executable }, stdout: "pipe", stderr: "pipe" })
  expect(child.stderr.toString()).toBe("")
  expect(child.exitCode).toBe(0)
  expect(child.stdout.toString()).toBe("native-only body\n")
})
