import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const packagePath = require.resolve("vibelang/package.json");
const packageMetadata = JSON.parse(readFileSync(packagePath, "utf8"));
const isBun = typeof globalThis.Bun === "object";
const loaded = new Map();

/**
 * Subpaths that only a Bun runtime can evaluate. Each names a module whose body
 * touches a Bun-only global, so Node must fail closed on it rather than expose a
 * half-initialized namespace. The platform-neutral half of each subsystem lives
 * on its own subpath (`vibelang/agent`, `vibelang/durable`, and
 * `vibelang/concurrency`).
 */
const bunOnlyExports = new Map([
  ["./agent/bun", {
    reason: "SQLite agent journal and durable Flow tools",
    recognize: (error) =>
      error?.code === "ERR_UNSUPPORTED_ESM_URL_SCHEME" || /bun:sqlite|URL scheme/i.test(String(error)),
  }],
  ["./durable/bun", {
    reason: "durable executor",
    recognize: (error) =>
      error?.code === "ERR_UNSUPPORTED_ESM_URL_SCHEME" || /bun:sqlite|URL scheme/i.test(String(error)),
  }],
  ["./concurrency/bun", {
    reason: "typed worker host",
    recognize: (error) => error instanceof ReferenceError && /\bBun\b/.test(String(error)),
  }],
]);

for (const exportName of Object.keys(packageMetadata.exports).sort()) {
  const specifier = exportName === "." ? "vibelang" : `vibelang${exportName.slice(1)}`;
  if (exportName === "./package.json") {
    assert.equal(require(specifier).name, "vibelang");
    continue;
  }
  if (bunOnlyExports.has(exportName) && !isBun) {
    const { reason, recognize } = bunOnlyExports.get(exportName);
    let rejected = false;
    try {
      await import(specifier);
    } catch (error) {
      rejected = recognize(error);
    }
    assert.equal(rejected, true, `Node must reject the explicitly Bun-only ${reason}`);
    continue;
  }
  const namespace = await import(specifier);
  assert.equal(typeof namespace, "object", `${specifier} did not produce a module namespace`);
  loaded.set(exportName, namespace);
}

const runtime = loaded.get("./runtime");
const nativeApi = loaded.get("./compiler");
assert.equal(loaded.get("."), nativeApi);
assert.equal("createProgram" in nativeApi, false);
const native = nativeApi.getNativeCompiler();
// Use the installed CLI under the current Node OR Bun host. No checkout,
// compiler-library import, reference runtime or SDK substitute for `plan`.
function inspectKeyedSourceWithCli(request) {
  const directory=mkdtempSync(join(tmpdir(),"vibelang-installed-plan-"));
  try {
    const entry=join(directory,request.fileName),input=join(directory,"input.json"),providers=join(directory,"providers.json"),output=join(directory,"inspected.plan.json");
    for(const file of [{fileName:request.fileName,source:request.source},...(request.dependencies??[])]) {
      const path=join(directory,file.fileName);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,file.source);
    }
    writeFileSync(input,request.inputJson);writeFileSync(providers,request.providersJson);
    const run=spawnSync(process.execPath,[join(dirname(packagePath),"bin/vibe.js"),"plan",entry,"--rootDir",directory,
      "--input",input,"--providers",providers,"--planId",request.planId,"--flowId",request.flowId,"--flowVersion",String(request.flowVersion),
      ...(request.exportName===undefined?[]:["--exportName",request.exportName]),"--outFile",output,"--format","json"],
      {cwd:directory,encoding:"utf8",timeout:15_000});
    assert.equal(run.error,undefined);assert.equal(run.signal,null);assert.equal(run.status,0,run.stderr||run.stdout);
    const report=JSON.parse(run.stdout),planJson=readFileSync(output,"utf8").trimEnd();
    assert.equal(report.ok,true);assert.equal(report.profile,"keyed");assert.equal("manifest" in report,false);
    assert.equal("approved" in report,false);assert.equal(planJson,JSON.stringify(report.plan));
    assert.equal(native.keyedPlan({operation:"verify",inputJson:planJson}).planJson,planJson);
    return planJson;
  } finally { rmSync(directory,{recursive:true,force:true}); }
}
assert.equal(native.identity.apiVersion, nativeApi.NATIVE_API_VERSION);
assert.match(native.identity.compilerVersion, /^7\./);
const nativeRequest = { rootNames: ["main.vibe"], files: [{ path: "main.vibe", kind: "vibelang", text: "export const answer: number = 42;" }], lowering: "internal" };
const nativeCompiled = native.compile(nativeRequest);
assert.equal(nativeCompiled.emitSkipped, false, JSON.stringify(nativeCompiled.diagnostics));
const nativeEntry = nativeCompiled.artifacts.find(item => item.path === "main.js");
assert(nativeEntry);
assert.equal((await import("data:text/javascript;base64," + nativeEntry.content)).answer, 42);
const nativeRefused = native.compile({ ...nativeRequest, files: [{ ...nativeRequest.files[0], text: 'export const answer: number = "bad";' }] });
assert.equal(nativeRefused.emitSkipped, true);
assert.deepEqual(nativeRefused.artifacts, []);
assert(nativeRefused.diagnostics.some(item => item.code === "TS2322"));
// The installed compiler owns Plan identity and verification too. No reference
// library or build-time checkout is available in this consumer environment.
const keyedDraft = { id: "a", material: { version: "flows/key-material/v2", kind: "sealed", body: { action: "example/A" }, inputs: [], layers: [], capabilities: [] },
  effects: { reads: [], writes: [], boundaryMode: "hard" } };
const keyed = native.keyedPlan({ operation: "compile", inputJson: JSON.stringify({ planId: "alpha-contract", flow: "example/Flow", nodes: [keyedDraft] }) });
assert.equal(keyed.ok, true, keyed.message);
const keyedArtifact = JSON.parse(keyed.planJson);
assert.equal(keyedArtifact.digest, "key1_650cd51f7b4f802e269efe2b3afc7592d26646d914f39d1edd36f81cdde7dfe6");
assert.equal(native.keyedPlan({ operation: "verify", inputJson: keyed.planJson }).planJson, keyed.planJson);
const elaborated = native.keyedPlan({ operation: "append", inputJson: JSON.stringify({ plan: keyedArtifact, nodes: [{ ...keyedDraft, id: "b",
  material: { ...keyedDraft.material, body: 2, inputs: [{ _tag: "Ref", from: "a", path: [] }] } }] }) });
