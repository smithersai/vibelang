import {
  compileProject,
  composeSourceMaps,
  emitProjectDeclarations,
  type ProjectSource,
  type EmittedDiagnostic,
  checkEmittedProject,
} from "vibelang/language";
import {
  decodeResult,
  encodeResult,
  type ValueCodec,
} from "vibelang/runtime";
import {
  AssetCompiler,
  ComptimeCompiler,
  compileComptimeIntrinsics,
  compileSourceAssetModules,
  type ComptimeIntrinsicResult,
  type SourceAssetCompilation,
} from "vibelang/build";
import { InMemoryTypeScriptCompiler } from "vibelang/agent";
import bundler, { type VibeLangPluginOptions } from "vibelang/unplugin";
const bundlerOptions: VibeLangPluginOptions = { entries: ["main.vibe"], mode: "checked", target: "node-es2022" };
const pluginName: string = bundler.rollup(bundlerOptions).name;
void pluginName;
// @ts-expect-error a complete checked root set is required
bundler.rollup({});
// @ts-expect-error there is no guess-the-calling-convention mode
bundler.rollup({ entries: ["main.vibe"], mode: "unchecked" });
import type { NativeCompiler as RootCompiler } from "vibelang";
import { NativeCompiler, type NativeCompileRequest, type NativeDiagnostic, type NativeDurableModuleResult, type NativeSyntaxSchemaResult, type NativeRuntimeFactoryRequest, type NativeRuntimeFactoryResult, type NativeActionContractRequest, type NativeActionContractResult, type NativeCheckedFunctionRequest, type NativeCheckedFunctionResult, type NativeConfigRequest, type NativeConfigResult } from "vibelang/compiler";
import type { NativeCheckedSchemasRequest, NativeCheckedSchemasResult } from "vibelang/compiler";
const rootCompiler: RootCompiler = new NativeCompiler();
void rootCompiler;
import type { NativeSourceRecoveryResult } from "vibelang/compiler";
import type { NativeComptimePlanRequest, NativeComptimePlanResult } from "vibelang/compiler";
import type { NativeGeneratedProjectRequest, NativeGeneratedProjectResult } from "vibelang/compiler";
import type { NativeBodyContractRequest, NativeBodyContractResult } from "vibelang/compiler";
import type { NativeDeclarationTextRequest, NativeDeclarationTextResult, NativeGeneratedDeclarationsRequest, NativeGeneratedDeclarationsResult } from "vibelang/compiler";
import {
  SqliteTurnJournal,
  flowTool,
  type FlowToolTarget,
} from "vibelang/agent/bun";

