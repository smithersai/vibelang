import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getNativeCompiler } from "../compiler/native.ts";
import { analyzeProject, analyzeSource } from "./analyze.ts";
import { compileProject } from "./project-compile.ts";
import { issueCompilerRuntimeSource } from "./runtime-source-authority.ts";

const root = mkdtempSync(join(tmpdir(), "vibelang-native-project-"));
afterAll(() => rmSync(root, {recursive:true, force:true}));
beforeAll(() => { getNativeCompiler(); }, 60_000);

test("native SDK relocation includes filesystem-discovered runtime modules and JS aliases", () => {
  writeFileSync(join(root, "relocated.ts"), '/** @module @throws {never} */\nexport const value=42');
  for (const spelling of ["./relocated.ts", "./relocated.js"]) {
    const compiled = compileProject([{ fileName: "relocate.vibe", source:
      `import {value} from ${JSON.stringify(spelling)};export function main(){return value}` }], {
      rootDir: root, outDir: join(root, "emit"), outputExtension: ".mjs",
      additionalRuntimeOutputs: [{ sourceFileName: join(root, "relocated.ts"),
        outputFileName: join(root, "emit", "foreign", "renamed.mjs"),
        resolutionAliases: [join(root, "relocated.js")] }],
    });
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.files["relocate.vibe"]!.code).toContain('from "./foreign/renamed.mjs"');
    expect(compiled.files["relocate.vibe"]!.sourceMap).toBeString();
  }
});

test("a native project refusal preserves diagnostics without claiming code or maps", () => {
  const source = 'export function main(): number { return "bad" }';
  const compiled = compileProject([
    { fileName: "bad-map.vibe", source },
    { fileName: "good-map.vibe", source: "export const value=42" },
  ], { rootDir: root, outDir: join(root, "emit") });
  expect(compiled.diagnostics.map(issue => issue.code)).toEqual(["TS2322"]);
  expect(compiled.diagnostics[0]!.fileName).toBe("bad-map.vibe");
  for (const file of Object.values(compiled.files)) {
    expect(file.code).toBe("");
    expect(file.sourceMap).toBeUndefined();
  }
});

test("native SDK checks consumers without imposing its environment on foreign implementations", () => {
  const foreign = '/** @module @throws {never} */\n/** @throws {never} */\n' +
    'export function host(value: number): number { process.stdout.write(String(value));return value }';
  writeFileSync(join(root, "host-environment.ts"), foreign);
  const compile = (argument: string) => compileProject([{ fileName: "host-consumer.vibe", source:
    `import {host} from "./host-environment.ts";export function main(){return host(${argument})}` }],
    { rootDir: root, outDir: join(root, "emit") });
  const accepted = compile("42");
  expect(accepted.diagnostics).toEqual([]);
  expect(accepted.files["host-consumer.vibe"]!.code).not.toBe("");
  const refused = compile('"wrong"');
  expect(refused.diagnostics.map(issue => issue.code)).toEqual(["TS2345"]);
  expect(refused.files["host-consumer.vibe"]!.code).toBe("");
  writeFileSync(join(root, "host-environment.ts"), foreign + "\nexport const malformed = ;");
  expect(compile("42").diagnostics.some(issue => issue.severity === "error")).toBe(true);
});

for (const extension of ["tsx", "jsx"]) test(`native SDK resolves foreign ${extension} without enabling language JSX`, () => {
  const fileName = `foreign-jsx.${extension}`;
  writeFileSync(join(root, fileName), '/** @module @throws {never} */\n' +
    'const React={createElement(){return "ok"}}; const Box=()=>"ok";\n' +
    '/** @throws {never}\n * @returns {string}\n */ export function host()' +
    (extension === "tsx" ? ": string" : "") + '{return <Box/>}');
  const compiled = compileProject([{ fileName: "jsx-consumer.vibe", source:
    `import {host} from "./${fileName}";export function main(){return host()}` }],
    { rootDir: root, outDir: join(root, "emit") });
  expect(compiled.diagnostics).toEqual([]);
  expect(compiled.files["jsx-consumer.vibe"]!.code).not.toBe("");
});

test("native public project analysis keeps caller labels, cross-module rows and authored UTF16 positions", () => {
  const sources = [
    {fileName:"./nested/main.vibe", source:'// 😀\r\nimport {work,type Boom} from "../domain.vibe";export function run():Result<number,Boom>{return work()!}'},
    {fileName:join(root,"domain.vibe"), source:'import {Context} from "vibelang/context";export class Boom extends Error{};abstract class Db extends Context {abstract read():number};export function work():Result<number,Boom>{return Db.context().read()}'},
  ];
  const first = analyzeProject(sources, {rootDir:root});
  expect(first.diagnostics).toEqual([]);
  expect(Object.keys(first.files)).toEqual([sources[0]!.fileName, sources[1]!.fileName]);
  expect(first.files[sources[0]!.fileName]!.rows.run).toEqual({failures:["Boom"],requirements:["Db"]});
  expect(first.files[sources[0]!.fileName]!.functions[0]?.start).toBe(sources[0]!.source.indexOf("export"));
  expect(analyzeProject([...sources].reverse(), {rootDir:root})).toEqual(first);
});