assert.equal(elaborated.ok, true, elaborated.message);
const elaboratedArtifact = JSON.parse(elaborated.planJson);
assert.deepEqual(elaboratedArtifact.nodes[0], keyedArtifact.nodes[0]);
assert.equal(elaboratedArtifact.baseDigest, keyedArtifact.baseDigest);
assert.equal(elaboratedArtifact.generation, 1);
assert.notEqual(elaboratedArtifact.digest, keyedArtifact.digest);
keyedArtifact.nodes[0].priority++;
const tamperedPlan = native.keyedPlan({ operation: "verify", inputJson: JSON.stringify(keyedArtifact) });
assert.equal(tamperedPlan.ok, false);
assert.equal(tamperedPlan.errorCode, "invalid_plan");
assert.equal(tamperedPlan.planJson, "");
const keyedSourceRequest = { fileName: "installed.vibe", flowId: "installed/Flow", flowVersion: 1, planId: "installed/plan", inputJson: "41",
  source: 'import {Action,durable} from "vibelang:flows";class Work extends Action<(n:number)=>Result<number,never>>{};export const Flow=durable((n:number)=>{const a=Work.run(n)!;const b=Work.run(n)!;return {b,a}})',
  providersJson: JSON.stringify([{actionId: "installed.vibe#Work", implementationId: "work/v1", implementationDigest: "a".repeat(64),
    tier: "sealed", effects: {boundaryMode: "hard", reads: [], writes: []}, layers: [], capabilities: []}]) };
const keyedSource = native.compileKeyedPlanSource(keyedSourceRequest);
assert.equal(keyedSource.ok, true, JSON.stringify(keyedSource.diagnostics));
assert.equal(native.keyedPlan({operation: "verify", inputJson: keyedSource.planJson}).planJson, keyedSource.planJson);
const keyedSourcePlan = JSON.parse(keyedSource.planJson);
assert.equal(keyedSourcePlan.nodes.length, 3);
assert.deepEqual(keyedSourcePlan.nodes[0].dependsOn, []);
assert.deepEqual(keyedSourcePlan.nodes[1].dependsOn, []);
assert.equal(keyedSourcePlan.nodes[0].material.body.contract.id, "installed.vibe#Work");
const missingProvider = native.compileKeyedPlanSource({...keyedSourceRequest, providersJson: "[]"});
assert.equal(missingProvider.ok, false);
assert.equal(missingProvider.planJson, "");
const nativeDurableSource = 'import { durable } from "vibelang:flows"; function helper(n: number) { return n * 2 } export const Flow = durable(helper);';
const nativeDurableFacts = native.durableModule(nativeDurableSource);
assert.deepEqual(nativeDurableFacts.diagnostics, []);
assert.equal(nativeDurableFacts.calls.length, 1);
assert.equal(nativeDurableFacts.removals.length, 1);
assert.equal(nativeDurableSource.slice(nativeDurableFacts.calls[0].start, nativeDurableFacts.calls[0].start + nativeDurableFacts.calls[0].length), "durable(helper)");
const nativeSchema = native.syntaxSchema('type T = { z: number; a: string }', "T");
assert.equal(nativeSchema.ok, true, nativeSchema.message);
assert.deepEqual(Object.keys(JSON.parse(nativeSchema.schemaJson).properties), ["z", "a"]);
const checkedSchemas = native.checkedSchemas({files:[{path:"main.ts",text:"derive<number>()",scriptKind:"typescript"}],modules:{},queries:[{file:"main.ts",span:{start:0,length:16}}]});
assert.equal(checkedSchemas.schemas[0].ok,true,JSON.stringify(checkedSchemas));
assert.deepEqual(JSON.parse(checkedSchemas.schemas[0].schemaJson),{kind:"number"});
const recovered = native.recoverSource("if(const x=1;x){}");
assert.equal(recovered.changed,true);
assert.equal(recovered.code,"{ const x=1; if (x){} }");
assert.equal(recovered.tokens[0].kind,"IfKeyword");
const comptimePlan=native.planComptime({files:[{path:"main.ts",text:'import {comptime} from "vibelang:comptime";const value=comptime(40+2);',scriptKind:"typescript"}],target:"test",schemaRuntimeImport:"bound:schema",inputs:[]});
assert.equal(comptimePlan.complete,true,JSON.stringify(comptimePlan));
assert.equal(JSON.parse(comptimePlan.calls[0].valueJson).root,42);
const nativeFactory = native.runtimeFactory({ source: "const __runtime = 41; export default 0; export const entry = (n: number) => n + __runtime;", entry: "entry", runtimeSpecifier: "bound:runtime" });
assert.equal(nativeFactory.ok, true, nativeFactory.message);
assert.equal(new Function('"use strict"; return (' + nativeFactory.code + ');')()({})(1), 42);
const nativeAction = native.actionContract({ source: 'import { Action } from "vibelang:flows"; export class Work extends Action<(input: number) => Result<string, never>> {}', fileName: "actions.vibe", exportName: "Work", id: "test/Work", version: 1 });
assert.equal(nativeAction.ok, true, JSON.stringify(nativeAction.diagnostics));
assert.deepEqual(JSON.parse(nativeAction.contractJson).inputSchema.descriptor, { kind: "number" });
const checkedFunction = native.checkedFunction({ files: [{path:"work.vibe",kind:"vibelang",text:"export function work(n: number): Result<number, never> { return n + 1; }"}], entryFile:"work.vibe", exportName:"work" });
assert.equal(checkedFunction.ok, true, JSON.stringify(checkedFunction));
assert.deepEqual(checkedFunction.function.typedFailures, []);
assert.deepEqual(JSON.parse(checkedFunction.function.failureSchemaJson).descriptor, {kind:"never"});
assert.equal(checkedFunction.function.valueSchemasJson, "");
const checkedProvider = native.checkedFunction({ files: [{path:"work.vibe",kind:"vibelang",text:"export async function work(n: number): Promise<number> { return n + 1; }"}], entryFile:"work.vibe", exportName:"work", durableBoundary:true });
assert.equal(checkedProvider.ok,true,JSON.stringify(checkedProvider));
assert.equal(JSON.parse(checkedProvider.function.valueSchemasJson).completion,"promise");
assert.deepEqual(JSON.parse(checkedProvider.function.valueSchemasJson).successSchema.descriptor,{kind:"number"});
const nativeConfig = native.validateConfig({path:"tsconfig.json",text:'{"compilerOptions":{}}'});
const nativeGenerated = native.checkGeneratedProject({files:[{path:"/project/main.ts",text:"export const answer: number = 42;"}],currentDirectory:"/project",diskDependencies:false});
const nativeLiteral = native.inspect([{path:"editor.vibe",text:"import('x')",scriptKind:"typescript"}]).files[0].moduleSyntax[0];
assert.deepEqual(nativeLiteral.specifierSpan,{start:7,length:3});
assert.equal(nativeLiteral.specifierKind,"string");
assert.deepEqual(nativeGenerated.diagnostics, []);
const nativeBodyContract = native.bodyContract({project:{files:[{path:"/project/flow.ts",text:"export const Flow = (n: number) => n + 1"}],currentDirectory:"/project",diskDependencies:false},entryFile:"/project/flow.ts",entry:"Flow",logicalFileName:"flow.vibe",runtimeSpecifier:"vibelang/runtime",resumable:false,async:false});
assert.equal(nativeBodyContract.ok,true,JSON.stringify(nativeBodyContract));
assert.deepEqual(JSON.parse(nativeBodyContract.schemasJson).successSchema.descriptor,{kind:"number"});
const nativeDeclarationText = native.declarationText({operation:"annotate",path:"/project/main.d.ts",text:"export declare function read(): 42;",effects:{read:{failures:[],requirements:[]}}});
assert.deepEqual(native.declarationText({operation:"read",path:"/project/main.d.ts",text:nativeDeclarationText.text}).effects.read,{failures:[],requirements:[]});
const nativeDeclarations = native.emitGeneratedDeclarations({project:{files:[{path:"/project/main.mjs",text:"export const answer: 42 = 42;"}],currentDirectory:"/project",diskDependencies:false}});
assert.equal(nativeDeclarations.ok,true,JSON.stringify(nativeDeclarations.diagnostics));
assert.equal(nativeDeclarations.outputs[0].path,"/project/main.d.mts");
assert.match(nativeDeclarations.outputs[0].text,/answer: 42/);
assert.equal(nativeConfig.diagnostics.length, 6);
assert(nativeConfig.diagnostics.every(issue => issue.code === "VIBE6001" && issue.file === "tsconfig.json"));
const resultFacade = loaded.get("./result");
assert.equal(runtime.Result, resultFacade.Result);

