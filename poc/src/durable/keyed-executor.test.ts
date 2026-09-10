import { beforeAll, expect, test } from "bun:test"
import { getNativeCompiler } from "../compiler/native.ts"
import { compileActionContract } from "./schema.ts"
import { compileActionImplementationSourceContract } from "./implementation-contract.ts"
import { buildWorkerPoolBundle } from "./pool-bundle.ts"
import { SignedDeployment } from "./signed-deployment.ts"
import { createKeyedWorkerRuntime, buildKeyedSourceDeployment, encodeSignedKeyedSourceDeployment,
  authenticateKeyedSourceDeployment, compileAuthenticatedKeyedInvocation, restoreAuthenticatedKeyedInvocation, requireAuthenticatedKeyedInvocation } from "./keyed-deployment.ts"
import { createAuthenticatedKeyedNodeWorker, decodeKeyedNodeExit, type KeyedNodeWork, type KeyedNodeExit } from "./keyed-executor.ts"
import { encodeKeyedValue, decodeKeyedValue, type KeyedValue } from "./keyed-value.ts"

const keys = SignedDeployment.generateKeyPair()
const trust = [SignedDeployment.verificationKey(keys)]
const boundary = {boundaryMode: "hard", readSet: [], writeSet: []}
const policy = {actionId: "flow.vibe#Work", tier: "sealed" as const,
  effects: {boundaryMode: "hard", reads: [], writes: []}, layers: [], capabilities: []}
const prefix = 'class Failed extends Error {constructor(readonly code:string){super(code)}}\n'

function fixture(kind: "success" | "failure" | "loop" | "nullable", timeoutMs = 3000, body="const value=Work.run(n)!;return value", inputJson?:string) {
  const prelude = kind === "failure" ? prefix : ""
  const input = kind === "success" ? "{z:number;a:number}" : "number"
  const error = kind === "failure" ? "Failed" : "never"
  const output = kind === "nullable" ? "number|null" : input
  const declaration = prelude+`import {Action,durable} from "vibelang:flows";
    export class Work extends Action<(n:${input})=>Result<${output},${error}>>{}
    export const Flow=durable((n:${input})=>{${body}});`
  const actionDeclaration = prelude+`import {Action} from "vibelang:flows";
    export class Work extends Action<(n:${input})=>Result<${output},${error}>>{}`
  const action = compileActionContract(actionDeclaration, {fileName: "flow.vibe", exportName: "Work", id: policy.actionId, version: 1})
  if (!action.ok) throw new Error(JSON.stringify(action.diagnostics))
  const provider = prelude+(kind === "success" ?
    'export function work(n:{z:number;a:number}):{z:number;a:number}{return {z:n.z+1,a:n.a}}' : kind === "failure" ?
    'export function work(n:number):Result<number,Failed>{throw new Failed("denied")}' :
    kind === "nullable" ? 'export function work(n:number):number|null{return n===1?null:n}' :
    'export function work(n:number):number{while(true){}}')
  const contract = compileActionImplementationSourceContract({action: action.descriptor, implementationId: "work/v1", implementationVersion: "1",
    entryFile: "flow.vibe", exportName: "work", sources: [{fileName: "flow.vibe", source: provider}]})
  const bundle = buildWorkerPoolBundle({poolId: "work", target: "typescript-deno", sandbox: "deno-subprocess/no-permissions",
    valueCodec: "vibelang/keyed-source/v2", selections: [{action: action.descriptor, contract}]})
  const runtime = createKeyedWorkerRuntime({timeoutMs})
  const deployment = buildKeyedSourceDeployment({source: {source: declaration, fileName: "flow.vibe", exportName: "Flow", flowId: "test/Flow", flowVersion: 1},
    runtime, bundles: [bundle], providers: [policy]})
  const proof = authenticateKeyedSourceDeployment(encodeSignedKeyedSourceDeployment(deployment, keys), trust, runtime)
  const invocation = compileAuthenticatedKeyedInvocation(proof, {planId: "worker/test", inputJson: inputJson ?? (kind === "success" ? '{"z":41,"a":1}' : "1")})
  const worker = createAuthenticatedKeyedNodeWorker(invocation)
  const interpreter = requireAuthenticatedKeyedInvocation(invocation).interpreter
  const plan = JSON.parse(invocation.planJson)
  const work = (id = "action/0", inputs: KeyedNodeWork["inputs"] = []): KeyedNodeWork => ({
    node: plan.nodes.find((node:any) => node.id === id), attempt: 1, boundary, inputs,
  })
  return {proof, invocation, worker, interpreter, work}
}

