import { beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { getNativeCompiler, type NativeCompiler } from "./native.ts";

let compiler:NativeCompiler;
beforeAll(()=>{compiler=getNativeCompiler()},60_000);

test("native language analysis publishes whole-project rows, authored positions, and per-binding addressability",()=>{
  const a=`// 😀\r\nimport {Context} from "vibelang/context";
export abstract class Db extends Context {abstract read():number}
export class Boom extends Error {readonly code="x";}
export function work():Result<number,Boom> {if(Db.context().read()<0)throw new Boom();return 42}
export class Box {work(){return 1}}
export const arrow=async()=>42;
export function __proto__(){return 2}`;
  const b=`import {work as invoke, type Boom} from "./a.vibe";export function run():Result<number,Boom>{return invoke()!}`;
  const got=compiler.analyzeLanguage({files:[{path:"z.vibe",kind:"vibelang",text:b},{path:"a.vibe",kind:"vibelang",text:a}]});
  expect(got.checked).toBe(true);expect(got.diagnostics).toEqual([]);
  expect(got.files.map(file=>file.path)).toEqual(["a.vibe","z.vibe"]);
  const file=got.files[0]!;
  expect(file.errors[0]).toEqual({name:"Boom",fieldsSource:'readonly code="x";',start:a.indexOf("export class Boom"),end:a.indexOf("export function work")-1});
  expect(file.functions.filter(fn=>fn.name==="work").map(fn=>[fn.moduleScope,fn.requirements,fn.failures])).toEqual([[true,["Db"],["Boom"]],[false,[],[]]]);
  expect(file.functions.find(fn=>fn.name==="arrow")).toMatchObject({async:true,exported:true,moduleScope:true});
  expect(file.functions.some(fn=>fn.name==="__proto__")).toBe(true);
  expect(got.files[1]!.functions[0]).toMatchObject({name:"run",requirements:["Db"],failures:["Boom"]});
});

test("native language analysis retains provisional diagnostics but never upgrades them to deployment facts",()=>{
  const text=`import {Context} from "vibelang/context";abstract class Db extends Context {abstract read():number}
export function work(){return Db.context().read()};work();`;
  const files=[{path:"main.vibe",kind:"vibelang" as const,text}];
  const got=compiler.analyzeLanguage({files});
  expect(got.checked).toBe(false);expect(got.files[0]?.analyzed).toBe(true);
  expect(got.files[0]?.functions[0]?.requirements).toEqual(["Db"]);
  const compiled=compiler.compile({files,rootNames:["main.vibe"],lowering:"internal"});
  expect(got.diagnostics).toEqual(compiled.diagnostics);
  const proof=compiler.checkedFunction({files,entryFile:"main.vibe",exportName:"work"});
  expect(proof.ok).toBe(false);expect(proof.function).toBeNull();
  const syntax=compiler.analyzeLanguage({files:[{...files[0]!,text:"export function broken( {"}]});
  expect(syntax.checked).toBe(false);expect(syntax.files[0]).toEqual({path:"main.vibe",analyzed:false,errors:[],functions:[]});
});

test("native language analysis uses conditional binding and strict generated type checks",()=>{
  const analyze=(text:string)=>compiler.analyzeLanguage({files:[{path:"main.vibe",kind:"vibelang",text}]});
  expect(analyze(`export function run(){if(const x=42;x>0){return x}else{return x+1}}`).checked).toBe(true);
  const unbraced=analyze(`export function run(){if(const x=42;x>0)return x;else return x+1}`);
  expect(unbraced.checked).toBe(false);
  expect(unbraced.diagnostics.some(issue=>issue.code==="VIBE1717"&&issue.message.includes("braced branches"))).toBe(true);
  const refused=analyze(`export function run():number{return "wrong"}`);
  expect(refused.checked).toBe(false);expect(refused.diagnostics.some(issue=>issue.code==="TS2322")).toBe(true);
  expect(refused.files[0]?.functions[0]?.channel).toBe("plain");
});

test("native project analysis bounds authored sources without disabling foreign resolution", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibelang-native-project-closure-"));
  try {
    await writeFile(join(root, "helper.vibe"), "export function work(){return 42}");
    await writeFile(join(root, "foreign.ts"), '/** @module @throws {never} */\n/** @throws {never} */\nexport function work():number{return 42}');
    const files = [{path:"main.vibe", kind:"vibelang" as const,
      text:'import {work} from "./helper.vibe"; export function main(){return work()}'}];
    const open = compiler.analyzeLanguage({files, resolutionRoot:root});
    expect(open.checked).toBe(true);
    expect(open.files.map(file => file.path)).toEqual(["main.vibe"]);
    const closed = compiler.analyzeLanguage({files, resolutionRoot:root, explicitVibeLangSources:true});
    expect(closed.checked).toBe(false);
    expect(closed.diagnostics.some(issue => issue.code === "VIBE1801")).toBe(true);

    // A closed graph must never read and subsequently discard an omitted
    // authored dependency, including one imported through a foreign module.
    await writeFile(join(root, "helper.vibe"), new Uint8Array([255, 254]));
    await writeFile(join(root, "relay.ts"), '/** @module @throws {never} */\nexport {work} from "./helper.vibe"');
    expect(() => compiler.analyzeLanguage({files, resolutionRoot:root})).toThrow("UTF-8");
    for (const module of ["helper.vibe", "foreign.ts", "relay.ts"]) {
      const result = compiler.analyzeLanguage({resolutionRoot:root, explicitVibeLangSources:true,
        files:[{...files[0]!, text:`import {work} from "./${module}"; export function main(){return work()}`} ]});
      expect(result.checked).toBe(module === "foreign.ts");
    }
    const supplied = compiler.analyzeLanguage({resolutionRoot:root, explicitVibeLangSources:true,
      files:[...files, {path:"helper.vibe", kind:"vibelang", text:"export function work(){return 42}"}]});
    expect(supplied.checked).toBe(true);
    expect(supplied.files.map(file => file.path)).toEqual(["helper.vibe", "main.vibe"]);
  } finally {
    await rm(root, {recursive:true, force:true});
  }
});