import { decodePlanArtifact } from "vibelang/durable/artifact";
import { compileDurableSource, compileEffectManifest } from "vibelang/durable/source-compiler";
import {
  canonicalJson,
  compileActionImplementationSourceContract,
  buildWorkerPoolBundle,
  buildKeyedSourceDeployment,
  compileAuthenticatedKeyedInvocation,
  createAuthenticatedKeyedNodeWorker,
  KeyedSourceEvaluationError,
  keyedInvocationApprovalTarget,
  type BuildKeyedSourceDeploymentOptions,
  type AuthenticatedKeyedSourceDeployment,
  type AuthenticatedKeyedInvocation,
  type AuthenticatedKeyedNodeWorker,
  type KeyedNodeWork,
  type KeyedNodeExit,
  type KeyedApprovalEnvelope,
  type KeyedApprovalTarget,
  type CompileActionImplementationSourceOptions,
  type BuildWorkerPoolBundleOptions,
  deploymentVerificationKey,
  digest as durableDigest,
  generateDeploymentSigningKeyPair,
  MAX_DURABLE_JSON_NODES,
  type DeploymentSigningKeyPair,
  type EffectManifest,
  type SignalNode,
  type TrustedDeploymentKey,
} from "vibelang/durable";
const sourceProviderCompiler: (options: CompileActionImplementationSourceOptions) => ReturnType<typeof compileActionImplementationSourceContract> = compileActionImplementationSourceContract;
const sourceBundleCompiler: (options: BuildWorkerPoolBundleOptions) => ReturnType<typeof buildWorkerPoolBundle> = buildWorkerPoolBundle;
void sourceProviderCompiler;
void sourceBundleCompiler;
const keyedSourceBuilder: (options: BuildKeyedSourceDeploymentOptions) => ReturnType<typeof buildKeyedSourceDeployment> = buildKeyedSourceDeployment;
const keyedInvocationCompiler: (source: AuthenticatedKeyedSourceDeployment, input: {planId: string; inputJson: string}) => AuthenticatedKeyedInvocation = compileAuthenticatedKeyedInvocation;
void keyedSourceBuilder;
void keyedInvocationCompiler;
const keyedTargetBuilder: (invocation: AuthenticatedKeyedInvocation, options: {envelope: KeyedApprovalEnvelope; deployClass: boolean}) => KeyedApprovalTarget = keyedInvocationApprovalTarget;
void keyedTargetBuilder;
const keyedWorkerFactory: (invocation: AuthenticatedKeyedInvocation) => AuthenticatedKeyedNodeWorker = createAuthenticatedKeyedNodeWorker;
async function executeInstalledControlledNode(worker:AuthenticatedKeyedNodeWorker,work:KeyedNodeWork):Promise<KeyedNodeExit> {
  const control=worker.createControl();
  const [ticket]=control.claim(1);
  const exit=await worker.executeControlled(control,ticket,work);
  control.complete(ticket,exit);
  const terminal:boolean=control.inspect().terminal;
  void terminal;
  return exit;
}
void executeInstalledControlledNode;
function executeInstalledKeyedNode(worker: AuthenticatedKeyedNodeWorker, work: KeyedNodeWork): Promise<KeyedNodeExit> {
  return worker.execute(work);
}
// @ts-expect-error inspected graph fields are not an authenticated invocation
createAuthenticatedKeyedNodeWorker({planId:"unissued",planJson:"{}",planDigest:"x",executionDigest:"x",inputJson:"null"});
// @ts-expect-error worker values use the ordered transport codec, not raw objects
const unencodedWorkerExit: KeyedNodeExit = {kind:"success",value:{z:1,a:2}};
void keyedWorkerFactory;
void executeInstalledKeyedNode;
void unencodedWorkerExit;
const keyedComputationError: TypeError = new KeyedSourceEvaluationError("node computation failed");
void keyedComputationError;
import {
  DurableExecutor,
  DurableStore,
  SignalDeliveryConflictError,
  SignalDeliveryRejectedError,
  validateDurableSchema,
  type SignalContractExpectation,
  type SignalDeliveryRequest,
  type SignalDeliveryResult,
  type SignalInboxState,
  type SignalPollResult,
} from "vibelang/durable/bun";
import {
  ValidationError,
  __vsSchema,
  type DerivedSchema,
  type SchemaDescriptor,
} from "vibelang/schema-runtime";
import { Chunk, Data, HashMap, Match, type Matcher } from "vibelang/data";
import {
  Clock,
  Duration,
  Path,
  TestClock,
  type DurationValue,
  type PlatformServices,
} from "vibelang/platform";
import {
  CancellationSource,
  Governor,
  Queue,
  Semaphore,
  Stream,
  awaitAll,
  type Channel,
} from "vibelang/concurrency";
import type { TypedWorkerHandle } from "vibelang/concurrency/bun";