let good: ReturnType<typeof fixture>, bad: ReturnType<typeof fixture>, loop: ReturnType<typeof fixture>
beforeAll(() => {good=fixture("success");bad=fixture("failure");loop=fixture("loop",2000)}, 30_000)

test("authenticated node worker executes a checked provider and its result projection", async () => {
  const exit = await good.worker.execute(good.work())
  expect(exit.kind).toBe("success")
  if (exit.kind !== "success") throw new Error(JSON.stringify(exit))
  expect(JSON.stringify(decodeKeyedValue(exit.value))).toBe('{"z":42,"a":1}')
  const result = await good.worker.execute(good.work("result", [{from: "action/0", path: [], value: exit.value}]))
  expect(result).toEqual(exit)
  expect(Object.isFrozen(exit)).toBe(true)
})

test("typed failures remain failure data rather than success or defects", async () => {
  const exit = await bad.worker.execute(bad.work())
  expect(exit.kind).toBe("failure")
  if (exit.kind !== "failure") throw new Error(JSON.stringify(exit))
  expect(decodeKeyedValue(exit.error)).toMatchObject({version:1,identity:"vibelang:flow.vibe@Failed@1",payload:{code:"denied"}})
})

test("runtime timeouts are defects, not typed Action failures", async () => {
  const exit = await loop.worker.execute(loop.work())
  expect(exit.kind).toBe("defect")
  if (exit.kind !== "defect") throw new Error(JSON.stringify(exit))
  expect(exit.defect.name).toBe("SandboxTimeout")
}, 5000)

test("pre-cancellation and in-flight cancellation preserve interruption", async () => {
  const before = new AbortController();before.abort()
  expect(await loop.worker.execute(loop.work(),{signal:before.signal})).toEqual({kind:"interrupted"})
  const during = new AbortController()
  const running = loop.worker.execute(loop.work(),{signal:during.signal})
  const timer = setTimeout(()=>during.abort(),50)
  try {expect(await running).toEqual({kind:"interrupted"})} finally {clearTimeout(timer)}
  expect(await good.worker.execute(good.work())).toMatchObject({kind:"success"})
}, 5000)

test("persisted proof-shaped objects and proxies cannot create a worker",()=>{
  let reads=0
  for(const forged of [{...good.invocation},Object.create(good.invocation),new Proxy(good.invocation,{get(){reads++;throw new Error("read")}})]){
    expect(()=>createAuthenticatedKeyedNodeWorker(forged)).toThrow("not issued")
  }
  expect(reads).toBe(0)
})

for(const [name,change] of [
  ["node id",(r:any)=>{r.node.id="action/99"}],
  ["priority",(r:any)=>{r.node.priority++}],
  ["body",(r:any)=>{r.node.material.body.operation="result"}],
  ["implementation",(r:any)=>{r.node.material.body.implementationDigest="0".repeat(64)}],
  ["effects",(r:any)=>{r.node.material.effects.reads=["secret"]}],
  ["extra node fields",(r:any)=>{r.node.approved=true}],
  ["zero attempt",(r:any)=>{r.attempt=0}],
  ["fractional attempt",(r:any)=>{r.attempt=1.5}],
  ["read authority",(r:any)=>{r.boundary.readSet=[{path:"secret",digest:"0".repeat(64)}]}],
  ["write authority",(r:any)=>{r.boundary.writeSet=["secret"]}],
  ["removal authority",(r:any)=>{r.boundary.removes=["secret"]}],
  ["null removals",(r:any)=>{r.boundary.removes=null}],
  ["soft boundary",(r:any)=>{r.boundary.boundaryMode="expected"}],
  ["boundary fields",(r:any)=>{r.boundary.authorized=true}],
  ["extra input",(r:any)=>{r.inputs=[{from:"action/0",path:[],value:1}]}],
  ["unknown options",(r:any)=>{r.javascript="throw 0"}],
] as const)test(`worker refuses ${name} before execution`,async()=>{
  const work=structuredClone(good.work());change(work)
  await expect(good.worker.execute(work)).rejects.toThrow()
})

