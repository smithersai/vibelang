import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const nativeDirectory = `poc/dist/compiler/native/${process.platform}-${process.arch}`;
const nativeName = process.platform === "win32" ? "vibelang-native.exe" : "vibelang-native";

function isolatedCompiler(t, { runtime = false, native = true, comptime = false, cli = false } = {}) {
  const temporary = mkdtempSync(join(tmpdir(), "vibelang-native-package-test-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  for (const file of [
    "typescript-fork.json", "poc/dist/agent/compiler.js", "poc/dist/agent/identity.js",
    "dist/relative-runtime-graph.js", "dist/go-backend.js", "dist/compiler.js",
    "poc/dist/compiler/native.js", "poc/dist/compiler/protocol.js", "poc/dist/language/format.js", "poc/dist/language/compiler-modules.js", "poc/dist/language/compiler-options.js", "poc/dist/language/generated-check.js",
    "poc/dist/language/declarations.js", "poc/dist/language/model.js", "poc/dist/language/editor-syntax.js", "poc/dist/language/recover.js",
    "poc/dist/language/native-analysis.js", "poc/dist/durable/site-id.js", "poc/dist/durable/value.js",
    "poc/dist/build/loader-registration.js", "poc/dist/build/stable.js",
    "poc/dist/build/source-assets.js", "poc/dist/build/assets.js", "poc/dist/build/sandboxed-loader.js",
    "poc/dist/build/comptime-value.js", "poc/dist/language/runtime-source-authority.js",
    "poc/dist/build/schema.js", "poc/dist/runtime/failure.js", "poc/dist/runtime/errors.js", "poc/dist/runtime/panic.js",
    ...(comptime ? ["comptime", "comptime-intrinsic", "schema-derive", "schema-runtime"].map(name => `poc/dist/build/${name}.js`) : []),
    ...(native ? [`${nativeDirectory}/manifest.json`, `${nativeDirectory}/${nativeName}`] : []),
    ...(cli ? ["bin/vibec.js", "dist/compiler-cli.js", "dist/compiler-process.js"] : []),
    ...(runtime ? [
      "dist/agent.js",
      ...["index", "bindings", "coding-agent", "fakes", "model", "prompt", "sandbox", "tools"].map(name => `poc/dist/agent/${name}.js`),
      ...["schema", "schema-runtime", "site-id", "value", "ir", "plan-ir", "authoring", "artifact",
        "body-artifact", "body-intrinsics", "manifest-artifact", "implementation-validation", "implementation-contract", "errors"].map(name => `poc/dist/durable/${name}.js`),
      ...readdirSync(join(root, "poc/dist/runtime")).filter(name => name.endsWith(".js")).map(name => `poc/dist/runtime/${name}`),
    ] : []),
  ]) {
    mkdirSync(dirname(join(temporary, file)), { recursive: true });
    copyFileSync(join(root, file), join(temporary, file));
  }
  writeFileSync(join(temporary, "package.json"), '{"type":"module"}\n');
  // Exercise the real public export map, with no installed dependencies. None
  // of the legacy compiler modules is copied into this fixture.
  if (runtime) copyFileSync(join(root, "package.json"), join(temporary, "package.json"));
  return temporary;
}

function execute(temporary, source) {
  const env = { ...process.env, PATH: "" };
  for (const key of Object.keys(env)) {
    if (key.startsWith("VIBELANG_") || key === "NODE_OPTIONS" || key === "NODE_PATH") delete env[key];
  }
  return spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: temporary, env, encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
  });
}

test("installed TypeScript CLI uses the pinned compiler without npm TypeScript, Go, or a checkout", (t) => {
  const temporary = isolatedCompiler(t, { cli: true });
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { spawnSync } from "node:child_process";
    import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
    import { getNativeCompiler } from "./dist/compiler.js";
    import { resolveTypeScriptCompiler, runTypeScriptCompiler } from "./dist/compiler-process.js";
    const compiler = getNativeCompiler();
    assert.equal(resolveTypeScriptCompiler(), compiler.executable);
    const version = spawnSync(process.execPath, ["bin/vibec.js", "--version"], { encoding: "utf8" });
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout, "Version " + compiler.identity.compilerVersion + "\\n");
    mkdirSync("source space");
    writeFileSync("source space/helper.ts", "export const value = 42;\\n");
    writeFileSync("source space/🐱 entry.ts", 'import {value} from "./helper.js"; export async function answer(): Promise<number> { return new Map([["value", value]]).get("value")!; }\\n');
    const project = { compilerOptions: {
      target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
      declaration: true, sourceMap: true, noEmitOnError: true, outDir: "output",
    }, include: ["source space/*.ts"] };
    writeFileSync("tsconfig.json", JSON.stringify(project));
    const missingRoot = spawnSync(process.execPath, ["bin/vibec.js", "--pretty", "false", "-p", "tsconfig.json"], { encoding: "utf8" });
    assert.notEqual(missingRoot.status, 0);
    assert.match(missingRoot.stdout, /TS5011/);
    project.compilerOptions.rootDir = "source space";
    writeFileSync("tsconfig.json", JSON.stringify(project));
    assert.equal(runTypeScriptCompiler(["--pretty", "false", "-p", "tsconfig.json"]), 0);
    const emitted = await import("./output/🐱 entry.js");
    assert.equal(await emitted.answer(), 42);
    assert.match(readFileSync("output/🐱 entry.d.ts", "utf8"), /answer.*Promise<number>/);
    assert.equal(JSON.parse(readFileSync("output/🐱 entry.js.map", "utf8")).version, 3);
    const config = spawnSync(process.execPath, ["bin/vibec.js", "--showConfig", "-p", "tsconfig.json"], { encoding: "utf8" });
    assert.equal(config.status, 0, config.stderr);
    assert.equal(JSON.parse(config.stdout).compilerOptions.strict, true);
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("installed TypeScript CLI preserves refusals and cannot mistake bridge commands for TS flags", (t) => {
  const temporary = isolatedCompiler(t, { cli: true });
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { spawnSync } from "node:child_process";
    import { existsSync, writeFileSync } from "node:fs";
    const run = (...args) => spawnSync(process.execPath, ["bin/vibec.js", "--pretty", "false", ...args], { encoding: "utf8" });
    writeFileSync("bad.ts", 'export const value: number = "wrong";\\n');
    const invalid = run("--noEmitOnError", "--outDir", "refused-output", "bad.ts");
    assert.equal(invalid.error, undefined);
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stdout, /TS2322/);
    assert.equal(existsSync("refused-output/bad.js"), false);
    for (const flag of ["--revision", "--build-identity", "--unknownCompilerOption"]) {
      const refused = run(flag);
      assert.notEqual(refused.status, 0);
      assert.match(refused.stdout, /TS5023/);
    }
    writeFileSync("language.vibe", "export const value = 42;\\n");
    const language = run("--noEmit", "language.vibe");
    assert.notEqual(language.status, 0);
    assert.match(language.stdout, /TS6054/);
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("installed agent compilation needs no JS compiler, Go, checkout, or dependencies", (t) => {
  const temporary = isolatedCompiler(t);
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { NativeTypeScriptCompiler } from "./poc/dist/agent/compiler.js";
    import { getNativeCompiler } from "./poc/dist/compiler/native.js";
    import { formatVibeLangSource, vibelangTokenAt } from "./poc/dist/language/format.js";
    const compiler = new NativeTypeScriptCompiler();
    const surface = "interface Functions { double(value: number): Promise<number> }";
    const good = await compiler.compile("export default async (f: Functions) => f.double(21)", surface);
    assert.equal(good.ok, true, JSON.stringify(good.diagnostics));
    const turn = await import("data:text/javascript;base64," + Buffer.from(good.javascript).toString("base64"));
    assert.equal(await turn.default({ double: async value => value * 2 }), 42);
    const bad = await compiler.compile('export default (f: Functions) => f.double("bad")', surface);
    assert.equal(bad.ok, false);
    assert(bad.diagnostics.some(d => d.code === 2345));
    const policy = await compiler.compile('export default () => eval("42")', surface);
    assert.equal(policy.ok, false);
    assert(policy.diagnostics.some(d => d.code === 91001));
    assert.equal(compiler.identity.name, "typescript-go/in-memory");
    const inspected = getNativeCompiler().inspect([{ path: "source.ts", text: "import('x')", scriptKind: "typescript" }]);
    assert.equal(inspected.files[0].moduleSyntax[0].specifier, "x");
    assert.deepEqual(inspected.files[0].moduleSyntax[0].specifierSpan, {start:7,length:3});
    assert.equal(inspected.files[0].moduleSyntax[0].specifierKind, "string");
    const formatted = formatVibeLangSource("const value=42");
    assert.equal(formatted.ok, true);
    assert.equal(formatted.code, "const value = 42\\n");
    assert.equal(formatVibeLangSource(formatted.code).changed, false);
    assert.deepEqual(vibelangTokenAt("value", 3), { kind: "Identifier", text: "value", start: 0, end: 5 });
    console.log(JSON.stringify({ answer: 42, compiler: good.compiler }));
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).answer, 42);
  assert.match(JSON.parse(result.stdout).compiler, /TypeScript 7\..*native Go/);
});

