import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import * as ts from "typescript-js"
import { compileProject } from "../language/project-compile.ts"
import {
  retainedCheckedImplementationProject
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
  "optional.ts",
  "panic.ts",
  "result.ts",
  "values.ts",
  "wire.ts"
] as const

/** Value exports the embedded runtime index provides to lowered modules. */
const RUNTIME_VALUE_EXPORTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "failure.ts": [
    "VIBE_FAILURE", "VibeFailure", "__VSError", "__vsCatch", "catchFailure",
    "isVibeFailure", "unwrapOptional", "__vsUnwrap", "throwExpression", "__vsThrow"
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
    "Result", "ResultValue", "__vsInspectResult", "__vsResultFailure",
    "__vsResultSuccess", "foreignBoundary", "foreignBoundaryPromise", "isResult",
    "rethrowPanics"
  ],
  "optional.ts": [
    "MissingOptionalValue", "Optional", "OptionalValue", "__vsInspectOptional",
    "__vsOptionalNone", "__vsOptionalSome", "isOptional"
  ],
  "wire.ts": [
    "ValueCodecError", "decodeOptional", "decodeResult", "encodeOptional", "encodeResult"
  ],
  "values.ts": ["RuntimeValues"]
})

/** Capability entry points present only as fail-closed stubs. */
const RUNTIME_STUB_EXPORTS = ["Context", "Layer", "__vsUse", "isLayer", "useCapability"] as const

/** Type-only names lowered modules may import; erased before execution. */
const RUNTIME_TYPE_ONLY_EXPORTS = [
  "CapabilityKey", "CapabilityService", "ErrorCase", "ErrorConstructor",
  "ErrorInstance", "ErrorPayloadCodec", "InspectedOptional", "InspectedResult",
  "JsonValue", "LayerType", "NominalError", "OptionalType", "ResultType", "ValueCodec"
] as const

const RUNTIME_IMPORTABLE_NAMES: ReadonlySet<string> = new Set([
  ...Object.values(RUNTIME_VALUE_EXPORTS).flat(),
  ...RUNTIME_STUB_EXPORTS,
  ...RUNTIME_TYPE_ONLY_EXPORTS
])

const RUNTIME_INDEX_CJS = [
  `"use strict";`,
  `Object.defineProperty(exports, "__esModule", { value: true });`,
  ...RUNTIME_SUBSET_FILES.map((file, index) =>
    `const __vibeRuntime${index} = require("./${file}");`),
  ...RUNTIME_SUBSET_FILES.flatMap((file, index) =>
    [...RUNTIME_VALUE_EXPORTS[file]!].sort().map((name) =>
      `exports.${name} = __vibeRuntime${index}.${name};`)),
  // Capability machinery is deliberately absent from worker bundles. These
  // stubs keep class declarations loadable while any actual use fails closed.
  `const __vibeNoCapability = (entry) => {`,
  `  throw new TypeError("vibelang worker bundle: " + entry + " requires capability authority, ` +
    `which bundle-executed implementations cannot receive in this POC");`,
  `};`,
  `class Context { constructor() { __vibeNoCapability("Context"); } ` +
    `static context() { __vibeNoCapability("Context.context()"); } }`,
  `class Layer { constructor() { __vibeNoCapability("Layer"); } ` +
    `static of() { __vibeNoCapability("Layer.of()"); } }`,
  `exports.Context = Context;`,
  `exports.Layer = Layer;`,
  `exports.__vsUse = () => __vibeNoCapability("__vsUse()");`,
  `exports.isLayer = () => false;`,
  `exports.useCapability = () => __vibeNoCapability("useCapability()");`,
  ``
].join("\n")

interface BundleModule {
  readonly namespace: string
  readonly path: string
  readonly commonJs: string
}

const transpileToCommonJs = (code: string, label: string): string => {
  const transpiled = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      removeComments: true
    },
    fileName: `${label}.ts`,
    reportDiagnostics: true
  })
  if (transpiled.diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    return fail(`bundle module ${label} failed deterministic transpilation`)
  }
  return transpiled.outputText
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