test("request getters and proxies are refused without being invoked",async()=>{
  let reads=0
  const work=Object.defineProperty({},"node",{enumerable:true,get(){reads++;return JSON.parse(good.invocation.planJson).nodes[0]}})
  await expect(good.worker.execute(work as KeyedNodeWork)).rejects.toThrow()
  await expect(good.worker.execute(new Proxy(good.work(),{get(){reads++;throw new Error("read")}}))).rejects.toThrow()
  expect(reads).toBe(0)
})

test("execution options cannot invoke accessors or carry unknown authority",async()=>{
  let reads=0
  for(const options of [{signal:"not a signal"},{functions:{}},Object.defineProperty({},"signal",{get(){reads++;return undefined}}),
    {signal:new Proxy(new AbortController().signal,{getPrototypeOf(){reads++;throw new Error("read")}})},
    new Proxy({},{ownKeys(){reads++;throw new Error("read")}})]) {
    await expect(good.worker.execute(good.work(),options as any)).rejects.toThrow()
  }
  expect(reads).toBe(0)
})

test("post-call request mutation cannot substitute the provider input",async()=>{
  const work=structuredClone(good.work()) as any
  const pending=good.worker.execute(work)
  work.node.material.body.implementationDigest="0".repeat(64);work.attempt=0
  expect(await pending).toMatchObject({kind:"success"})
})

for(const [name,raw] of [
  ["unknown exit",{kind:"other"}],
  ["forged interruption",{kind:"interrupted"}],
  ["extra success field",{kind:"success",value:1,approved:true}],
  ["wrong success type",{kind:"success",value:1}],
  ["malformed value codec",{kind:"success",value:{kind:"object",items:{z:1,a:2},order:["z"]}}],
  ["wrong failure channel",{kind:"failure",error:encodeKeyedValue({message:"not declared"})}],
  ["wrong defect fields",{kind:"defect",defect:{name:"bad",message:4}}],
  ["extra defect fields",{kind:"defect",defect:{name:"bad",message:"bad",cause:null}}],
] as const)test(`worker protocol refuses ${name}`,()=>{
  expect(decodeKeyedNodeExit(good.interpreter,"action/0",raw)).toMatchObject({kind:"defect",defect:{name:"KeyedWorkerProtocolDefect"}})
})

test("valid defect name, message and stack survive protocol decoding",()=>{
  const value={kind:"defect",defect:{name:"Broken",message:"broken",stack:"exact stack"}} as const
  expect(decodeKeyedNodeExit(good.interpreter,"action/0",value)).toEqual(value)
})

test("authenticated worker executes Go-derived computations before and after a real provider",async()=>{
  const computed=fixture("success",3000,"const value=Work.run({z:n.z+1,a:n.a})!;return {z:value.z*2,a:value.a}")
  const action=await computed.worker.execute(computed.work())
  expect(action.kind).toBe("success")
  if(action.kind!=="success")throw new Error(JSON.stringify(action))
  expect(decodeKeyedValue(action.value)).toEqual({z:43,a:1})
  const refs=[{from:"action/0",path:["items","z"],value:43},{from:"action/0",path:["items","a"],value:1}]
  const result=await computed.worker.execute(computed.work("result",refs))
  expect(result.kind).toBe("success")
  if(result.kind!=="success")throw new Error(JSON.stringify(result))
  expect(JSON.stringify(decodeKeyedValue(result.value))).toBe('{"z":86,"a":1}')
  await expect(computed.worker.execute(computed.work("result",[{...refs[0],value:"wrong"},refs[1]]))).rejects.toThrow(/durable number/)
  const changed=JSON.parse(computed.invocation.planJson)
  changed.nodes[0].material.body.expression.entries[0].value.operator="subtract"
  const rebuilt=getNativeCompiler().keyedPlan({operation:"compile",inputJson:JSON.stringify(changed)})
  expect(rebuilt.ok).toBe(true)
  expect(JSON.parse(rebuilt.planJson).digest).not.toBe(computed.invocation.planDigest)
  // A valid generic graph hash is not evidence of what signed source means.
  expect(()=>restoreAuthenticatedKeyedInvocation(computed.proof,{planId:computed.invocation.planId,
    inputJson:computed.invocation.inputJson,planJson:rebuilt.planJson})).toThrow()
  await expect(computed.worker.execute({...computed.work(),node:JSON.parse(rebuilt.planJson).nodes[0]})).rejects.toThrow(/authenticated invocation/)
},10_000)

