import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { getNativeCompiler } from "../compiler/native.ts"
import { compileProject } from "../language/project-compile.ts"
import { snapshotKeyedJSON } from "./keyed-value.ts"
import { validateActionContractDescriptor } from "./schema-runtime.ts"
import {
  retainedCheckedImplementationProject, requireCompilerCheckedValueBoundary
} from "./implementation-contract.ts"
import {
  assertJson,
  canonicalJson,
  deepFreeze,
  type ActionDescriptor,
  type ActionImplementationContract,
  type DurableTypeDescriptor
} from "./ir.ts"

/**
 * Tree-shaken worker pool bundle emission.
 *
 * One worker pool compiles to ONE deterministic JavaScript module containing
 * exactly the pool's selected Action implementations: each implementation's
 * complete checked `.vibe` source closure (the same sources its
 * `compileActionImplementationContract` projectDigest pins) is lowered by the
 * ordinary project compiler, transpiled module-by-module to a CommonJS-shaped
 * factory, and concatenated with an embedded copy of the capability-free
 * VibeLang runtime subset. The SHA-256 of the exact emitted JavaScript bytes is
 * the pool's `bundleDigest` inside the deployment manifest, so the Ed25519
 * deployment signature transitively covers the worker bundle bytes.
 *
 * Deliberate bounds (fail closed, POC honesty):
 * - only checked contracts issued in this process can be bundled (their source
 *   closure must be retained by the compiler seam);
 * - bundled implementations cannot receive capability authority: the embedded
 *   runtime has no Layer machinery, so a nonempty requirement row is rejected
 *   at build time and the `Context`/`Layer` entry points in the bundle throw;
 * - emitted modules may import only the compiler runtime and other modules of
 *   the same checked closure — any other specifier fails the build;
 * - the digest pins bundle bytes (code identity), not the executing runtime
 *   binary and not build provenance.
 */

const BUNDLE_FORMAT_VERSION = 1 as const
export const MAX_POOL_BUNDLE_BYTES = 4 * 1024 * 1024
const HEX_DIGEST = /^[0-9a-f]{64}$/

/** Marker specifier the lowered modules import compiler helpers from. */
const RUNTIME_IMPORT_SPECIFIER = "vibelang-worker-bundle-runtime"
const RUNTIME_NAMESPACE = "runtime"
const RUNTIME_INDEX_PATH = "index.ts"

export class WorkerPoolBundleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WorkerPoolBundleError"
  }
}

const fail = (message: string): never => {
  throw new WorkerPoolBundleError(message)
}

export interface WorkerPoolBundle {
  readonly formatVersion: typeof BUNDLE_FORMAT_VERSION
  readonly poolId: string
  readonly actionIds: readonly string[]
  /** Complete emitted module source. `digest` is SHA-256 of exactly these bytes. */
  readonly javascript: string
  /** Lowercase hex SHA-256 of the UTF-8 bytes of `javascript`. */
  readonly digest: string
}

export interface WorkerPoolBundleSelection {
  readonly action: ActionDescriptor
  readonly contract: ActionImplementationContract
}

export interface BuildWorkerPoolBundleOptions {
  readonly poolId: string
  readonly target: string
  readonly sandbox: string
  readonly selections: readonly WorkerPoolBundleSelection[]
  /** Encode/decode durable values before JSON transport, not after it. Requires
   * source-only checked value boundaries and the runner's native inspector. */
  readonly valueCodec?: "vibelang/keyed-source/v2"
}

/** @internal Build provenance, distinct from a serialized bundle's digest. */
interface CheckedKeyedBundle {
  readonly bundle: WorkerPoolBundle
  readonly target: string
  readonly sandbox: string
  readonly selections: readonly WorkerPoolBundleSelection[]
}
const checkedKeyedBundles = new WeakMap<object, CheckedKeyedBundle>()

/** @internal A self-consistent serialized bundle is not compiler issuance. */
export const requireCheckedKeyedWorkerPoolBundle = (value: unknown): CheckedKeyedBundle => {
  if (value === null || typeof value !== "object") return fail("keyed bundle was not issued by the checked source builder")
  return checkedKeyedBundles.get(value) ?? fail("keyed bundle was not issued by the checked source builder")
}

export const sha256Utf8 = (text: string): string =>
  createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")

// ---------------------------------------------------------------------------
// Embedded runtime subset
// ---------------------------------------------------------------------------

/**
 * The capability-free runtime files embedded into every bundle. `layer.ts` is
 * deliberately absent: it depends on host-only node builtins and represents
 * ambient authority a digest-pinned bundle must not receive in this POC.
 */
const RUNTIME_SUBSET_FILES = [
  "errors.ts",
  "failure.ts",
  "effect.ts",
  "lexical.ts",
  "panic.ts",
  "result.ts",
  "values.ts",
  "wire.ts"
] as const

