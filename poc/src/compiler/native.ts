import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, realpathSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { decodeNativeResult, decodeNativeInspection, decodeNativeFormat, decodeNativeToken, decodeNativeLoaderRegistration, decodeNativeAssetOutput, decodeNativeAssetImports, decodeNativeTranspile, decodeNativeBundleModules, decodeNativeCanonicalFunction, decodeNativeRuntimeModules, decodeNativeDurableModule, decodeNativeSyntaxSchema, decodeNativeRuntimeFactory, decodeNativeActionContract, decodeNativeCheckedFunction, decodeNativeConfig, encodeNativeRequest, NATIVE_API_VERSION, NativeCompilerError } from "./protocol.ts"
import { decodeNativeGeneratedProject, type NativeGeneratedProjectRequest, type NativeGeneratedProjectResult } from "./protocol.ts"
import { decodeNativeBodyContract, type NativeBodyContractRequest, type NativeBodyContractResult } from "./protocol.ts"
import { decodeNativeBodyLowering, type NativeBodyLoweringRequest, type NativeBodyLoweringResult } from "./protocol.ts"
import { decodeNativePlanSource, type NativePlanSourceRequest, type NativePlanSourceResult } from "./protocol.ts"
import { decodeNativeKeyedPlan, type NativeKeyedPlanRequest, type NativeKeyedPlanResult } from "./protocol.ts"
import { decodeNativeKeyedSource, type NativeKeyedSourceRequest, type NativeKeyedSourceResult } from "./protocol.ts"
import { decodeNativeCheckedSchemas, type NativeCheckedSchemasRequest, type NativeCheckedSchemasResult } from "./protocol.ts"
import { decodeNativeSourceRecovery, type NativeSourceRecoveryResult } from "./protocol.ts"
import { decodeNativeComptimePlan, type NativeComptimePlanRequest, type NativeComptimePlanResult } from "./protocol.ts"
import { decodeNativeLanguageAnalysis, type NativeLanguageAnalysisRequest, type NativeLanguageAnalysisResult } from "./protocol.ts"
import { decodeNativeLanguageLowering, type NativeLanguageLoweringRequest, type NativeLanguageLoweringResult } from "./protocol.ts"
import { decodeNativeDeclarationText, decodeNativeGeneratedDeclarations, type NativeDeclarationTextRequest, type NativeDeclarationTextResult, type NativeGeneratedDeclarationsRequest, type NativeGeneratedDeclarationsResult } from "./protocol.ts"
import type { NativeCompileRequest, NativeCompileResult, NativeInspectionSource, NativeInspectionResult,
  NativeFormatRequest, NativeFormatResult, NativeTokenRequest, NativeTokenResult,
  NativeLoaderRegistrationRequest, NativeLoaderRegistrationResult, NativeAssetOutputRequest, NativeAssetOutputResult,
  NativeAssetImportsRequest, NativeAssetImportsResult, NativeTranspileRequest, NativeTranspileResult,
  NativeBundleModulesRequest, NativeBundleModulesResult, NativeCanonicalFunctionResult, NativeRuntimeModulesRequest, NativeRuntimeModulesResult, NativeDurableModuleResult, NativeSyntaxSchemaResult, NativeRuntimeFactoryRequest, NativeRuntimeFactoryResult, NativeActionContractRequest, NativeActionContractResult, NativeCheckedFunctionRequest, NativeCheckedFunctionResult, NativeConfigRequest, NativeConfigResult } from "./protocol.ts"

export interface NativeCompilerIdentity {
  readonly apiVersion: number
  readonly revision: string
  readonly patchSeries: string
  readonly compilerVersion: string
  readonly sha256: string
}

export interface NativeCompilerOptions {
  /** Explicit trusted toolchain override; still checked against the source pin. */
  readonly executable?: string
  readonly timeoutMs?: number
}

const BUFFER_LIMIT = 128 * 1024 * 1024
const moduleDirectory = dirname(fileURLToPath(import.meta.url))
// Both poc/src/compiler and poc/dist/compiler are three levels below the
// package root. Installed consumers read only the package's public pin file;
// source-only preparation below is never a fallback to another compiler.
const packageRoot = resolve(moduleDirectory, "../../..")