test("a computed Action-input defect does not dispatch the looping provider",async()=>{
  const computed=fixture("loop",1000,"return Work.run(n/(n-n))")
  const result=await computed.worker.execute(computed.work())
  expect(result).toMatchObject({kind:"defect",defect:{name:"KeyedSourceEvaluationError"}})
  if(result.kind!=="defect")throw new Error(JSON.stringify(result))
  expect(result.defect.message).toMatch(/finite number other than negative zero/)
  const abort=new AbortController();abort.abort()
  expect(await computed.worker.execute(computed.work(),{signal:abort.signal})).toEqual({kind:"interrupted"})
},10_000)

test("a computed Flow-output defect is a node outcome after a real successful Action",async()=>{
  const computed=fixture("success",3000,"const value=Work.run(n)!;return value.z/(value.a-1)")
  const action=await computed.worker.execute(computed.work())
  expect(action.kind).toBe("success")
  if(action.kind!=="success")throw new Error(JSON.stringify(action))
  expect(decodeKeyedValue(action.value)).toEqual({z:42,a:1})
  const result=await computed.worker.execute(computed.work("result",[
    {from:"action/0",path:["items","z"],value:42},{from:"action/0",path:["items","a"],value:1},
  ]))
  expect(result).toMatchObject({kind:"defect",defect:{name:"KeyedSourceEvaluationError"}})
},10_000)

test("authenticated control opens independent Go-derived work and joins real provider outcomes",async()=>{
  const parallel=fixture("success",3000,"const first=Work.run(n)!;const second=Work.run(n)!;return {first,second}")
  const control=parallel.worker.createControl(),fresh=parallel.worker.createControl()
  const tickets=control.claim(2)
  expect(tickets.map(ticket=>ticket.nodeId)).toEqual(["action/0","action/1"])
  expect(control.claim(2)).toEqual([])
  const outcomes=await Promise.all(tickets.map(ticket=>parallel.worker.execute(parallel.work(ticket.nodeId))))
  expect(outcomes.every(exit=>exit.kind==="success")).toBe(true)
  // Only an owning host's real commit/adoption may perform this acknowledgement
  // in production. This test proves demand + authenticated provider execution,
  // not a durable receipt, SQL transaction or crash-recovery host.
  control.complete(tickets[1],outcomes[1]);expect(control.claim(2)).toEqual([])
  control.complete(tickets[0],outcomes[0]);const [join]=control.claim(2)
  expect(join.nodeId).toBe("result")
  const inputs=outcomes.map((exit,index)=>{
    if(exit.kind!=="success")throw new Error(JSON.stringify(exit))
    return {from:tickets[index].nodeId,path:[],value:exit.value}
  })
  const result=await parallel.worker.execute(parallel.work("result",inputs))
  control.complete(join,result)
  expect(result.kind).toBe("success")
  if(result.kind!=="success")throw new Error(JSON.stringify(result))
  expect(JSON.stringify(decodeKeyedValue(result.value))).toBe('{"first":{"z":42,"a":1},"second":{"z":42,"a":1}}')
  expect(control.inspect().nodes.every(node=>node.status==="success")).toBe(true)
  // Each interpretation owns its own reservations; no accidental shared cache.
  expect(fresh.inspect().terminal).toBe(false)
  expect(fresh.claim(2).map(ticket=>ticket.nodeId)).toEqual(["action/0","action/1"])
},10_000)

test("authenticated control preserves a real typed failure and blocks its result projection",async()=>{
  const control=bad.worker.createControl(),[ticket]=control.claim(2)
  const exit=await bad.worker.execute(bad.work(ticket.nodeId))
  expect(exit.kind).toBe("failure")
  control.complete(ticket,exit)
  expect(control.claim(2)).toEqual([])
  expect(control.inspect().nodes).toEqual([
    {id:"action/0",status:"failure"},{id:"result",status:"blocked",blockedBy:"action/0"},
  ])
})