test("installed native language analysis needs no legacy checker and does not authenticate provisional rows", (t) => {
  const temporary = isolatedCompiler(t);
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { getNativeCompiler } from "./dist/compiler.js";
    const compiler = getNativeCompiler();
    const source = '// 😀\\nimport {Context} from "vibelang/context"; abstract class Db extends Context {abstract read():number} export function work(){return Db.context().read()}';
    const files = [{path:"main.vibe",kind:"vibelang",text:source}];
    const valid = compiler.analyzeLanguage({files});
    assert.equal(valid.checked, true, JSON.stringify(valid.diagnostics));
    assert.equal(valid.files[0].analyzed, true);
    assert.equal(valid.files[0].functions[0].start, source.indexOf('export function work'));
    assert.deepEqual(valid.files[0].functions[0].requirements, ["Db"]);
    const invalidFiles = [{...files[0],text:source+';work()'}];
    const refused = compiler.analyzeLanguage({files:invalidFiles});
    assert.equal(refused.checked, false);
    assert.deepEqual(refused.files[0].functions[0].requirements, ["Db"]);
    assert.deepEqual(refused.diagnostics, compiler.compile({files:invalidFiles,rootNames:["main.vibe"],lowering:"internal"}).diagnostics);
    const proof = compiler.checkedFunction({files:invalidFiles,entryFile:"main.vibe",exportName:"work"});
    assert.equal(proof.ok, false);
    assert.equal(proof.function, null);
    assert.equal("artifacts" in valid, false);
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test("installed single-source native adapter resolves a bounded dependency without a JS compiler", (t) => {
  const temporary = isolatedCompiler(t);
  writeFileSync(join(temporary,"helper.vibe"), 'import {Context} from "vibelang/context";abstract class Db extends Context{abstract read():number};export function read(){return Db.context().read()}');
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import {analyzeNativeSource} from "./poc/dist/language/native-analysis.js";
    const options={rootDir:process.cwd(),fileName:"main.vibe"};
    const valid=analyzeNativeSource('import {read} from "./helper.vibe";export function work(){return read()}',options);
    assert.deepEqual(valid.diagnostics,[]);
    assert.deepEqual(valid.rows.work.requirements,["Db"]);
    const refused=analyzeNativeSource('import {read} from "./helper.vibe";export function work(){return read()};work()',options);
    assert(refused.diagnostics.some(issue=>issue.code==="VIBE2102"));
    const invalid=analyzeNativeSource('export function work():number{return "wrong"}',options);
    assert(invalid.diagnostics.some(issue=>issue.code==="TS2322"));
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test("the public native compiler entry loads and compiles with no dependencies", (t) => {
  const temporary = isolatedCompiler(t);
  copyFileSync(join(root,"package.json"),join(temporary,"package.json"));
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { NativeCompiler, NativeCompilerError, NATIVE_API_VERSION } from "vibelang";
    assert.equal((await import("vibelang/compiler")).NativeCompiler,NativeCompiler);
    assert.equal("createProgram" in await import("vibelang"),false);
    await assert.rejects(import("vibelang/typescript"),{code:"ERR_PACKAGE_PATH_NOT_EXPORTED"});
    const compiler = new NativeCompiler();
    assert.equal(compiler.identity.apiVersion, NATIVE_API_VERSION);
    const request = { rootNames: ["main.vibe"], files: [{path:"main.vibe",kind:"vibelang",text:"export const answer = 42;"}], lowering:"internal" };
    const result = compiler.compile(request);
    assert.equal(result.emitSkipped, false, JSON.stringify(result.diagnostics));
    const file = result.artifacts.find(item => item.path === "main.js");
    assert(file);
    assert.equal((await import("data:text/javascript;base64," + file.content)).answer, 42);
    assert.throws(() => compiler.compile({...request, lowering:"typescript"}), NativeCompilerError);
    const json = compiler.inspect([{path:"config.json",text:'{"x":1,"x":2}',scriptKind:"json"}]).files[0];
    assert.deepEqual(json.moduleSyntax, []);
    assert.deepEqual(json.diagnostics, []);
    assert.deepEqual(json.jsonDuplicateKeys, [{start:7,length:3}]);
    const escapedKey = '"' + String.fromCharCode(92) + 'ud800"';
    const escapedText = '{' + escapedKey + ':1,' + escapedKey + ':2}';
    const escaped = compiler.inspect([{path:"config.json",text:escapedText,scriptKind:"json"}]).files[0];
    assert.deepEqual(escaped.jsonDuplicateKeys, [{start:12,length:8}]);
    assert.equal(escapedText.slice(12,20), escapedKey);
    const helper = 'function helper(n: number) { return n * 2 }';
    const durableSource = 'import { durable as pin } from "vibelang:flows"; ' + helper + ' export const Flow = pin(helper);';
    const facts = compiler.durableModule(durableSource);
    assert.deepEqual(facts.diagnostics, []);
    assert.equal(facts.calls.length, 1);
    assert.equal(facts.removals.length, 1);
    const excerpt = span => durableSource.slice(span.start, span.start + span.length);
    assert.equal(excerpt(facts.calls[0]), 'pin(helper)');
    assert.equal(excerpt(facts.removals[0]), helper);
    const defaulted = compiler.durableModule(durableSource + ' function outside(n = helper(21)) { return n } export { outside };');
    assert.deepEqual(defaulted.diagnostics, []);
    assert.deepEqual(defaulted.removals, []);
    const invalid = compiler.durableModule('import { durable } from "vibelang:flows"; const Flow = durable(() => { return + });');
    assert(invalid.diagnostics.some(item => item.code === "VIBE1000"));
    assert.deepEqual(invalid.calls, []);
    assert.deepEqual(invalid.removals, []);
    assert.deepEqual(invalid.imports, []);
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test("installed checked Action implementations use Go with no legacy compiler or dependency directory", (t) => {
  const temporary = isolatedCompiler(t, { runtime: true });
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { getNativeCompiler } from "./dist/compiler.js";
    import { compileActionContract } from "./poc/dist/durable/schema.js";
    import { compileActionImplementationContract, retainedCheckedImplementationProject, requireCompilerAuthenticatedContract, requireCompilerAuthenticatedImplementation } from "./poc/dist/durable/implementation-contract.js";
    const action = compileActionContract('import { Action } from "vibelang:flows"; export class Work extends Action<(n: number) => Result<number, never>> {}', {fileName:"action.vibe", exportName:"Work", id:"test/native-implementation", version:1});
    assert.equal(action.ok, true, JSON.stringify(action.diagnostics));
    const helper = 'export function helper(n: number) { return n + 1; }';
    const source = 'import { helper } from "./lib"; export function work(n: number): Result<number, never> { return helper(n); }';
    const callback = n => n + 1;
    const options = {action:action.descriptor, implementation:callback, implementationId:"native-work", implementationVersion:"1", entryFile:"main.vibe", exportName:"work", sources:[{fileName:"main.vibe",source},{fileName:"lib/index.vibe",source:helper}]};
    const contract = compileActionImplementationContract(options);
    assert.deepEqual(contract.typedFailures, []);
    assert.equal(contract.failureSchemaDigest, action.descriptor.errorSchema.digest);
    assert.equal(requireCompilerAuthenticatedContract(contract), contract);
    requireCompilerAuthenticatedImplementation(contract, callback);
    assert.throws(() => requireCompilerAuthenticatedContract({...contract}), /exact frozen contract/);
    assert.throws(() => requireCompilerAuthenticatedImplementation(contract, n => n + 1), /exact runtime callback/);
    assert.equal(retainedCheckedImplementationProject(contract).sources.length, 2);
    const request = {files:options.sources.map(s => ({path:s.fileName,text:s.source,kind:"vibelang"})),entryFile:"main.vibe",exportName:"work"};
    const native = getNativeCompiler().checkedFunction(request);
    assert.equal(native.ok, true, JSON.stringify(native));
    assert.equal(source.slice(native.function.span.start, native.function.span.start + native.function.span.length), 'export function work(n: number): Result<number, never> { return helper(n); }');
    const badSource = 'export function work(): number { return "bad"; }';
    const bad = getNativeCompiler().checkedFunction({...request,files:[{path:"main.vibe",text:badSource,kind:"vibelang"}]});
    assert.equal(bad.ok, false);
    assert.equal(bad.function, null);
    assert(bad.diagnostics.some(issue => issue.code === "TS2322"));
    assert.throws(() => compileActionImplementationContract({...options,sources:[{fileName:"main.vibe",source:badSource}]}), /native checked lowering/);
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test("installed editor literal navigation needs no legacy compiler, Go, checkout, or dependencies", (t) => {
  const temporary = isolatedCompiler(t);
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import {editorModuleLinks} from "./poc/dist/language/editor-syntax.js";
    const source='/*😀*/ import {x} from "./x.vibe" with {type:"json"}; export * from "./y.vibe";';
    const links=editorModuleLinks(source,"editor.vibe");
    assert.deepEqual(links.map(link=>link.specifier),["./x.vibe","./y.vibe"]);
    assert.deepEqual(links.map(link=>source.slice(link.start,link.end)),['"./x.vibe"','"./y.vibe"']);
    const attribute=source.indexOf('"json"')+1;
    assert.equal(links.some(link=>link.start<=attribute&&attribute<link.end),false);
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test("installed generated checking needs no legacy compiler, Go, checkout, or dependencies", (t) => {
  const temporary = isolatedCompiler(t);
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { resolve } from "node:path";
    import { checkEmittedProject, checkEmittedTypeScript } from "./poc/dist/language/generated-check.js";
    import { getNativeCompiler } from "./dist/compiler.js";
    const sources = [
      {fileName:resolve("main.js"),code:'import { answer } from "./dep.js"; export const value: number = answer;'},
      {fileName:resolve("dep.js"),code:'export const answer: number = 42;'},
    ];
    assert.deepEqual(checkEmittedProject(sources), []);
    const bad = checkEmittedTypeScript("// 😀\\nexport const 𝐀: number = 'bad';",resolve("bad.ts"));
    assert.deepEqual(bad.map(issue=>issue.code),["TS2322"]);
    assert.deepEqual(bad[0].position,{line:1,character:13});
    assert.equal(bad[0].span.length,2);
    assert.equal(typeof bad[0].file,"string");
    const direct = getNativeCompiler().checkGeneratedProject({files:sources.map(s=>({path:s.fileName,text:s.code})),currentDirectory:process.cwd(),diskDependencies:false});
    assert.deepEqual(direct.diagnostics,[]);
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test("installed Flow boundary checking needs no legacy compiler, Go, checkout, or dependencies", (t) => {
  const temporary = isolatedCompiler(t);
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { getNativeCompiler } from "./dist/compiler.js";
    const native = getNativeCompiler();
    const source = "export const Flow = (n: number) => n + 1";
    const request = {project:{files:[{path:"/body/entry.ts",text:source}],currentDirectory:"/body",diskDependencies:false},entryFile:"/body/entry.ts",entry:"Flow",logicalFileName:"entry.vibe",runtimeSpecifier:"vibelang/runtime",resumable:false,async:false};
    const contract = native.bodyContract(request);
    assert.equal(contract.ok,true,JSON.stringify(contract));
    const schemas = JSON.parse(contract.schemasJson);
    assert.deepEqual(schemas.inputSchema.descriptor,{kind:"number"});
    assert.deepEqual(schemas.successSchema.descriptor,{kind:"number"});
    assert.deepEqual(schemas.failureSchema.descriptor,{kind:"never"});
    const bad = native.bodyContract({...request,project:{...request.project,files:[{path:request.entryFile,text:source.replace("n: number","n: unknown")}]}});
    assert.equal(bad.ok,false);
    assert.equal(bad.schemasJson,"");
    assert(bad.diagnostics.some(issue=>issue.code.startsWith("TS")));
    const opaque = native.bodyContract({...request,project:{...request.project,files:[{path:request.entryFile,text:"export const Flow = (n: unknown) => n"}]}});
    assert.equal(opaque.reason,"boundary");
    assert.equal(opaque.schemasJson,"");
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test("installed configuration validation needs no legacy compiler, project files or dependency directory", (t) => {
  const temporary = isolatedCompiler(t);
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { getNativeCompiler } from "./dist/compiler.js";
    import { validateVibeLangTsconfig, MANDATORY_CHECKER_OPTIONS } from "./poc/dist/language/compiler-options.js";
    const path = "/project/config/../tsconfig.json";
    const text = JSON.stringify({compilerOptions: MANDATORY_CHECKER_OPTIONS});
    assert.deepEqual(validateVibeLangTsconfig(path,text), []);
    const bad = text.replace('"strict":true', '"strict":false');
    const direct = getNativeCompiler().validateConfig({path,text:bad});
    const adapted = validateVibeLangTsconfig(path,bad);
    assert.equal(adapted.length, 1);
    assert.equal(adapted[0].fileName, path);
    assert.equal(adapted[0].code, "VIBE6001");
    assert.equal(adapted[0].start, direct.diagnostics[0].span.start);
    assert.equal(bad.slice(adapted[0].start, adapted[0].start + adapted[0].length), '"strict":false');
    assert.equal(validateVibeLangTsconfig(path, "").length, 6);
    assert(validateVibeLangTsconfig(path, text.slice(0,-1)).some(issue => issue.code.startsWith("TS")));
    assert.equal(validateVibeLangTsconfig(path, '{"extends":"/must/not/read.json"}').length, 6);
    for (const newline of [String.fromCharCode(10), String.fromCharCode(13), String.fromCharCode(13,10), String.fromCharCode(0x2028), String.fromCharCode(0x2029)]) {
      const unicode = "// 😀" + newline + bad;
      const finding = validateVibeLangTsconfig(path, unicode)[0];
      assert.equal(finding.line, 2);
      assert.equal(finding.column, adapted[0].column);
      assert.equal(finding.start, adapted[0].start + 5 + newline.length);
    }
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test("installed declaration emission and inspection need no legacy compiler, Go, checkout, or dependencies", (t) => {
  const temporary = isolatedCompiler(t);
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { resolve } from "node:path";
    import { emitProjectDeclarations, annotateDeclarationEffects, readDeclarationEffects, normalizeDeclarationEffectChannels } from "./poc/dist/language/declarations.js";
    import { checkEmittedProject } from "./poc/dist/language/generated-check.js";
    const sources = [
      {fileName:resolve("dep.mjs"),code:'export const answer: 42 = 42;'},
      {fileName:resolve("main.mjs"),code:'import {answer} from "./dep.mjs"; export function read(): 42 { return answer; }',effects:{read:{failures:[],requirements:[]}}},
    ];
    const result = emitProjectDeclarations(sources);
    assert.equal(result.ok,true,JSON.stringify(result.diagnostics));
    assert.equal(result.outputs.length,2);
    assert.deepEqual(checkEmittedProject([...result.outputs,{fileName:resolve("consumer.mts"),code:'import {read} from "./main.mjs"; export const n: 42 = read();'}]),[]);
    assert.deepEqual(readDeclarationEffects(result.outputs.find(file=>file.fileName.endsWith("main.d.mts")).code).read,{failures:[],requirements:[]});
    const text = 'import {Result} from "sdk"; export declare function f(): Result<string, never> | Result<never, Error>;';
    const rows = {f:{failures:["Error"],requirements:[]}};
    assert(normalizeDeclarationEffectChannels(text,rows,"main.d.mts","sdk").includes("Result<string, Error>"));
    assert.deepEqual(readDeclarationEffects(annotateDeclarationEffects(text,rows)).f,rows.f);
    const bad = emitProjectDeclarations([{fileName:resolve("bad.mjs"),code:'export const n: number = "bad";'}]);
    assert.equal(bad.ok,false);assert.deepEqual(bad.outputs,[]);assert.equal(bad.diagnostics[0].code,"TS2322");
    assert.equal(typeof bad.diagnostics[0].file,"string");
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test("packaged native executable tampering is rejected before launch", (t) => {
  const temporary = isolatedCompiler(t);
  appendFileSync(join(temporary, nativeDirectory, nativeName), "changed");
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { NativeTypeScriptCompiler } from "./poc/dist/agent/compiler.js";
    assert.throws(() => new NativeTypeScriptCompiler(), /digest mismatch/);
  `);
  assert.equal(result.status, 0, result.stderr);
});

test("installed syntax-schema derivation and validation need no compiler-library dependency", (t) => {
  const temporary = isolatedCompiler(t);
  const source = String.raw`type T = { z: number; "\ud800": "\udfff"; "__proto__": string; a: boolean }`;
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { deriveSchema, parseWithSchema, ValidationFailure } from "./poc/dist/build/schema.js";
    import { getNativeCompiler } from "./dist/compiler.js";
    const schema = deriveSchema(${JSON.stringify(source)}, "T");
    const key = String.fromCharCode(0xd800), literal = String.fromCharCode(0xdfff);
    assert.deepEqual(Object.keys(schema.properties), ["z", key, "__proto__", "a"]);
    assert.equal(Object.getPrototypeOf(schema.properties), null);
    assert(Object.isFrozen(schema.properties[key].schema));
    const input = Object.create(null);
    input.z = 42; input[key] = literal; input.__proto__ = "data"; input.a = true;
    const output = parseWithSchema(schema, input);
    assert.equal(output[key], literal);
    assert(Object.hasOwn(output, "__proto__"));
    assert.equal(output.__proto__, "data");
    assert.throws(() => parseWithSchema(schema, {}), error => error instanceof ValidationFailure && error.message.includes("$input.z"));
    assert.throws(() => deriveSchema('import type { Array } from "missing"; type T = Array<string>', "T"), /cannot resolve/);
    assert.throws(() => deriveSchema("type T = { x: }", "T"), SyntaxError);
    assert.equal(getNativeCompiler().syntaxSchema("type T = string[]", "T").ok, true);
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test("installed checked schemas resolve an explicit type closure with no JS compiler or filesystem dependencies", (t) => {
  const temporary = isolatedCompiler(t, {runtime:true});
  for (const name of ["schema-derive", "schema-runtime"]) {
    copyFileSync(join(root, `poc/dist/build/${name}.js`), join(temporary, `poc/dist/build/${name}.js`));
  }
  const source = 'import type {Item} from "./types.vibe"; const value=derive<Item>()';
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { deriveSchemaDescriptors } from "./poc/dist/build/schema-derive.js";
    import { __vsSchema } from "./poc/dist/build/schema-runtime.js";
    import { getNativeCompiler } from "./dist/compiler.js";
    const source = ${JSON.stringify(source)};
    const request = {files:[{path:"main.vibe",text:source,scriptKind:"typescript"},
      {path:"types.vibe",text:"export type Item={count:number}",scriptKind:"typescript"}],modules:{},
      queries:[{file:"main.vibe",span:{start:source.indexOf("derive<Item>()"),length:14}}]};
    const native=getNativeCompiler().checkedSchemas(request);
    assert.equal(native.schemas[0].ok,true,JSON.stringify(native));
    const derived=deriveSchemaDescriptors(request);
    const validator=__vsSchema(derived.schemas[0].descriptor);
    assert.deepEqual(validator.parse({count:42}).unwrap(),{count:42});
    assert.equal(validator.parse({count:"bad"}).isError(),true);
    assert.match(derived.identity,/^[a-f0-9]{64}$/);
    request.files[1].text="export type Item=unknown";
    assert.equal(deriveSchemaDescriptors(request).schemas[0].error.failure,"unsupported");
  `);
  assert.equal(result.error,undefined);
  assert.equal(result.status,0,result.stderr);
});

test("installed native source recovery needs no JavaScript parser, Go toolchain, or dependencies", (t) => {
  const temporary = isolatedCompiler(t);
  const source = "// 🐱\nif(const x='😀';x){use(x)}";
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { getNativeCompiler } from "./dist/compiler.js";
    import { recoverVibeLangSyntax, scanTokens } from "./poc/dist/language/recover.js";
    const source = ${JSON.stringify(source)};
    const facts = getNativeCompiler().recoverSource(source);
    const recovered = recoverVibeLangSyntax(source);
    assert.equal(recovered.changed,true);
    assert.equal(recovered.parseSource,facts.code);
    assert.equal(recovered.toAuthored(recovered.parseSource.indexOf("use(x)")),source.indexOf("use(x)"));
    assert.equal(scanTokens(source).find(token=>token.text==="'😀'").kind,"StringLiteral");
    assert.equal(recoverVibeLangSyntax("if(var x=1;x){}").diagnostics[0].code,"VIBE1717");
  `);
  assert.equal(result.error,undefined);
  assert.equal(result.status,0,result.stderr);
});

test("installed comptime phase uses native evaluation and explicit text inputs without compiler dependencies", (t) => {
  const temporary=isolatedCompiler(t);
  const source='import {comptime,embed} from "vibelang:comptime";const value=comptime(()=>{const shared={n:42};return {z:shared,a:shared,text:embed("./data.txt")}})();';
  const result=execute(temporary,`
    import assert from "node:assert/strict";
    import { getNativeCompiler } from "./dist/compiler.js";
    import { decodeComptimeValue } from "./poc/dist/build/comptime-value.js";
    const compiler=getNativeCompiler();
    const request={files:[{path:"main.ts",text:${JSON.stringify(source)},scriptKind:"typescript"}],target:"test",schemaRuntimeImport:"bound:schema",inputs:[]};
    const missing=compiler.planComptime(request);
    assert.equal(missing.complete,false);
    assert.deepEqual(missing.reads.map(read=>read.specifier),["./data.txt"]);
    assert.deepEqual(missing.calls,[]);
    request.inputs.push({file:"main.ts",specifier:"./data.txt",text:"tracked",error:""});
    const plan=compiler.planComptime(request);
    assert.equal(plan.complete,true,JSON.stringify(plan));
    const value=decodeComptimeValue(JSON.parse(plan.calls[0].valueJson));
    assert.deepEqual(Object.keys(value),["z","a","text"]);
    assert.equal(value.z,value.a);
    assert.equal(value.z.n,42);
    assert.equal(value.text,"tracked");
  `);
  assert.equal(result.error,undefined);
  assert.equal(result.status,0,result.stderr);
});

test("installed comptime host lowers, caches and maps using only the native compiler", (t) => {
  const temporary = isolatedCompiler(t, { runtime: true, comptime: true });
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import {writeFileSync} from "node:fs";
    import {ComptimeCompiler} from "./poc/dist/build/comptime.js";
    import {compileComptimeIntrinsics} from "./poc/dist/build/comptime-intrinsic.js";
    import {getNativeCompiler} from "./dist/compiler.js";
    const root=process.cwd();
    const compiler=new ComptimeCompiler({root,cacheDirectory:root+"/cache",target:"test"});
    const source='// 🐱\\r\\nimport {comptime,embed} from "vibelang:comptime"; export const value=comptime(()=>{const shared={n:42};return {z:shared,a:shared,text:embed("./input.txt")}})();';
    writeFileSync("main.vibe",source);
    writeFileSync("input.txt","tracked");
    let previous;
    for(const cacheHit of [false,true]){
      const result=await compileComptimeIntrinsics({compiler,sources:{"main.vibe":source}});
      assert.deepEqual(result.diagnostics,[]);
      assert.equal(result.calls[0].build.cacheHit,cacheHit);
      assert.deepEqual(result.calls[0].build.dependencies.map(d=>d.path),["input.txt"]);
      assert.equal(result.calls[0].value.z,result.calls[0].value.a);
      const file=result.loweredFiles["main.vibe"];
      assert.equal(file.provenance.frontend,"vibelang-comptime-native@1");
      assert.deepEqual(JSON.parse(file.sourceMap).sourcesContent,[source]);
      const edit=file.provenance.edits.find(edit=>edit.kind==="intrinsic-call");
      assert.equal(edit.authored.start,source.indexOf("comptime(()"));
      const emitted=getNativeCompiler().transpile({files:[{path:"main.ts",text:file.code}],options:{target:"esnext",module:"esnext"}}).files[0];
      assert.equal(emitted.emitSkipped,false);
      assert.deepEqual(emitted.diagnostics,[]);
      const loaded=await import("data:text/javascript;base64,"+Buffer.from(emitted.javascript).toString("base64"));
      assert.equal(loaded.value.z,loaded.value.a);
      assert.equal(loaded.value.z.n,42);
      assert.equal(loaded.value.text,"tracked");
      assert.deepEqual(Object.keys(loaded.value),["z","a","text"]);
      if(previous) assert.equal(file.identity,previous);
      previous=file.identity;
    }
    const refused=await compileComptimeIntrinsics({compiler,sources:{"bad.ts":'export * from "vibelang:comptime";'}});
    assert.equal(refused.ok,false);
    assert(refused.diagnostics.some(issue=>issue.code==="VCT1006"));
    assert.equal(refused.loweredFiles,undefined);
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test("native transport identity covers the ordered graph decoder and its validator", (t) => {
  const temporary=isolatedCompiler(t);
  const readIdentity=()=>{
    const result=execute(temporary,'import {getNativeCompiler} from "./dist/compiler.js"; console.log(getNativeCompiler().transportDigest);');
    assert.equal(result.error,undefined);
    assert.equal(result.status,0,result.stderr);
    return result.stdout.trim();
  };
  const original=readIdentity();
  appendFileSync(join(temporary,"poc/dist/build/comptime-value.js"),"\n// graph decoder identity regression\n");
  const changedGraph=readIdentity();
  assert.notEqual(changedGraph,original);
  appendFileSync(join(temporary,"poc/dist/build/stable.js"),"\n// graph validator identity regression\n");
  assert.notEqual(readIdentity(),changedGraph);
});

test("installed native runtime-factory assembly needs no compiler-library dependency", (t) => {
  const temporary = isolatedCompiler(t);
  const source = `import { increment as bump } from "bound:runtime";
const __runtime = 39, __runtime_1 = 1;
let order = 0;
export default (order = 1);
export const entry = (n: number) => bump(__runtime + __runtime_1 + n + order);`;
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { getNativeCompiler } from "./dist/compiler.js";
    const compiler = getNativeCompiler();
    const factory = compiler.runtimeFactory({ source: ${JSON.stringify(source)}, entry: "entry", runtimeSpecifier: "bound:runtime" });
    assert.equal(factory.ok, true, factory.message);
    const load = new Function('"use strict"; return (' + factory.code + ');')();
    assert.equal(load({ increment: n => n + 1 })(0), 42);
    const refused = compiler.runtimeFactory({ source: 'export const entry = () => import("unbound");', entry: "entry", runtimeSpecifier: "bound:runtime" });
    assert.equal(refused.ok, false);
    assert.equal(refused.code, "");
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test("installed native Action contracts use Go checking and preserve their declared identity", (t) => {
  const temporary = isolatedCompiler(t);
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { getNativeCompiler } from "./dist/compiler.js";
    const compiler = getNativeCompiler();
    const source = 'import { Action } from "vibelang:flows"; class Failed extends Error { constructor(readonly code: string) { super(code) } }; export class Work extends Action<(input: number) => Result<string, Failed>> {}';
    const request = { source, fileName: "actions.vibe", exportName: "Work", id: "test/Work", version: 7 };
    const result = compiler.actionContract(request);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const descriptor = JSON.parse(result.contractJson);
    assert.equal(descriptor.id, "test/Work");
    assert.equal(descriptor.version, 7);
    assert.deepEqual(descriptor.inputSchema.descriptor, {kind:"number"});
    assert.deepEqual(descriptor.successSchema.descriptor, {kind:"string"});
    assert.equal(descriptor.errorSchema.descriptor.identity, "vibelang:actions.vibe@Failed@1");
    assert.deepEqual(compiler.actionContract(request), result);
    const refused = compiler.actionContract({...request, source: source.replace("input: number", "input: unknown")});
    assert.equal(refused.ok, false);
    assert.equal(refused.contractJson, "");
    assert(refused.diagnostics.some(item => item.code === "VIBE4203"));
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test("standalone Action contract API does not load a legacy checker through its validators", (t) => {
  const temporary = isolatedCompiler(t, { runtime: true });
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { compileActionContract, DurableContractCompiler, DurableCodecError, validateDurableValue } from "./poc/dist/durable/schema.js";
    import * as codecs from "./poc/dist/durable/schema-runtime.js";
    assert.equal(DurableCodecError, codecs.DurableCodecError);
    assert.equal(validateDurableValue, codecs.validateDurableValue);
    assert.equal(DurableContractCompiler.compile, compileActionContract);
    const source = 'import { Action } from "vibelang:flows"; class Café extends Error { constructor(readonly code: string) { super(code) } }; export class Work extends Action<(input: number) => Result<string, Café>> {}';
    const options = { fileName: "actions.vibe", exportName: "Work", id: "test/Work", version: 7 };
    const compiled = compileActionContract(source, options);
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    assert.equal(compiled.descriptor.errorSchema.descriptor.name, "Café");
    assert.equal(compiled.descriptor.id, options.id);
    assert.equal(compiled.descriptor.version, options.version);
    assert.equal(validateDurableValue(compiled.descriptor.inputSchema, 42), 42);
    assert.throws(() => validateDurableValue(compiled.descriptor.inputSchema, "bad"), DurableCodecError);
    assert.match(compiled.declaration, /run\\(input: number\\)/);
    const refused = compileActionContract(source.replace("input: number", "input: unknown"), options);
    assert.equal(refused.ok, false);
    assert(refused.diagnostics.some(issue => issue.code === "VIBE4203"));
    assert.equal("descriptor" in refused, false);
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test("public agent tools compile their contracts and generated programs with Go only", (t) => {
  const temporary = isolatedCompiler(t, { runtime: true });
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { compileActionTool, declareCallableSurface, NativeTypeScriptCompiler, ActionToolContractError } from "vibelang/agent";
    const source = 'import { Action } from "vibelang:flows"; export class Double extends Action<(input: number) => Result<number, never>> {}';
    const options = { source, exportName: "Double", id: "tool/Double", version: 1,
      implementationId: "tool/double-native", implementationVersion: "1" };
    let calls = 0;
    const double = compileActionTool(options, async n => { calls++; return n * 2; });
    const surface = declareCallableSurface({ double });
    assert(surface.includes("compiler-derived contract="));
    const compiler = new NativeTypeScriptCompiler();
    const compiled = await compiler.compile('export default async (f: Functions) => f.double(21)', surface);
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    const entry = await import('data:text/javascript;base64,' + Buffer.from(compiled.javascript).toString('base64'));
    assert.equal(await entry.default({ double: n => double.invoke(n, {}) }), 42);
    assert.equal(calls, 1);
    const bad = await compiler.compile('export default (f: Functions) => f.double("bad")', surface);
    assert.equal(bad.ok, false);
    assert(bad.diagnostics.some(issue => issue.code === 2345));
    assert.throws(() => compileActionTool({ ...options, source: source.replace("input: number", "input: unknown") }, async n => n), ActionToolContractError);
    assert.equal(calls, 1);
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test("durable data validation and executable loading need neither a compiler library nor a native binary", (t) => {
  const temporary = isolatedCompiler(t, { runtime: true, native: false });
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { existsSync } from "node:fs";
    import { Action } from "vibelang/durable/authoring";
    import { validatePlanTemplate } from "vibelang/durable/artifact";
    import { compileActionTool, ActionToolContractError, NativeTypeScriptCompiler } from "vibelang/agent";
    import { compileActionContract, DurableCodecError } from "./poc/dist/durable/schema.js";
    import { validateDurableValue, materializeDurableValue, decodeWorkerExit } from "./poc/dist/durable/schema-runtime.js";
    import { validateActionImplementationContract, ActionImplementationContractError } from "./poc/dist/durable/implementation-validation.js";
    import { loadDurableBody } from "./poc/dist/durable/body-artifact.js";
    import { digest, structuralSchema } from "./poc/dist/durable/value.js";
    assert.equal(existsSync("node_modules"), false);
    assert.equal(existsSync(${JSON.stringify(`${nativeDirectory}/${nativeName}`)}), false);
    const input = structuralSchema("input", {kind:"number"});
    const output = structuralSchema("success", {kind:"number"});
    const failure = structuralSchema("error", {kind:"never"});
    const contract = {id:"test/Number", version:1, inputSchema:input, successSchema:output, errorSchema:failure};
    const descriptor = {...contract, contractDigest:digest(contract)};
    assert.equal(Action.fromDescriptor(descriptor).descriptor.contractDigest, descriptor.contractDigest);
    assert.equal(validateDurableValue(input, 42), 42);
    assert.throws(() => validateDurableValue(input, -0), {name:"TypeError", message:"durable value is not durable JSON: negative zero"});
    const record = structuralSchema("input", {kind:"object", fields:[{name:"__proto__",optional:false,value:{kind:"number"}}]});
    const wire = validateDurableValue(record, JSON.parse('{"__proto__":42}'));
    assert.equal(Object.getPrototypeOf(wire), null);
    assert(Object.isFrozen(wire));
    const authored = materializeDurableValue(record, wire);
    assert.equal(Object.getPrototypeOf(authored), Object.prototype);
    assert(Object.hasOwn(authored, "__proto__"));
    authored.__proto__++;
    assert.equal(authored.__proto__, 43);
    assert.equal(wire.__proto__, 42);
    const route = {actionId:descriptor.id, schemas:{input,success:output,error:failure}};
    assert.deepEqual(decodeWorkerExit(route, {kind:"defect",defect:{name:"Failed",message:"reason",stack:"trace"}}, {label:"test",protocolDefectName:"ProtocolDefect"}),
      {kind:"defect",defect:{name:"Failed",message:"reason",stack:"trace"}});
    assert.equal(decodeWorkerExit(route, {kind:"success",value:"bad"}, {label:"test",protocolDefectName:"ProtocolDefect"}).defect.name, "SuccessCodecDefect");
    assert.throws(() => validateActionImplementationContract({}), ActionImplementationContractError);
    assert.throws(() => validatePlanTemplate({}), /[Ii]nvalid|[Pp]lan|[Ff]low/);
    const source = {fileName:"runtime.vibe",text:"export const entry = (n: number) => n + 1;"};
    const manifestData = {manifestVersion:1,flowId:"runtime/entry",flowVersion:1,actions:[],requirements:[],contracts:[],failures:[],sites:[]};
    const body = {bodyVersion:1,source,sourceIdentity:digest(source),manifest:{...manifestData,digest:digest(manifestData)},
      entry:"entry",javascript:"function(abi) { return n => n + 1; }",resumable:false,async:false,
      inputSchema:input,successSchema:output,failureSchema:failure,errors:[]};
    const loaded = loadDurableBody({...body,digest:digest(body)});
    assert.deepEqual(loaded.create(41).computation.next(), {done:true,value:42});
    assert.throws(() => loaded.create("bad"), DurableCodecError);
    const actionSource = 'import { Action } from "vibelang:flows"; export class Work extends Action<(n: number) => Result<number, never>> {}';
    const options = {exportName:"Work",id:"test/Work",version:1};
    const unavailable = compileActionContract(actionSource, options);
    assert.equal(unavailable.ok, false);
    assert.equal(unavailable.diagnostics[0].code, "VIBE4201");
    assert.match(unavailable.diagnostics[0].message, /native|packaged|manifest/i);
    assert.throws(() => compileActionTool({...options,source:actionSource}, n => n), ActionToolContractError);
    assert.throws(() => new NativeTypeScriptCompiler(), /native|packaged|manifest/i);
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test("installed CLI Go transport checks and emits without source checkout, Go or JS compiler", (t) => {
  const temporary = isolatedCompiler(t);
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { mkdirSync, writeFileSync } from "node:fs";
    import { dirname, resolve } from "node:path";
    import { pathToFileURL } from "node:url";
    import { invokeGoBackend } from "./dist/go-backend.js";
    process.env.VIBELANG_TYPESCRIPT_FORK = "/does-not-exist";
    process.env.VIBELANG_GO = "/does-not-exist/go";
    const files = [{ path: "main.vibe", kind: "vibelang", text:
      'class Failed extends Error {} function read(x: number): Result<number, Failed> { if (x < 0) throw new Failed("bad"); return x + 1; } export const answer = read(41).match({ok: x => x, error: () => 0});' }];
    const result = invokeGoBackend({ rootNames: ["main.vibe"], files, lowering: "internal", options: {} });
    assert.equal(result.emitSkipped, false, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.diagnostics, []);
    assert(result.artifacts.some(item => item.path === "main.js"));
    for (const artifact of result.artifacts) {
      const file = resolve("out", artifact.path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, Buffer.from(artifact.content, "base64"));
    }
    assert.equal((await import(pathToFileURL(resolve("out/main.js")).href)).answer, 42);
    const bad = invokeGoBackend({ rootNames: ["main.vibe"], files: [{...files[0], text:'export const answer: number = "bad";'}], lowering: "internal", options: {} });
    assert.equal(bad.emitSkipped, true);
    assert.deepEqual(bad.artifacts, []);
    assert(bad.diagnostics.some(item => item.code === "TS2322"));
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test("installed relative runtime graphs resolve, classify and execute with Go and no compiler library", (t) => {
  const temporary = isolatedCompiler(t);
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { mkdirSync, writeFileSync, realpathSync } from "node:fs";
    import { join, dirname } from "node:path";
    import { pathToFileURL } from "node:url";
    import { buildRelativeRuntimeGraph, transpileRelativeRuntimeGraph } from "./dist/relative-runtime-graph.js";
    mkdirSync("project");
    const root = realpathSync("project");
    const outDir = join(root, "out");
    const marker = "/** @module @throws {never} */";
    const source = 'import { value } from "./library.mjs"; export const result = value;';
    const fileName = join(root, "main.vibe");
    writeFileSync(fileName, source);
    writeFileSync(join(root, "library.mjs"), marker + '\\nimport { base } from "./dependency.js"; export const value = base + 1;');
    writeFileSync(join(root, "library.d.mts"), 'import type { Value } from "./types.js"; export declare const value: Value;');
    writeFileSync(join(root, "types.d.ts"), 'export type Value = number;');
    writeFileSync(join(root, "dependency.ts"), marker + '\\nexport const base: number = 41;');
    const options = { rootDir: root, outDir, vibelangSources: [{ fileName, source, bytes: Buffer.byteLength(source) }],
      vibelangOutputs: [{ sourceFileName: fileName, outputFileName: join(outDir, "main.mjs") }],
      budget: { maximumFileBytes: 1024 * 1024, maximumTotalBytes: 8 * 1024 * 1024, maximumFiles: 32 } };
    const graph = buildRelativeRuntimeGraph(options);
    assert.deepEqual(graph.diagnostics, []);
    assert.equal(graph.files.length, 2);
    assert.equal(graph.declarationSources.length, 2);
    const output = transpileRelativeRuntimeGraph(graph, { sourceMap: true });
    assert.deepEqual(output.diagnostics, []);
    for (const file of output.files) {
      mkdirSync(dirname(file.outputFileName), { recursive: true });
      writeFileSync(file.outputFileName, file.code);
      assert.deepEqual(JSON.parse(file.sourceMap).sourcesContent, [file.source]);
    }
    const entry = output.files.find(file => file.fileName.endsWith("library.mjs"));
    assert(entry);
    assert.equal((await import(pathToFileURL(entry.outputFileName).href)).value, 42);
    writeFileSync(join(root, "dependency.ts"), '// /** @module @throws {never} */\\nexport const base: number = 41;');
    const refused = buildRelativeRuntimeGraph(options);
    assert.deepEqual(refused.diagnostics.map(item => item.code), ["VIBE1510"]);
    assert(refused.diagnostics[0].fileName.endsWith("dependency.ts"));
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test("installed native transpilation erases trusted TypeScript without a compiler library or dependencies", (t) => {
  const temporary = isolatedCompiler(t);
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { getNativeCompiler } from "./poc/dist/compiler/native.js";
    const compiler = getNativeCompiler();
    const sources = [{ path: "runtime.ts", text: "export class Box { #value: number = 41; read() { return this.#value + 1 } }" }];
    const emitted = compiler.transpile({ files: sources, options: { module: "commonjs", target: "es2019", removeComments: true } });
    assert.equal(emitted.files[0].emitSkipped, false);
    assert.deepEqual(emitted.files[0].diagnostics, []);
    const output = {};
    new Function("exports", emitted.files[0].javascript)(output);
    assert.equal(new output.Box().read(), 42);
    const esm = compiler.transpile({ files: sources, options: { sourceMap: true, inlineSources: true } }).files[0];
    assert.equal(esm.emitSkipped, false);
    const module = await import("data:text/javascript;base64," + Buffer.from(esm.javascript).toString("base64"));
    assert.equal(new module.Box().read(), 42);
    assert.deepEqual(JSON.parse(esm.sourceMap).sourcesContent, [sources[0].text]);
    const bad = compiler.transpile({ files: [{ path: "bad.ts", text: "const value = ;" }] }).files[0];
    assert.equal(bad.emitSkipped, true);
    assert.equal(bad.javascript, "");
    assert.equal(bad.sourceMap, "");
    assert(bad.diagnostics.some(d => d.code === "TS1109" && d.phase === "parse"));
    assert.throws(() => compiler.transpile({ files: [{ path: "source.vibe", text: "export const value = 42" }] }), /checked internal lowering/);
    assert.throws(() => compiler.transpile({ files: sources, options: { noCheck: false } }), /not an emission control/);
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test("installed worker-module analysis binds registrations and seals the closure without compiler dependencies", (t) => {
  const temporary = isolatedCompiler(t);
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { getNativeCompiler } from "./poc/dist/compiler/native.js";
    const compiler = getNativeCompiler();
    const request = {
      runtimeSpecifier: "test:runtime", runtimeHelpers: ["__vsRegisterError"], registrationExport: "__vsRegisterError",
      files: [{ path: "main.ts", text: [
        'import { __vsRegisterError as register } from "test:runtime";',
        'import { value } from "./value.ts";',
        'class Failed extends Error {}',
        'function unrelated(register: Function) { register(Failed, "forged"); }',
        'register(Failed, "issued:Failed");',
        'export const answer = value;',
      ].join("\\n") }, { path: "value.ts", text: "export const value = 42;" }],
    };
    const valid = compiler.bundleModules(request);
    assert.deepEqual(valid.diagnostics, []);
    assert.deepEqual(valid.registrations, [{ path: "main.ts", className: "Failed", identity: "issued:Failed" }]);
    for (const extra of ['export * from "external";', 'require("external");', 'import("external");']) {
      const bad = compiler.bundleModules({ ...request, files: [{ ...request.files[0], text: request.files[0].text + extra }, request.files[1]] });
      assert(bad.diagnostics.some(d => d.path === "main.ts" && d.message.includes("imports external module")));
      assert.deepEqual(bad.registrations, []);
    }
    assert.throws(() => compiler.bundleModules({ ...request, files: [{ path: "../outside.ts", text: "" }] }), /escapes the virtual project/);
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test("installed function fingerprints use native parsing, erasure and printing without evaluating source", (t) => {
  const temporary = isolatedCompiler(t);
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { getNativeCompiler } from "./poc/dist/compiler/native.js";
    const compiler = getNativeCompiler();
    const plain = compiler.canonicalFunction("function work(value) { return value + 1; }");
    const typed = compiler.canonicalFunction("export default function work(value: number): number { return value + 1; }");
    assert.equal(plain.ok, true);
    assert.equal(typed.ok, true);
    assert.equal(plain.code, typed.code);
    assert.equal(new Function("return " + typed.code)()(41), 42);
    globalThis.probe = 0;
    const deferred = compiler.canonicalFunction("() => { globalThis.probe = 1; return 42; }");
    assert.equal(deferred.ok, true);
    assert.equal(globalThis.probe, 0);
    for (const source of ["42", "() => ;", "(() => 42)()", "function work() {}; work();"]) {
      const refused = compiler.canonicalFunction(source);
      assert.equal(refused.ok, false);
      assert.equal(refused.code, "");
      assert.notEqual(refused.message, "");
    }
    const withHelpers = compiler.canonicalFunction("function work(resource: Disposable) { using local = resource; return 42; }");
    assert.equal(withHelpers.ok, true);
    assert(withHelpers.code.includes("function work(resource)"));
    assert(withHelpers.code.includes("return 42"));
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test("installed native schema compilation and execution need no compiler library or runtime dependency", (t) => {
  const temporary = isolatedCompiler(t);
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { mkdirSync, writeFileSync } from "node:fs";
    import { dirname, resolve, sep } from "node:path";
    import { pathToFileURL } from "node:url";
    import { getNativeCompiler } from "./poc/dist/compiler/native.js";
    const source = [
      'import { comptime } from "vibelang:comptime";',
      'import { Schema } from "vibelang:schema";',
      'const S = comptime(Schema.derive<{ value: number }>());',
      'export function read(input: unknown): ReturnType<typeof S.parse> { return S.parse(input)!; }',
    ].join("\\n");
    const compiler = getNativeCompiler();
    const good = compiler.compile({ rootNames: ["main.vibe"], files: [{ path: "main.vibe", kind: "vibelang", text: source }], lowering: "internal" });
    assert.equal(good.emitSkipped, false, JSON.stringify(good.diagnostics));
    assert.deepEqual(good.diagnostics, []);
    for (const artifact of good.artifacts) {
      const target = resolve("output", artifact.path);
      assert(target.startsWith(resolve("output") + sep));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, Buffer.from(artifact.content, "base64"));
    }
    const module = await import(pathToFileURL(resolve("output/main.js")).href);
    assert.equal(module.read({ value: 42 }).unwrapOr({ value: 0 }).value, 42);
    assert.equal(module.read({ value: "wrong" }).match({ ok: () => "wrong", error: error => error.pointer }), "$.value");
    const bad = compiler.compile({ rootNames: ["main.vibe"], files: [{ path: "main.vibe", kind: "vibelang", text: source.replace("{ value: number }", "any") }], lowering: "internal" });
    assert.equal(bad.emitSkipped, true);
    assert.deepEqual(bad.artifacts, []);
    assert(bad.diagnostics.some(item => item.code === "VCT1204"));
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test("packaged native declared identity must match the executable", (t) => {
  const temporary = isolatedCompiler(t);
  const path = join(temporary, nativeDirectory, "manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.patchSeries = "0".repeat(64);
  writeFileSync(path, JSON.stringify(manifest));
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { NativeTypeScriptCompiler } from "./poc/dist/agent/compiler.js";
    assert.throws(() => new NativeTypeScriptCompiler(), /identity does not match/);
  `);
  assert.equal(result.status, 0, result.stderr);
});

test("installed loader registration needs no compiler library, dependencies, or checkout", (t) => {
  const temporary = isolatedCompiler(t);
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { looksLikeLoaderRegistration, recognizeLoaderRegistration } from "./poc/dist/build/loader-registration.js";
    const source = 'import { comptime as ct } from "vibelang:comptime"; const state = { value: 1 }; state.value = 42; export default ct.loader("yaml", () => state.value);';
    assert.equal(looksLikeLoaderRegistration(source), true);
    const good = recognizeLoaderRegistration({ fileName: "plugins/load.js", source });
    assert.equal(good.ok, true, JSON.stringify(good.diagnostics));
    assert.equal(good.identified, true);
    assert.equal(good.registration.type, "yaml");
    assert.match(good.registration.authoredDigest, /^[a-f0-9]{64}$/);
    assert.match(good.registration.sandboxDigest, /^[a-f0-9]{64}$/);
    const module = await import("data:text/javascript;base64," + Buffer.from(good.registration.sandboxSource).toString("base64"));
    assert.equal(module.default(), 42);
    const bad = recognizeLoaderRegistration({ fileName: "plugins/load.js", source: source.replace('"yaml"', '"*.yaml"') });
    assert.equal(bad.ok, false);
    assert.equal(bad.identified, true);
    assert.equal(bad.registration, undefined);
    assert.equal(bad.diagnostics[0].code, "VCT1307");
    assert.equal(bad.diagnostics[0].fileName, "plugins/load.js");
    const inert = recognizeLoaderRegistration({ fileName: "load.js", source: source + 'throw new Error("must not execute");' });
    assert.equal(inert.ok, true);
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test("native API version is one contract in the Go API and JS protocol binding", () => {
  const api = readFileSync(join(root, "compiler/api.go"), "utf8");
  const protocol = readFileSync(join(root, "poc/src/compiler/protocol.ts"), "utf8");
  assert.equal(api.match(/^const APIVersion = (\d+)$/m)?.[1], protocol.match(/^export const NATIVE_API_VERSION = (\d+)$/m)?.[1]);
  assert.match(api, /^const APIVersion = \d+$/m);
});

test("installed asset-output validation uses Go with no compiler library or dependencies", (t) => {
  const temporary = isolatedCompiler(t);
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { getNativeCompiler } from "./poc/dist/compiler/native.js";
    const compiler = getNativeCompiler();
    const key = "a".repeat(64);
    const good = compiler.validateAssetOutput({ source: 'import data from "./' + key + '.ts"; const value = { data: data }; export default value;', declaredLogicalKeys: [key] });
    assert.deepEqual(good, { ok: true, message: "", references: [key] });
    for (const source of ['export default (() => 42)();', 'export default { "__proto__": {} };', 'export default new Uint8Array(1000000000);']) {
      const refused = compiler.validateAssetOutput({ source, declaredLogicalKeys: [] });
      assert.equal(refused.ok, false);
      assert.notEqual(refused.message, "");
      assert.deepEqual(refused.references, []);
    }
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test("installed source-asset compilation uses the native parser and resolver without dependencies", (t) => {
  const temporary = isolatedCompiler(t);
  const result = execute(temporary, `
    import assert from "node:assert/strict";
    import { mkdirSync, writeFileSync, realpathSync } from "node:fs";
    import { resolve } from "node:path";
    import { getNativeCompiler } from "./poc/dist/compiler/native.js";
    import { AssetCompiler } from "./poc/dist/build/assets.js";
    import { compileSourceAssetModules } from "./poc/dist/build/source-assets.js";
    mkdirSync("project");
    const root = realpathSync("project");
    writeFileSync(resolve(root, "data.json"), '{"value":42}');
    writeFileSync(resolve(root, "helper.ts"), 'throw new Error("must not execute"); export const x = 1;');
    const compiler = new AssetCompiler({ root, cacheDirectory: resolve(root, ".cache") });
    const source = 'import data from "./data.json" with {type:"json"}; export function value() { if (const x = data.value; x > 0) { return x; } return 0; }';
    const good = await compileSourceAssetModules({ compiler, sources: [{fileName:"main.vibe", source}] });
    assert.equal(good.ok, true, JSON.stringify(good.diagnostics));
    assert.equal(good.modules.length, 1);
    const emitted = getNativeCompiler().compile({ rootNames:["data.ts"], files:[{path:"data.ts",kind:"typescript",text:good.modules[0].source}], lowering:"typescript" });
    assert.equal(emitted.emitSkipped, false, JSON.stringify(emitted.diagnostics));
    const javascript = emitted.artifacts.find(item => item.path === "data.js");
    assert(javascript);
    const module = await import("data:text/javascript;base64," + javascript.content);
    assert.equal(module.default.value, 42);
    const replay = await compileSourceAssetModules({ compiler, sources: [{fileName:"main.vibe", source}] });
    assert.equal(replay.modules[0].cacheHit, true);
    assert.equal(replay.modules[0].contentKey, good.modules[0].contentKey);
    const braceless = await compileSourceAssetModules({ compiler, sources: [{fileName:"braceless.vibe", source:source.replace("{ return x; }", "return x;")}] });
    assert.equal(braceless.ok, false);
    assert.deepEqual(braceless.modules, []);
    assert.deepEqual(braceless.diagnostics.map(item => item.code), ["VIBE1717"]);
    const conflict = await compileSourceAssetModules({ compiler, sources: [{fileName:"other.vibe", source:'import {x} from "./helper.js"; import text from "./helper.ts" with {type:"text"};'}] });
    assert.equal(conflict.ok, false);
    assert.deepEqual(conflict.modules, []);
    assert(conflict.diagnostics.some(item => item.code === "VIBE5215"));
    const bad = await compileSourceAssetModules({ compiler, sources: [{fileName:"bad.vibe", source:'if (const x = 1; x) {}\\nimport data from "./data.json";'}] });
    assert.deepEqual(bad.diagnostics.map(({code,line,column}) => ({code,line,column})), [{code:"VIBE5201",line:2,column:1}]);
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});
