import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getNativeCompiler } from "../compiler/native.ts";
import { checkEmittedTypeScript } from "./generated-check.ts";
import { compileVibeLang } from "./compile.ts";
import { originalPosition } from "./source-map.ts";
import { isResult, __vsInspectResult, errorIdentity } from "../runtime/index.ts";

const directory = mkdtempSync(join(tmpdir(), "vibelang-native-sdk-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
let sequence = 0;

test("native SDK source maps preserve template heads, middles, tails and UTF16 columns", () => {
  const source = 'class Boom extends Error{};\nexport function main(value:string):Result<string,Boom>{\n' +
    'return `😀 head ${value}: reserved ${value} tail`\n}';
  const result = compileVibeLang(source, { fileName: "template-map.vibe" });
  expect(result.analysis.diagnostics).toEqual([]);
  const position = (text: string, token: string) => {
    const offset = text.indexOf(token);
    expect(offset).toBeGreaterThanOrEqual(0);
    const preceding = text.slice(0, offset).split("\n");
    return { line: preceding.length - 1, column: preceding.at(-1)!.length };
  };
  for (const token of ["head ", "reserved ", "tail"]) {
    const emitted = position(result.code, token);
    const authored = position(source, token);
    expect(originalPosition(result.sourceMap!, emitted.line, emitted.column)).toEqual({
      source: "template-map.vibe", line: authored.line, column: authored.column,
    });
  }
});
async function execute(source: string): Promise<unknown> {
  const name = `sdk-${sequence++}.vibe`;
  const lowered = getNativeCompiler().lowerLanguage({
    project: { files: [{ path: name, kind: "vibelang", text: source }] },
    runtimeImport: join(import.meta.dir, "../runtime/index.ts"),
  });
  expect(lowered.analysis.diagnostics).toEqual([]);
  expect(lowered.diagnostics).toEqual([]);
  expect(lowered.ok).toBe(true);
  const file = lowered.files[0]!;
  const output = join(directory, name + ".ts");
  expect(checkEmittedTypeScript(file.text, output)).toEqual([]);
  writeFileSync(output, file.text);
  const module = await import(output);
  return await module.main();
}

test("native SDK output produces the existing opaque runtime Result", async () => {
  const result = await execute(`class Boom extends Error {}; export function main(): Result<number, Boom> { return 42 }`);
  expect(isResult(result)).toBe(true);
  if (!isResult(result)) throw new Error("not the SDK Result");
  expect(__vsInspectResult(result)).toEqual({ ok: true, value: 42 });
  expect(Object.keys(result)).toEqual([]);
});

test("native SDK propagation preserves nominal errors and cleanup", async () => {
  const result = await execute(`class Boom extends Error {}; const seen: string[]=[];
    function f():Result<number,Boom>{throw new Boom("missing")}
    function work():Result<number,Boom>{try{return f()!}finally{seen.push("cleanup")}}
    export function main(){ const result=work(); return { result: result.match({ok:()=>"wrong",error:e=>e}), seen } }`);
  const value = result as { result: Error; seen: string[] };
  expect(value.result.message).toBe("missing");
  expect(errorIdentity(value.result)).toContain("sdk-");
  expect(value.seen).toEqual(["cleanup"]);
});

for (const [name, caller, invocation] of [
  ["async function", "async function call(){read();return seen.length}", "await call()"],
  ["method", "class Box { call(){read();return seen.length} }", "new Box().call()"],
  ["async method", "class Box { async call(){read();return seen.length} }", "await new Box().call()"],
  ["accessor", "class Box { get value(){read();return seen.length} }", "new Box().value"],
  ["callback", "function call(){[1].forEach(()=>{read()});return seen.length}", "call()"],
] as const) test(`native SDK discarded dependency call executes in ${name}`, async () => {
  expect(await execute(`import {Context} from "vibelang/context"; import {Layer} from "vibelang/provider";
    abstract class Db extends Context {abstract n():number}; const seen:number[]=[];
    function read(){seen.push(Db.context().n());return 1}; ${caller}
    export async function main(){const count=await Layer.provide(Layer.succeed(Db,{n:()=>7}),async()=>${invocation});return [count,...seen]}`)).toEqual([1,7]);
});

test("native SDK async Result propagation awaits cleanup", async () => {
  expect(await execute(`class Boom extends Error {}; const seen:string[]=[];
    async function f():Promise<Result<number,Boom>>{throw new Boom("missing")}
    async function work():Promise<Result<number,Boom>>{try{return (await f())!}finally{await Promise.resolve();seen.push("cleanup")}}
    export async function main(){const result=await work();return [result.match({ok:()=>"wrong",error:e=>e.message}),...seen]}`)).toEqual(["missing","cleanup"]);
});

test("native SDK Result namespace and global Panic type share SDK identity", async () => {
  const value = await execute(`export function main():Result<number,Panic>{return Result.try(()=>42)}`);
  expect(isResult(value)).toBe(true);
  if (!isResult(value)) throw new Error("not the SDK Result");
  expect(value.unwrapOr(0)).toBe(42);
});

test("native SDK getters expose explicit must-use Result channels", async () => {
  expect(await execute(`class Boom extends Error{};
    const good={get value():Result<number,Boom>{return 42}};
    const bad={get value():Result<number,Boom>{throw new Boom("missing")}};
    export function main(){return [good.value.unwrapOr(0),bad.value.match({ok:()=>"wrong",error:e=>e.message})]}`))
    .toEqual([42,"missing"]);
});

test("native SDK lowering refuses invalid source without intermediate artifacts", () => {
  const lowered = getNativeCompiler().lowerLanguage({ project:{files:[{path:"bad.vibe",kind:"vibelang",text:`export function main():number{return "bad"}`} ]}, runtimeImport:"vibelang/runtime" });
  expect(lowered.ok).toBe(false);
  expect(lowered.files).toEqual([]);
  expect(lowered.analysis.diagnostics.some(issue => issue.code === "TS2322")).toBe(true);
});

test("public single-source and project compile/check entry points need no compiler library", () => {
  const executed = Bun.spawnSync([process.execPath,"--eval",`
    import {plugin} from "bun";
    plugin({name:"no-compiler-library",setup(build){
      build.onResolve({filter:/^typescript(?:-js)?(?:\\/|$)/},()=>{throw new Error("retired compiler dependency")});
    }});
    const {compileAndCheckVibeLang,compileAndCheckProject}=await import(${JSON.stringify(new URL("./validate.ts",import.meta.url).href)});
    const runtimeImport=${JSON.stringify(join(import.meta.dir,"../runtime/index.ts"))};
    const single=compileAndCheckVibeLang('class Boom extends Error{};export function main():Result<number,Boom>{return 42}',
      {fileName:"single.vibe",sourceName:"single.vibe",outputFileName:${JSON.stringify(join(directory,"isolated.ts"))},runtimeImport});
    if(!single.ok || !single.result.code.includes("__vsResultSuccess"))throw new Error(JSON.stringify(single));
    const project=compileAndCheckProject([{fileName:"service.vibe",source:'export function read(){return 42}'},
      {fileName:"main.vibe",source:'import {read} from "./service.vibe";export function main(){return read()}'}],
      {rootDir:${JSON.stringify(directory)},outDir:${JSON.stringify(join(directory,"isolated-project"))},runtimeImport});
    if(!project.ok || !project.result.files["main.vibe"].code.includes("./service.ts"))throw new Error(JSON.stringify(project));
    console.log("native-only compilation");
  `],{env:{...process.env,VIBELANG_NATIVE_COMPILER:getNativeCompiler().executable},stdout:"pipe",stderr:"pipe"});
  expect(executed.stderr.toString()).toBe("");
  expect(executed.exitCode).toBe(0);
  expect(executed.stdout.toString()).toBe("native-only compilation\n");
});
