import {expect,test} from "bun:test"
import {getNativeCompiler} from "../compiler/native.ts"
import {KeyedSourceInterpreter} from "./keyed-interpreter.ts"
import {decodeKeyedValue,type KeyedValue} from "./keyed-value.ts"

const header='import {Action,durable,fanOut,sequential} from "vibelang:flows";'
const work='class Work extends Action<(n:number)=>Result<number,never>>{};'
const child='const Child=durable((n:number)=>{return Work.run(n)});'
const provider={actionId:"flow.vibe#Work",implementationId:"work/v1",implementationDigest:"a".repeat(64),
  tier:"sealed",effects:{boundaryMode:"hard",reads:[],writes:[]},layers:[],capabilities:[]}
const request=(source:string,inputJson="41")=>({source:header+source,inputJson,fileName:"flow.vibe",
  flowId:"composition/Flow",flowVersion:1,planId:"composition/plan",providersJson:JSON.stringify([provider])})
const compile=(source:string,inputJson="41")=>{
  const got=getNativeCompiler().compileKeyedPlanSource(request(source,inputJson))
  if(!got.ok)throw new Error(JSON.stringify(got.diagnostics))
  return new KeyedSourceInterpreter(got.planJson)
}

// Only interpret graph DATA with supplied test answers. This intentionally is
// not a scheduler, approval mechanism, provider executor, or durability claim.
function interpret(flow:KeyedSourceInterpreter,answer:(value:any)=>unknown=(n)=>n+1){
  const values=new Map<string,KeyedValue>(),waves:string[][]=[],calls:{id:string,input:unknown}[]=[]
  const pending=[...flow.nodes],plan=JSON.parse(flow.planJson)
  while(pending.length){
    const ready=pending.filter(node=>node.dependsOn.every(id=>values.has(id))).reverse()
    if(!ready.length)throw new Error("cyclic test graph")
    waves.push(ready.map(node=>node.id))
    for(const node of ready){
      const refs=plan.nodes.find((item:any)=>item.id===node.id).material.inputs.filter((item:any)=>item._tag==="Ref").map((item:any)=>{
        let value:any=values.get(item.from)
        for(const key of item.path)value=value[key]
        return {from:item.from,path:item.path,value}
      })
      const prepared=flow.prepare(node.id,refs)
      if(prepared.operation==="action"){
        calls.push({id:node.id,input:prepared.input})
        values.set(node.id,flow.encodeSuccess(node.id,answer(prepared.input)))
      }else values.set(node.id,prepared.value)
      pending.splice(pending.indexOf(node),1)
    }
  }
  return {value:decodeKeyedValue(values.get("result")!),waves:waves.map(wave=>wave.length),calls}
}

test("source child data edges use the checked success type",()=>{
  const flow=compile(work+child+'export const Flow=durable((n:number)=>{const first=Child.run(n)!;return Work.run(first)});')
  expect(interpret(flow).value).toBe(43)
  expect(interpret(flow).waves).toEqual([1,1,1])
  expect(flow.nodes.map(node=>node.id)).toEqual(["flow/0/action/0","action/1","result"])
})

test("repeated child calls have distinct addresses and remain independently ready",()=>{
  const flow=compile(work+child+'export const Flow=durable((n:number)=>{const a=Child.run(n)!;const b=Child.run(2)!;return {b,a}});')
  expect(interpret(flow)).toMatchObject({value:{b:3,a:42},waves:[2,1]})
  expect(flow.nodes.map(node=>node.id)).toEqual(["flow/0/action/0","flow/1/action/0","result"])
  expect(JSON.stringify(interpret(flow).value)).toBe('{"b":3,"a":42}')
})

test("identical child invocations keep equal content keys without address collisions",()=>{
  const flow=compile(work+child+'export const Flow=durable((n:number)=>{const a=Child.run(n)!;const b=Child.run(n)!;return {a,b}});')
  const nodes=JSON.parse(flow.planJson).nodes
  expect(nodes[0].id).not.toBe(nodes[1].id)
  expect(nodes[0].key).toBe(nodes[1].key)
  expect(interpret(flow).waves).toEqual([2,1])
})

test("unused child output does not discard child work or sequence an independent sibling",()=>{
  const flow=compile(work+child+'export const Flow=durable((n:number)=>{const ignored=Child.run(n)!;return Work.run(2)});')
  expect(interpret(flow)).toMatchObject({value:3,waves:[2,1]})
  expect(flow.nodes.at(-1)?.dependsOn).toHaveLength(2)
})