test("authenticated control cancellation closes a real worker's completion reservation",async()=>{
  const control=loop.worker.createControl(),[ticket]=control.claim(),abort=new AbortController()
  const pending=loop.worker.execute(loop.work(ticket.nodeId),{signal:abort.signal})
  control.cancel()
  expect(control.inspect().cancel).toEqual([ticket.nodeId])
  abort.abort()
  const exit=await pending
  expect(exit).toEqual({kind:"interrupted"})
  expect(()=>control.complete(ticket,exit)).toThrow(/consumed or cancelled/)
  expect(control.inspect().nodes.every(node=>node.status==="cancelled")).toBe(true)
},5000)

// These tests acknowledge real worker outcomes in local demand state. They do
// not pretend that an acknowledgement is a durable host's commit or approval.
async function driveControlled(f:ReturnType<typeof fixture>) {
  const control=f.worker.createControl(),answers=new Map<string,KeyedValue>()
  const executed:string[]=[],outcomes=new Map<string,KeyedNodeExit>()
  for(let round=0;!control.inspect().terminal;round++) {
    if(round>f.interpreter.nodes.length)throw new Error("controlled execution did not settle")
    const tickets=control.claim(10000)
    expect(tickets.length).toBeGreaterThan(0)
    for(const ticket of tickets) {
      const node=f.work(ticket.nodeId).node as any
      const refs=node.material.inputs.filter((input:any)=>input._tag==="Ref"&&ticket.dependencies.includes(input.from)).map((input:any)=>{
        expect(answers.has(input.from)).toBe(true)
        let value:any=answers.get(input.from)
        for(const key of input.path){expect(Object.hasOwn(value,key)).toBe(true);value=value[key]}
        return {from:input.from,path:input.path,value}
      })
      executed.push(ticket.nodeId)
      const exit=await f.worker.executeControlled(control,ticket,f.work(ticket.nodeId,refs))
      outcomes.set(ticket.nodeId,exit)
      if(exit.kind==="success")answers.set(ticket.nodeId,exit.value)
      control.complete(ticket,exit)
    }
  }
  return {control,executed,outcomes,value:answers.has("result")?decodeKeyedValue(answers.get("result")):undefined}
}

for(const [input,expected] of [["1",0],["2",3]] as const)test(`authenticated nullable success reaches its selected guard on ${input}`,async()=>{
  const f=fixture("nullable",3000,"const value=Work.run(n)!;if(value===null)return 0;return value+1",input)
  // Fresh authentication/re-derivation must produce precisely the same Plan.
  const restored=restoreAuthenticatedKeyedInvocation(f.proof,{planId:f.invocation.planId,inputJson:input,planJson:f.invocation.planJson})
  expect(restored.planJson).toBe(f.invocation.planJson)
  const result=await driveControlled(f)
  expect(result.value).toBe(expected)
  expect(result.outcomes.get("action/0")).toEqual({kind:"success",value:input==="1"?null:2})
  expect(result.control.inspect().nodes.find(node=>node.id==="result")?.status).toBe("success")
},10_000)

for(const [body,expected,dispatches] of [
  ["if(n.a===1)return Work.run(n);return Work.run({z:99,a:n.a})",{z:42,a:1},1],
  ["if(n.a!==1)return Work.run(n);return Work.run({z:99,a:n.a})",{z:100,a:1},1],
  ["if(n.a===1)return n;return Work.run(n)",{z:41,a:1},0],
  ["if(n.a===1){Work.run(n)!}return n",{z:41,a:1},1],
  ["if(n.a!==1){Work.run(n)!}return n",{z:41,a:1},0],
  ["if(n.a===1){const value=Work.run(n)!;if(value.z>0)return value}return n",{z:42,a:1},1],
  ["if(const value=Work.run(n)!;value.z>0){return value}else{return n}",{z:42,a:1},1],
] as const)test(`authenticated statement execution: ${body}`,async()=>{
  const f=fixture("success",3000,body),result=await driveControlled(f)
  expect(result.value).toEqual(expected)
  const actions=f.interpreter.nodes.filter(node=>node.operation==="action").map(node=>node.id)
  expect(result.executed.filter(id=>actions.includes(id))).toHaveLength(dispatches)
  expect(result.control.inspect().nodes.find(node=>node.id==="result")?.status).toBe("success")
},10_000)