test("public project analysis never silently discovers an omitted authored module", () => {
  writeFileSync(join(root,"omitted.vibe"), new Uint8Array([255,254]));
  writeFileSync(join(root,"foreign.ts"), '/** @module @throws {never} */\nexport const value=42');
  const result = analyzeProject([
    {fileName:"a.vibe",source:'import {work} from "./omitted.vibe";export function main(){return work()}'},
    {fileName:"b.vibe",source:'import {value} from "./foreign.ts";export function main(){return value}'},
  ], {rootDir:root});
  expect(result.files["a.vibe"]!.diagnostics.some(issue=>issue.code === "VIBE1801")).toBe(true);
  expect(result.files["b.vibe"]!.diagnostics).toEqual([]);
});

test("parameter defaults retain their native requirement rows across source modules", () => {
  const service = {fileName:"service.vibe",source:'import {Context} from "vibelang/context";export abstract class Db extends Context{abstract read():number};export function get(){return Db.context().read()}'};
  for (const declaration of [
    'export function read(value=get()){return value}',
    'export function read({value=get()}:{value?:number}={}){return value}',
    'export const read=(value=get())=>value',
  ]) {
    const source = 'import {Db,get} from "./service.vibe";import {Layer} from "vibelang/provider";' + declaration;
    const declared = analyzeProject([service,{fileName:"main.vibe",source}],{rootDir:root});
    expect(declared.diagnostics).toEqual([]);
    expect(declared.files["main.vibe"]!.rows.read?.requirements).toEqual(["Db"]);
    const unprovided = analyzeProject([service,{fileName:"main.vibe",source:source+';export const answer=read()'}],{rootDir:root});
    expect(unprovided.diagnostics.some(issue=>issue.code === "VIBE2102" && issue.message.includes("Db"))).toBe(true);
    const provided = analyzeProject([service,{fileName:"main.vibe",source:source+';export const answer=Layer.provide(Layer.succeed(Db,{read:()=>42}),()=>read())'}],{rootDir:root});
    expect(provided.diagnostics).toEqual([]);
  }
});

test("native compiler-data aliases preserve data types but structural copies retain foreign checks", () => {
  const runtime = issueCompilerRuntimeSource({sourceFileName:"generated/config.ts",resolutionAliases:["config.json"],
    source:'/** @module @throws {never} */\nconst config={count:3} as const;export default config'});
  const sources = [{fileName:"main.vibe",source:'import config from "./config.json" with {type:"json"};export const value=config.count'}];
  expect(analyzeProject(sources,{rootDir:root,additionalRuntimeSources:[runtime]}).diagnostics).toEqual([]);
  const copied = analyzeProject(sources,{rootDir:root,additionalRuntimeSources:[{...runtime}]});
  expect(copied.diagnostics.some(issue=>issue.code === "VIBE1506")).toBe(true);
  const invalid = issueCompilerRuntimeSource({...runtime,source:'/** @module @throws {never} */\nexport default (()=>42)()'});
  expect(()=>analyzeProject(sources,{rootDir:root,additionalRuntimeSources:[invalid]})).toThrow("native admission");
});

for (const generated of ["assets/value.ts", ".vibelang-generated/assets/value.ts"]) {
  test(`native asset forwarders retain named/default contracts under ${generated}`, () => {
    const runtime = issueCompilerRuntimeSource({ sourceFileName: generated, resolutionAliases: ["profile.md"],
      source: '/** @module @throws {never} */\nexport const answer=42; export default answer' });
    const compile = (body: string) => compileProject([{ fileName: "asset-profile.vibe", source:
      'import value,{answer} from "./profile.md";export function main():number{' + body + '}' }],
      { rootDir: root, outDir: join(root, "asset-out"), additionalRuntimeSources: [runtime] });
    expect(compile("return answer+value").diagnostics).toEqual([]);
    const bad = compile("return value.missing");
    expect(bad.diagnostics.some(issue => issue.code === "TS2339")).toBe(true);
    expect(bad.files["asset-profile.vibe"]!.code).toBe("");
  });
}

test("native SDK preserves the diagnostic chain identifying a missing Result match branch", () => {
  const compiled = compileProject([{ fileName: "match-branch.vibe", source:
    'class Boom extends Error{}; function f():Result<string,Boom>{return "ok"};' +
    'export function main(){return f().match({ok:(value)=>value})}' }],
    { rootDir: root, outDir: join(root, "emit") });
  expect(compiled.diagnostics.map(issue => issue.code)).toEqual(["TS2345"]);
  expect(compiled.diagnostics[0]!.message).toContain("Property 'error' is missing");
});