test("consuming a child value joins its unused intermediate work",()=>{
  const flow=compile(work+'const Child=durable((n:number)=>{const ignored=Work.run(7)!;return Work.run(n)});'+
    'export const Flow=durable((n:number)=>{const value=Child.run(n)!;return Work.run(value)});')
  expect(interpret(flow)).toMatchObject({value:43,waves:[2,1,1]})
  expect(flow.nodes.find(node=>node.id==="action/1")?.dependsOn).toHaveLength(2)
})

test("nested child calls preserve instance scopes and transitive data edges",()=>{
  const flow=compile(work+child+'const Middle=durable((n:number)=>{const value=Child.run(n)!;return Work.run(value)});'+
    'export const Flow=durable((n:number)=>{const value=Middle.run(n)!;return Child.run(value)!});')
  expect(interpret(flow)).toMatchObject({value:44,waves:[1,1,1,1]})
  expect(flow.nodes[0].id).toBe("flow/0/flow/0/action/0")
})

test("explicit sequential ordering crosses child group boundaries",()=>{
  const flow=compile(work+child+'export const Flow=durable((n:number)=>{return sequential(Child.run(n),Child.run(2))});')
  expect(interpret(flow)).toMatchObject({value:[42,3],waves:[1,1,1]})
  expect(flow.nodes[1].dependsOn).toEqual(["flow/0/action/0"])
})

test("fan-out inside a child composes into the same keyed graph",()=>{
  const flow=compile(work+'const Child=durable((items:readonly number[])=>{return fanOut(items,n=>n,n=>Work.run(n))});'+
    'export const Flow=durable((items:readonly number[])=>{return Child.run(items)!});',"[3,1,2]")
  expect(interpret(flow)).toMatchObject({value:[4,2,3],waves:[3,1]})
  expect(flow.nodes.slice(0,-1).every(node=>node.id.startsWith("flow/0/fanout/0/key1_"))).toBe(true)
})

test("a child returning known array structure can feed static fan-out",()=>{
  const flow=compile(work+'const Child=durable((n:number)=>{return [n,2]});'+
    'export const Flow=durable((n:number)=>{const items:readonly number[]=Child.run(n)!;return fanOut(items,v=>v,v=>Work.run(v))});')
  expect(interpret(flow)).toMatchObject({value:[42,3],waves:[2,1]})
})

test("known child collections retain completion barriers for unused work",()=>{
  const flow=compile(work+'const Child=durable((n:number)=>{const ignored=Work.run(7)!;return [n,2]});'+
    'export const Flow=durable((n:number)=>{const items:readonly number[]=Child.run(n)!;return fanOut(items,v=>v,v=>Work.run(v))});')
  expect(interpret(flow)).toMatchObject({value:[42,3],waves:[1,2,1]})
})

for(const [name,imported,expression] of [
  ["alias",'import {Child as Renamed} from "./api";',"Renamed"],
  ["namespace",'import * as API from "./api";',"API.Child"],
  ["default",'import Child from "./api";',"Child"],
] as const)test(`source child ${name} imports preserve declaration-owned Action identity`,()=>{
  const r=request(imported+'export const Flow=durable((n:number)=>{return '+expression+'.run(n)!});')
  const got=getNativeCompiler().compileKeyedPlanSource({...r,providersJson:JSON.stringify([{...provider,actionId:"child.vibe#Work"}]),
    dependencies:[{fileName:"api.vibe",source:'export {Child,Child as default} from "./child";'},
      {fileName:"child.vibe",source:header+work+'export const Child=durable((n:number)=>{return Work.run(n)});'}]})
  expect(got.diagnostics).toEqual([])
  const flow=new KeyedSourceInterpreter(got.planJson)
  expect(interpret(flow).value).toBe(42)
  expect(flow.prepare(flow.nodes[0].id,[])).toMatchObject({contract:{id:"child.vibe#Work"}})
})

test("source function declarations and immutable function bindings are not evaluated",()=>{
  for(const declaration of ['function body(n:number){return Work.run(n)}','const body=(n:number)=>{return Work.run(n)};']){
    const flow=compile(work+declaration+'const Child=durable(body);export const Flow=durable((n:number)=>{return Child.run(n)!});')
    expect(interpret(flow).value).toBe(42)
  }
})

test("action-free child scopes preserve input object order without synthetic work",()=>{
  const r=request('const Child=durable((n:{z:number;a:number})=>{return n});export const Flow=durable((n:{z:number;a:number})=>{return Child.run(n)!});','{"z":2,"a":1}')
  const got=getNativeCompiler().compileKeyedPlanSource({...r,providersJson:"[]"})
  expect(got.diagnostics).toEqual([])
  const flow=new KeyedSourceInterpreter(got.planJson)
  expect(flow.nodes).toHaveLength(1)
  expect(JSON.stringify(interpret(flow).value)).toBe('{"z":2,"a":1}')
})

