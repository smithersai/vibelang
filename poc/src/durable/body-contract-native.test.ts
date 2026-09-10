import { expect, test } from "bun:test";
import { getNativeCompiler } from "../compiler/native.ts";
import { validateDurableSchema } from "./schema-runtime.ts";
import { structuralSchema } from "./value.ts";

function request(text:string) {
  return {project:{files:[{path:"/flow/entry.ts",text}],currentDirectory:"/flow",diskDependencies:false},entryFile:"/flow/entry.ts",entry:"Flow",logicalFileName:"entry.vibe",runtimeSpecifier:"vibelang/runtime",resumable:false,async:false};
}

test("native Flow contracts have independently validated canonical schema digests",()=>{
  const contract=getNativeCompiler().bodyContract(request(`export const Flow = (n: {b?: number, a: readonly [string, boolean]}) => n.a[0]`));
  expect(contract.ok).toBe(true);
  if(!contract.ok)throw new Error(JSON.stringify(contract));
  const schemas=JSON.parse(contract.schemasJson);
  expect(validateDurableSchema(schemas.successSchema,"success")).toEqual(structuralSchema("success",{kind:"string"}));
  expect(validateDurableSchema(schemas.failureSchema,"error")).toEqual(structuralSchema("error",{kind:"never"}));
  expect(validateDurableSchema(schemas.inputSchema,"input")).toEqual(structuralSchema("input",{kind:"object",fields:[
    {name:"a",optional:false,value:{kind:"tuple",items:[{kind:"string"},{kind:"boolean"}]}},
    {name:"b",optional:true,value:{kind:"number"}},
  ]}));
});

test("native Flow wire preserves separate per-codec descriptor budgets",()=>{
  const fields=Array.from({length:600},(_,i)=>`p${i}: Leaf;`).join("");
  const text=`type Leaf = [number,number,number,number,number,number,number,number,number,number]; type Many={${fields}}; export const Flow=(n:Many)=>n;`;
  const contract=getNativeCompiler().bodyContract(request(text));
  expect(contract.ok).toBe(true);
  if(!contract.ok)throw new Error(JSON.stringify(contract));
  const schemas=JSON.parse(contract.schemasJson);
  for(const role of ["input","success"] as const){
    const schema=validateDurableSchema(schemas[`${role}Schema`],role);
    expect(schema.shape).toBe("structural");
    if(schema.shape!=="structural" || schema.descriptor.kind!=="object")throw new Error("wrong descriptor");
    expect(schema.descriptor.fields.length).toBe(600);
  }
});

test("native Flow diagnostics keep exact Unicode root spans and no partial codecs",()=>{
  const text="// 😀\u2028export const Flow = (n: number): string => n";
  const result=getNativeCompiler().bodyContract(request(text));
  expect(result.reason).toBe("check");
  expect(result.schemasJson).toBe("");
  expect(result.diagnostics).toHaveLength(1);
  const issue=result.diagnostics[0]!;
  expect(issue.code).toBe("TS2322");
  expect(issue.file).toBe("/flow/entry.ts");
  expect(text.slice(issue.span!.start,issue.span!.start+issue.span!.length)).toBe("n");
});
