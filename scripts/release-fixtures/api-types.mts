import {
  compileProject,
  composeSourceMaps,
  emitProjectDeclarations,
  type ProjectSource,
} from "vibelang/language";
import {
  decodeOptional,
  decodeResult,
  encodeOptional,
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
import {
  SqliteTurnJournal,
  flowTool,
  type FlowToolTarget,
} from "vibelang/agent/bun";
import { decodePlanArtifact } from "vibelang/durable/artifact";
import { compileDurableSource } from "vibelang/durable/source-compiler";
import {
  deploymentVerificationKey,
  generateDeploymentSigningKeyPair,
  MAX_DURABLE_JSON_NODES,
  type DeploymentSigningKeyPair,
  type SignalNode,
  type TrustedDeploymentKey,
} from "vibelang/durable";
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
  compilePortableModule,
  executePortableTypeScript,
  type PortableExecution,
  type PortableModuleIR,
} from "vibelang/targets";
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

const sources: readonly ProjectSource[] = [{ fileName: "main.vibe", source: "export const value = 1" }];
const project = compileProject(sources, { rootDir: "/virtual", outDir: "/virtual/out" });
const declarations = emitProjectDeclarations([{ fileName: "/virtual/main.ts", code: "export const value = 1" }]);
const map: string = composeSourceMaps(
  '{"version":3,"sources":["a"],"names":[],"mappings":"AAAA"}',
  '{"version":3,"sources":["b"],"names":[],"mappings":"AAAA"}',
  "out.js",
);

const codec: ValueCodec<string> = { encode: (value) => value, decode: (value) => String(value) };
declare const resultValue: Parameters<typeof encodeResult<string, Error>>[0];
declare const optionalValue: Parameters<typeof encodeOptional<string>>[0];
const resultWire = encodeResult(resultValue, codec);
const optionalWire = encodeOptional(optionalValue, codec);
decodeResult(resultWire, codec);
decodeOptional(optionalWire, codec);

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
const durable = compileDurableSource(
  'import { durable } from "vibelang:flows"; export const Flow = durable(function Flow(input: string) { return input })',
  { actions: [] },
);
if (durable.ok) decodePlanArtifact(durable.artifact);
new InMemoryTypeScriptCompiler();
declare const flowTarget: FlowToolTarget;
flowTool(flowTarget);
new SqliteTurnJournal();

const portableModule: PortableModuleIR = compilePortableModule({
  moduleId: "release/types",
  source: "export function identity(value: number): number { return value }",
});
const portableExecution: PortableExecution = executePortableTypeScript(
  portableModule,
  "identity",
  { value: 1 },
);
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
const releaseMapped: number | undefined = releaseMap
  .get("answer")
  .match({ some: (value) => value, none: () => undefined });
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
  portableExecution,
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