// The specification withdrew `Optional<T>` and the portability pin on
// 2026-08-23. Absence is an ordinary `T | undefined` union and there is no
// second compilation target, so neither subpath may reach a consumer. This is
// the only gate that installs a real tarball, so it is the only place the
// withdrawal can be checked as a shipped fact rather than a source diff.
for (const withdrawn of ["./optional", "./targets"]) {
  assert.equal(loaded.has(withdrawn), false, `${withdrawn} is withdrawn but still exported`);
}
for (const withdrawn of ["Optional", "encodeOptional", "decodeOptional", "__vsOptionalSome"]) {
  assert.equal(withdrawn in runtime, false, `runtime still exports withdrawn ${withdrawn}`);
}

const stringCodec = Object.freeze({
  encode(value) {
    assert.equal(typeof value, "string");
    return value;
  },
  decode(value) {
    if (typeof value !== "string") throw new TypeError("expected string");
    return value;
  },
});
const resultWire = runtime.encodeResult(runtime.__vsResultSuccess("wire-ok"), stringCodec);
assert.equal(runtime.decodeResult(resultWire, stringCodec).match({ ok: (value) => value, error: () => "error" }), "wire-ok");
// Absence crosses the wire as the ordinary union it now is: a present value
// round-trips, and `undefined` stays `undefined` without a container.
const presentWire = runtime.encodeResult(runtime.__vsResultSuccess("present"), stringCodec);
assert.equal(runtime.decodeResult(presentWire, stringCodec).match({ ok: (value) => value, error: () => "error" }), "present");
assert.equal(undefined ?? "absent", "absent");

const language = loaded.get("./language");
const projectRoot = join(process.cwd(), "virtual-project");
const project = language.compileProject([
  {
    fileName: "service.vibe",
    source: [
      "export class Missing extends Error {}",
      "export function load(valid: boolean): Result<string, Missing> {",
      "  if (!valid) throw new Missing(\"missing\")",
      "  return \"release\"",
      "}",
    ].join("\n"),
  },
  {
    fileName: "main.vibe",
    source: [
      'import { load, type Missing } from "./service.vibe"',
      "export function run(): Result<string, Missing> { return load(true)! }",
    ].join("\n"),
  },
], {
  rootDir: projectRoot,
  outDir: join(projectRoot, "out"),
  outputExtension: ".mjs",
  runtimeImport: "vibelang/runtime",
  sourceMap: true,
});
assert.deepEqual(project.diagnostics, []);
assert.match(project.files["main.vibe"].code, /\.\/service\.mjs/);
assert.equal(typeof project.files["main.vibe"].sourceMap, "string");

const declarations = language.emitProjectDeclarations([{
  fileName: join(projectRoot, "declaration.ts"),
  code: "export const answer = 42 as const;",
}]);
assert.equal(declarations.ok, true, JSON.stringify(declarations.diagnostics));
assert.match(declarations.outputs[0].code, /answer: 42/);

const identityMap = (file, source, content) => JSON.stringify({
  version: 3,
  file,
  sources: [source],
  sourcesContent: [content],
  names: [],
  mappings: "AAAA",
});
const composedMap = JSON.parse(language.composeSourceMaps(
  identityMap("out.js", "lowered.ts", "const value = 1"),
  identityMap("lowered.ts", "authored.vibe", "const value = 1"),
  "out.js",
));
assert.deepEqual(composedMap.sources, ["authored.vibe"]);
assert.deepEqual(composedMap.sourcesContent, ["const value = 1"]);