test("native foreign provenance follows lifted values through await and aliases", () => {
  writeFileSync(join(root, "lifted-foreign.ts"), '/** @module @throws {never} */\n' +
    'export function union():string|Promise<string>{return Promise.resolve("ok")}\n' +
    'export function promise():Promise<string>{return Promise.resolve("ok")}\n' +
    '/** @throws {never} */\nexport function claimed():Promise<string>{return Promise.resolve("ok")}');
  const analyze = (body: string) => analyzeProject([{ fileName: "lifted.vibe", source:
    'import {union,promise,claimed} from "./lifted-foreign.ts";\n' +
    'export async function main():Promise<Result<string,Panic>>{\n' + body + '\n}' }], { rootDir: root });
  const escaped = analyze('const value=await union();const alias=value;return alias');
  expect(escaped.diagnostics.map(issue => issue.code).sort()).toEqual(["VIBE1301", "VIBE1508"]);
  const implicit = analyze('const value=await union();return `${value}`');
  expect(implicit.diagnostics.map(issue => issue.code)).toContain("VIBE1506");
  for (const body of [
    'const value=await promise();return value',
    'const value=(await promise())!;return `${value}`',
  ]) expect(analyze(body).diagnostics).toEqual([]);
  const rejectedClaim = analyze('const value=await claimed();return value');
  expect(rejectedClaim.diagnostics.map(issue => issue.code)).toEqual(["VIBE1502"]);
});

test("reserved schema-runtime imports never probe an ambient node_modules alias", () => {
  const outside = join(root,"outside");
  const project = join(root,"isolated");
  mkdirSync(outside); mkdirSync(project);
  symlinkSync(outside,join(project,"node_modules"),"dir");
  for (const source of [
    'import {__vsRunResult} from "vibelang/schema-runtime";export const value=__vsRunResult',
    'import * as runtime from "vibelang/schema-runtime";export const value=runtime.__vsRunResult',
    'export {__vsRunResult} from "vibelang/schema-runtime"',
  ]) {
    expect(analyzeSource(source,{rootDir:project,fileName:"main.vibe"}).diagnostics.some(issue=>issue.code === "VIBE1201")).toBe(true);
  }
  // The local alias did not broaden the exact compiler module registry.
  expect(()=>analyzeSource('import * as runtime from "vibelang/schema-runtime-extra";export const value=runtime',
    {rootDir:project,fileName:"main.vibe"})).toThrow("symbolic-link alias");
});

test("all public analysis entry points load and execute with compiler-library imports prohibited", () => {
  const url = new URL("./analyze.ts", import.meta.url).href;
  const executed = Bun.spawnSync([process.execPath,"--eval",`
    import {plugin} from "bun";
    plugin({name:"no-legacy-compiler",setup(build){
      build.onResolve({filter:/^typescript(?:-js)?(?:\\/|$)/},()=>{throw new Error("retired compiler dependency")});
    }});
    const api=await import(${JSON.stringify(url)});
    const source="export function answer(){return 42}";
    for(const operation of [()=>api.analyzeSource(source),()=>api.parseErrors(source),()=>api.parseFunctions(source),
      ()=>api.analyzeProject([{fileName:"main.vibe",source}])])operation();
    const service='import {Context} from "vibelang/context";export abstract class Db extends Context{abstract read():number};export function get(){return Db.context().read()}';
    const checked=api.analyzeProject([{fileName:"service.vibe",source:service},{fileName:"main.vibe",
      source:'import {get} from "./service.vibe";export function read(value=get()){return value};export const answer=read()'}]);
    if(checked.files["main.vibe"].rows.read.requirements.join(",")!=="Db" ||
      !checked.diagnostics.some(issue=>issue.code==="VIBE2102"))throw new Error("native default requirement was lost");
    console.log("native-only analysis");
  `],{env:{...process.env,VIBELANG_NATIVE_COMPILER:getNativeCompiler().executable},stdout:"pipe",stderr:"pipe"});
  expect(executed.stderr.toString()).toBe("");
  expect(executed.exitCode).toBe(0);
  expect(executed.stdout.toString()).toBe("native-only analysis\n");
});

for (const sources of [
  [{fileName:"main.ts",source:""}],
  [{fileName:"main.vibe",source:42}],
  [{fileName:"main.vibe",source:""},{fileName:"./main.vibe",source:""}],
  [{fileName:"../escape.vibe",source:""}],
  [{fileName:"bad\0.vibe",source:""}],
] as const) test(`native project source identities fail closed: ${JSON.stringify(sources)}`, () => {
  expect(()=>analyzeProject(sources as never,{rootDir:root})).toThrow();
});
