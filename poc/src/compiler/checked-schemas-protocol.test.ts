import { expect, test } from "bun:test";
import { decodeNativeCheckedSchemas, NATIVE_API_VERSION } from "./protocol.ts";

const revision = "a".repeat(40);
const request = {files:[{path:"main.ts",text:"derive<number>()",scriptKind:"typescript" as const}],modules:{},queries:[{file:"main.ts",span:{start:0,length:16}}]};
const wire = ():any => ({apiVersion:NATIVE_API_VERSION,compilerRevision:revision,result:{schemas:[{ok:true,schemaJson:'{"kind":"number"}',failure:"",message:""}]}});
const decode = (w:unknown) => decodeNativeCheckedSchemas(JSON.stringify(w),revision,request);
test("native schema queries preserve success and bounded reification refusals",()=>{
  expect(decode(wire()).schemas[0]?.ok).toBe(true);
  for(const failure of ["unsupported","budget"]){
    const w=wire();w.result.schemas[0]={ok:false,schemaJson:"",failure,message:"refused"};
    expect<unknown>(decode(w)).toEqual(w.result);
  }
});
for(const [name,mutate] of [
  ["version",(w:any)=>w.apiVersion--],
  ["revision",(w:any)=>w.compilerRevision="b".repeat(40)],
  ["compiler objects",(w:any)=>w.result.checker={}],
  ["missing queries",(w:any)=>w.result.schemas=[]],
  ["invented queries",(w:any)=>w.result.schemas.push(w.result.schemas[0])],
  ["partial schemas",(w:any)=>w.result.schemas[0].ok=false],
  ["success refusal",(w:any)=>w.result.schemas[0].failure="budget"],
  ["success message",(w:any)=>w.result.schemas[0].message="bad"],
  ["unknown refusal",(w:any)=>w.result.schemas[0]={ok:false,schemaJson:"",failure:"fallback",message:"bad"}],
  ["missing data",(w:any)=>w.result.schemas[0].schemaJson=""],
  ["invalid JSON",(w:any)=>w.result.schemas[0].schemaJson="{"],
  ["oversized JSON",(w:any)=>w.result.schemas[0].schemaJson=" ".repeat(2*1024*1024+1)],
] as const) test(`checked-schema protocol rejects ${name}`,()=>{const w=wire();mutate(w);expect(()=>decode(w)).toThrow()});
for(const [name,descriptor] of [
  ["null",null], ["any",{kind:"any"}], ["unknown",{kind:"unknown"}], ["never",{kind:"never"}],
  ["extra properties",{kind:"number",fallback:true}], ["null literal",{kind:"literal",value:null}],
  ["lone surrogate",{kind:"literal",value:"\ud800"}],
  ["one-way union",{kind:"union",variants:[{kind:"number"}]}],
  ["tuple budget",{kind:"tuple",elements:Array.from({length:65},()=>({kind:"number"}))}],
  ["union budget",{kind:"union",variants:Array.from({length:65},(_,i)=>({kind:"literal",value:i}))}],
  ["object shape",{kind:"object",properties:{a:{kind:"number"}}}],
  ["property budget",{kind:"object",properties:Array.from({length:129},(_,i)=>({name:String(i).padStart(3,"0"),optional:false,value:{kind:"number"}}))}],
  ["property order",{kind:"object",properties:["z","a"].map(name=>({name,optional:false,value:{kind:"number"}}))}],
  ["duplicate property",{kind:"object",properties:["a","a"].map(name=>({name,optional:false,value:{kind:"number"}}))}],
  ["depth budget",Array.from({length:17}).reduce((element:any)=>({kind:"array",element}),{kind:"number"})],
] as const) test(`checked-schema descriptor rejects ${name}`,()=>{
  const w=wire();w.result.schemas[0].schemaJson=JSON.stringify(descriptor);expect(()=>decode(w)).toThrow();
});