const runtimeModules = (): readonly BundleModule[] => {
  if (cachedRuntimeModules !== undefined) return cachedRuntimeModules
  const runtimeDir = resolve(dirname(fileURLToPath(import.meta.url)), "../runtime")
  const modules: BundleModule[] = [{
    namespace: RUNTIME_NAMESPACE,
    path: RUNTIME_INDEX_PATH,
    commonJs: RUNTIME_INDEX_CJS
  }]
  for (const file of RUNTIME_SUBSET_FILES) {
    const source = patchRuntimeSource(file, readFileSync(resolve(runtimeDir, file), "utf8"))
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

const resolveRelativePath = (fromPath: string, specifier: string): string => {
  const parts = fromPath.split("/")
  parts.pop()
  for (const segment of specifier.split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      if (parts.length === 0) return fail(`bundle import '${specifier}' escapes the checked source closure`)
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return parts.join("/")
}

const assertBundleImports = (
  emittedCode: string,
  modulePath: string,
  modulePaths: ReadonlySet<string>,
  label: string
): void => {
  const sourceFile = ts.createSourceFile(`${label}.ts`, emittedCode, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier)) {
      return fail(`${label} has a non-literal import specifier`)
    }
    const specifier = statement.moduleSpecifier.text
    if (specifier === RUNTIME_IMPORT_SPECIFIER) {
      const bindings = statement.importClause?.namedBindings
      if (statement.importClause?.name !== undefined || bindings === undefined || !ts.isNamedImports(bindings)) {
        return fail(`${label} must import compiler helpers as named bindings`)
      }
      for (const element of bindings.elements) {
        const imported = (element.propertyName ?? element.name).text
        if (!RUNTIME_IMPORTABLE_NAMES.has(imported)) {
          return fail(
            `${label} imports runtime helper '${imported}' which the embedded worker bundle runtime does not provide`
          )
        }
      }
      continue
    }
    if (specifier.startsWith(".")) {
      const resolved = resolveRelativePath(modulePath, specifier)
      if (!modulePaths.has(resolved)) {
        return fail(`${label} imports '${specifier}' which is outside the checked source closure`)
      }
      continue
    }
    return fail(`${label} imports external module '${specifier}'; worker bundles must be self-contained`)
  }
}

interface BundledAction {
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
    readonly name: string
    readonly fields: readonly { readonly name: string; readonly optional: boolean }[]
  }[]
  readonly modules: readonly BundleModule[]
}

const errorVariantsFor = (action: ActionDescriptor): BundledAction["errorVariants"] => {
  if (action.errorSchema.shape !== "structural") return []
  const variants: {
    identity: string
    name: string
    fields: { name: string; optional: boolean }[]
  }[] = []
  const visit = (descriptor: DurableTypeDescriptor): void => {
    if (descriptor.kind === "union") {
      for (const variant of descriptor.variants) visit(variant)
      return
    }
    if (descriptor.kind !== "error") {
      return fail(`Action ${action.id} error schema is not a nominal Error or Error union`)
    }
    variants.push({
      identity: descriptor.identity,
      name: descriptor.name,
      fields: descriptor.payload.fields.map((field) => ({ name: field.name, optional: field.optional }))
    })
  }
  visit(action.errorSchema.descriptor)
  return variants.sort((left, right) => left.identity < right.identity ? -1 : left.identity > right.identity ? 1 : 0)
}

const bundleActionFor = (selection: WorkerPoolBundleSelection, poolId: string): BundledAction => {
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
  for (const file of [...emitted].sort((left, right) => left.path < right.path ? -1 : 1)) {
    assertBundleImports(file.code, file.path, modulePaths, `${action.id}:${file.path}`)
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
    actionId: action.id,
    actionVersion: action.version,
    actionContractDigest: action.contractDigest,
    implementationContractDigest: contract.digest,
    checkedExportDigest: contract.checkedExportDigest,
    namespace,
    entryModule,
    exportName: retained.exportName,
    errorVariants: errorVariantsFor(action),
    modules
  }
}

// ---------------------------------------------------------------------------
// Deterministic assembly
// ---------------------------------------------------------------------------