/** Value exports the embedded runtime index provides to lowered modules. */
const RUNTIME_VALUE_EXPORTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "failure.ts": [
    "VIBELANG_FAILURE", "VibeLangFailure", "__VSError", "__vsCatch", "catchFailure",
    "isVibeLangFailure", "throwExpression", "__vsThrow"
  ],
  "panic.ts": [
    "Panic", "__vsPanic", "__vsPanicValue", "catchPanic", "catchPanicPromise",
    "isPanic", "makePanic", "panic"
  ],
  "errors.ts": [
    "ErrorCodecError", "UnhandledException", "__vsErrorCases", "__vsRegisterError",
    "__vsValidateForeignError", "decodeError", "encodeError", "errorCases",
    "errorIdentity", "errorIs", "errorMatches", "isLocalError", "matchError",
    "matchErrorPartial", "registerErrorCodec", "registerErrorType", "rootCause"
  ],
  "result.ts": [
    "Result", "ResultValue", "__vsCompleteResult", "__vsInspectResult", "__vsResultFailure",
    "__vsResultSuccess", "foreignBoundary", "foreignBoundaryPromise", "isResult",
    "rethrowPanics", "__vsUnwrapKnownSuccess"
  ],
  "effect.ts": [
    "__vsExpect", "__vsGet", "__vsProvide", "__vsProvideRoot", "__vsPropagate",
    "__vsResultScope", "__vsResultScopeAsync", "__vsRunResult", "__vsRunResultAsync", "__vsPerform", "__vsProvideAsync", "__vsProvideRootAsync"
  ],
  "lexical.ts": ["__vsBindSuper", "__vsSuperReference"],
  "wire.ts": [
    "ValueCodecError", "decodeResult", "encodeResult"
  ],
  "values.ts": ["RuntimeValues"]
})

/** Capability entry points present only as fail-closed stubs. */
const RUNTIME_STUB_EXPORTS = ["Context", "Layer", "__vsUse", "isLayer", "useCapability"] as const

/** Type-only names lowered modules may import; erased before execution. */
const RUNTIME_TYPE_ONLY_EXPORTS = [
  "CapabilityKey", "CapabilityService", "ErrorCase", "ErrorConstructor",
  "ErrorInstance", "ErrorPayloadCodec", "InspectedResult",
  "JsonValue", "LayerType", "NominalError", "ResultType", "ValueCodec",
  "AnyRequest", "AsyncResumable", "Resumable"
] as const

const RUNTIME_IMPORTABLE_NAMES: ReadonlySet<string> = new Set([
  ...Object.values(RUNTIME_VALUE_EXPORTS).flat(),
  ...RUNTIME_STUB_EXPORTS,
  ...RUNTIME_TYPE_ONLY_EXPORTS
])

const RUNTIME_LAYER_CJS = [
  // Capability machinery is deliberately absent from worker bundles. These
  // stubs keep class declarations loadable while any actual use fails closed.
  `const __vibelangNoCapability = (entry) => {`,
  `  throw new TypeError("vibelang worker bundle: " + entry + " requires capability authority, ` +
    `which bundle-executed implementations cannot receive in this POC");`,
  `};`,
  `class Context { constructor() { __vibelangNoCapability("Context"); } ` +
    `static context() { __vibelangNoCapability("Context.context()"); } }`,
  `class Layer { constructor() { __vibelangNoCapability("Layer"); } ` +
    `static of() { __vibelangNoCapability("Layer.of()"); } }`,
  `exports.Context = Context;`,
  `exports.Layer = Layer;`,
  `exports.__vsUse = () => __vibelangNoCapability("__vsUse()");`,
  `exports.isLayer = () => false;`,
  `exports.useCapability = () => __vibelangNoCapability("useCapability()");`,
  ...["__vsLayerEntries", "__vsOpenScope", "__vsInScope", "__vsCloseScope"].map(name =>
    `exports.${name} = () => __vibelangNoCapability(${JSON.stringify(name + "()")});`),
  ``
].join("\n")

const RUNTIME_INDEX_CJS = [
  `"use strict";`,
  `Object.defineProperty(exports, "__esModule", { value: true });`,
  ...RUNTIME_SUBSET_FILES.map((file, index) =>
    `const __vibelangRuntime${index} = require("./${file}");`),
  ...RUNTIME_SUBSET_FILES.flatMap((file, index) =>
    [...RUNTIME_VALUE_EXPORTS[file]!].sort().map((name) =>
      `exports.${name} = __vibelangRuntime${index}.${name};`)),
  `const __vibelangLayer = require("./layer.ts");`,
  ...RUNTIME_STUB_EXPORTS.map(name => `exports.${name} = __vibelangLayer.${name};`),
  ``
].join("\n")

interface BundleModule {
  readonly namespace: string
  readonly path: string
  readonly commonJs: string
}

const transpileToCommonJs = (code: string, label: string): string => {
  // The project compiler has already checked/lowered implementation modules;
  // embedded runtime files are trusted ordinary TypeScript. This operation is
  // erasure/module conversion only, never a fallback for a rejected program.
  // Labels include Action identities, not filesystem paths. Keep them out of
  // native virtual filenames (and retain them only in the host diagnostic).
  const transpiled = getNativeCompiler().transpile({
    files: [{ path: "module.ts", text: code }],
    options: { target: "es2022", module: "commonjs", removeComments: true },
  }).files[0]!
  if (transpiled.emitSkipped) {
    return fail(`bundle module ${label} failed deterministic transpilation`)
  }
  return transpiled.javascript
}