const nativeRequest: NativeCompileRequest = {
  rootNames: ["main.vibe"],
  files: [{ path: "main.vibe", kind: "vibelang", text: "export const answer = 42;" }],
  lowering: "internal",
};
const nativeDiagnostics: readonly NativeDiagnostic[] = new NativeCompiler().compile(nativeRequest).diagnostics;
void nativeDiagnostics;
const nativeModule: NativeDurableModuleResult = new NativeCompiler().durableModule("export const ordinary = 42;");
const nativeRemoval: { readonly start: number; readonly length: number } | undefined = nativeModule.removals[0];
void nativeRemoval;
const nativeSchema: NativeSyntaxSchemaResult = new NativeCompiler().syntaxSchema("type T = number", "T");
const checkedSchemaRequest: NativeCheckedSchemasRequest = {files:[{path:"main.ts",text:"derive<number>()",scriptKind:"typescript"}],modules:{},queries:[{file:"main.ts",span:{start:0,length:16}}]};
const checkedSchemas: NativeCheckedSchemasResult = new NativeCompiler().checkedSchemas(checkedSchemaRequest);
const checkedSchemaJSON: string | undefined = checkedSchemas.schemas[0]?.schemaJson;
void checkedSchemaJSON;
const recovered: NativeSourceRecoveryResult = new NativeCompiler().recoverSource("if(const x=1;x){}");
const recoveredTokenKind: string | undefined = recovered.tokens[0]?.kind;
void recoveredTokenKind;
const comptimeRequest: NativeComptimePlanRequest = {files:[{path:"main.ts",text:'import {comptime} from "vibelang:comptime";const value=comptime(42);',scriptKind:"typescript"}],target:"test",schemaRuntimeImport:"bound:schema",inputs:[]};
const comptimePlan: NativeComptimePlanResult = new NativeCompiler().planComptime(comptimeRequest);
const comptimeGraph: string | undefined = comptimePlan.calls[0]?.valueJson;
void comptimeGraph;
const nativeSchemaJSON: string = nativeSchema.schemaJson;
void nativeSchemaJSON;
const nativeFactoryRequest: NativeRuntimeFactoryRequest = { source: "const entry = () => 42;", entry: "entry", runtimeSpecifier: "bound:runtime" };
const nativeFactory: NativeRuntimeFactoryResult = new NativeCompiler().runtimeFactory(nativeFactoryRequest);
const nativeFactoryCode: string = nativeFactory.code;
void nativeFactoryCode;
const nativeActionRequest: NativeActionContractRequest = { source: 'import { Action } from "vibelang:flows"; export class Work extends Action<(input: number) => Result<number, never>> {}', fileName: "actions.vibe", exportName: "Work", id: "test/Work", version: 1 };
const nativeAction: NativeActionContractResult = new NativeCompiler().actionContract(nativeActionRequest);
const nativeCheckedFunctionRequest: NativeCheckedFunctionRequest = { files: [{path:"work.vibe",kind:"vibelang",text:"export function work() { return 42; }"}], entryFile:"work.vibe", exportName:"work" };
const nativeCheckedFunction: NativeCheckedFunctionResult = new NativeCompiler().checkedFunction(nativeCheckedFunctionRequest);
const nativeCheckedFunctionRequirements: readonly string[] = nativeCheckedFunction.function?.requirements ?? [];
void nativeCheckedFunctionRequirements;
const nativeConfigRequest: NativeConfigRequest = {path:"tsconfig.json",text:"{}"};
const nativeConfig: NativeConfigResult = new NativeCompiler().validateConfig(nativeConfigRequest);
const nativeConfigDiagnostics: readonly NativeDiagnostic[] = nativeConfig.diagnostics;
void nativeConfigDiagnostics;
const generatedRequest: NativeGeneratedProjectRequest = {files:[{path:"/project/main.ts",text:"export const answer: number = 42;"}],currentDirectory:"/project",diskDependencies:false};
const generatedResult: NativeGeneratedProjectResult = new NativeCompiler().checkGeneratedProject(generatedRequest);
const emittedDiagnostics: readonly EmittedDiagnostic[] = checkEmittedProject([{fileName:"/project/main.ts",code:""}]);
const emittedFileName: string | undefined = emittedDiagnostics[0]?.file;
void generatedResult;
const inspectedLiteral = new NativeCompiler().inspect([{path:"editor.vibe",text:"import('x')",scriptKind:"typescript"}]).files[0]?.moduleSyntax[0];
const literalKind: "string" | "template" | undefined = inspectedLiteral?.specifierKind;
const literalStart: number | undefined = inspectedLiteral?.specifierSpan?.start;
void literalKind; void literalStart;
const bodyRequest: NativeBodyContractRequest = {project:generatedRequest,entryFile:"/project/main.ts",entry:"Flow",logicalFileName:"main.vibe",runtimeSpecifier:"vibelang/runtime",resumable:false,async:false};
const bodyContract: NativeBodyContractResult = new NativeCompiler().bodyContract(bodyRequest);
const bodySchemas: string = bodyContract.schemasJson;
const bodyRefusal: "" | "check" | "entry" | "boundary" = bodyContract.reason;
void bodySchemas; void bodyRefusal;
void emittedFileName;
const declarationTextRequest: NativeDeclarationTextRequest = {operation:"read",path:"/project/main.d.ts",text:""};
const declarationText: NativeDeclarationTextResult = new NativeCompiler().declarationText(declarationTextRequest);
const generatedDeclarationRequest: NativeGeneratedDeclarationsRequest = {project:generatedRequest};
const generatedDeclarations: NativeGeneratedDeclarationsResult = new NativeCompiler().emitGeneratedDeclarations(generatedDeclarationRequest);
const declarationRows: readonly string[] | undefined = declarationText.effects["read"]?.requirements;
const declarationCode: string | undefined = generatedDeclarations.outputs[0]?.text;
void declarationRows; void declarationCode;
// @ts-expect-error generated diagnostics are data, never legacy SourceFile objects
emittedDiagnostics[0]?.file?.getLineAndCharacterOfPosition(0);
const nativeActionJSON: string = nativeAction.contractJson;
void nativeActionJSON;
// @ts-expect-error language lowering cannot be disabled by omitting its mode
const missingNativeMode: NativeCompileRequest = { rootNames: ["main.vibe"], files: nativeRequest.files };
void missingNativeMode;