const moduleDefinition = (module: BundleModule): string => [
  `__vibeDefine(${JSON.stringify(module.namespace)}, ${JSON.stringify(module.path)}, ` +
    `function (exports, require, module, Error, EvalError, RangeError, ReferenceError, ` +
    `SyntaxError, TypeError, URIError) {`,
  module.commonJs,
  `});`
].join("\n")

const DISPATCH_SOURCE = `
function __vibeDefect(name, message) {
  return { kind: "defect", defect: { name: name, message: String(message) } };
}
function __vibeThrownDefect(thrown) {
  try {
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
    return __vibeDefect("ThrownDefect", thrown);
  } catch (hostile) {
    return __vibeDefect("DefectCodecDefect", "thrown value could not be encoded");
  }
}
function __vibeTypedFailure(action, error) {
  const name = error && error.constructor ? error.constructor.name : undefined;
  const matches = action.errorVariants.filter(function (variant) { return variant.name === name; });
  if (matches.length !== 1) {
    return __vibeDefect(
      "BundleFailureMappingDefect",
      "bundle could not map failure " + String(name) + " for " + action.actionId
    );
  }
  const variant = matches[0];
  const payload = {};
  for (const field of variant.fields) {
    const value = error[field.name];
    if (value === undefined) {
      if (!field.optional) {
        return __vibeDefect(
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
async function __vibeInvokeAction(invocation) {
  try {
    if (invocation === null || typeof invocation !== "object" || typeof invocation.actionId !== "string") {
      return __vibeDefect("BundleInvocationDefect", "bundle invocation must name an actionId");
    }
    const action = __vibeActionTable.get(invocation.actionId);
    if (action === undefined) {
      return __vibeDefect("RoutingDefect", "bundle has no Action " + invocation.actionId);
    }
    if (
      invocation.actionVersion !== action.actionVersion ||
      invocation.actionContractDigest !== action.actionContractDigest
    ) {
      return __vibeDefect(
        "ManifestVerificationDefect",
        "bundle rejected " + invocation.actionId + " contract identity"
      );
    }
    const runtime = __vibeLoad("runtime", "index.ts");
    let entry;
    try {
      const moduleExports = __vibeLoad(action.namespace, action.entryModule);
      entry = moduleExports[action.exportName];
    } catch (loadError) {
      return __vibeThrownDefect(loadError);
    }
    if (typeof entry !== "function") {
      return __vibeDefect(
        "BundleEntryDefect",
        "bundle module " + action.entryModule + " does not export function " + action.exportName
      );
    }
    let output;
    try {
      output = await entry(invocation.input);
    } catch (thrown) {
      return __vibeThrownDefect(thrown);
    }
    if (runtime.isResult(output)) {
      const inspected = runtime.__vsInspectResult(output);
      if (inspected.ok) return { kind: "success", value: inspected.value };
      const error = inspected.error;
      if (runtime.isPanic(error)) {
        return __vibeDefect("Panic", error && error.message ? error.message : "VibeLang panic");
      }
      return __vibeTypedFailure(action, error);
    }
    return { kind: "success", value: output };
  } catch (unexpected) {
    return __vibeThrownDefect(unexpected);
  }
}
`