/**
 * A worker bundle is a self-contained runtime instance and must not install
 * ambient globals into its host. The ordinary runtime publishes
 * `Reflect.panic`; this deterministic patch makes the installation block a
 * no-op both in the frozen zero-permission Deno runner and in a Bun worker host
 * that may load another independently content-addressed bundle. It fails
 * closed if the runtime source drifts away from the expected statement.
 */
const PANIC_REFLECT_PATTERN =
  `const reflectPanic = Object.getOwnPropertyDescriptor(Reflect, "panic");`
const PANIC_REFLECT_REPLACEMENT =
  `const reflectPanic = { value: panic }; ` +
  `// vibelang bundle patch: self-contained workers never mutate ambient Reflect`

const patchRuntimeSource = (file: string, source: string): string => {
  if (file !== "panic.ts") return source
  if (!source.includes(PANIC_REFLECT_PATTERN)) {
    return fail(
      "runtime panic.ts no longer matches the bundle's ambient-Reflect patch pattern; " +
      "update pool-bundle.ts alongside the runtime"
    )
  }
  return source.replace(PANIC_REFLECT_PATTERN, PANIC_REFLECT_REPLACEMENT)
}

let cachedRuntimeModules: readonly BundleModule[] | undefined

const workerSourceAsset = (directory: "runtime" | "durable", file: string): string => {
  // Installed source assets must not sit beside .d.ts/.js files: TypeScript
  // resolution would select the source instead of its declaration. They are
  // inert .txt build inputs in an explicit asset directory, never a fallback
  // into a checkout or an unpinned dependency.
  const sourceMode = fileURLToPath(import.meta.url).endsWith(".ts")
  const relative = sourceMode ? `../${directory}/${file}` : `./bundle-assets/${directory}/${file}.txt`
  return readFileSync(new URL(relative, import.meta.url), "utf8")
}

const runtimeModules = (): readonly BundleModule[] => {
  if (cachedRuntimeModules !== undefined) return cachedRuntimeModules
  const modules: BundleModule[] = [{
    namespace: RUNTIME_NAMESPACE,
    path: RUNTIME_INDEX_PATH,
    commonJs: RUNTIME_INDEX_CJS
  }, {
    // Delimiters share the real implementation; only the authority seam is
    // replaced. No duplicate Result runtime and no host async-hooks imports.
    namespace: RUNTIME_NAMESPACE,
    path: "layer.ts",
    commonJs: RUNTIME_LAYER_CJS
  }]
  for (const file of RUNTIME_SUBSET_FILES) {
    const source = patchRuntimeSource(file, workerSourceAsset("runtime", file))
    modules.push({
      namespace: RUNTIME_NAMESPACE,
      path: file,
      commonJs: transpileToCommonJs(source, `runtime/${file}`)
    })
  }
  cachedRuntimeModules = Object.freeze(modules)
  return cachedRuntimeModules
}

// ---------------------------------------------------------------------------
// Checked implementation lowering
// ---------------------------------------------------------------------------

const loweredModulePath = (fileName: string): string => {
  const normalized = fileName.replace(/\\/g, "/").split("/")
    .filter((part) => part !== "" && part !== "." && part !== "..")
    .join("/")
  if (normalized === "") return fail(`bundle source has an empty logical file name: ${fileName}`)
  return normalized.replace(/\.vibe$/, ".ts")
}

interface BundledAction {
  readonly completion?: "value" | "promise"
  readonly actionId: string
  readonly actionVersion: number
  readonly actionContractDigest: string
  readonly implementationContractDigest: string
  readonly checkedExportDigest: string
  readonly namespace: string
  readonly entryModule: string
  readonly exportName: string
  readonly errorVariants: readonly {
    readonly identity: string
    /**
     * The compiler-issued nominal Error identity the bundle SELECTS this variant
     * by at dispatch. Never a class name: see {@link DISPATCH_SOURCE}.
     */
    readonly nominalIdentity: string
    readonly name: string
    readonly fields: readonly { readonly name: string; readonly optional: boolean }[]
  }[]
  readonly modules: readonly BundleModule[]
}