const sources: readonly ProjectSource[] = [{ fileName: "main.vibe", source: "export const value = 1" }];
const project = compileProject(sources, { rootDir: "/virtual", outDir: "/virtual/out" });
const declarations = emitProjectDeclarations([{ fileName: "/virtual/main.ts", code: "export const value = 1" }]);
const declarationDiagnostics: readonly EmittedDiagnostic[] = declarations.diagnostics;
void declarationDiagnostics;
// @ts-expect-error declaration diagnostics no longer expose a legacy compiler SourceFile
declarations.diagnostics[0]?.file?.getLineAndCharacterOfPosition(0);
const map: string = composeSourceMaps(
  '{"version":3,"sources":["a"],"names":[],"mappings":"AAAA"}',
  '{"version":3,"sources":["b"],"names":[],"mappings":"AAAA"}',
  "out.js",
);

const codec: ValueCodec<string> = { encode: (value) => value, decode: (value) => String(value) };
declare const resultValue: Parameters<typeof encodeResult<string, Error>>[0];
const resultWire = encodeResult(resultValue, codec);
decodeResult(resultWire, codec);

// Absence is an ordinary `T | undefined` union after the 2026-08-23 withdrawal
// of `Optional<T>`, so it needs no codec of its own and none is exported.
declare const maybeName: string | undefined;
const name: string = maybeName ?? "anonymous";

declare const compiler: ComptimeCompiler;
const comptime: Promise<ComptimeIntrinsicResult> = compileComptimeIntrinsics({
  compiler,
  sources: { "main.vibe": 'import { comptime } from "vibelang:comptime"; comptime(1)' },
});
declare const assetCompiler: AssetCompiler;
const sourceAssets: Promise<SourceAssetCompilation> = compileSourceAssetModules({
  compiler: assetCompiler,
  sources: [{ fileName: "/virtual/main.vibe", source: "export const value = 1" }],
});
const DURABLE_SOURCE =
  'import { durable } from "vibelang:flows"; export const Flow = durable(function Flow(input: string) { return input })';
const durable = compileDurableSource(DURABLE_SOURCE, { actions: [] });
if (durable.ok) decodePlanArtifact(durable.artifact);
// MIGRATION-PLAN.md §5 R2. `verify:pack` is the only gate that type-checks the
// PACKED artifact's public durable surface, and it reached that surface through
// the Plan alone. The historical Manifest path selected by
// `vibe plan --profile manifest-compat` is checked from the same specifier too.
const durableManifest = compileEffectManifest(DURABLE_SOURCE, { actions: [] });
if (durableManifest.ok) {
  const manifest: EffectManifest = durableManifest.manifest;
  const { digest: _declared, ...semantic } = manifest;
  const recomputedManifestDigest: string = durableDigest(semantic);
  const canonicalManifest: string = canonicalJson(manifest);
  void recomputedManifestDigest;
  void canonicalManifest;
}
new InMemoryTypeScriptCompiler();
declare const flowTarget: FlowToolTarget;
flowTool(flowTarget);
new SqliteTurnJournal();