const durableCompiler = loaded.get("./durable/source-compiler");
const durableArtifact = loaded.get("./durable/artifact");
const durable = loaded.get("./durable");
const keyedInterpreter = new durable.KeyedSourceInterpreter(keyedSource.planJson);
assert.equal(keyedInterpreter.prepare("action/0", []).input, 41);
assert.equal(keyedInterpreter.prepare("action/1", []).input, 41);
const keyedAnswer = keyedInterpreter.encodeSuccess("action/0", 42);
const keyedPrepared = keyedInterpreter.prepare("result", [
  {from: "action/1", path: [], value: keyedAnswer}, {from: "action/0", path: [], value: keyedAnswer},
]);
assert.equal(keyedPrepared.operation, "result");
assert.equal(JSON.stringify(durable.decodeKeyedValue(keyedPrepared.value)), '{"b":42,"a":42}');
const orderedKeyedValue = durable.encodeKeyedValue({z: 1, a: {y: 2, b: 3}});
assert.equal(JSON.stringify(durable.decodeKeyedValue(JSON.parse(durable.canonicalJson(orderedKeyedValue)))), '{"z":1,"a":{"y":2,"b":3}}');
assert.deepEqual(durable.keyedValuePath(["z", "0"]), ["items", "z", "items", "0"]);
assert.throws(() => keyedInterpreter.encodeSuccess("action/0", "wrong"));
assert.throws(() => keyedInterpreter.prepare("result", [{from: "action/0", path: [], value: 42}]));
const durableSource = [
  'import { durable as lower } from "vibelang:flows"',
  "export const Echo = lower(function Echo(input: { value: string }) {",
  "  return input.value",
  "})",
].join("\n");
const durableOptions = { fileName: "flows/echo.ts", flowId: "release/Echo", flowVersion: 1, actions: [] };
const durableResult = durableCompiler.compileDurableSource(durableSource, durableOptions);
assert.equal(durableResult.ok, true, JSON.stringify(durableResult.diagnostics));
assert.equal(durableArtifact.decodePlanArtifact(durableResult.artifact).digest, durableResult.plan.digest);
assert.equal(durable.compileDurableSource, durableCompiler.compileDurableSource);
// MIGRATION-PLAN.md §5 R2. The packed runtime is smoke-tested through the
// Manifest path as well as the Plan path, and the Manifest's published identity
// is re-derived from its own canonical bytes rather than read off the field —
// that is what `vibe plan --profile manifest-compat --outFile` publishes, so a
// packed build that broke it would be caught.
const manifestResult = durableCompiler.compileEffectManifest(durableSource, durableOptions);
assert.equal(manifestResult.ok, true, JSON.stringify(manifestResult.diagnostics));
assert.equal(manifestResult.manifest.flowId, "release/Echo");
assert.equal(manifestResult.manifest.manifestVersion, 1);
assert.deepEqual(manifestResult.manifest.actions, []);
assert.deepEqual(manifestResult.manifest.sites, []);
const { digest: declaredManifestDigest, ...manifestSemantic } = manifestResult.manifest;
assert.equal(durable.digest(manifestSemantic), declaredManifestDigest);
assert.equal(typeof durable.canonicalJson(manifestResult.manifest), "string");
assert.equal(durable.compileEffectManifest, durableCompiler.compileEffectManifest);
assert.equal(typeof durable.validateDurableSchema, "function");
assert.equal("waitSignal" in durable, false);
assert.equal(durable.MAX_DURABLE_JSON_NODES, 100_000);
const signingKeyPair = durable.generateDeploymentSigningKeyPair();
const verificationKey = durable.deploymentVerificationKey(signingKeyPair);
assert.equal(signingKeyPair.algorithm, "Ed25519");
assert.equal(verificationKey.algorithm, "Ed25519");
assert.equal(verificationKey.keyId, signingKeyPair.keyId);
assert.equal(verificationKey.publicKey, signingKeyPair.publicKey);
if (isBun) {
  const durableBun = loaded.get("./durable/bun");
  assert.equal(durableBun.compileDurableSource, durableCompiler.compileDurableSource);
  assert.equal(typeof durableBun.SignalDeliveryConflictError, "function");
  assert.equal(typeof durableBun.SignalDeliveryRejectedError, "function");
  assert.equal(typeof durableBun.DurableExecutor.prototype.deliverSignal, "function");
  assert.equal(typeof durableBun.DurableStore.prototype.deliverSignal, "function");
  assert.equal(typeof durableBun.DurableStore.prototype.pollSignal, "function");
  assert.equal(typeof durableBun.validateDurableSchema, "function");
  assert.equal(durableBun.MAX_DURABLE_JSON_NODES, durable.MAX_DURABLE_JSON_NODES);
  assert.equal("waitSignal" in durableBun, false);
}

const build = loaded.get("./build");
const comptimeCache = mkdtempSync(join(tmpdir(), "vibelang-release-comptime-"));
const comptimeCompiler = new build.ComptimeCompiler({
  root: process.cwd(),
  cacheDirectory: comptimeCache,
  target: isBun ? "bun" : "node",
});
const comptimeSource = `import { comptime as now } from "vibelang:comptime";
export const value = now({ release: true, count: 2 });
export const aliased = now(() => { const shared = { count: 2 }; return { left: shared, right: shared }; })();`;
let comptime;
try {
  comptime = await build.compileComptimeIntrinsics({
    compiler: comptimeCompiler,
    sources: { "release.vibe": comptimeSource },
  });
} finally {
  rmSync(comptimeCache, { recursive: true, force: true });
}
assert.equal(comptime.ok, true, JSON.stringify(comptime.diagnostics));
assert.equal(comptime.calls[0].value.count, 2);
assert.equal(comptime.calls[0].value.release, true);
// Program values preserve authored insertion order. Canonical sorting belongs
// to build metadata, not the observable value returned by comptime.
assert.deepEqual(Object.keys(comptime.calls[0].value), ["release", "count"]);
assert.equal(JSON.stringify(comptime.calls[0].value), '{"release":true,"count":2}');
assert.doesNotMatch(comptime.loweredSources["release.vibe"], /vibelang:comptime/);
const comptimeEmit = native.transpile({ files: [{path:"release.ts",text:comptime.loweredSources["release.vibe"]}],
  options: {target:"ESNext",module:"ESNext",sourceMap:false} });
assert.equal(comptimeEmit.files.length, 1);
assert.equal(comptimeEmit.files[0].emitSkipped, false);
assert.deepEqual(comptimeEmit.files[0].diagnostics, []);
const comptimeJavascript = comptimeEmit.files[0].javascript;
assert.equal(typeof comptimeJavascript, "string");
const comptimeLoaded = await import(`data:text/javascript;base64,${Buffer.from(comptimeJavascript).toString("base64")}`);
assert.equal(JSON.stringify(comptimeLoaded.value), '{"release":true,"count":2}');
assert.equal(comptime.calls.length, 2);
assert.equal(comptime.calls[1].value.left, comptime.calls[1].value.right);
assert.equal(comptime.calls[1].build.value.left, comptime.calls[1].build.value.right);
assert.equal(comptimeLoaded.aliased.left, comptimeLoaded.aliased.right);

const agent = loaded.get("./agent");
assert.equal("SqliteTurnJournal" in agent, false);
assert.equal("flowTool" in agent, false);
// Bundle emission must work from the real installed package, which has no
// checkout sources. Native Go checks the provider; explicit runtime source
// assets feed native emission. No callback supplies the executable behavior.
const sourceAction = keyedInterpreter.prepare("action/0", []).contract;
const sourceProviderOptions = { action: sourceAction, implementationId: "work/v1", implementationVersion: "1",
  entryFile: "provider.vibe", exportName: "work", sources: [{ fileName: "provider.vibe",
    source: "const state = { value: 0 }; state.value = 1; export function work(n: number): number { return n + state.value; }" }] };
const sourceProvider = durable.compileActionImplementationSourceContract(sourceProviderOptions);
const sourceBundle = durable.buildWorkerPoolBundle({poolId:"installed",target:"typescript-deno",sandbox:"deno-subprocess/no-permissions",
  valueCodec:"vibelang/keyed-source/v2",selections:[{action:sourceAction,contract:sourceProvider}]});