const LOADER_SOURCE = `
// Every module resolves the identifier Error to this bundle-local subclass.
// The Vibe runtime may therefore install its Error convenience methods without
// mutating host Error.prototype or colliding with another pool bundle.
const __vibeHostError = globalThis.Error;
class __vibeBundleError extends __vibeHostError {}
function __vibeBuiltinError(name) {
  return class extends __vibeBundleError {
    constructor(...args) {
      super(...args);
      this.name = name;
    }
  };
}
const __vibeBundleEvalError = __vibeBuiltinError("EvalError");
const __vibeBundleRangeError = __vibeBuiltinError("RangeError");
const __vibeBundleReferenceError = __vibeBuiltinError("ReferenceError");
const __vibeBundleSyntaxError = __vibeBuiltinError("SyntaxError");
const __vibeBundleTypeError = __vibeBuiltinError("TypeError");
const __vibeBundleURIError = __vibeBuiltinError("URIError");
const __vibeModules = new Map();
function __vibeDefine(namespace, path, factory) {
  __vibeModules.set(namespace + "\\u0001" + path, { factory: factory, exports: null, state: "defined" });
}
function __vibeResolveRelative(fromPath, specifier) {
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
function __vibeLoad(namespace, path) {
  const key = namespace + "\\u0001" + path;
  const entry = __vibeModules.get(key);
  if (entry === undefined) throw new Error("vibelang bundle: unknown module " + namespace + ":" + path);
  if (entry.state === "loaded" || entry.state === "loading") return entry.exports;
  entry.state = "loading";
  const moduleObject = { exports: {} };
  entry.exports = moduleObject.exports;
  const localRequire = function (specifier) {
    if (specifier === ${JSON.stringify(RUNTIME_IMPORT_SPECIFIER)}) {
      return __vibeLoad(${JSON.stringify(RUNTIME_NAMESPACE)}, ${JSON.stringify(RUNTIME_INDEX_PATH)});
    }
    if (specifier.startsWith(".")) {
      return __vibeLoad(namespace, __vibeResolveRelative(path, specifier));
    }
    throw new Error("vibelang bundle: unsupported import " + specifier);
  };
  entry.factory.call(
    undefined,
    moduleObject.exports,
    localRequire,
    moduleObject,
    __vibeBundleError,
    __vibeBundleEvalError,
    __vibeBundleRangeError,
    __vibeBundleReferenceError,
    __vibeBundleSyntaxError,
    __vibeBundleTypeError,
    __vibeBundleURIError
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
  if (typeof poolId !== "string" || poolId.trim() === "") return fail("bundle pool id must be non-empty")
  if (typeof options.target !== "string" || options.target.trim() === "") {
    return fail(`bundle pool ${poolId} target must be non-empty`)
  }
  if (typeof options.sandbox !== "string" || options.sandbox.trim() === "") {
    return fail(`bundle pool ${poolId} sandbox must be non-empty`)
  }
  if (!Array.isArray(options.selections)) return fail(`bundle pool ${poolId} selections must be an array`)
  const seen = new Set<string>()
  for (const selection of options.selections) {
    if (seen.has(selection.action.id)) return fail(`bundle pool ${poolId} selects ${selection.action.id} twice`)
    seen.add(selection.action.id)
  }
  const actions = [...options.selections]
    .sort((left, right) => left.action.id < right.action.id ? -1 : left.action.id > right.action.id ? 1 : 0)
    .map((selection) => bundleActionFor(selection, poolId))
  const actionIds = actions.map((action) => action.actionId)

  const meta = assertJson({
    formatVersion: BUNDLE_FORMAT_VERSION,
    poolId,
    target: options.target,
    sandbox: options.sandbox,
    actionIds,
    actions: actions.map((action) => ({
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
    `const __vibeBundleMeta = ${canonicalJson(meta)};`,
    LOADER_SOURCE.trim()
  ]
  for (const module of runtimeModules()) lines.push(moduleDefinition(module))
  for (const action of actions) {
    for (const module of action.modules) lines.push(moduleDefinition(module))
  }
  lines.push(
    `const __vibeActionTable = new Map(__vibeBundleMeta.actions.map(function (action) { ` +
      `return [action.actionId, action]; }));`,
    DISPATCH_SOURCE.trim(),
    `export { __vibeInvokeAction };`,
    `export const __vibePoolBundle = __vibeBundleMeta;`,
    ``
  )
  const javascript = lines.join("\n")
  if (Buffer.byteLength(javascript, "utf8") > MAX_POOL_BUNDLE_BYTES) {
    return fail(`bundle pool ${poolId} exceeds ${MAX_POOL_BUNDLE_BYTES} bytes`)
  }
  return deepFreeze({
    formatVersion: BUNDLE_FORMAT_VERSION,
    poolId,
    actionIds: actionIds as readonly string[],
    javascript,
    digest: sha256Utf8(javascript)
  })
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
  `const __vibeInvocation = JSON.parse(${JSON.stringify(invocationJson)});`,
  `export default async function __vibeWorkerMain() {`,
  `  return await __vibeInvokeAction(__vibeInvocation);`,
  `}`,
  ``
].join("\n")