function hashFile(file: string | URL): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

function failure(message: string, code = "VIBELANG_GO_INSTALLATION"): never {
  throw new NativeCompilerError(code, message)
}

function readJson(file: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"))
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("not an object")
    return value as Record<string, unknown>
  } catch (cause) { return failure(`Cannot read native compiler metadata ${file}: ${String(cause)}`) }
}

function run(executable: string, args: readonly string[], timeout: number, input?: string, cwd?: string): string {
  let directory: string | undefined
  let descriptor: number | undefined
  try {
    if (input !== undefined) {
      // Node's synchronous pipe writer can stall while the Go reader awaits
      // bytes/EOF (reproduced on macOS Node 22.12 after async child execution).
      // A completed, read-only file gives stdin a finite byte stream without
      // requiring the parent event loop to finish a backpressured pipe write.
      directory = mkdtempSync(join(tmpdir(), "vibelang-native-request-"))
      const file = join(directory, "stdin.json")
      writeFileSync(file, input, { encoding: "utf8", flag: "wx", mode: 0o600 })
      descriptor = openSync(file, "r")
      if (process.platform !== "win32") {
        // The inherited descriptor remains readable after unlink. No source
        // pathname survives even if this host is killed while the child runs.
        unlinkSync(file)
        rmdirSync(directory)
        directory = undefined
      }
    }
    const result = spawnSync(executable, [...args], {
      encoding: "utf8", stdio: [descriptor ?? "ignore", "pipe", "pipe"],
      timeout, killSignal: "SIGKILL", maxBuffer: BUFFER_LIMIT,
      ...(cwd === undefined ? {} : { cwd }),
    })
    if (result.error || result.status !== 0 || result.signal) {
      failure(`Native compiler command failed: ${result.error?.message ?? result.signal ?? result.status}; ` +
        (result.stderr || result.stdout || "no process output").slice(0, 16_384),
      result.error && "code" in result.error && result.error.code === "ETIMEDOUT" ? "VIBELANG_GO_TIMEOUT" : "VIBELANG_GO_BACKEND")
    }
    return result.stdout
  } finally {
    try {
      if (descriptor !== undefined) closeSync(descriptor)
    } finally {
      if (directory !== undefined) {
        rmSync(join(directory, "stdin.json"), { force: true })
        rmdirSync(directory)
      }
    }
  }
}

function pinnedRevision(): string {
  const revision = readJson(join(packageRoot, "typescript-fork.json")).revision
  if (typeof revision !== "string" || !/^[a-f0-9]{40}$/.test(revision)) failure("Invalid native compiler source pin")
  return revision
}

function checkoutFor(revision: string): string {
  const explicit = process.env.VIBELANG_TYPESCRIPT_FORK
  if (explicit !== undefined) {
    const candidate = resolve(explicit)
    if (existsSync(candidate)) return candidate
    return failure(`VIBELANG_TYPESCRIPT_FORK does not exist: ${candidate}`)
  }
  const caches = process.env.VIBELANG_TYPESCRIPT_FORK_CACHE === undefined
    ? ["/private/tmp/vibelang-ts-fork-cache", join(tmpdir(), "vibelang-ts-fork-cache")]
    : [resolve(process.env.VIBELANG_TYPESCRIPT_FORK_CACHE)]
  for (const cache of caches) {
    const candidate = join(cache, revision)
    if (existsSync(candidate)) return candidate
  }
  return failure("The source checkout needs its pinned native compiler. Set VIBELANG_TYPESCRIPT_FORK, " +
    "or prepare it with node scripts/prepare-typescript-fork.mjs --fetch --cache /path/to/cache " +
    "and set VIBELANG_TYPESCRIPT_FORK_CACHE. No JavaScript compiler fallback exists.")
}

