import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getNativeCompiler } from "../compiler/native.ts";
import { analyzeSource, parseErrors, parseFunctions } from "./analyze.ts";
import { analyzeNativeSource, nativeFileAnalysis } from "./native-analysis.ts";

const root = mkdtempSync(join(tmpdir(), "vibelang-source-analysis-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
beforeAll(() => { getNativeCompiler(); }, 60_000);

test("public single-source operations expose native declarations and prototype-safe row names", () => {
  const source = `// 😀\r\nclass Boom extends Error {readonly code="a";}
export function work():Result<number,Boom>{throw new Boom()}
class Box {work(){return 1}}
function outer(){function work(){return 2};return work()}
export function __proto__(){return 3}`;
  const options = { rootDir: root, fileName: "main.vibe" };
  const native = getNativeCompiler().analyzeLanguage({files:[{path:"main.vibe",kind:"vibelang",text:source}],resolutionRoot:root});
  const view = nativeFileAnalysis(native.files[0]!, native.diagnostics, source);
  const publicView = analyzeSource(source, options);
  expect(publicView).toEqual(view);
  expect(publicView.diagnostics).toEqual([]);
  expect(publicView.rows.work).toEqual({failures:["Boom"],requirements:[]});
  expect(Object.hasOwn(publicView.rows, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(publicView.rows)).toBe(Object.prototype);
  expect(publicView.rows.__proto__).toEqual({failures:[],requirements:[]});
  expect(parseErrors(source, options)).toEqual(view.errors);
  expect(parseFunctions(source, options)).toEqual(view.functions);
  expect(view.errors[0]?.start).toBe(source.indexOf("class Boom"));
  expect(view.functions.filter(fn=>fn.name==="work")).toHaveLength(3);
});

for (const newline of ["\n", "\r\n", "\r", "\u2028", "\u2029"]) {
  test(`native diagnostic positions retain UTF16 across ${JSON.stringify(newline)}`, () => {
    const source = `// 😀${newline}export function wrong(): number { return "text" }`;
    const got = analyzeSource(source, {rootDir:root,fileName:"position.vibe"});
    const issue = got.diagnostics.find(issue=>issue.code==="TS2322");
    expect(issue).toBeDefined();
    expect(issue!.line).toBe(2);
    expect(issue!.column).toBe(issue!.start - source.indexOf("export") + 1);
    expect(issue!.start).toBeGreaterThanOrEqual(source.indexOf("return"));
  });
}

test("native disk discovery resolves parent imports only within the supplied project root", () => {
  mkdirSync(join(root,"nested"));
  const helper = `import {Context} from "vibelang/context";abstract class Db extends Context{abstract read():number};export function work(){return Db.context().read()}`;
  writeFileSync(join(root,"helper.vibe"), helper);
  const source = `import {work} from "../helper.vibe";export function main(){return work()}`;
  const restricted = analyzeSource(source,{fileName:join(root,"nested","main.vibe")});
  expect(restricted.diagnostics.some(issue=>issue.code==="VIBE1801")).toBe(true);
  const expanded = analyzeSource(source,{fileName:join(root,"nested","main.vibe"),rootDir:root});
  expect(expanded.diagnostics).toEqual([]);
  expect(expanded.rows.main?.requirements).toEqual(["Db"]);
  expect(readFileSync(join(root,"helper.vibe"),"utf8")).toBe(helper);
});

test("supplied source wins over disk and dependency findings keep their identity", () => {
  writeFileSync(join(root,"overlay.vibe"), `export function work():number{return "wrong"}`);
  expect(analyzeSource(`export function work(){return 42}`, {rootDir:root,fileName:"overlay.vibe"}).diagnostics).toEqual([]);
  const result = analyzeSource(`import {work} from "./overlay.vibe";export function main(){return work()}`,{rootDir:root,fileName:"importer.vibe"});
  expect(result.diagnostics.find(issue=>issue.code==="TS2322")).toMatchObject({start:0,line:1,column:1});
  expect(result.diagnostics.find(issue=>issue.code==="TS2322")?.message).toStartWith("[overlay.vibe]");
});

test("a grammar refusal retains nearby native findings but cannot become a checked proof", () => {
  const source = `class Holder {value!:string};class Boom extends Error{}
declare function lookup():Result<string,Boom>;
export function work():Result<string,Boom>{return lookup().unwrap()}
function nonNull(value:string|undefined):string{return value!}`;
  const got = analyzeSource(source,{rootDir:root,fileName:"refused.vibe"});
  expect(got.diagnostics.map(issue=>issue.code)).toEqual(expect.arrayContaining(["VIBE1001","VIBE1206","VIBE1207"]));
  const files = [{path:"refused.vibe",kind:"vibelang" as const,text:source}];
  const compiler = getNativeCompiler();
  expect(compiler.analyzeLanguage({files}).checked).toBe(false);
  const compiled = compiler.compile({files,rootNames:["refused.vibe"],lowering:"internal"});
  expect(compiled.emitSkipped).toBe(true);
  expect(compiled.artifacts).toEqual([]);
  expect(compiler.checkedFunction({files,entryFile:"refused.vibe",exportName:"work"}).function).toBeNull();
});

for (const options of [{fileName:""}, {fileName:"../escape.vibe",rootDir:root}, {rootDir:42}, null]) {
  test(`invalid single-source options are refused ${JSON.stringify(options)}`, () => {
    expect(() => analyzeNativeSource("", options as never)).toThrow();
  });
}
