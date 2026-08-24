import {
  compileProject,
  composeSourceMaps,
  emitProjectDeclarations,
  type ProjectSource,
} from "smthrs/language";
import {
  decodeResult,
  encodeResult,
  type ValueCodec,
} from "smthrs/runtime";
import {
  AssetCompiler,
  ComptimeCompiler,
  compileComptimeIntrinsics,
  compileSourceAssetModules,
  type ComptimeIntrinsicResult,
  type SourceAssetCompilation,
} from "smthrs/build";
import { InMemoryTypeScriptCompiler } from "smthrs/agent";
import {
  SqliteTurnJournal,
  flowTool,
  type FlowToolTarget,
} from "smthrs/agent/bun";
import { decodePlanArtifact } from "smthrs/durable/artifact";
import { compileDurableSource } from "smthrs/durable/source-compiler";
import {
  deploymentVerificationKey,
  generateDeploymentSigningKeyPair,
  MAX_DURABLE_JSON_NODES,
  type DeploymentSigningKeyPair,
  type SignalNode,
  type TrustedDeploymentKey,
} from "smthrs/durable";
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
} from "smthrs/durable/bun";
import {
  ValidationError,
  __vsSchema,
  type DerivedSchema,
  type SchemaDescriptor,
} from "smthrs/schema-runtime";
import { Chunk, Data, HashMap, Match, type Matcher } from "smthrs/data";
import {
  Clock,
  Duration,
  Path,
  TestClock,
  type DurationValue,
  type PlatformServices,
} from "smthrs/platform";
import {
  CancellationSource,
  Governor,
  Queue,
  Semaphore,
  Stream,
  awaitAll,
  type Channel,
} from "smthrs/concurrency";
import type { TypedWorkerHandle } from "smthrs/concurrency/bun";

const sources: readonly ProjectSource[] = [{ fileName: "main.sm", source: "export const value = 1" }];
const project = compileProject(sources, { rootDir: "/virtual", outDir: "/virtual/out" });
const declarations = emitProjectDeclarations([{ fileName: "/virtual/main.ts", code: "export const value = 1" }]);
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
  sources: { "main.sm": 'import { comptime } from "smithers:comptime"; comptime(1)' },
});
declare const assetCompiler: AssetCompiler;
const sourceAssets: Promise<SourceAssetCompilation> = compileSourceAssetModules({
  compiler: assetCompiler,
  sources: [{ fileName: "/virtual/main.sm", source: "export const value = 1" }],
});
const durable = compileDurableSource(
  'import { durable } from "smithers:flows"; export const Flow = durable(function Flow(input: string) { return input })',
  { actions: [] },
);
if (durable.ok) decodePlanArtifact(durable.artifact);
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
// `comptime(Schema.derive<T>())` names as `smthrs/schema-runtime`, so an
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