function prepareSourceCompiler(revision: string): string {
  if (!existsSync(join(packageRoot, "cmd/vibec-prepare/main.go"))) {
    return failure(`No packaged native compiler for ${process.platform}-${process.arch}. ` +
      "Install a package built for this platform or set VIBELANG_NATIVE_COMPILER to a matching native executable.")
  }
  const go = process.env.VIBELANG_GO ?? "go"
  const args = ["run", "./cmd/vibec-prepare", "--fork-checkout", checkoutFor(revision)]
  if (process.env.VIBELANG_GO) args.push("--go-command", go)
  let prepared: unknown
  try { prepared = JSON.parse(run(go, args, 300_000, undefined, packageRoot)) } catch (cause) {
    if (cause instanceof NativeCompilerError) throw cause
    return failure(`Invalid native compiler preparation result: ${String(cause)}`)
  }
  if (!prepared || typeof prepared !== "object" || !("executable" in prepared) || typeof prepared.executable !== "string") {
    return failure("Native preparation did not return an executable")
  }
  return prepared.executable
}

/** Thin host binding: all parsing, policy, checking and emission happen in Go. */
export class NativeCompiler {
  readonly identity: NativeCompilerIdentity
  readonly executable: string
  readonly transportDigest: string
  readonly #timeoutMs: number