const errorVariantsFor = (
  action: ActionDescriptor,
  nominalIdentityByClass: ReadonlyMap<string, string>,
  poolId: string
): BundledAction["errorVariants"] => {
  if (action.errorSchema.shape !== "structural") return []
  const variants: {
    identity: string
    nominalIdentity: string
    name: string
    fields: { name: string; optional: boolean }[]
  }[] = []
  const visit = (descriptor: DurableTypeDescriptor): void => {
    if (descriptor.kind === "never") return
    if (descriptor.kind === "union") {
      for (const variant of descriptor.variants) visit(variant)
      return
    }
    if (descriptor.kind !== "error") {
      return fail(`Action ${action.id} error schema is not a nominal Error or Error union`)
    }
    // The join is on the class DECLARATION name, at BUILD time, between the
    // Action contract's declared failure row and the registrations the lowered
    // closure emitted. Nothing a payload can reach participates: the value it
    // produces is the compiler-issued identity, and that is the only thing
    // dispatch compares. `implementation-contract.ts` already refuses a closure
    // in which a declared failure name resolves to anything other than exactly
    // one Error class, so this join has exactly one candidate or the build fails.
    const nominalIdentity = nominalIdentityByClass.get(descriptor.name)
    if (nominalIdentity === undefined) {
      return fail(
        `pool ${poolId} cannot bundle ${action.id}: declared failure ${descriptor.name} has no compiler-issued ` +
        `nominal Error identity in the checked source closure, so a bundled failure could not be selected by identity`
      )
    }
    variants.push({
      identity: descriptor.identity,
      nominalIdentity,
      name: descriptor.name,
      fields: descriptor.payload.fields.map((field) => ({ name: field.name, optional: field.optional }))
    })
  }
  visit(action.errorSchema.descriptor)
  const claimed = new Map<string, string>()
  for (const variant of variants) {
    const prior = claimed.get(variant.nominalIdentity)
    if (prior !== undefined && prior !== variant.identity) {
      return fail(
        `pool ${poolId} cannot bundle ${action.id}: declared failures ${prior} and ${variant.identity} share ` +
        `nominal Error identity ${variant.nominalIdentity}, so the bundle could not tell them apart`
      )
    }
    claimed.set(variant.nominalIdentity, variant.identity)
  }
  return variants.sort((left, right) => left.identity < right.identity ? -1 : left.identity > right.identity ? 1 : 0)
}