assert.equal(durable.validateWorkerPoolBundle(sourceBundle).digest,sourceBundle.digest);
assert.throws(()=>durable.validateWorkerPoolBundle({...sourceBundle,javascript:sourceBundle.javascript+"\n// tampered"}));
assert.throws(()=>durable.compileActionImplementationSourceContract({...sourceProviderOptions,sources:[{fileName:"provider.vibe",source:"export function work(n:number): string { return String(n); }"}]}));
const keyedRuntime = durable.createKeyedWorkerRuntime({timeoutMs:3000});
const keyedDeployment = durable.buildKeyedSourceDeployment({runtime:keyedRuntime,bundles:[sourceBundle],
  source:{source:keyedSourceRequest.source,fileName:keyedSourceRequest.fileName,flowId:keyedSourceRequest.flowId,flowVersion:1},
  providers:[{actionId:sourceAction.id,tier:"sealed",effects:{boundaryMode:"hard",reads:[],writes:[]},layers:[],capabilities:[]}]});
const signedKeyedSource = durable.encodeSignedKeyedSourceDeployment(keyedDeployment,signingKeyPair);
assert.throws(()=>durable.authenticateKeyedSourceDeployment(Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(signedKeyedSource)]),[verificationKey],keyedRuntime));
const authenticatedKeyedSource = durable.authenticateKeyedSourceDeployment(signedKeyedSource,[verificationKey],keyedRuntime);
const keyedInvocation = durable.compileAuthenticatedKeyedInvocation(authenticatedKeyedSource,{planId:"installed/plan-auth",inputJson:"41"});
assert.equal(keyedInvocation.executionDigest,keyedDeployment.executionDigest);
assert.equal(JSON.parse(keyedInvocation.planJson).planId,"installed/plan-auth");
assert.equal(JSON.parse(keyedInvocation.planJson).nodes[0].material.body.implementationDigest,sourceBundle.digest);
assert.equal(durable.restoreAuthenticatedKeyedInvocation(authenticatedKeyedSource,{planId:keyedInvocation.planId,inputJson:keyedInvocation.inputJson,planJson:keyedInvocation.planJson}).planDigest,keyedInvocation.planDigest);
const cliSourceRequest={...keyedSourceRequest,planId:keyedInvocation.planId,
  providersJson:JSON.stringify([{...JSON.parse(keyedSourceRequest.providersJson)[0],implementationDigest:sourceBundle.digest}])};
const cliPlanJson=inspectKeyedSourceWithCli(cliSourceRequest);
assert.equal(cliPlanJson,keyedInvocation.planJson);
const cliInvocation=durable.restoreAuthenticatedKeyedInvocation(authenticatedKeyedSource,
  {planId:keyedInvocation.planId,inputJson:keyedInvocation.inputJson,planJson:cliPlanJson});
// Valid inspection with a fabricated provider declaration is NOT executable
// authority: signing/restoration independently requires the actual bundle.
const fabricatedCliPlan=inspectKeyedSourceWithCli({...cliSourceRequest,providersJson:keyedSourceRequest.providersJson});
assert.notEqual(fabricatedCliPlan,cliPlanJson);
assert.throws(()=>durable.restoreAuthenticatedKeyedInvocation(authenticatedKeyedSource,
  {planId:keyedInvocation.planId,inputJson:keyedInvocation.inputJson,planJson:fabricatedCliPlan}));
const keyedApprovalOptions = {envelope:{capabilities:[],flows:[],budget:{}},deployClass:false};
const keyedTarget = durable.keyedInvocationApprovalTarget(keyedInvocation,keyedApprovalOptions);
// Approval is a JSON wire value. Its defensive snapshots intentionally have
// null prototypes; compare transported data, without weakening digest checks.
assert.deepEqual(JSON.parse(JSON.stringify(keyedTarget)),{_tag:"Plan",planId:keyedInvocation.planId,envelope:keyedApprovalOptions.envelope,
  digest:durable.digest({flowId:keyedSourceRequest.flowId,input:41,envelope:keyedApprovalOptions.envelope,deployClass:false,
    executionDigest:keyedDeployment.executionDigest,persistedPlan:keyedInvocation.planDigest})});
assert.equal("approved" in keyedTarget,false);
assert.throws(()=>durable.encodeSignedKeyedSourceDeployment({...keyedDeployment},signingKeyPair));
assert.throws(()=>durable.compileAuthenticatedKeyedInvocation({...authenticatedKeyedSource},{planId:"forged",inputJson:"41"}));
assert.throws(()=>durable.authenticateKeyedSourceDeployment(signedKeyedSource,[verificationKey],durable.createKeyedWorkerRuntime({timeoutMs:3001})));
assert.throws(()=>durable.compileAuthenticatedKeyedInvocation(authenticatedKeyedSource,{planId:"wrong-input",inputJson:'"wrong"'}));
// Source authentication and native Plan issuance do not imply approval.
assert.equal("approved" in keyedInvocation,false);
assert.equal(typeof durable.createAuthenticatedKeyedNodeWorker,"function");
assert.throws(()=>durable.createAuthenticatedKeyedNodeWorker({...keyedInvocation}));
const installedWorker=durable.createAuthenticatedKeyedNodeWorker(cliInvocation);
const installedWork={node:JSON.parse(keyedInvocation.planJson).nodes[0],attempt:1,
  boundary:{boundaryMode:"hard",readSet:[],writeSet:[]},inputs:[]};
await assert.rejects(installedWorker.execute({...installedWork,node:{...installedWork.node,priority:999}}));
const installedWorkerExit=await installedWorker.execute(installedWork);
assert.equal(installedWorkerExit.kind,"success",JSON.stringify(installedWorkerExit));
assert.equal(durable.decodeKeyedValue(installedWorkerExit.value),42);
const installedAbort=new AbortController();installedAbort.abort();
assert.deepEqual(await installedWorker.execute(installedWork,{signal:installedAbort.signal}),{kind:"interrupted"});
const modularSource = {fileName:"module-entry.vibe",flowId:"installed/ModularFlow",flowVersion:1,
  source:'import {durable} from "vibelang:flows";import {Work} from "./module-api";export const Flow=durable((n:number)=>{return Work.run(n)!});',
  dependencies:[{fileName:"installed.vibe",source:'import {Action} from "vibelang:flows";export class Work extends Action<(n:number)=>Result<number,never>>{}'},
    {fileName:"module-api.vibe",source:'export {Work} from "./installed";'}]};
const modularDeployment = durable.buildKeyedSourceDeployment({runtime:keyedRuntime,bundles:[sourceBundle],source:modularSource,
  providers:[{actionId:sourceAction.id,tier:"sealed",effects:{boundaryMode:"hard",reads:[],writes:[]},layers:[],capabilities:[]}]});