  constructor(options: NativeCompilerOptions = {}) {
    this.#timeoutMs = options.timeoutMs ?? 30_000
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs <= 0 || this.#timeoutMs > 300_000) {
      throw new TypeError("native compiler timeoutMs must be an integer in [1, 300000]")
    }
    const revision = pinnedRevision()
    const override = options.executable ?? process.env.VIBELANG_NATIVE_COMPILER
    const directory = join(moduleDirectory, "native", `${process.platform}-${process.arch}`)
    const manifestPath = join(directory, "manifest.json")
    let executable: string
    let expectedDigest: string | undefined
    let expectedPatchSeries: string | undefined
    let expectedCompilerVersion: string | undefined
    if (override !== undefined) {
      executable = resolve(override)
    } else if (existsSync(manifestPath)) {
      const manifest = readJson(manifestPath)
      if (manifest.apiVersion !== NATIVE_API_VERSION || manifest.revision !== revision ||
        manifest.platform !== process.platform || manifest.arch !== process.arch ||
        typeof manifest.executable !== "string" || basename(manifest.executable) !== manifest.executable ||
        manifest.executable !== (process.platform === "win32" ? "vibelang-native.exe" : "vibelang-native") ||
        typeof manifest.patchSeries !== "string" || !/^[a-f0-9]{64}$/.test(manifest.patchSeries) ||
        typeof manifest.compilerVersion !== "string" || manifest.compilerVersion.length > 100 ||
        typeof manifest.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(manifest.sha256)) {
        failure("Packaged native compiler metadata does not match this host and source pin")
      }
      executable = join(directory, manifest.executable)
      expectedDigest = manifest.sha256
      expectedPatchSeries = manifest.patchSeries
      expectedCompilerVersion = manifest.compilerVersion
    } else {
      executable = prepareSourceCompiler(revision)
    }
    try { this.executable = realpathSync(executable) } catch (cause) {
      failure(`Native compiler executable is unavailable: ${String(cause)}`)
    }
    const digest = hashFile(this.executable)
    if (expectedDigest !== undefined && digest !== expectedDigest) failure("Packaged native compiler executable digest mismatch")
    let metadata: Record<string, unknown>
    try { metadata = JSON.parse(run(this.executable, ["--build-identity"], this.#timeoutMs)) } catch (cause) {
      if (cause instanceof NativeCompilerError) throw cause
      failure(`Invalid native compiler identity: ${String(cause)}`)
    }
    if (!metadata || metadata.apiVersion !== NATIVE_API_VERSION || metadata.revision !== revision ||
      typeof metadata.patchSeries !== "string" || !/^[a-f0-9]{64}$/.test(metadata.patchSeries) ||
      typeof metadata.compilerVersion !== "string" || !metadata.compilerVersion.startsWith("7.") || metadata.compilerVersion.length > 100 ||
      (expectedPatchSeries !== undefined && metadata.patchSeries !== expectedPatchSeries) ||
      (expectedCompilerVersion !== undefined && metadata.compilerVersion !== expectedCompilerVersion)) {
      failure("Native executable API or compiler identity does not match this host and source pin")
    }
    this.identity = Object.freeze({ apiVersion: NATIVE_API_VERSION, revision, patchSeries: metadata.patchSeries,
      compilerVersion: metadata.compilerVersion, sha256: digest })
    const extension = import.meta.url.endsWith(".ts") ? "ts" : "js"
    this.transportDigest = createHash("sha256").update(hashFile(new URL(import.meta.url)))
      .update(hashFile(new URL(`./protocol.${extension}`, import.meta.url)))
      .update(hashFile(new URL(`../build/comptime-value.${extension}`, import.meta.url)))
      .update(hashFile(new URL(`../build/stable.${extension}`, import.meta.url))).digest("hex")
    Object.freeze(this)
  }

  compile(request: NativeCompileRequest): NativeCompileResult {
    // Durable component identity cannot silently keep the digest of replaced
    // bytes. Local filesystem ownership remains a host trust assumption.
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    const output = run(this.executable, [], this.#timeoutMs, encodeNativeRequest(request))
    return decodeNativeResult(output, this.identity.revision)
  }

  inspect(files: readonly NativeInspectionSource[]): NativeInspectionResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeInspection(run(this.executable, ["--inspect"], this.#timeoutMs, encodeNativeRequest({ files })), this.identity.revision, files)
  }

  format(request: NativeFormatRequest): NativeFormatResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeFormat(run(this.executable, ["--format"], this.#timeoutMs, encodeNativeRequest(request)), this.identity.revision, request.text)
  }

  tokenAt(request: NativeTokenRequest): NativeTokenResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeToken(run(this.executable, ["--token-at"], this.#timeoutMs, encodeNativeRequest(request)), this.identity.revision, request)
  }

  loaderRegistration(request: NativeLoaderRegistrationRequest): NativeLoaderRegistrationResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeLoaderRegistration(run(this.executable, ["--loader-registration"], this.#timeoutMs, encodeNativeRequest(request)), this.identity.revision, request)
  }

  validateAssetOutput(request: NativeAssetOutputRequest): NativeAssetOutputResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeAssetOutput(run(this.executable, ["--asset-output"], this.#timeoutMs, encodeNativeRequest(request)), this.identity.revision, request)
  }

  assetImports(request: NativeAssetImportsRequest): NativeAssetImportsResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeAssetImports(run(this.executable, ["--asset-imports"], this.#timeoutMs, encodeNativeRequest(request)), this.identity.revision, request)
  }

  /** Ordinary TS syntax/emit only. Use compile() for checked language programs. */
  transpile(request: NativeTranspileRequest): NativeTranspileResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeTranspile(run(this.executable, ["--transpile"], this.#timeoutMs, encodeNativeRequest(request)), this.identity.revision, request)
  }

  bundleModules(request: NativeBundleModulesRequest): NativeBundleModulesResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeBundleModules(run(this.executable, ["--bundle-modules"], this.#timeoutMs, encodeNativeRequest(request)), this.identity.revision, request)
  }

  canonicalFunction(source: string): NativeCanonicalFunctionResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeCanonicalFunction(run(this.executable, ["--canonical-function"], this.#timeoutMs, encodeNativeRequest({ source })), this.identity.revision)
  }

  runtimeModules(request: NativeRuntimeModulesRequest): NativeRuntimeModulesResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeRuntimeModules(run(this.executable, ["--runtime-modules"], this.#timeoutMs, encodeNativeRequest(request)), this.identity.revision, request)
  }

  durableModule(source: string): NativeDurableModuleResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeDurableModule(run(this.executable, ["--durable-module"], this.#timeoutMs, encodeNativeRequest({ source })), this.identity.revision, source)
  }

  checkedSchemas(request: NativeCheckedSchemasRequest): NativeCheckedSchemasResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeCheckedSchemas(run(this.executable, ["--checked-schemas"], this.#timeoutMs, encodeNativeRequest(request)), this.identity.revision, request)
  }

  recoverSource(text: string): NativeSourceRecoveryResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeSourceRecovery(run(this.executable,["--recover-source"],this.#timeoutMs,encodeNativeRequest({text})),this.identity.revision,text)
  }

  planComptime(request: NativeComptimePlanRequest): NativeComptimePlanResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeComptimePlan(run(this.executable,["--comptime-plan"],this.#timeoutMs,encodeNativeRequest(request)),this.identity.revision,request)
  }

  analyzeLanguage(request: NativeLanguageAnalysisRequest): NativeLanguageAnalysisResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeLanguageAnalysis(run(this.executable, ["--analyze-language"], this.#timeoutMs, encodeNativeRequest(request)), this.identity.revision, request)
  }

  lowerLanguage(request: NativeLanguageLoweringRequest): NativeLanguageLoweringResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeLanguageLowering(run(this.executable, ["--lower-language"], this.#timeoutMs, encodeNativeRequest(request)), this.identity.revision, request)
  }

  syntaxSchema(source: string, typeName: string): NativeSyntaxSchemaResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeSyntaxSchema(run(this.executable, ["--syntax-schema"], this.#timeoutMs, encodeNativeRequest({ source, typeName })), this.identity.revision)
  }

  runtimeFactory(request: NativeRuntimeFactoryRequest): NativeRuntimeFactoryResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeRuntimeFactory(run(this.executable, ["--runtime-factory"], this.#timeoutMs, encodeNativeRequest(request)), this.identity.revision)
  }

  actionContract(request: NativeActionContractRequest): NativeActionContractResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeActionContract(run(this.executable, ["--action-contract"], this.#timeoutMs, encodeNativeRequest(request)), this.identity.revision, request)
  }

  compilePlanSource(request: NativePlanSourceRequest): NativePlanSourceResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativePlanSource(run(this.executable, ["--plan-source"], this.#timeoutMs, encodeNativeRequest(request)), this.identity.revision, request)
  }

  keyedPlan(request: NativeKeyedPlanRequest): NativeKeyedPlanResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeKeyedPlan(run(this.executable, ["--keyed-plan"], this.#timeoutMs, encodeNativeRequest(request)), this.identity.revision, request)
  }

  compileKeyedPlanSource(request: NativeKeyedSourceRequest): NativeKeyedSourceResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeKeyedSource(run(this.executable, ["--keyed-plan-source"], this.#timeoutMs, encodeNativeRequest(request)), this.identity.revision, request)
  }

  validateConfig(request: NativeConfigRequest): NativeConfigResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeConfig(run(this.executable, ["--validate-config"], this.#timeoutMs, encodeNativeRequest(request)), this.identity.revision, request)
  }

  checkedFunction(request: NativeCheckedFunctionRequest): NativeCheckedFunctionResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeCheckedFunction(run(this.executable, ["--checked-function"], this.#timeoutMs, encodeNativeRequest(request)), this.identity.revision, request)
  }

  checkGeneratedProject(request: NativeGeneratedProjectRequest): NativeGeneratedProjectResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeGeneratedProject(run(this.executable, ["--check-generated-project"], this.#timeoutMs, encodeNativeRequest(request)), this.identity.revision, request)
  }

  bodyContract(request: NativeBodyContractRequest): NativeBodyContractResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeBodyContract(run(this.executable, ["--body-contract"], this.#timeoutMs, encodeNativeRequest(request)), this.identity.revision, request)
  }

  lowerBody(request: NativeBodyLoweringRequest): NativeBodyLoweringResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeBodyLowering(run(this.executable, ["--lower-body"], this.#timeoutMs, encodeNativeRequest(request)), this.identity.revision, request)
  }

  declarationText(request: NativeDeclarationTextRequest): NativeDeclarationTextResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeDeclarationText(run(this.executable, ["--declaration-text"], this.#timeoutMs, encodeNativeRequest(request)), this.identity.revision, request)
  }

  emitGeneratedDeclarations(request: NativeGeneratedDeclarationsRequest): NativeGeneratedDeclarationsResult {
    if (hashFile(this.executable) !== this.identity.sha256) failure("Native compiler changed after its identity was captured")
    return decodeNativeGeneratedDeclarations(run(this.executable, ["--emit-generated-declarations"], this.#timeoutMs, encodeNativeRequest(request)), this.identity.revision, request)
  }
}

let defaultCompiler: NativeCompiler | undefined
export function getNativeCompiler(): NativeCompiler {
  return defaultCompiler ??= new NativeCompiler()
}