const bundleActionFor = (selection: WorkerPoolBundleSelection, poolId: string, keyed: boolean): BundledAction => {
  const action = selection.action
  const contract = selection.contract
  if (contract.actionId !== action.id || contract.actionContractDigest !== action.contractDigest) {
    return fail(`pool ${poolId} bundle selection for ${action.id} does not match its implementation contract`)
  }
  if (contract.requirements.length > 0) {
    return fail(
      `pool ${poolId} cannot bundle ${action.id}: implementation requires capabilities ` +
      `[${contract.requirements.join(", ")}] and worker bundles carry no capability authority in this POC`
    )
  }
  let retained
  try {
    retained = retainedCheckedImplementationProject(contract)
  } catch (error) {
    return fail(
      `pool ${poolId} cannot bundle ${action.id}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (keyed && retained.completion !== "value" && retained.completion !== "promise") return fail("keyed provider has no native completion convention")
  const namespace = `action:${contract.digest}`
  const compiled = compileProject(
    retained.sources.map((source) => ({ fileName: source.fileName, source: source.source })),
    {
      outDir: "/vibelang-pool-bundle-emit",
      runtimeImport: RUNTIME_IMPORT_SPECIFIER,
      sourceMap: false,
      ...(retained.rootDir === undefined ? {} : { rootDir: retained.rootDir })
    }
  )
  if (compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return fail(`pool ${poolId} bundle compilation of ${action.id} produced diagnostics`)
  }
  const modulePaths = new Set<string>()
  const emitted: { path: string; code: string }[] = []
  for (const source of retained.sources) {
    const file = compiled.files[source.fileName]
    if (file === undefined) {
      return fail(`pool ${poolId} bundle compilation of ${action.id} did not emit ${source.fileName}`)
    }
    const path = loweredModulePath(source.fileName)
    if (modulePaths.has(path)) {
      return fail(`pool ${poolId} bundle for ${action.id} has colliding module path ${path}`)
    }
    modulePaths.add(path)
    emitted.push({ path, code: file.code })
  }
  const modules: BundleModule[] = []
  const sorted = [...emitted].sort((left, right) => left.path < right.path ? -1 : 1)
  const analyzed = getNativeCompiler().bundleModules({
    files: sorted.map(file => ({ path: file.path, text: file.code })),
    runtimeSpecifier: RUNTIME_IMPORT_SPECIFIER,
    runtimeHelpers: [...RUNTIME_IMPORTABLE_NAMES],
    registrationExport: "__vsRegisterError",
  })
  const refusal = analyzed.diagnostics[0]
  if (refusal !== undefined) return fail(`${action.id}:${refusal.path} ${refusal.message}`)
  // Read the exact keys issued by lowering, never re-mint them from filenames.
  // Go resolves the imported registration binding, so a shadowed local cannot
  // forge a fact. Ambiguity across the whole closure fails before any assembly.
  const nominalIdentityByClass = new Map(analyzed.registrations.map(item => [item.className, item.identity]))
  for (const file of sorted) {
    modules.push({
      namespace,
      path: file.path,
      commonJs: transpileToCommonJs(file.code, `${namespace}/${file.path}`)
    })
  }
  const entryModule = loweredModulePath(retained.entryFile)
  if (!modulePaths.has(entryModule)) {
    return fail(`pool ${poolId} bundle for ${action.id} is missing its entry module ${entryModule}`)
  }
  return {
    ...(keyed ? { completion: retained.completion } : {}),
    actionId: action.id,
    actionVersion: action.version,
    actionContractDigest: action.contractDigest,
    implementationContractDigest: contract.digest,
    checkedExportDigest: contract.checkedExportDigest,
    namespace,
    entryModule,
    exportName: retained.exportName,
    errorVariants: errorVariantsFor(action, nominalIdentityByClass, poolId),
    modules
  }
}

// ---------------------------------------------------------------------------
// Deterministic assembly
// ---------------------------------------------------------------------------

const moduleDefinition = (module: BundleModule): string => [
  `__vibelangDefine(${JSON.stringify(module.namespace)}, ${JSON.stringify(module.path)}, ` +
    `function (exports, require, module, Error, EvalError, RangeError, ReferenceError, ` +
    `SyntaxError, TypeError, URIError) {`,
  module.commonJs,
  `});`
].join("\n")

const DISPATCH_SOURCE = `
function __vibelangCheckPrototypeChain(value, isProxy) {
  if (!isProxy || value === null || (typeof value !== "object" && typeof value !== "function")) return;
  let current = value;
  for (let depth = 0; current !== null; depth++) {
    if (depth > 128 || isProxy(current)) throw new TypeError("keyed provider value has a proxy or excessive prototype chain");
    current = Object.getPrototypeOf(current);
  }
}
function __vibelangDataProperty(value, key, isProxy) {
  __vibelangCheckPrototypeChain(value, isProxy);
  for (let current = value; current !== null; current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) {
      if (!("value" in descriptor)) throw new TypeError("typed failure payload is not inert data");
      return descriptor.value;
    }
  }
  return undefined;
}
function __vibelangDefect(name, message) {
  return { kind: "defect", defect: { name: name, message: String(message) } };
}
function __vibelangThrownDefect(thrown, isProxy) {
  try {
    if (isProxy) {
      if (thrown !== null && (typeof thrown === "object" || typeof thrown === "function")) {
        if (isProxy(thrown)) return __vibelangDefect("ThrownDefect", "provider threw a proxy value");
        const name = Object.getOwnPropertyDescriptor(thrown, "name");
        const message = Object.getOwnPropertyDescriptor(thrown, "message");
        return __vibelangDefect(
          name && "value" in name && typeof name.value === "string" ? name.value : "ThrownDefect",
          message && "value" in message && typeof message.value === "string" ? message.value : "provider threw a non-data defect"
        );
      }
      return __vibelangDefect("ThrownDefect", thrown);
    }
    if (thrown !== null && typeof thrown === "object") {
      const name = typeof thrown.name === "string" ? thrown.name : "ThrownDefect";
      const message = typeof thrown.message === "string" ? thrown.message : String(thrown);
      const stack = typeof thrown.stack === "string" ? thrown.stack : undefined;
      return {
        kind: "defect",
        defect: stack === undefined
          ? { name: name, message: message }
          : { name: name, message: message, stack: stack }
      };
    }
    return __vibelangDefect("ThrownDefect", thrown);
  } catch (hostile) {
    return __vibelangDefect("DefectCodecDefect", "thrown value could not be encoded");
  }
}
// Which declared failure a raised Error IS, selected by the compiler-issued
// nominal Error identity and by nothing else.
//
// \`error.constructor.name\` used to be the key here, and it is not one.
// \`constructor\` is an ordinary property lookup, so an own field shadows the
// prototype's, and \`name\` is a string: between them the PAYLOAD could name its
// own failure identity. Measured on this bundle before this line changed, with
// implementations the checked-implementation compiler accepts unchanged
// (\`Object.defineProperty(err, "constructor", …)\`, \`Object.assign\`, or a plain
// computed \`err["constructor"] = …\`): a genuine \`Denied\` selected the \`Failed\`
// variant, and erasing \`constructor\` turned a typed business failure into a
// defect — which \`engine.ts\` then AUTO-RETRIES. Neither outcome is a refusal.
//
// \`runtime.errorIdentity\` is the compiler-issued key instead: the transport
// registry in \`runtime/errors.ts\`, keyed by PROTOTYPE identity in a WeakMap,
// populated by the \`__vsRegisterError(Class, "vibelang:<file>:<Class>")\` calls
// the lowered modules emit and this bundle's \`errorVariants\` were built from.
// Nothing readable from the value reaches it: it is \`Object.getPrototypeOf\` and
// a WeakMap lookup, behind a native \`instanceof\`. An Error with no registration
// — a foreign throw, a decoded impostor — answers \`undefined\` and fails closed.
//
// specification/failures.mdx §Error Prototype: "Handler selection MUST use
// compiler-stable nominal identity, not a forgeable user \`_tag\` or
// minifier-sensitive constructor name in compiled artifacts."
function __vibelangTypedFailure(runtime, action, error, isProxy) {
  __vibelangCheckPrototypeChain(error, isProxy);
  let identity;
  try {
    identity = runtime.errorIdentity(error);
  } catch (hostile) {
    identity = undefined;
  }
  const matches = typeof identity !== "string"
    ? []
    : action.errorVariants.filter(function (variant) { return variant.nominalIdentity === identity; });
  if (matches.length !== 1) {
    return __vibelangDefect(
      "BundleFailureMappingDefect",
      "bundle could not map failure " +
        (typeof identity === "string" ? identity : "with no compiler-issued Error identity") +
        " for " + action.actionId
    );
  }
  const variant = matches[0];
  // A null prototype keeps a declared payload field named "__proto__" as data:
  // into {} the assignment below would go through Object.prototype's setter for
  // that name and the field would leave the wire silently.
  const payload = Object.create(null);
  for (const field of variant.fields) {
    let value;
    try { value = isProxy ? __vibelangDataProperty(error, field.name, isProxy) : error[field.name]; }
    catch { return __vibelangDefect("BundleFailureMappingDefect", "typed failure payload is not inert data"); }
    if (value === undefined) {
      if (!field.optional) {
        return __vibelangDefect(
          "BundleFailureMappingDefect",
          "failure " + variant.name + " is missing payload field " + field.name
        );
      }
      continue;
    }
    payload[field.name] = value;
  }
  return { kind: "failure", error: { version: 1, identity: variant.identity, payload: payload } };
}
// \`signal\` is the caller's execution budget. An in-process host cannot preempt
// a synchronous body, but it CAN refuse to start abandoned work and refuse to
// hand back a result the caller has already stopped waiting for, which is what
// keeps a timed-out dispatch from committing a second exit for the same attempt.
async function __vibelangInvokeAction(invocation, signal, isProxy) {
  try {
    if (signal && signal.aborted) {
      return __vibelangDefect("InvocationCancelled", "bundle invocation was cancelled before dispatch");
    }
    if (invocation === null || typeof invocation !== "object" || typeof invocation.actionId !== "string") {
      return __vibelangDefect("BundleInvocationDefect", "bundle invocation must name an actionId");
    }
    const action = __vibelangActionTable.get(invocation.actionId);
    if (action === undefined) {
      return __vibelangDefect("RoutingDefect", "bundle has no Action " + invocation.actionId);
    }
    if (
      invocation.actionVersion !== action.actionVersion ||
      invocation.actionContractDigest !== action.actionContractDigest
    ) {
      return __vibelangDefect(
        "ManifestVerificationDefect",
        "bundle rejected " + invocation.actionId + " contract identity"
      );
    }
    const runtime = __vibelangLoad("runtime", "index.ts");
    let entry;
    try {
      const moduleExports = __vibelangLoad(action.namespace, action.entryModule);
      entry = moduleExports[action.exportName];
    } catch (loadError) {
      return __vibelangThrownDefect(loadError, isProxy);
    }
    if (typeof entry !== "function") {
      return __vibelangDefect(
        "BundleEntryDefect",
        "bundle module " + action.entryModule + " does not export function " + action.exportName
      );
    }
    let output;
    try {
      const completion = entry(invocation.input);
      __vibelangCheckPrototypeChain(completion, isProxy);
      output = isProxy && action.completion === "value" ? completion : await completion;
    } catch (thrown) {
      return __vibelangThrownDefect(thrown, isProxy);
    }
    if (signal && signal.aborted) {
      return __vibelangDefect("InvocationCancelled", "bundle invocation was cancelled before it produced a result");
    }
    __vibelangCheckPrototypeChain(output, isProxy);
    if (runtime.isResult(output)) {
      const inspected = runtime.__vsInspectResult(output);
      if (inspected.ok) return { kind: "success", value: inspected.value };
      const error = inspected.error;
      __vibelangCheckPrototypeChain(error, isProxy);
      if (runtime.isPanic(error)) {
        if (isProxy) {
          const defect = __vibelangThrownDefect(error, isProxy);
          return __vibelangDefect("Panic", defect.defect.message);
        }
        return __vibelangDefect("Panic", error && error.message ? error.message : "VibeLang panic");
      }
      return __vibelangTypedFailure(runtime, action, error, isProxy);
    }
    return { kind: "success", value: output };
  } catch (unexpected) {
    return __vibelangThrownDefect(unexpected, isProxy);
  }
}
`

const LOADER_SOURCE = `
// Every module resolves the identifier Error to this bundle-local subclass.
// The VibeLang runtime may therefore install its Error convenience methods without
// mutating host Error.prototype or colliding with another pool bundle.
const __vibelangHostError = globalThis.Error;
class __vibelangBundleError extends __vibelangHostError {}
function __vibelangBuiltinError(name) {
  return class extends __vibelangBundleError {
    constructor(...args) {
      super(...args);
      this.name = name;
    }
  };
}
const __vibelangBundleEvalError = __vibelangBuiltinError("EvalError");
const __vibelangBundleRangeError = __vibelangBuiltinError("RangeError");
const __vibelangBundleReferenceError = __vibelangBuiltinError("ReferenceError");
const __vibelangBundleSyntaxError = __vibelangBuiltinError("SyntaxError");
const __vibelangBundleTypeError = __vibelangBuiltinError("TypeError");
const __vibelangBundleURIError = __vibelangBuiltinError("URIError");
const __vibelangModules = new Map();
function __vibelangDefine(namespace, path, factory) {
  __vibelangModules.set(namespace + "\\u0001" + path, { factory: factory, exports: null, state: "defined" });
}
function __vibelangResolveRelative(fromPath, specifier) {
  const parts = fromPath.split("/");
  parts.pop();
  for (const segment of specifier.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) throw new Error("vibelang bundle: import escapes the bundle: " + specifier);
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join("/");
}
function __vibelangLoad(namespace, path) {
  const key = namespace + "\\u0001" + path;
  const entry = __vibelangModules.get(key);
  if (entry === undefined) throw new Error("vibelang bundle: unknown module " + namespace + ":" + path);
  if (entry.state === "loaded" || entry.state === "loading") return entry.exports;
  entry.state = "loading";
  const moduleObject = { exports: {} };
  entry.exports = moduleObject.exports;
  const localRequire = function (specifier) {
    if (specifier === ${JSON.stringify(RUNTIME_IMPORT_SPECIFIER)}) {
      return __vibelangLoad(${JSON.stringify(RUNTIME_NAMESPACE)}, ${JSON.stringify(RUNTIME_INDEX_PATH)});
    }
    if (specifier.startsWith(".")) {
      return __vibelangLoad(namespace, __vibelangResolveRelative(path, specifier));
    }
    throw new Error("vibelang bundle: unsupported import " + specifier);
  };
  entry.factory.call(
    undefined,
    moduleObject.exports,
    localRequire,
    moduleObject,
    __vibelangBundleError,
    __vibelangBundleEvalError,
    __vibelangBundleRangeError,
    __vibelangBundleReferenceError,
    __vibelangBundleSyntaxError,
    __vibelangBundleTypeError,
    __vibelangBundleURIError
  );
  entry.exports = moduleObject.exports;
  entry.state = "loaded";
  return entry.exports;
}
`

/**
 * Build one deterministic pool bundle. Identical inputs yield byte-identical
 * `javascript` and therefore an identical `digest`.
 */
export const buildWorkerPoolBundle = (options: BuildWorkerPoolBundleOptions): WorkerPoolBundle => {
  const poolId = options.poolId
  const target = options.target, sandbox = options.sandbox, requestedSelections = options.selections
  if (typeof poolId !== "string" || poolId.trim() === "") return fail("bundle pool id must be non-empty")
  if (typeof target !== "string" || target.trim() === "") {
    return fail(`bundle pool ${poolId} target must be non-empty`)
  }
  if (typeof sandbox !== "string" || sandbox.trim() === "") {
    return fail(`bundle pool ${poolId} sandbox must be non-empty`)
  }
  if (!Array.isArray(requestedSelections)) return fail(`bundle pool ${poolId} selections must be an array`)
  const valueCodec = options.valueCodec
  if (valueCodec !== undefined && valueCodec !== "vibelang/keyed-source/v2") return fail("unknown worker value codec")
  const selections = valueCodec === undefined ? requestedSelections : requestedSelections.map(selection => ({
    // Inspect the compiler proof before reading any caller-owned contract fields.
    contract: requireCompilerCheckedValueBoundary(selection.contract),
    action: validateActionContractDescriptor(snapshotKeyedJSON(selection.action)),
  }))
  const seen = new Set<string>()
  for (const selection of selections) {
    if (valueCodec !== undefined) requireCompilerCheckedValueBoundary(selection.contract)
    if (seen.has(selection.action.id)) return fail(`bundle pool ${poolId} selects ${selection.action.id} twice`)
    seen.add(selection.action.id)
  }
  const actions = [...selections]
    .sort((left, right) => left.action.id < right.action.id ? -1 : left.action.id > right.action.id ? 1 : 0)
    .map((selection) => bundleActionFor(selection, poolId, valueCodec !== undefined))
  const actionIds = actions.map((action) => action.actionId)

  const meta = assertJson({
    formatVersion: BUNDLE_FORMAT_VERSION,
    poolId,
    target,
    sandbox,
    actionIds,
    ...(valueCodec === undefined ? {} : { valueCodec }),
    actions: actions.map((action) => ({
      ...(action.completion === undefined ? {} : { completion: action.completion }),
      actionId: action.actionId,
      actionVersion: action.actionVersion,
      actionContractDigest: action.actionContractDigest,
      implementationContractDigest: action.implementationContractDigest,
      checkedExportDigest: action.checkedExportDigest,
      namespace: action.namespace,
      entryModule: action.entryModule,
      exportName: action.exportName,
      errorVariants: action.errorVariants
    }))
  }, "worker pool bundle metadata")

  const lines: string[] = [
    `"use strict";`,
    `// VibeLang tree-shaken worker pool bundle. Format version ${BUNDLE_FORMAT_VERSION}.`,
    `// This file is content-addressed: its SHA-256 is the pool bundleDigest`,
    `// inside the signed deployment manifest. Do not edit.`,
    `const __vibelangBundleMeta = ${canonicalJson(meta)};`,
    LOADER_SOURCE.trim()
  ]
  for (const module of runtimeModules()) lines.push(moduleDefinition(module))
  if (valueCodec !== undefined) {
    const path = "keyed-value-core.ts"
    const core = workerSourceAsset("durable", path)
    lines.push(moduleDefinition({ namespace: "value-codec", path, commonJs: transpileToCommonJs(core, path) }))
  }
  for (const action of actions) {
    for (const module of action.modules) lines.push(moduleDefinition(module))
  }
  lines.push(
    `const __vibelangActionTable = new Map(__vibelangBundleMeta.actions.map(function (action) { ` +
      `return [action.actionId, action]; }));`,
    DISPATCH_SOURCE.trim(),
    ...(valueCodec === undefined ? [] : [KEYED_DISPATCH_SOURCE.trim(), `export { __vibelangInvokeKeyedAction };`]),
    `export { __vibelangInvokeAction };`,
    `export const __vibelangPoolBundle = __vibelangBundleMeta;`,
    ``
  )
  const javascript = lines.join("\n")
  if (Buffer.byteLength(javascript, "utf8") > MAX_POOL_BUNDLE_BYTES) {
    return fail(`bundle pool ${poolId} exceeds ${MAX_POOL_BUNDLE_BYTES} bytes`)
  }
  const bundle = deepFreeze({
    formatVersion: BUNDLE_FORMAT_VERSION,
    poolId,
    actionIds: actionIds as readonly string[],
    javascript,
    digest: sha256Utf8(javascript)
  })
  if (valueCodec !== undefined) checkedKeyedBundles.set(bundle, deepFreeze({bundle,
    target, sandbox, selections: [...selections]}))
  return bundle
}

