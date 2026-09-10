import {expect,test} from "bun:test"
import {getNativeCompiler} from "../compiler/native.ts"
import {decodeNativeKeyedSource,NATIVE_API_VERSION,type NativeKeyedSourceRequest} from "../compiler/protocol.ts"
import {KeyedSourceInterpreter} from "./keyed-interpreter.ts"

const request:NativeKeyedSourceRequest={fileName:"entry.vibe",flowId:"modules/Flow",flowVersion:1,planId:"modules/plan",
  source:`import {durable} from "vibelang:flows";import * as API from "./api";
export const Flow=durable((n:number)=>{return API.Work.run(n)!});`,inputJson:"41",
  dependencies:[{fileName:"api.vibe",source:`export {Work} from "./work";`},
    {fileName:"work.vibe",source:`import {Action} from "vibelang:flows";export class Work extends Action<(n:number)=>Result<number,never>>{}`}],
  providersJson:JSON.stringify([{actionId:"work.vibe#Work",implementationId:"work/v1",implementationDigest:"a".repeat(64),
    tier:"sealed",effects:{boundaryMode:"hard",reads:[],writes:[]},layers:[],capabilities:[]}])}

test("native SDK source modules retain identity and feed the data interpreter",()=>{
  const native=getNativeCompiler(),compiled=native.compileKeyedPlanSource(request)
  expect(compiled.ok).toBe(true)
  const interpreter=new KeyedSourceInterpreter(compiled.planJson)
  expect(interpreter.source.fileName).toBe("entry.vibe")
  expect(interpreter.source.projectDigest).toMatch(/^[0-9a-f]{64}$/)
  expect(interpreter.prepare("action/0",[])).toMatchObject({input:41,contract:{id:"work.vibe#Work"}})
  const value=interpreter.encodeSuccess("action/0",42)
  expect(interpreter.prepare("result",[{from:"action/0",path:[],value}])).toMatchObject({operation:"result",value:42})
  const reordered=native.compileKeyedPlanSource({...request,dependencies:[...request.dependencies!].reverse()})
  expect(reordered.planJson).toBe(compiled.planJson)
})

test("dependency diagnostics keep their original Unicode source coordinates",()=>{
  const dependency={fileName:"bad.vibe",source:'// 🌋\nexport const bad:number="wrong";'}
  const compiled=getNativeCompiler().compileKeyedPlanSource({...request,dependencies:[...request.dependencies!,dependency]})
  expect(compiled.ok).toBe(false)
  expect(compiled.planJson).toBe("")
  expect(compiled.diagnostics[0].file).toBe(dependency.fileName)
  expect(compiled.diagnostics[0].span?.start).toBe(dependency.source.indexOf("bad:"))
})

test("keyed source transport accepts only diagnostic spans in supplied modules",()=>{
  const native=getNativeCompiler(),dependency=request.dependencies![0]
  const issue={code:"TS2322",category:"error",phase:"check",file:dependency.fileName,message:"wrong type",span:{start:0,length:1}}
  const decode=(change:Record<string,unknown>)=>decodeNativeKeyedSource(JSON.stringify({apiVersion:NATIVE_API_VERSION,
    compilerRevision:native.identity.revision,result:{ok:false,planJson:"",diagnostics:[{...issue,...change}]}}),native.identity.revision,request)
  expect(decode({}).ok).toBe(false)
  expect(()=>decode({file:"not-supplied.vibe"})).toThrow("invalid keyed source diagnostic")
  expect(()=>decode({span:{start:dependency.source.length+1,length:1}})).toThrow("invalid keyed source diagnostic")
})

test("imported declaration checking cannot erase a capability row",()=>{
  const source=`import {Context} from "vibelang/context";
abstract class C extends Context {abstract n():number}
function read():number{return C.context().n()}
const erased:()=>number=read;`
  const got=getNativeCompiler().compileKeyedPlanSource({...request,dependencies:[...request.dependencies!,{fileName:"unsafe.vibe",source}]})
  expect(got.ok).toBe(false)
  expect(got.diagnostics.some(issue=>issue.file==="unsafe.vibe"&&issue.code==="VIBE1808")).toBe(true)
})

test("real imported Action failures cannot be replaced by descriptor-only never stubs",()=>{
  const dependencies=[{fileName:"api.vibe",source:'export {Work,Bad} from "./work";'},
    {fileName:"work.vibe",source:'import {Action} from "vibelang:flows";export class Bad extends Error{};export class Work extends Action<(n:number)=>Result<number,Bad>>{}'}]
  const source=`import {durable} from "vibelang:flows";import {Work} from "./api";
function hides(n:number):Result<number,never>{return Work.run(n)!}
export const Flow=durable((n:number)=>{return n});`
  const got=getNativeCompiler().compileKeyedPlanSource({...request,source,dependencies,providersJson:"[]"})
  expect(got.ok).toBe(false)
  expect(got.diagnostics.some(issue=>issue.file===request.fileName&&issue.code==="VIBE1104"&&issue.message.includes("Bad"))).toBe(true)
})

test("same-spelled Action declarations from different source modules remain distinct",()=>{
  const declaration='import {Action} from "vibelang:flows";export class Work extends Action<(n:number)=>Result<number,never>>{}'
  const providers=JSON.parse(request.providersJson)
  const source=`import {durable} from "vibelang:flows";import {Work as A} from "./left";import {Work as B} from "./right";
export const Flow=durable((n:number)=>{const a=A.run(n)!;const b=B.run(n)!;return {a,b}});`
  const got=getNativeCompiler().compileKeyedPlanSource({...request,source,
    dependencies:[{fileName:"left.vibe",source:declaration},{fileName:"right.vibe",source:declaration}],
    providersJson:JSON.stringify(["left","right"].map(name=>({...providers[0],actionId:name+".vibe#Work"})))})
  expect(got.ok).toBe(true)
  const interpreter=new KeyedSourceInterpreter(got.planJson)
  expect(interpreter.prepare("action/0",[])).toMatchObject({contract:{id:"left.vibe#Work"}})
  expect(interpreter.prepare("action/1",[])).toMatchObject({contract:{id:"right.vibe#Work"}})
})
