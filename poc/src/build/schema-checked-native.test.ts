import { expect, test } from "bun:test";
import { deriveSchemaDescriptors, emitSchemaDescriptorLiteral } from "./schema-derive.ts";
import { __vsSchema } from "./schema-runtime.ts";

const call = "derive<Item>()";
const source = 'import type { Item } from "./types.vibe"; const answer = '+call;
function request(type = "{a: number, b?: string}") {
  return {files:[{path:"main.vibe",text:source,scriptKind:"typescript" as const},
    {path:"types.vibe",text:"export type Item="+type,scriptKind:"typescript" as const}],modules:{},
    queries:[{file:"main.vibe",span:{start:source.indexOf(call),length:call.length}}]};
}
test("checked schemas resolve native imported types and drive the existing runtime validator",()=>{
  const result=deriveSchemaDescriptors(request());
  const schema=result.schemas[0]!;
  if("error" in schema) throw schema.error;
  expect(schema.descriptor).toEqual({kind:"object",properties:[
    {name:"a",optional:false,value:{kind:"number"}}, {name:"b",optional:true,value:{kind:"string"}}]});
  expect(__vsSchema(schema.descriptor).parse({a:42}).unwrap()).toEqual({a:42});
  expect(__vsSchema(schema.descriptor).parse({a:"bad"}).isError()).toBe(true);
  expect(new Function("return ("+emitSchemaDescriptorLiteral(schema.descriptor)+")")()).toEqual(schema.descriptor);
});
test("schema cache identity includes the entire native closure even when the descriptor is unchanged",()=>{
  const first=deriveSchemaDescriptors(request()), second=deriveSchemaDescriptors(request());
  expect(first.identity).toBe(second.identity);
  const changed=request();changed.files[1]!.text+="; // changed dependency";
  const edited=deriveSchemaDescriptors(changed);
  expect(edited.schemas).toEqual(first.schemas);
  expect(edited.identity).not.toBe(first.identity);
  const changedMap=request();
  const mapped=deriveSchemaDescriptors({...changedMap,modules:{"extra:types":"types.vibe"}});
  expect(mapped.identity).not.toBe(first.identity);
});
test("checked schema host preserves unsupported and budget failures with no fallback",()=>{
  const unsupported=deriveSchemaDescriptors(request("any")).schemas[0]!;
  expect("error" in unsupported && unsupported.error.failure).toBe("unsupported");
  const budget=deriveSchemaDescriptors(request("["+Array.from({length:65},()=>"number").join(",")+"]")).schemas[0]!;
  expect("error" in budget && budget.error.failure).toBe("budget");
});