const modularProof = durable.authenticateKeyedSourceDeployment(durable.encodeSignedKeyedSourceDeployment(modularDeployment,signingKeyPair),[verificationKey],keyedRuntime);
const modularInvocation = durable.compileAuthenticatedKeyedInvocation(modularProof,{planId:"installed/modules",inputJson:"41"});
const modularInterpreter = new durable.KeyedSourceInterpreter(modularInvocation.planJson);
assert.match(modularInterpreter.source.projectDigest,/^[0-9a-f]{64}$/);
assert.equal(modularInterpreter.prepare("action/0",[]).contract.id,sourceAction.id);
assert.equal(durable.restoreAuthenticatedKeyedInvocation(modularProof,{planId:modularInvocation.planId,inputJson:"41",planJson:modularInvocation.planJson}).planDigest,modularInvocation.planDigest);
assert.throws(()=>durable.buildKeyedSourceDeployment({runtime:keyedRuntime,bundles:[sourceBundle],
  source:{...modularSource,dependencies:[]},providers:modularDeployment.providers.map(({actionId,tier,effects,layers,capabilities})=>({actionId,tier,effects,layers,capabilities}))}));
const installedInterpreter = modularInterpreter;
const installedPrepared = installedInterpreter.prepare("action/0",[]);
assert.equal(installedPrepared.implementationDigest,sourceBundle.digest);
const installedInvocation = {actionId:sourceAction.id,actionVersion:sourceAction.version,actionContractDigest:sourceAction.contractDigest,input:durable.encodeKeyedValue(installedPrepared.input)};
const installedDriver = `\nexport default function (_functions,inspection) { return __vibelangInvokeKeyedAction(${JSON.stringify(installedInvocation)},inspection); }\n`;
const installedSandbox = new agent.DenoSubprocessSandbox({timeoutMs:3000,runtimeValueInspection:true});
const installedExecution = await installedSandbox.execute(sourceBundle.javascript+installedDriver,{}, {sourceDigest:sourceBundle.digest,turnId:"installed-provider"});
assert.equal(installedExecution.ok,true,JSON.stringify(installedExecution.error));
assert.equal(installedExecution.result.kind,"success");
assert.equal(durable.decodeKeyedValue(installedExecution.result.value),42);
const installedAnswer = installedInterpreter.encodeSuccess("action/0",durable.decodeKeyedValue(installedExecution.result.value));
assert.equal(installedAnswer,42);
assert.equal(installedInterpreter.prepare("result",[{from:"action/0",path:[],value:installedAnswer}]).value,42);
// Installed source fan-out is a fully published graph, not a callback invoked
// to discover work. Execute each provider directly below only as a package
// consumer check; this is not scheduler admission, approval or crash recovery.
const fanOutDeployment=durable.buildKeyedSourceDeployment({runtime:keyedRuntime,bundles:[sourceBundle],
  source:{...modularSource,source:'import {durable,fanOut} from "vibelang:flows";import {Work} from "./module-api";const Child=durable((items:readonly number[]):Result<readonly number[],never>=>{return items});const Item=durable((n:number):Result<number,never>=>{return Work.run(n)!});export const Flow=durable((input:readonly number[])=>{const items=Child.run(input)!;return fanOut(items,n=>n,(n:number):Result<number,never>=>{return Item.run(n)!})});'},
  providers:[{actionId:sourceAction.id,tier:"sealed",effects:{boundaryMode:"hard",reads:[],writes:[]},layers:[],capabilities:[]}]});
const fanOutProof=durable.authenticateKeyedSourceDeployment(durable.encodeSignedKeyedSourceDeployment(fanOutDeployment,signingKeyPair),[verificationKey],keyedRuntime);
const fanOutInvocation=durable.compileAuthenticatedKeyedInvocation(fanOutProof,{planId:"installed/fanout",inputJson:"[41,2]"});
const fanOutInterpreter=new durable.KeyedSourceInterpreter(fanOutInvocation.planJson);
assert.equal(fanOutInterpreter.nodes.length,3);
assert.equal(durable.restoreAuthenticatedKeyedInvocation(fanOutProof,{planId:fanOutInvocation.planId,inputJson:fanOutInvocation.inputJson,planJson:fanOutInvocation.planJson}).planDigest,fanOutInvocation.planDigest);
const fanOutAnswers=new Map();
for(const node of fanOutInterpreter.nodes.filter(node=>node.operation==="action")) {
  assert.deepEqual(node.dependsOn,[]);
  assert.match(node.id,/^fanout\/1\/key1_[a-f0-9]{64}\/0\/action\/0$/);
  const prepared=fanOutInterpreter.prepare(node.id,[]);
  const invocation={actionId:sourceAction.id,actionVersion:sourceAction.version,actionContractDigest:sourceAction.contractDigest,input:durable.encodeKeyedValue(prepared.input)};
  const driver=`\nexport default function (_functions,inspection) { return __vibelangInvokeKeyedAction(${JSON.stringify(invocation)},inspection); }\n`;
  const execution=await installedSandbox.execute(sourceBundle.javascript+driver,{}, {sourceDigest:sourceBundle.digest,turnId:node.id});
  assert.equal(execution.ok,true,JSON.stringify(execution.error));
  assert.equal(execution.result.kind,"success");
  fanOutAnswers.set(node.id,fanOutInterpreter.encodeSuccess(node.id,durable.decodeKeyedValue(execution.result.value)));
}
const fanOutRefs=JSON.parse(fanOutInvocation.planJson).nodes.at(-1).material.inputs.filter(input=>input._tag==="Ref")
  .map(input=>({from:input.from,path:input.path,value:fanOutAnswers.get(input.from)}));