/**
 * Validate a bundle envelope and recompute its content digest. This checks
 * byte identity, not provenance: a signature over the manifest that pins this
 * digest is what makes the bytes trustworthy.
 */
export const validateWorkerPoolBundle = (value: unknown): WorkerPoolBundle => {
  const record = assertJson(value, "worker pool bundle") as unknown
  if (record === null || typeof record !== "object" || Array.isArray(record) ||
    canonicalJson(Object.keys(record).sort()) !==
      canonicalJson(["actionIds", "digest", "formatVersion", "javascript", "poolId"])) {
    return fail("worker pool bundle has an invalid envelope")
  }
  const candidate = record as WorkerPoolBundle
  if (candidate.formatVersion !== BUNDLE_FORMAT_VERSION) return fail("unsupported worker pool bundle format")
  if (typeof candidate.poolId !== "string" || candidate.poolId.trim() === "") {
    return fail("worker pool bundle pool id must be non-empty")
  }
  if (!Array.isArray(candidate.actionIds) ||
    candidate.actionIds.some((id) => typeof id !== "string" || id.trim() === "") ||
    canonicalJson(candidate.actionIds) !== canonicalJson([...new Set(candidate.actionIds)].sort())) {
    return fail("worker pool bundle action ids must be sorted and unique")
  }
  if (typeof candidate.javascript !== "string" ||
    Buffer.byteLength(candidate.javascript, "utf8") > MAX_POOL_BUNDLE_BYTES) {
    return fail("worker pool bundle source is missing or exceeds its size limit")
  }
  if (typeof candidate.digest !== "string" || !HEX_DIGEST.test(candidate.digest)) {
    return fail("worker pool bundle digest must be a lowercase SHA-256 digest")
  }
  if (sha256Utf8(candidate.javascript) !== candidate.digest) {
    return fail("worker pool bundle digest does not match its bytes")
  }
  return deepFreeze(record as unknown as WorkerPoolBundle)
}

