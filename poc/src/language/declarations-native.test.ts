import {expect,test} from "bun:test";
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {annotateDeclarationEffects,emitProjectDeclarations,normalizeDeclarationEffectChannels,readDeclarationEffects} from "./declarations.ts";
import {checkEmittedProject} from "./generated-check.ts";

test("native declaration emission snapshots host inputs and preserves literal contracts",()=>{
  let paths=0,texts=0,effects=0,runtimes=0,failures=0,requirements=0;
  const result=emitProjectDeclarations([{
    get fileName(){paths++;return "/generated/main.mjs"},
    get code(){texts++;return 'export function answer(): 42 { return 42; }'},
    get effects(){effects++;return {answer:{get failures(){failures++;return []},get requirements(){requirements++;return []}}}},
    get runtimeModule(){runtimes++;return "vibelang/runtime"},
  }]);
  expect(result.ok).toBe(true);
  expect([paths,texts,effects,runtimes,failures,requirements]).toEqual([1,1,1,1,1,1]);
  expect(result.outputs[0]?.code).toContain("answer(): 42");
  expect(result.outputs[0]?.code.match(/@vibelangModule/g)).toHaveLength(1);
  expect(readDeclarationEffects(result.outputs[0]!.code)).toEqual({answer:{failures:[],requirements:[]}});
});

test("native declarations keep disk dependencies read-only and check consumers without the library source",()=>{
  const root=mkdtempSync(join(tmpdir(),"vibelang-native-declarations-"));
  try {
    mkdirSync(join(root,"sdk"));
    const js='throw new Error("must not execute");';
    writeFileSync(join(root,"sdk/index.js"),js);
    writeFileSync(join(root,"sdk/index.d.ts"),'export declare function call(value: number): 42;');
    const source={fileName:join(root,"main.mjs"),code:'import {call} from "sdk"; export function answer() { return call(1); }'};
    const resolution={moduleOverrides:{sdk:join(root,"sdk/index.js")}};
    const emitted=emitProjectDeclarations([source],resolution);
    expect(emitted.ok).toBe(true);
    expect(emitted.outputs[0]?.code).toContain("answer(): 42");
    const consumer={fileName:join(root,"consumer.mts"),code:'import {answer} from "./main.mjs"; export const n: 42 = answer();'};
    expect(checkEmittedProject([...emitted.outputs,consumer])).toEqual([]);
    expect(checkEmittedProject([...emitted.outputs,{...consumer,code:consumer.code.replace("n: 42","n: 43")}]).map(issue=>issue.code)).toEqual(["TS2322"]);
    expect(readFileSync(join(root,"sdk/index.js"),"utf8")).toBe(js);
    expect(readdirSync(root)).toEqual(["sdk"]);
  } finally {rmSync(root,{recursive:true,force:true})}
});

test("native warm declaration emission does not read stale sibling outputs as input",()=>{
  const root=mkdtempSync(join(tmpdir(),"vibelang-native-warm-declarations-"));
  try {
    const stale='export declare const answer: "stale";';
    writeFileSync(join(root,"dep.d.mts"),stale);
    const sources=[
      {fileName:join(root,"dep.mjs"),code:'export const answer: 42 = 42;'},
      {fileName:join(root,"main.mjs"),code:'import {answer} from "./dep.mjs"; export const result: 42 = answer;'},
    ];
    expect(checkEmittedProject(sources)).toEqual([]);
    const first=emitProjectDeclarations(sources);
    expect(first.ok).toBe(true);expect(first.diagnostics).toEqual([]);
    expect(readFileSync(join(root,"dep.d.mts"),"utf8")).toBe(stale);
    for (const file of first.outputs) writeFileSync(file.fileName,file.code);
    expect(emitProjectDeclarations(sources)).toEqual(first);
    const changed=emitProjectDeclarations([{...sources[0]!,code:'export const answer: 43 = 43;'},sources[1]!]);
    expect(changed.ok).toBe(false);expect(changed.outputs).toEqual([]);
    expect(changed.diagnostics.map(issue=>issue.code)).toEqual(["TS2322"]);
  } finally {rmSync(root,{recursive:true,force:true})}
});

for (const newline of ["\n","\r\n","\r","\u2028","\u2029"]) test(`native declaration diagnostics use UTF-16 across ${JSON.stringify(newline)}`,()=>{
  const code=`// 😀${newline}export const 𝐀: number = "bad";`;
  const result=emitProjectDeclarations([{fileName:"/generated/main.mjs",code}]);
  expect(result.ok).toBe(false);expect(result.outputs).toEqual([]);
  expect(result.diagnostics.map(issue=>issue.code)).toEqual(["TS2322"]);
  expect(result.diagnostics[0]?.position).toEqual({line:1,character:13});
  expect(result.diagnostics[0]?.span).toEqual({start:code.indexOf("𝐀"),length:2});
});

test("native declaration metadata handles prototype-like names and inline comments without changing types",()=>{
  const rows=Object.fromEntries([["__proto__",{failures:[],requirements:["path*/part\u2028.vibe#Action"]}]]);
  const annotated=annotateDeclarationEffects("export declare function __proto__(): 42;",rows);
  expect(annotated).toContain("*\\/");expect(annotated).toContain("\\u2028");
  const read=readDeclarationEffects(annotated);
  expect(Object.getPrototypeOf(read)).toBeNull();expect(Object.isFrozen(read.__proto__)).toBe(true);
  expect(read.__proto__).toEqual(rows.__proto__);
  expect(annotateDeclarationEffects(annotated,rows)).toBe(annotated);
});

test("native channel normalization matches runtime identity, not the final type name",()=>{
  const code='import {Result as R} from "./runtime.js"; export declare function run(input: R<string, never> | R<never, Error>): Promise<R<string, never> | R<never, Error>>;';
  const effects={run:{failures:["Error"],requirements:[]}};
  const result=normalizeDeclarationEffectChannels(code,effects,"/generated/main.d.mts","./runtime.d.ts");
  expect(result).toContain("input: R<string, never> | R<never, Error>");
  expect(result).toContain("Promise<R<string, Error>>");
  expect(normalizeDeclarationEffectChannels(code,effects,"/generated/main.d.mts","./another.js")).toBe(code);
});