assert.deepEqual(durable.decodeKeyedValue(fanOutInterpreter.prepare("result",fanOutRefs).value),[42,3]);
// Source child composition uses the same installed native compiler, signer and
// data interpreter, with real provider answers passed along the derived edge.
// Cover both a direct consumer and a shared capture in per-item child Flows.
for (const capture of [false,true]) {
const composedDeployment=durable.buildKeyedSourceDeployment({runtime:keyedRuntime,bundles:[sourceBundle],
  source:{...modularSource,exportName:"Flow",source:`import {durable,fanOut} from "vibelang:flows";import {Work} from "./module-api";export const Child=durable((n:number):Result<number,never>=>{return Work.run(n)!});export const Flow=durable((n:number):Result<${capture?"readonly number[]":"number"},never>=>{const value=Child.run(n)!;return ${capture?"fanOut([2,1],item=>item,item=>Child.run(value)!)":"Work.run(value)"}});`},
  providers:[{actionId:sourceAction.id,tier:"sealed",effects:{boundaryMode:"hard",reads:[],writes:[]},layers:[],capabilities:[]}]});
const composedProof=durable.authenticateKeyedSourceDeployment(durable.encodeSignedKeyedSourceDeployment(composedDeployment,signingKeyPair),[verificationKey],keyedRuntime);
const composedInvocation=durable.compileAuthenticatedKeyedInvocation(composedProof,{planId:capture?"installed/capture":"installed/composition",inputJson:"41"});
const composedInterpreter=new durable.KeyedSourceInterpreter(composedInvocation.planJson),composedAnswers=new Map();
const composedWorker=durable.createAuthenticatedKeyedNodeWorker(composedInvocation);
assert.equal(composedInterpreter.source.exportName,"Flow");
if(capture) {
  assert.equal(composedInterpreter.nodes.length,4);
  assert.equal(composedInterpreter.nodes[0].id,"flow/0/action/0");
  for(const node of composedInterpreter.nodes.slice(1,-1)) {
    assert.match(node.id,/^fanout\/1\/key1_[a-f0-9]{64}\/0\/action\/0$/);
    assert.deepEqual(node.dependsOn,["flow/0/action/0"]);
  }
} else assert.deepEqual(composedInterpreter.nodes.map(node=>node.id),["flow/0/action/0","action/1","result"]);
assert.deepEqual(composedInterpreter.nodes[1].dependsOn,["flow/0/action/0"]);
assert.equal(durable.restoreAuthenticatedKeyedInvocation(composedProof,{planId:composedInvocation.planId,inputJson:"41",planJson:composedInvocation.planJson}).planDigest,composedInvocation.planDigest);
for(const node of JSON.parse(composedInvocation.planJson).nodes) {
  const refs=node.material.inputs.filter(input=>input._tag==="Ref").map(input=>{
    let value=composedAnswers.get(input.from);
    for(const key of input.path)value=value[key];
    return {from:input.from,path:input.path,value};
  });
  const exit=await composedWorker.execute({node,attempt:1,boundary:{boundaryMode:"hard",readSet:[],writeSet:[]},inputs:refs});
  assert.equal(exit.kind,"success",JSON.stringify(exit));
  if(node.id==="result")assert.deepEqual(durable.decodeKeyedValue(exit.value),capture?[43,43]:43);
  composedAnswers.set(node.id,exit.value);
}
}
// Arithmetic is Go-derived Plan data, and is delivered by the installed worker
// before AND after real provider calls. Retain the non-computing controls above.
assert.equal(typeof durable.KeyedSourceEvaluationError,"function");
const computationDeployment=durable.buildKeyedSourceDeployment({runtime:keyedRuntime,bundles:[sourceBundle],
  source:{...modularSource,source:'import {durable} from "vibelang:flows";import {Work} from "./module-api";export const Flow=durable((n:number)=>{const a=Work.run(n+1)!;const b=Work.run(a*2)!;return {value:b-1,ok:b>n}});'},
  providers:[{actionId:sourceAction.id,tier:"sealed",effects:{boundaryMode:"hard",reads:[],writes:[]},layers:[],capabilities:[]}]});
const computationProof=durable.authenticateKeyedSourceDeployment(durable.encodeSignedKeyedSourceDeployment(computationDeployment,signingKeyPair),[verificationKey],keyedRuntime);
const computationInvocation=durable.compileAuthenticatedKeyedInvocation(computationProof,{planId:"installed/computation",inputJson:"41"});
assert.equal(durable.restoreAuthenticatedKeyedInvocation(computationProof,{planId:computationInvocation.planId,inputJson:"41",planJson:computationInvocation.planJson}).planDigest,computationInvocation.planDigest);
const computationWorker=durable.createAuthenticatedKeyedNodeWorker(computationInvocation),computationAnswers=new Map();
for(const node of JSON.parse(computationInvocation.planJson).nodes) {
  const inputs=node.material.inputs.filter(input=>input._tag==="Ref").map(input=>({from:input.from,path:input.path,value:computationAnswers.get(input.from)}));
  const exit=await computationWorker.execute({node,inputs,attempt:1,boundary:{boundaryMode:"hard",readSet:[],writeSet:[]}});
  assert.equal(exit.kind,"success",JSON.stringify(exit));computationAnswers.set(node.id,exit.value);
}
assert.equal(JSON.stringify(durable.decodeKeyedValue(computationAnswers.get("result"))),'{"value":86,"ok":true}');
// Both alternatives are published and authenticated, but the installed demand
// adapter reserves only the selected provider. Do not use the eager node sweep
// above for conditional graphs, or label these local outcomes durable commits.
const nullableDeclaration=modularSource.dependencies[0].source.replace("Result<number,never>","Result<{value:number}|null,never>");
const nullableContract=durable.compileActionContract(nullableDeclaration,{fileName:"installed.vibe",exportName:"Work",id:sourceAction.id,version:1});
assert.equal(nullableContract.ok,true,JSON.stringify(nullableContract.diagnostics));
const nullableProvider=durable.compileActionImplementationSourceContract({...sourceProviderOptions,action:nullableContract.descriptor,
  sources:[{fileName:"provider.vibe",source:"export function work(n:number):{value:number}|null{return n<0?null:{value:n+1}}"}]});
const nullableBundle=durable.buildWorkerPoolBundle({poolId:"installed-nullable",target:"typescript-deno",sandbox:"deno-subprocess/no-permissions",
  valueCodec:"vibelang/keyed-source/v2",selections:[{action:nullableContract.descriptor,contract:nullableProvider}]});