export const WorkerPoolBundles = Object.freeze({
  build: buildWorkerPoolBundle,
  validate: validateWorkerPoolBundle,
  sha256: sha256Utf8
})

/** @internal exposed for the bundle-executing workers' driver composition. */
export const bundleInvocationDriver = (invocationJson: string): string => [
  ``,
  `// --- bundle-executing worker driver (appended after digest verification) ---`,
  `const __vibelangInvocation = JSON.parse(${JSON.stringify(invocationJson)});`,
  `export default async function __vibelangWorkerMain() {`,
  `  return await __vibelangInvokeAction(__vibelangInvocation);`,
  `}`,
  ``
].join("\n")

/** @internal Compiler-owned adapter. The exact codec bytes are in the bundle
 * digest; the native inspection hook belongs to the separately pinned runner. */
const KEYED_DISPATCH_SOURCE = `
async function __vibelangInvokeKeyedAction(invocation, inspection) {
  if (!inspection || typeof inspection.isProxy !== "function") {
    throw new TypeError("keyed worker requires the pinned runner's native value inspector");
  }
  const codec = __vibelangLoad("value-codec", "keyed-value-core.ts").createKeyedValueCodec(inspection.isProxy);
  const input = codec.decodeKeyedValue(invocation.input);
  const exit = await __vibelangInvokeAction({ ...invocation, input }, undefined, inspection.isProxy);
  if (exit.kind === "success") return { kind: "success", value: codec.encodeKeyedValue(exit.value) };
  if (exit.kind === "failure") return { kind: "failure", error: codec.encodeKeyedValue(exit.error) };
  return codec.snapshotKeyedJSON(exit);
}
`

/** @internal Input is already encoded keyed data. Never pass canonicalized
 * ordinary author data here: that would erase order before decoding. */
export const keyedBundleInvocationDriver = (invocationJson: string): string => [
  ``,
  `const __vibelangKeyedInvocation = JSON.parse(${JSON.stringify(invocationJson)});`,
  `export default async function __vibelangKeyedWorkerMain(_functions, inspection) {`,
  `  return await __vibelangInvokeKeyedAction(__vibelangKeyedInvocation, inspection);`,
  `}`,
  ``
].join("\n")