test("ordering through an action-free child does not drop the preceding barrier",()=>{
  const flow=compile(work+child+'const Empty=durable((n:number)=>{return n});export const Flow=durable((n:number)=>{const pair=sequential(Child.run(n),Empty.run(2));return Work.run(3)});')
  expect(interpret(flow)).toMatchObject({value:4,waves:[1,1,1]})
})

test("a child returning a constant still waits for its declared work",()=>{
  const flow=compile(work+'const Child=durable((n:number)=>{const ignored=Work.run(n)!;return 7});export const Flow=durable((n:number)=>{const value=Child.run(n)!;return Work.run(value)});')
  expect(interpret(flow)).toMatchObject({value:8,waves:[1,1,1]})
})

test("source child Action failures preserve nominal declaration identities",()=>{
  const flow=compile('class Bad extends Error{};class Work extends Action<(n:number)=>Result<number,Bad>>{};'+child+
    'export const Flow=durable((n:number)=>{return Child.run(n)!});')
  expect(flow.planJson).toContain("flow.vibe@Bad@1")
  expect(flow.prepare(flow.nodes[0].id,[])).toMatchObject({contract:{errorSchema:{source:"compiler-derived",
    descriptor:{kind:"error",identity:"vibelang:flow.vibe@Bad@1"}}}})
})

test("unannotated propagated collections retain their callback element types",()=>{
  const flow=compile(work+'const Child=durable((n:number)=>{return [n,2]});'+
    'export const Flow=durable((n:number)=>{const items=Child.run(n)!;return fanOut(items,v=>v,v=>Work.run(v))});')
  expect(interpret(flow)).toMatchObject({value:[42,3],waves:[2,1]})
})

test("explicit Result annotations preserve success types through child composition",()=>{
  const flow=compile(work+'const Child=durable((n:number):Result<number,never>=>{return Work.run(n)!});'+
    'export const Flow=durable((n:number):Result<number,never>=>{return Child.run(n)!});')
  expect(interpret(flow)).toMatchObject({value:42,waves:[1,1]})
})

test("nested inferred collections keep property, element and Action input types",()=>{
  const flow=compile(work+'const Child=durable((n:number)=>{return {items:[{value:n},{value:2}]}});'+
    'export const Flow=durable((n:number)=>{const data=Child.run(n)!;return fanOut(data.items,v=>v.value,v=>Work.run(v.value))});')
  expect(interpret(flow)).toMatchObject({value:[42,3],waves:[2,1]})
})

test("typed fan-out callbacks lift their checked Result success values",()=>{
  const flow=compile(work+'export const Flow=durable((n:number)=>{return fanOut([n,2],v=>v,(v:number):Result<number,never>=>{return Work.run(v)!})});')
  expect(interpret(flow)).toMatchObject({value:[42,3],waves:[2,1]})
})

test("checking retained bodies cannot hide unused type errors",()=>{
  for(const declaration of ['const ignored:string=n;', 'const ignored=missing;', 'const ignored:{value:string}={value:n};']){
    const got=getNativeCompiler().compileKeyedPlanSource(request(work+'export const Flow=durable((n:number)=>{'+declaration+'return Work.run(n)});'))
    expect(got.ok).toBe(false)
    expect(got.planJson).toBe("")
    expect(got.diagnostics.some(issue=>issue.code.startsWith("TS"))).toBe(true)
  }
})

test("fan-out and sequential composition cannot erase Action failure rows",()=>{
  const action='class Bad extends Error{};class Work extends Action<(n:number)=>Result<number,Bad>>{};'
  for(const body of ['fanOut([n],v=>v,v=>Work.run(v))',
    'fanOut([n],v=>v,(v:number):Result<number,Bad>=>{return Work.run(v)!})',
    'sequential(Work.run(n),Work.run(2))']){
    const got=getNativeCompiler().compileKeyedPlanSource(request(action+
      'export const Flow=durable((n:number):Result<readonly number[],never>=>{return '+body+'});'))
    expect(got.ok).toBe(false)
    expect(got.planJson).toBe("")
    expect(got.diagnostics.some(issue=>issue.code==="VIBE1104")).toBe(true)
  }
  const flow=compile(action+'export const Flow=durable((n:number):Result<readonly number[],Bad>=>{return fanOut([n,2],v=>v,v=>Work.run(v))});')
  expect(interpret(flow)).toMatchObject({value:[42,3],waves:[2,1]})
})