for(const [body,inputType,publishedActions,cases,nullable=false] of [
  ["const value=Work.run(n)!;if(value===null)return 0;return value.value+1","number",1,[["41",43,null,1],["-1",0,null,1]],true],
  ["if(n>0)return Work.run(n+1);return Work.run(-n+10)","number",2,[["41",43,"then",2],["-1",12,"else",2]]],
  ["if(n===null)return 0;return Work.run(n)","number|null",1,[["null",0,null,2],["41",42,"else",1]]],
  ['if(n.kind==="a")return Work.run(n.x);return Work.run(n.y)','{kind:"a";x:number}|{kind:"b";y:number}',2,
    [['{"kind":"a","x":41}',42,"then",2],['{"kind":"b","y":11}',12,"else",2]]],
  ["return n>0?Work.run(n+1):Work.run(-n+10)","number",2,[["41",43,"then",2],["-1",12,"else",2]]],
  ["return n>0&&Work.run(n+1)!","number",1,[["41",43,"then",1],["-1",false,null,2]]],
  ["return n>0||Work.run(n+1)!","number",1,[["41",true,null,2],["-1",1,"else",1]]],
  ["return n??Work.run(41)!","number|null",1,[["null",42,"then",1],["0",0,null,2]]],
]) {
const branchSource={...modularSource,source:`import {durable} from "vibelang:flows";import {Work} from "./module-api";export const Flow=durable((n:${inputType})=>{${body}});`};
if(nullable)branchSource.dependencies=modularSource.dependencies.map(file=>file.fileName==="installed.vibe"?{...file,source:nullableDeclaration}:file);
const branchDeployment=durable.buildKeyedSourceDeployment({runtime:keyedRuntime,bundles:[nullable?nullableBundle:sourceBundle],
  source:branchSource,
  providers:[{actionId:sourceAction.id,tier:"sealed",effects:{boundaryMode:"hard",reads:[],writes:[]},layers:[],capabilities:[]}]});
const branchProof=durable.authenticateKeyedSourceDeployment(durable.encodeSignedKeyedSourceDeployment(branchDeployment,signingKeyPair),[verificationKey],keyedRuntime);
for(const [inputJson,expected,selected,skipped] of cases) {
  const invocation=durable.compileAuthenticatedKeyedInvocation(branchProof,{planId:"installed/branch",inputJson});
  const planJson=inspectKeyedSourceWithCli({...branchSource,planId:invocation.planId,inputJson,
    providersJson:JSON.stringify(branchDeployment.providers.map(provider=>({actionId:provider.actionId,
      implementationId:provider.implementation.implementationId,implementationDigest:provider.bundleDigest,
      tier:provider.tier,effects:provider.effects,layers:provider.layers,capabilities:provider.capabilities})))});
  assert.equal(planJson,invocation.planJson);
  const restored=durable.restoreAuthenticatedKeyedInvocation(branchProof,{planId:invocation.planId,inputJson,planJson});
  assert.equal(restored.planDigest,invocation.planDigest);
  const worker=durable.createAuthenticatedKeyedNodeWorker(restored),control=worker.createControl(),answers=new Map(),executed=[];
  const plan=JSON.parse(invocation.planJson);
  assert.equal(plan.nodes.filter(node=>node.material.body.operation==="action").length,publishedActions);
  const work=(node,inputs=[])=>({node,inputs,attempt:1,boundary:{boundaryMode:"hard",readSet:[],writeSet:[]}});
  await assert.rejects(worker.execute(work(plan.nodes[0])),/controlled execution/);
  while(!control.inspect().terminal) {
    const ready=control.claim(10000);
    assert.ok(ready.length>0,"branch demand stalled");
    for(const ticket of ready) {
      const node=plan.nodes.find(node=>node.id===ticket.nodeId);
      const inputs=node.material.inputs.filter(input=>input._tag==="Ref"&&ticket.dependencies.includes(input.from)).map(input=>{
        assert.ok(answers.has(input.from));let value=answers.get(input.from);
        for(const key of input.path)value=value[key];
        return {from:input.from,path:input.path,value};
      });
      await assert.rejects(worker.executeControlled(control,{...ticket},work(node,inputs)),/foreign/);
      const exit=await worker.executeControlled(control,ticket,work(node,inputs));
      assert.equal(exit.kind,"success",JSON.stringify(exit));
      answers.set(node.id,exit.value);executed.push(node.id);control.complete(ticket,exit);
      await assert.rejects(worker.executeControlled(control,ticket,work(node,inputs)),/consumed/);
    }
  }
  assert.equal(durable.decodeKeyedValue(answers.get("result")),expected);
  assert.deepEqual(executed.filter(id=>id.includes("/action/")),selected===null?[]:[`branch/0/${selected}/action/0`]);
  assert.equal(control.inspect().nodes.find(node=>node.id==="result").status,"success");
  assert.equal(control.inspect().nodes.filter(node=>node.status==="skipped").length,skipped);
}
}
// No scheduler admission, approval or durable commit is inferred from this
// intentionally direct local execution of the installed bundle.
const turn = await new agent.InMemoryTypeScriptCompiler().compile(
  "export default async function turn(functions: Functions) { void functions; return null }",
  "interface Functions {}",
);
assert.equal(turn.ok, true, JSON.stringify(turn.diagnostics));
assert.match(turn.javascript, /function turn/);
if (isBun) {
  const agentBun = loaded.get("./agent/bun");
  assert.equal(typeof agentBun.SqliteTurnJournal, "function");
  assert.equal(typeof agentBun.flowTool, "function");
  assert.equal(agentBun.InMemoryTypeScriptCompiler, agent.InMemoryTypeScriptCompiler);
}

// The derived-schema runtime is the module every lowered
// `comptime(Schema.derive<T>())` names, so it must resolve and interpret a
// descriptor from the installed package alone.
const schemaRuntime = loaded.get("./schema-runtime");
const smokeSchema = schemaRuntime.__vsSchema({
  kind: "object",
  properties: [
    { name: "count", optional: false, value: { kind: "number" } },
    { name: "name", optional: false, value: { kind: "string" } },
  ],
});
assert.equal(smokeSchema.descriptor.kind, "object");
assert.deepEqual(
  smokeSchema.parse({ name: "release", count: 1 }).match({ ok: (row) => row, error: () => null }),
  { count: 1, name: "release" },
);
assert.equal(
  smokeSchema.parse({ name: 1, count: 1 }).match({ ok: () => null, error: (failure) => failure.pointer }),
  "$.name",
);
assert.equal(typeof schemaRuntime.ValidationError, "function");

const platform = loaded.get("./platform");
assert.equal(platform.Duration.seconds(2).toMillis(), 2_000);
assert.equal(platform.Path.join("release", "smoke"), "release/smoke");
// `NodePlatform` is a ready-made Layer value; `nodePlatform(options)` is the
// factory that builds one with overrides. Pin both shapes so a regression in
// either direction is caught.
assert.equal(typeof platform.NodePlatform, "object");
assert.equal(typeof platform.nodePlatform, "function");
assert.equal(typeof platform.InMemoryFileSystem, "function");
const smokeClock = new platform.TestClock();
assert.equal(typeof smokeClock.monotonic(), "number");

const data = loaded.get("./data");
assert.deepEqual([...data.Chunk.of(1, 2, 3)], [1, 2, 3]);
assert.equal(data.Chunk.of(1, 2, 3).size, 3);
// A lookup that can miss now answers with the value or `undefined`, read by
// ordinary narrowing rather than a container. Both directions are pinned.
assert.equal(data.HashMap.of(["answer", 42]).get("answer") ?? null, 42);
assert.equal(data.HashMap.of(["answer", 42]).get("absent") ?? null, null);
assert.equal(data.HashSet.of("release").has("release"), true);
assert.equal(data.Data.equals(data.Data.struct({ id: 1 }), data.Data.struct({ id: 1 })), true);
assert.equal(typeof data.Match.value, "function");

const concurrency = loaded.get("./concurrency");
assert.equal(typeof concurrency.awaitAll, "function");
for (const name of ["Queue", "Semaphore", "Channel", "Stream", "Governor", "CancellationSource"]) {
  assert.equal(typeof concurrency[name], "function", `vibelang/concurrency must export ${name}`);
}
assert.equal(typeof concurrency.allKeyed, "function");
assert.equal("TypedWorker" in concurrency, false, "the Bun worker host stays on vibelang/concurrency/bun");
assert.deepEqual(await concurrency.awaitAll(Promise.resolve(1), Promise.resolve("two")), [1, "two"]);

console.log(JSON.stringify({ ok: true, runtime: isBun ? "bun" : "node", exports: Object.keys(packageMetadata.exports).length }));