test("a failed consumed statement cannot disappear into its pure return",async()=>{
  const f=fixture("failure",3000,"if(n>0){Work.run(n)!}return 0"),result=await driveControlled(f)
  const actions=result.executed.filter(id=>id.includes("/action/"))
  expect(actions).toEqual(["branch/0/then/action/0"])
  expect(result.outcomes.get(actions[0])).toMatchObject({kind:"failure"})
  expect(result.value).toBeUndefined()
  expect(result.control.inspect().nodes.find(node=>node.id==="result")?.status).toBe("blocked")
},10_000)

test("an early return does not open a nonterminating continuation",async()=>{
  const f=fixture("loop",1000,"if(n>0)return n;return Work.run(n)"),result=await driveControlled(f)
  expect(result.value).toBe(1)
  expect(result.executed.some(id=>id.includes("/action/"))).toBe(false)
},10_000)

for(const [predicate,selected,expected] of [["===","then",42],["!==","else",100]] as const)
test(`Go-derived ${selected} branch dispatches only its selected authenticated provider`,async()=>{
  const f=fixture("success",3000,`return n.a${predicate}1?Work.run(n):Work.run({z:99,a:n.a})`)
  expect(f.interpreter.nodes.filter(node=>node.operation==="action")).toHaveLength(2)
  // All nodes, including pure conditions, refuse the eager scheduler sweep.
  for(const node of f.interpreter.nodes)await expect(f.worker.execute(f.work(node.id))).rejects.toThrow(/controlled execution/)
  const result=await driveControlled(f)
  expect(JSON.stringify(result.value)).toBe(`{"z":${expected},"a":1}`)
  expect(result.executed.filter(id=>id.includes("/action/"))).toEqual([`branch/0/${selected}/action/0`])
  const skipped=result.control.inspect().nodes.filter(node=>node.status==="skipped")
  expect(skipped.map(node=>node.id)).toEqual(expect.arrayContaining([
    `branch/0/${selected==="then"?"else":"then"}/result`,
  ]))
  expect(result.control.inspect().nodes.find(node=>node.id==="result")?.status).toBe("success")
},10_000)

test("a real selected provider failure blocks the join without trying the other branch",async()=>{
  const f=fixture("failure",3000,"return n>0?Work.run(n):Work.run(-n)")
  const result=await driveControlled(f)
  const actions=result.executed.filter(id=>id.includes("/action/"))
  expect(actions).toHaveLength(1)
  expect(actions[0]).toContain("/then/")
  expect(result.outcomes.get(actions[0])).toMatchObject({kind:"failure"})
  expect(result.value).toBeUndefined()
  expect(result.control.inspect().nodes.find(node=>node.id==="result")).toMatchObject({status:"blocked"})
  expect(result.control.inspect().nodes.filter(node=>node.id.includes("/else/")).every(node=>node.status==="skipped")).toBe(true)
},10_000)

for(const [body,expected,dispatches] of [
  ["return n.a===1&&Work.run(n)!",{z:42,a:1},1],
  ["return n.a!==1&&Work.run(n)!",false,0],
  ["return n.a===1||Work.run(n)!",true,0],
  ["return n.a!==1||Work.run(n)!",{z:42,a:1},1],
  ["const chosen=n.a===1?n:null;return chosen??Work.run(n)!",{z:41,a:1},0],
  ["const chosen=n.a!==1?n:null;return chosen??Work.run(n)!",{z:42,a:1},1],
  ["return Work.run(n)!.z&&Work.run(n)!",{z:42,a:1},2],
  ["return Work.run(n)!.z||Work.run(n)!",42,1],
] as const)test(`authenticated logical work preserves its operand: ${body}`,async()=>{
  const f=fixture("success",3000,body),result=await driveControlled(f)
  expect(result.value).toEqual(expected)
  const actions=f.interpreter.nodes.filter(node=>node.operation==="action").map(node=>node.id)
  const executed=result.executed.filter(id=>actions.includes(id))
  expect(executed).toHaveLength(dispatches)
  expect(new Set(executed).size).toBe(dispatches)
  expect(result.control.inspect().nodes.find(node=>node.id==="result")?.status).toBe("success")
},10_000)

for(const body of ["return n>0&&Work.run(n)!","return n<0||Work.run(n)!"])
test(`a selected logical provider failure is not coerced into a success: ${body}`,async()=>{
  const f=fixture("failure",3000,body),result=await driveControlled(f)
  const actions=result.executed.filter(id=>id.includes("/action/"))
  expect(actions).toHaveLength(1)
  expect(result.outcomes.get(actions[0])).toMatchObject({kind:"failure"})
  expect(result.value).toBeUndefined()
  expect(result.control.inspect().nodes.find(node=>node.id==="result")?.status).toBe("blocked")
},10_000)