const reviewCases = JSON.parse(readFileSync(new URL("../../../reviews/2026-09-05/cases.json", import.meta.url), "utf8")) as {name:string;source:string}[];
const reviewedSource = (name:string):string => {
  const entry=reviewCases.find(entry=>entry.name===name);
  if(!entry)throw new Error(`Missing recorded reviewer reproducer: ${name}`);
  return entry.source;
};
for(const [name,code] of [
  ["row_assign","VIBE1808"],
  ["result_branch","VIBE1302"],
  ["result_uninvoked","VIBE1302"],
  ["result_collection","VIBE1301"],
  ["promise_branch","VIBE1403"],
  ["promise_result_abort","VIBE1403"],
  ["date_parse","VIBE1602"],
  ["date_constructor","VIBE1602"],
  ["date_setter","VIBE1602"],
] as const)test(`native analysis preserves the reviewer correction for ${name}`,()=>{
  const result=compiler.analyzeLanguage({files:[{path:"main.vibe",kind:"vibelang",text:reviewedSource(name)}]});
  expect(result.checked).toBe(false);
  expect(result.diagnostics.some(issue=>issue.code===code&&issue.category==="error")).toBe(true);
});

for(const name of ["async_discard","method_discard","callback_discard"] as const)test(`native accepted ${name} actually invokes its effectful callee`,async()=>{
  const files=[{path:"main.vibe",kind:"vibelang" as const,text:reviewedSource(name)}];
  const analysis=compiler.analyzeLanguage({files});
  expect(analysis.checked).toBe(true);expect(analysis.diagnostics).toEqual([]);
  const compiled=compiler.compile({files,rootNames:["main.vibe"],lowering:"internal"});
  expect(compiled.emitSkipped).toBe(false);expect(compiled.diagnostics).toEqual([]);
  const directory=await mkdtemp(join(tmpdir(),"vibelang-native-analysis-execute-"));
  try{
    await writeFile(join(directory,"package.json"),'{"type":"module"}');
    for(const artifact of compiled.artifacts){
      const target=join(directory,artifact.path);
      await mkdir(dirname(target),{recursive:true});
      await writeFile(target,Buffer.from(artifact.content,"base64"));
    }
    const module=await import(pathToFileURL(join(directory,"main.js")).href);
    expect(await module.main()).toBe(1);
  }finally{await rm(directory,{recursive:true,force:true})}
});
