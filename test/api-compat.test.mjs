import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";

const require = createRequire(import.meta.url);

test("the package root is the native Go compiler entry, not a second compiler", async () => {
  const root = await import("vibelang");
  const native = await import("vibelang/compiler");
  assert.equal(root, native);
  assert.equal(root.getNativeCompiler(), native.getNativeCompiler());
  assert.match(root.getNativeCompiler().identity.compilerVersion, /^7\./);
  for (const name of ["createProgram", "createLanguageService", "createDocumentRegistry", "transpileModule", "typescript", "factory", "server", "SyntaxKind"]) {
    assert.equal(name in root, false, `retired compiler object leaked: ${name}`);
  }
});

test("the root compiles ordinary TypeScript and checks VibeLang through Go", async () => {
  const {getNativeCompiler} = await import("vibelang");
  const compiler = getNativeCompiler();
  const good = compiler.compile({rootNames:["main.ts"], files:[{path:"main.ts",kind:"typescript",text:"export const answer:number=42;"}],lowering:"typescript"});
  assert.equal(good.emitSkipped, false, JSON.stringify(good.diagnostics));
  const output = good.artifacts.find(file=>file.path==="main.js");
  assert(output);
  assert.equal((await import("data:text/javascript;base64,"+output.content)).answer,42);
  const source='import {Context} from "vibelang/context"; abstract class Db extends Context {abstract read():number} export function work(){return Db.context().read()} work();';
  const files=[{path:"main.vibe",kind:"vibelang",text:source}];
  const bad=compiler.analyzeLanguage({files});
  assert.equal(bad.checked,false);
  assert(bad.diagnostics.some(issue=>issue.code==="VIBE2102"));
  assert.deepEqual(bad.files[0].functions[0].requirements,["Db"]);
  assert.deepEqual(bad.diagnostics,compiler.compile({rootNames:["main.vibe"],files,lowering:"internal"}).diagnostics);
});

test("CommonJS consumers can load the native root with dynamic import on Node 22", () => {
  const result=spawnSync(process.execPath,["--input-type=commonjs","--eval",`import("vibelang").then(api=>{if(typeof api.NativeCompiler!=="function"||"createProgram" in api)throw new Error("wrong root");console.log(api.NATIVE_API_VERSION)})`],{encoding:"utf8",timeout:30_000});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/^\d+\n$/);
});

test("retired TypeScript 5.9 aliases and pass-through plugins cannot hide a legacy compiler", async () => {
  for (const name of ["typescript","typescript.js","lib/typescript","lib/typescript.js","tsserverlibrary","lib/tsserverlibrary","lib/tsserverlibrary.js","plugin","language-service"]) {
    assert.throws(()=>require.resolve(`vibelang/${name}`),{code:"ERR_PACKAGE_PATH_NOT_EXPORTED"});
    await assert.rejects(import(`vibelang/${name}`),{code:"ERR_PACKAGE_PATH_NOT_EXPORTED"});
  }
});

test("the VibeLang helper entry shares the native compiler without emulating Program objects", async () => {
  const api = await import("vibelang/vibe");
  const native = await import("vibelang");
  assert.equal(api.NativeCompiler,native.NativeCompiler);
  assert.equal(api.getNativeCompiler,native.getNativeCompiler);
  assert.equal(typeof api.compileVibeLang,"function");
  assert.equal(api.createProgram,undefined);
  assert.equal(api.typescript,undefined);
});

test("unpinned TypeScript client and JavaScript AST pass-throughs are retired", async () => {
  for (const name of ["sync", "async", "fs", "proto", "ast", "ast/is", "ast/factory", "ast/utils", "ast/scanner", "ast/visitor", "ast/clone"]) {
    assert.throws(() => require.resolve(`vibelang/unstable/${name}`), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
    await assert.rejects(import(`vibelang/unstable/${name}`), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
  }
  const { getNativeCompiler } = await import("vibelang/compiler");
  assert.deepEqual(getNativeCompiler().tokenAt({ text: "/*🐱*/ value", offset: 9 }).token,
    { kind: "Identifier", text: "value", start: 7, end: 12 });
});