test("cancelling selected logical work invalidates its provider before the completion join",async()=>{
  const f=fixture("loop",1500,"return n>0&&Work.run(n)!"),control=f.worker.createControl()
  const [condition]=control.claim()
  const decided=await f.worker.executeControlled(control,condition,f.work(condition.nodeId))
  expect(decided).toEqual({kind:"success",value:true});control.complete(condition,decided)
  const [selected]=control.claim(),abort=new AbortController()
  expect(selected.nodeId).toBe("branch/0/then/action/0")
  const pending=f.worker.executeControlled(control,selected,f.work(selected.nodeId),{signal:abort.signal})
  control.cancel();abort.abort()
  expect(await pending).toEqual({kind:"interrupted"})
  expect(()=>control.complete(selected,{kind:"success",value:1})).toThrow(/cancelled/)
  expect(control.claim(10000)).toEqual([])
  expect(control.inspect().nodes.find(node=>node.id==="branch/0/else/result")?.status).toBe("skipped")
},10_000)

test("controlled execution rejects substituted owners, tickets and work before dispatch",async()=>{
  const control=good.worker.createControl(),[ticket]=control.claim()
  let reads=0
  const trap={get(){reads++;throw new Error("read")},getPrototypeOf(){reads++;throw new Error("read")}}
  for(const forged of [{...ticket},Object.create(ticket),new Proxy(ticket,trap)]) {
    await expect(good.worker.executeControlled(control,forged,good.work())).rejects.toThrow(/foreign/)
  }
  for(const forged of [{...control},Object.create(control),new Proxy(control,trap),good.interpreter.createControl()]) {
    await expect(good.worker.executeControlled(forged as any,ticket,good.work())).rejects.toThrow(/not issued/)
  }
  await expect(bad.worker.executeControlled(control,ticket,bad.work())).rejects.toThrow(/not issued/)
  await expect(good.worker.executeControlled(control,ticket,good.work("result"))).rejects.toThrow(/does not match/)
  expect(reads).toBe(0)
  const exit=await good.worker.executeControlled(control,ticket,good.work())
  expect(exit.kind).toBe("success")
  control.complete(ticket,exit)
  await expect(good.worker.executeControlled(control,ticket,good.work())).rejects.toThrow(/consumed/)
})

test("one control reservation cannot dispatch concurrent attempts",async()=>{
  const control=good.worker.createControl(),[ticket]=control.claim()
  const running=good.worker.executeControlled(control,ticket,good.work())
  await expect(good.worker.executeControlled(control,ticket,good.work())).rejects.toThrow(/executing attempt/)
  const exit=await running
  expect(exit.kind).toBe("success")
  control.complete(ticket,exit)
})

test("cancelling an authenticated branch invalidates its running provider and never opens the other arm",async()=>{
  const f=fixture("loop",1500,"return n>0?Work.run(n):Work.run(-n)"),control=f.worker.createControl()
  const [condition]=control.claim()
  const decided=await f.worker.executeControlled(control,condition,f.work(condition.nodeId))
  expect(decided).toEqual({kind:"success",value:true});control.complete(condition,decided)
  const [selected]=control.claim()
  expect(selected.nodeId).toContain("/then/action/")
  const abort=new AbortController(),pending=f.worker.executeControlled(control,selected,f.work(selected.nodeId),{signal:abort.signal})
  control.cancel();abort.abort()
  expect(control.inspect().cancel).toEqual([selected.nodeId])
  expect(await pending).toEqual({kind:"interrupted"})
  expect(()=>control.complete(selected,{kind:"success",value:1})).toThrow(/cancelled/)
  expect(control.claim(10000)).toEqual([])
  expect(control.inspect().nodes.filter(node=>node.id.includes("/else/")).every(node=>node.status==="skipped")).toBe(true)
},10_000)

test("a locally invalidated reservation cannot report a late successful provider exit",async()=>{
  const control=good.worker.createControl(),[ticket]=control.claim()
  const pending=good.worker.executeControlled(control,ticket,good.work())
  control.cancel()
  expect(await pending).toEqual({kind:"interrupted"})
})