const deploymentSigningKey: DeploymentSigningKeyPair = generateDeploymentSigningKeyPair();
const trustedDeploymentKey: TrustedDeploymentKey = deploymentVerificationKey(deploymentSigningKey);
const maximumDurableJsonNodes: number = MAX_DURABLE_JSON_NODES;
declare const signalNode: SignalNode;
declare const signalRequest: SignalDeliveryRequest;
declare const signalExpectation: SignalContractExpectation;
declare const signalInbox: SignalInboxState;
declare const signalPoll: SignalPollResult;
declare const durableExecutor: DurableExecutor<unknown, unknown>;
declare const durableStore: DurableStore;
const signalDelivery: SignalDeliveryResult = durableExecutor.deliverSignal(signalRequest);
const storedSignalDelivery: SignalDeliveryResult = durableStore.deliverSignal(signalRequest, signalExpectation);
const checkedSignalSchema = validateDurableSchema(signalNode.payloadSchema, "input");
const signalNewlyConsumed: boolean | undefined = signalPoll.kind === "terminal"
  ? signalPoll.newlyConsumed
  : undefined;
void [SignalDeliveryConflictError, SignalDeliveryRejectedError];

// The derived-schema runtime is the module every lowered
// `comptime(Schema.derive<T>())` names as `vibelang/schema-runtime`, so an
// installed consumer must be able to resolve and type it exactly like this.
interface ReleaseRow {
  readonly name: string;
  readonly count: number;
}
const releaseRowSchema: DerivedSchema<ReleaseRow> = __vsSchema<ReleaseRow>({
  kind: "object",
  properties: [
    { name: "count", optional: false, value: { kind: "number" } },
    { name: "name", optional: false, value: { kind: "string" } },
  ],
});
const releaseRowDescriptor: SchemaDescriptor = releaseRowSchema.descriptor;
const releaseRowParsed: ReleaseRow | undefined = releaseRowSchema
  .parse({ name: "release", count: 1 })
  .match({ ok: (row) => row, error: (failure: ValidationError) => (void failure.pointer, undefined) });

const releaseChunk = Chunk.of(1, 2, 3);
const releaseChunkSize: number = releaseChunk.size;
const releaseMap = HashMap.of(["answer", 42] as const);
// `get` answers with the value or `undefined`; the annotation is the whole
// contract now that absence is an ordinary union.
const releaseMapped: number | undefined = releaseMap.get("answer");
const releaseData = Data.struct({ id: "release" });
declare const releaseTag: { readonly kind: "release" } | { readonly kind: "draft" };
const releaseMatcher: Matcher<typeof releaseTag, { readonly kind: "draft" }, string> = Match
  .value(releaseTag)
  .whenTag("release", () => "released");
const releaseMatched: string = releaseMatcher.orElse(() => "pending").run();

const releaseDuration: DurationValue = Duration.seconds(1);
const releaseJoined: string = Path.join("release", "types");
declare const releaseClock: Clock;
const releaseMonotonic: number = releaseClock.monotonic();
declare const releaseTestClock: TestClock;
declare const releasePlatform: PlatformServices;

declare const releaseQueue: Queue<number>;
declare const releaseChannel: Channel<number>;
declare const releaseStream: Stream<number>;
declare const releaseSemaphore: Semaphore;
const releaseGovernor: Governor = Governor.withLimit(2);
const releaseCancellation: CancellationSource = new CancellationSource();
declare const releaseWorker: TypedWorkerHandle<{ readonly ping: () => Promise<number> }>;
declare const releaseFirst: Promise<number>;
declare const releaseSecond: Promise<string>;
const releaseJoin: Promise<[number, string]> = awaitAll(releaseFirst, releaseSecond);

void [
  project,
  declarations,
  map,
  comptime,
  sourceAssets,
  trustedDeploymentKey,
  maximumDurableJsonNodes,
  signalInbox,
  signalPoll,
  signalDelivery,
  storedSignalDelivery,
  checkedSignalSchema,
  signalNewlyConsumed,
  releaseRowDescriptor,
  releaseRowParsed,
  releaseChunkSize,
  releaseMapped,
  releaseData,
  releaseMatched,
  releaseDuration,
  releaseJoined,
  releaseMonotonic,
  releaseTestClock,
  releasePlatform,
  releaseQueue,
  releaseChannel,
  releaseStream,
  releaseSemaphore,
  releaseGovernor,
  releaseCancellation,
  releaseWorker,
  releaseJoin,
];
