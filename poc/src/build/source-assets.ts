import { existsSync, readFileSync, realpathSync, statSync, type Stats } from "node:fs"
import { dirname, isAbsolute, relative, resolve, sep } from "node:path"
import { getNativeCompiler } from "../compiler/native.ts"
import { AssetCompiler, type AssetBuild, type AssetDependency, type AssetLoader } from "./assets.ts"
import {
  LoaderRegistrationDiagnosticCode,
  looksLikeLoaderRegistration,
  recognizeLoaderRegistration,
  type LoaderRegistration
} from "./loader-registration.ts"
import { createSandboxedLoader } from "./sandboxed-loader.ts"
import { canonical as canonicalJson } from "./stable.ts"
import {
  issueCompilerRuntimeSource,
  type AdditionalRuntimeSource
} from "../language/runtime-source-authority.ts"

const DEFAULT_MAX_ASSET_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_TOTAL_ASSET_BYTES = 16 * 1024 * 1024
const DEFAULT_MAX_ASSETS = 1_024
const DEFAULT_MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_TOTAL_SOURCE_BYTES = 16 * 1024 * 1024
const DEFAULT_MAX_SOURCES = 1_024
const MAX_GENERATED_SOURCE_BYTES = 2 * 1024 * 1024
/** Provisional bounds on source-level `comptime.loader(...)` registration files. */
const MAX_LOADER_FILES = 64
const MAX_LOADER_FILE_BYTES = 1024 * 1024
/** Version stamped into a source-registered loader's identity. */
const SOURCE_LOADER_VERSION = "provisional-1"
/**
 * Authored asset imports are depth 0. A loader-declared generated module edge
 * adds one level; four nested levels are supported and every level is
 * reconciled against the parent's tracked dependency record.
 */
const MAX_GENERATED_MODULE_DEPTH = 4
const GENERATED_MARKER = "/** @module @throws {never} */"

export interface SourceAssetInput {
  /** Absolute, or relative to AssetCompiler.root. */
  readonly fileName: string
  readonly source: string
}

export interface SourceAssetDiagnostic {
  readonly code: string
  readonly severity: "error" | "warning"
  readonly message: string
  readonly fileName: string
  readonly line: number
  readonly column: number
}

export interface CompiledSourceAssetModule extends AdditionalRuntimeSource {
  /** Generated checker identity beneath the project root; no file is written. */
  readonly sourceFileName: string
  /** Canonical asset path spelling resolved from authored imports. */
  readonly resolutionAliases: readonly string[]
  readonly source: string
  readonly declaration: string
  readonly logicalKey: string
  readonly contentKey: string
  readonly loader: string
  readonly dependencies: readonly AssetDependency[]
  readonly cacheHit: boolean
  /**
   * Logical keys of the generated asset modules this module imports. Empty for
   * every authored-only asset; non-empty only for a loader that declared the
   * edge through the tracked context and referenced the generated sibling.
   */
  readonly references: readonly string[]
  /**
   * Nesting level at which this single canonical module was first issued: 0
   * for an authored import, re-export, or literal dynamic import, and 1..4 for
   * a module first reached through a loader-declared edge. Issuance order is
   * the canonical asset-path order, so the value is deterministic.
   */
  readonly depth: number
}

export interface SourceAssetCompilation {
  readonly ok: boolean
  readonly modules: readonly CompiledSourceAssetModule[]
  readonly diagnostics: readonly SourceAssetDiagnostic[]
}

export interface CompileSourceAssetOptions {
  /** Host-only path probes for build invalidation, never loader authority. */
  readonly onDependency?: (absolutePath: string) => void
  readonly compiler: AssetCompiler
  readonly sources: readonly SourceAssetInput[]
  /**
   * **Provisional.** Project files that declare a source-level
   * `comptime.loader(type, fn)` registration, given project-relative or as an
   * absolute path beneath the project root. Each is read from disk, recognized
   * by native Go checker identity, and registered as a sandboxed loader.
   *
   * A file in `sources` that spells the registration is discovered
   * automatically as well; this list additionally covers loader files that no
   * authored source imports. Precedence: compiler-owned built-ins always win,
   * and two files registering one `type` fail closed.
   */
  readonly loaders?: readonly string[]
  /** Maximum UTF-8 bytes parsed from one authored source string. */
  readonly maximumSourceFileBytes?: number
  /** Maximum UTF-8 bytes parsed from all authored source strings. */
  readonly maximumTotalSourceBytes?: number
  /** Maximum authored source strings inspected for asset imports. */
  readonly maximumSources?: number
  readonly maximumAssetBytes?: number
  readonly maximumTotalAssetBytes?: number
  readonly maximumAssets?: number
}

type AssetRequestForm = "import" | "re-export" | "dynamic-import"

interface AssetRequest {
  readonly importer: string
  readonly specifier: string
  readonly absoluteAlias: string
  readonly attributes: Readonly<Record<string, string>>
  readonly form: AssetRequestForm
  /** Authored positions returned by the native parser. */
  readonly site: DiagnosticSite
  readonly specifierSite: DiagnosticSite
}

interface CollectedRequests {
  readonly requests: readonly AssetRequest[]
  readonly ordinaryAliases: ReadonlySet<string>
  readonly sourceNames: ReadonlySet<string>
}

interface PreparedAssetRequest {
  readonly request: AssetRequest
  readonly canonical: string
  readonly attributes: Readonly<Record<string, unknown>>
  readonly attributesKey: string
  readonly identity: AssetFileIdentity
}

interface AssetFileIdentity {
  readonly dev: number
  readonly ino: number
  readonly size: number
  readonly mtimeMs: number
  readonly ctimeMs: number
}

/** Where a diagnostic about an asset is reported in authored source. */
interface DiagnosticSite {
  readonly fileName: string
  readonly start: number
  readonly line: number
  readonly column: number
}

const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

const isInside = (root: string, file: string): boolean => {
  const path = relative(root, file)
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`))
}

const diagnostic = (
  site: DiagnosticSite,
  code: string,
  message: string,
  severity: "error" | "warning" = "error"
): SourceAssetDiagnostic => ({
  code, severity, message, fileName: site.fileName, line: site.line, column: site.column
})

/** Host-side file admission stays here; parsing and module resolution live in Go. */
const collectRequests = (
  compiler: AssetCompiler,
  sources: readonly SourceAssetInput[],
  diagnostics: SourceAssetDiagnostic[]
): CollectedRequests => {
  const requests: AssetRequest[] = []
  const sourceNames = new Set<string>()
  const ordinaryAliases = new Set<string>()
  const files = sources.map((input) => {
    const importer = resolve(compiler.root, input.fileName)
    if (!isInside(compiler.root, importer) || importer === compiler.root) {
      throw new TypeError(`source asset importer escapes the project root: ${input.fileName}`)
    }
    if (sourceNames.has(importer)) throw new TypeError(`duplicate source asset importer: ${input.fileName}`)
    sourceNames.add(importer)
    return { path: relative(compiler.root, importer).split(sep).join("/"), text: input.source }
  })
  const result = getNativeCompiler().assetImports({ files, resolutionRoot: compiler.root })
  for (const file of result.files) {
    const importer = resolve(compiler.root, file.path)
    for (const entry of file.diagnostics) diagnostics.push({ ...entry, fileName: importer })
    for (const edge of file.ordinaryImports) {
      ordinaryAliases.add(resolve(dirname(importer), edge.specifier))
      if (edge.resolvedPath !== undefined) ordinaryAliases.add(resolve(compiler.root, edge.resolvedPath))
    }
    for (const entry of file.requests) {
      requests.push({
        importer,
        specifier: entry.specifier,
        absoluteAlias: resolve(dirname(importer), entry.specifier),
        attributes: Object.freeze({ ...entry.attributes }),
        form: entry.form,
        site: Object.freeze({ ...entry.site, fileName: importer }),
        specifierSite: Object.freeze({ ...entry.specifierSite, fileName: importer })
      })
    }
  }
  return {
    requests: requests.sort((left, right) => compareText(left.importer, right.importer) || left.site.start - right.site.start),
    ordinaryAliases,
    sourceNames
  }
}

const checkedLimit = (value: number | undefined, fallback: number, label: string): number => {
  const selected = value ?? fallback
  if (!Number.isSafeInteger(selected) || selected < 1) throw new RangeError(`${label} must be a positive safe integer`)
  return selected
}

const snapshotSourceInputs = (
  inputs: readonly SourceAssetInput[],
  maximumFileBytes: number,
  maximumTotalBytes: number,
  maximumSources: number
): readonly SourceAssetInput[] => {
  if (!Array.isArray(inputs)) throw new TypeError("source asset inputs must be an array")
  if (inputs.length > maximumSources) {
    throw new RangeError(`source asset analysis exceeds ${maximumSources} source files`)
  }
  let totalBytes = 0
  return Object.freeze(inputs.map((input, index) => {
    if (input === null || typeof input !== "object") {
      throw new TypeError(`source asset input ${index} requires fileName and source strings`)
    }
    const fileName = input.fileName
    const source = input.source
    if (typeof fileName !== "string" || typeof source !== "string") {
      throw new TypeError(`source asset input ${index} requires fileName and source strings`)
    }
    const bytes = Buffer.byteLength(source, "utf8")
    if (bytes > maximumFileBytes) {
      throw new RangeError(`source asset input '${fileName}' exceeds ${maximumFileBytes} bytes`)
    }
    totalBytes += bytes
    if (totalBytes > maximumTotalBytes) {
      throw new RangeError(`source asset analysis exceeds ${maximumTotalBytes} source bytes`)
    }
    return Object.freeze({ fileName, source })
  }))
}

const assetFileIdentity = (metadata: Stats): AssetFileIdentity => ({
  dev: metadata.dev,
  ino: metadata.ino,
  size: metadata.size,
  mtimeMs: metadata.mtimeMs,
  ctimeMs: metadata.ctimeMs
})

const sameAssetFileIdentity = (
  left: AssetFileIdentity,
  right: AssetFileIdentity
): boolean => left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
  left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs


const generatedModule = (build: AssetBuild): { readonly source: string; readonly references: readonly string[] } => {
  const source = `${GENERATED_MARKER}\n` +
    `// Compiler-generated asset ${JSON.stringify(relative(dirname(build.path), build.path))}; ` +
    `logical=${build.logicalKey} content=${build.key}\n` +
    build.module.emittedTypeScript
  const declaredLogicalKeys = new Set(
    build.dependencies
      .filter((dependency) => dependency.kind === "asset" && typeof dependency.logicalKey === "string")
      .map((dependency) => dependency.logicalKey!)
  )
  if (Buffer.byteLength(source, "utf8") > MAX_GENERATED_SOURCE_BYTES) {
    throw new RangeError(`generated asset module exceeds ${MAX_GENERATED_SOURCE_BYTES} bytes`)
  }
  const result = getNativeCompiler().validateAssetOutput({ source, declaredLogicalKeys: [...declaredLogicalKeys] })
  if (!result.ok) throw new TypeError(result.message)
  return { source, references: result.references }
}

/* --------------------------------------------------------------------------
 * Provisional source-level loader registration (docs/ASSET_LOADERS.md open
 * question 2). Recognition lives in `loader-registration.ts` and is purely
 * AST/checker level; this seam only decides which files are candidates, applies
 * precedence, and turns a surviving registration into a sandboxed loader. The
 * loader file is never imported here — it runs only inside the Deno sandbox.
 * -------------------------------------------------------------------------- */

interface LoaderFileCandidate {
  /** Canonical absolute path; also the diagnostic file name. */
  readonly canonical: string
  /** Declared through `loaders:` rather than discovered inside `sources`. */
  readonly explicit: boolean
  /** In-memory text when the same file also appears in `sources`. */
  readonly declaredSource?: string
}

const portablePathOf = (root: string, path: string): string => relative(root, path).split(sep).join("/")

const loaderDiagnostic = (
  fileName: string,
  code: string,
  message: string,
  severity: "error" | "warning" = "error",
  line = 1,
  column = 1
): SourceAssetDiagnostic => ({ code, severity, message, fileName, line, column })

const collectLoaderFileCandidates = (
  compiler: AssetCompiler,
  sources: readonly SourceAssetInput[],
  declared: readonly string[] | undefined,
  diagnostics: SourceAssetDiagnostic[]
): ReadonlyMap<string, LoaderFileCandidate> => {
  const candidates = new Map<string, LoaderFileCandidate>()
  const admit = (fileName: string, explicit: boolean, declaredSource: string | undefined): void => {
    const absolute = resolve(compiler.root, fileName)
    try {
      const canonicalPath = realpathSync(absolute)
      if (canonicalPath !== absolute) {
        throw new Error(
          `a comptime loader file may not resolve through a symbolic-link or case alias: ${absolute} -> ${canonicalPath}`
        )
      }
      const metadata = statSync(canonicalPath)
      if (!metadata.isFile()) throw new Error("a comptime loader registration must be a regular file")
      if (!isInside(compiler.root, canonicalPath) || canonicalPath === compiler.root) {
        throw new Error("a comptime loader registration must live beneath the project root")
      }
      if (metadata.size > MAX_LOADER_FILE_BYTES) {
        throw new RangeError(`a comptime loader file exceeds ${MAX_LOADER_FILE_BYTES} bytes`)
      }
      const prior = candidates.get(canonicalPath)
      candidates.set(canonicalPath, {
        canonical: canonicalPath,
        explicit: explicit || prior?.explicit === true,
        declaredSource: declaredSource ?? prior?.declaredSource
      })
    } catch (error) {
      // The sandbox snapshots the loader file itself, so a registration that is
      // not a real project file cannot be honoured and never degrades silently.
      diagnostics.push(loaderDiagnostic(
        absolute,
        LoaderRegistrationDiagnosticCode.ModuleShape,
        error instanceof Error ? error.message : String(error)
      ))
    }
  }
  if (declared !== undefined) {
    if (!Array.isArray(declared)) throw new TypeError("source asset loader paths must be an array")
    if (declared.length > MAX_LOADER_FILES) {
      throw new RangeError(`source asset analysis exceeds ${MAX_LOADER_FILES} loader files`)
    }
    for (const entry of declared) {
      if (typeof entry !== "string" || entry.trim() === "") {
        throw new TypeError("source asset loader paths must be non-empty strings")
      }
      admit(entry, true, undefined)
    }
  }
  for (const input of sources) {
    if (!looksLikeLoaderRegistration(input.source, input.fileName)) continue
    admit(input.fileName, false, input.source)
  }
  if (candidates.size > MAX_LOADER_FILES) {
    throw new RangeError(`source asset analysis exceeds ${MAX_LOADER_FILES} loader files`)
  }
  return candidates
}

const registerSourceLoaders = (
  compiler: AssetCompiler,
  candidates: ReadonlyMap<string, LoaderFileCandidate>,
  diagnostics: SourceAssetDiagnostic[]
): void => {
  const ordered = [...candidates.values()].sort((left, right) => compareText(left.canonical, right.canonical))
  const byType = new Map<string, LoaderRegistration>()
  for (const candidate of ordered) {
    let text: string
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(candidate.canonical))
    } catch (error) {
      diagnostics.push(loaderDiagnostic(
        candidate.canonical,
        LoaderRegistrationDiagnosticCode.ModuleShape,
        `a comptime loader file could not be read as UTF-8 text: ${error instanceof Error ? error.message : String(error)}`
      ))
      continue
    }
    if (candidate.declaredSource !== undefined && candidate.declaredSource !== text) {
      // The sandbox executes the bytes on disk. If the compiled source differs,
      // recognition would be describing a module that never runs.
      diagnostics.push(loaderDiagnostic(
        candidate.canonical,
        LoaderRegistrationDiagnosticCode.SourceMismatch,
        "the compiled source and the on-disk comptime loader file disagree; the sandbox snapshots the file on disk"
      ))
      continue
    }
    const analysis = recognizeLoaderRegistration({ fileName: candidate.canonical, source: text })
    // An auto-discovered candidate was selected by a text trigger, not by the
    // author. Until recognition proves the default export really is the
    // compiler-owned `comptime.loader`, the honest verdict is "this is not a
    // loader", so it is dropped rather than turned into a fatal VCT13xx. A
    // declared loader path is the author asserting otherwise, and keeps every
    // diagnostic; so does a discovered file that *is* a registration and is
    // merely malformed.
    if (candidate.explicit === false && analysis.identified === false) continue
    for (const entry of analysis.diagnostics) diagnostics.push({ ...entry })
    const registration = analysis.registration
    if (registration === undefined) continue
    const prior = byType.get(registration.type)
    if (prior !== undefined) {
      diagnostics.push(loaderDiagnostic(
        registration.fileName,
        LoaderRegistrationDiagnosticCode.DuplicateRegistration,
        `two project files register the import type ${JSON.stringify(registration.type)}: ${prior.fileName} and ${registration.fileName}`,
        "error",
        registration.line,
        registration.column
      ))
      continue
    }
    byType.set(registration.type, registration)
  }
  for (const registration of [...byType.values()].sort((left, right) => compareText(left.fileName, right.fileName))) {
    const existing = AssetCompiler.prototype.describeTypeLoader.call(compiler, registration.type)
    if (existing?.builtin === true) {
      // Documented precedence: a compiler-owned built-in always wins, and the
      // shadowed registration stays inert rather than silently disappearing.
      diagnostics.push(loaderDiagnostic(
        registration.fileName,
        LoaderRegistrationDiagnosticCode.BuiltinPrecedence,
        `the compiler-owned built-in loader ${existing.id} already owns the import type ${JSON.stringify(registration.type)}; this registration is ignored`,
        "warning",
        registration.line,
        registration.column
      ))
      continue
    }
    const id = `vibelang:project-loader/${portablePathOf(compiler.root, registration.fileName)}`
    let loader: AssetLoader
    try {
      // Third-party comptime code is never run in process. The compiler-lowered
      // module is what the no-permission Deno process receives; the authored
      // bytes still enter the loader's implementation digest, and therefore the
      // asset cache identity.
      loader = createSandboxedLoader({
        id,
        version: SOURCE_LOADER_VERSION,
        extensions: [],
        types: [registration.type],
        modulePath: registration.fileName,
        loweredSource: registration.sandboxSource
      })
    } catch (error) {
      diagnostics.push(loaderDiagnostic(
        registration.fileName,
        LoaderRegistrationDiagnosticCode.RegistrationFailure,
        `the comptime loader could not be prepared for the sandbox: ${error instanceof Error ? error.message : String(error)}`,
        "error",
        registration.line,
        registration.column
      ))
      continue
    }
    if (existing !== undefined) {
      // Re-running the preflight against the same compiler is a no-op; a
      // different implementation for the same type is a fail-closed conflict.
      if (existing.id === loader.id && existing.implementationDigest === loader.implementationDigest) continue
      diagnostics.push(loaderDiagnostic(
        registration.fileName,
        LoaderRegistrationDiagnosticCode.RegistrationFailure,
        `the asset compiler already has a different loader registered for the import type ${JSON.stringify(registration.type)}: ${existing.id}`,
        "error",
        registration.line,
        registration.column
      ))
      continue
    }
    try {
      AssetCompiler.prototype.register.call(compiler, loader)
    } catch (error) {
      diagnostics.push(loaderDiagnostic(
        registration.fileName,
        LoaderRegistrationDiagnosticCode.RegistrationFailure,
        error instanceof Error ? error.message : String(error),
        "error",
        registration.line,
        registration.column
      ))
    }
  }
}

export const compileSourceAssetModules = async (
  options: CompileSourceAssetOptions
): Promise<SourceAssetCompilation> => {
  if (!(options.compiler instanceof AssetCompiler)) throw new TypeError("source asset compilation requires an AssetCompiler")
  if (options.onDependency !== undefined && typeof options.onDependency !== "function") throw new TypeError("source asset dependency observer must be a function")
  const compiler = options.compiler
  const maximumAssetBytes = checkedLimit(options.maximumAssetBytes, DEFAULT_MAX_ASSET_BYTES, "maximumAssetBytes")
  const maximumTotalAssetBytes = checkedLimit(options.maximumTotalAssetBytes, DEFAULT_MAX_TOTAL_ASSET_BYTES, "maximumTotalAssetBytes")
  const maximumAssets = checkedLimit(options.maximumAssets, DEFAULT_MAX_ASSETS, "maximumAssets")
  const maximumSourceFileBytes = checkedLimit(
    options.maximumSourceFileBytes,
    DEFAULT_MAX_SOURCE_FILE_BYTES,
    "maximumSourceFileBytes"
  )
  const maximumTotalSourceBytes = checkedLimit(
    options.maximumTotalSourceBytes,
    DEFAULT_MAX_TOTAL_SOURCE_BYTES,
    "maximumTotalSourceBytes"
  )
  const maximumSources = checkedLimit(options.maximumSources, DEFAULT_MAX_SOURCES, "maximumSources")
  if (maximumTotalAssetBytes < maximumAssetBytes) {
    throw new RangeError("maximumTotalAssetBytes must be at least maximumAssetBytes")
  }
  if (maximumTotalSourceBytes < maximumSourceFileBytes) {
    throw new RangeError("maximumTotalSourceBytes must be at least maximumSourceFileBytes")
  }
  const sources = snapshotSourceInputs(
    options.sources,
    maximumSourceFileBytes,
    maximumTotalSourceBytes,
    maximumSources
  )
  const diagnostics: SourceAssetDiagnostic[] = []
  const failed = (): SourceAssetCompilation => {
    diagnostics.sort((left, right) => compareText(left.fileName, right.fileName) ||
      left.line - right.line || left.column - right.column || compareText(left.code, right.code))
    return Object.freeze({ ok: false, modules: Object.freeze([]), diagnostics: Object.freeze(diagnostics) })
  }
  const collected = collectRequests(compiler, sources, diagnostics)
  for (const request of collected.requests) {
    if (isInside(compiler.root, request.absoluteAlias)) options.onDependency?.(request.absoluteAlias)
  }
  if (diagnostics.some((entry) => entry.severity === "error")) return failed()
  const loaderCandidates = collectLoaderFileCandidates(compiler, sources, options.loaders, diagnostics)
  for (const candidate of loaderCandidates.keys()) options.onDependency?.(candidate)
  if (diagnostics.some((entry) => entry.severity === "error")) return failed()
  const modulesByAsset = new Map<string, CompiledSourceAssetModule>()
  const identityOwners = new Map<string, string>()
  const codeIdentityOwners = new Map<string, string>()
  // A loader file is project code, so it participates in the same code/asset
  // identity reconciliation as an authored source or an ordinary import.
  for (const candidate of [...collected.sourceNames, ...collected.ordinaryAliases, ...loaderCandidates.keys()]
    .sort(compareText)) {
    try {
      if (!existsSync(candidate)) continue
      const canonical = realpathSync(candidate)
      // Symbolic aliases never grant compiler trust here. The runtime graph
      // rejects them independently; only exact, regular project identities
      // participate in this asset/code hard-link reconciliation.
      if (canonical !== candidate || !isInside(compiler.root, canonical) || canonical === compiler.root) continue
      const metadata = statSync(canonical)
      if (!metadata.isFile()) continue
      const identity = `${metadata.dev}:${metadata.ino}`
      const prior = codeIdentityOwners.get(identity)
      if (prior === undefined || compareText(canonical, prior) < 0) codeIdentityOwners.set(identity, canonical)
    } catch {
      // Resolution/read errors are owned by the language/runtime graph. This
      // pass only closes identities it can prove without following aliases.
    }
  }
  if (loaderCandidates.size > 0) {
    registerSourceLoaders(compiler, loaderCandidates, diagnostics)
    if (diagnostics.some((entry) => entry.severity === "error")) return failed()
  }
  const admitted = new Map<string, AssetFileIdentity>()
  let totalBytes = 0
  /**
   * Prove one asset path may enter the graph at all. Authored imports,
   * re-exports, literal dynamic imports, and loader-declared nested modules all
   * pass through exactly these checks and share the same budgets.
   */
  const admitAsset = (
    absoluteAlias: string,
    site: DiagnosticSite
  ): { readonly canonical: string; readonly identity: AssetFileIdentity } | undefined => {
    if (isInside(compiler.root, absoluteAlias)) options.onDependency?.(absoluteAlias)
    let canonical: string
    let metadata: Stats
    try {
      canonical = realpathSync(absoluteAlias)
      metadata = statSync(canonical)
      if (canonical !== absoluteAlias) {
        throw new TypeError(`asset imports may not resolve through a symbolic-link or case alias: ${absoluteAlias} -> ${canonical}`)
      }
      if (!metadata.isFile() || !isInside(compiler.root, canonical) || canonical === compiler.root) {
        throw new TypeError("asset must be a regular file beneath the project root")
      }
      if (metadata.size > maximumAssetBytes) throw new RangeError(`asset exceeds ${maximumAssetBytes} bytes`)
    } catch (error) {
      diagnostics.push(diagnostic(
        site,
        "VIBE5209",
        error instanceof Error ? error.message : String(error)
      ))
      return undefined
    }
    const already = admitted.get(canonical)
    if (already !== undefined) return { canonical, identity: already }
    if (collected.sourceNames.has(canonical) || collected.ordinaryAliases.has(canonical)) {
      diagnostics.push(diagnostic(
        site,
        "VIBE5215",
        "one path cannot be both a compiler asset module and an authored/runtime code module"
      ))
      return undefined
    }
    const identity = `${metadata.dev}:${metadata.ino}`
    const codeOwner = codeIdentityOwners.get(identity)
    if (codeOwner !== undefined) {
      diagnostics.push(diagnostic(
        site,
        "VIBE5215",
        `one file identity cannot be both a compiler asset module and an authored/runtime code module: ${codeOwner} and ${canonical}`
      ))
      return undefined
    }
    const priorIdentity = identityOwners.get(identity)
    if (priorIdentity !== undefined && priorIdentity !== canonical) {
      diagnostics.push(diagnostic(site, "VIBE5210", `asset hard-link aliases are forbidden: ${priorIdentity} and ${canonical}`))
      return undefined
    }
    if (identityOwners.size >= maximumAssets) {
      diagnostics.push(diagnostic(site, "VIBE5211", `asset graph exceeds ${maximumAssets} files`))
      return undefined
    }
    if (totalBytes + metadata.size > maximumTotalAssetBytes) {
      diagnostics.push(diagnostic(site, "VIBE5212", `asset graph exceeds ${maximumTotalAssetBytes} bytes`))
      return undefined
    }
    identityOwners.set(identity, canonical)
    totalBytes += metadata.size
    const fileIdentity = assetFileIdentity(metadata)
    admitted.set(canonical, fileIdentity)
    return { canonical, identity: fileIdentity }
  }

  const preparedByAsset = new Map<string, PreparedAssetRequest>()
  for (const request of collected.requests) {
    const site = request.specifierSite
    const target = admitAsset(request.absoluteAlias, site)
    if (target === undefined) continue
    const attributesKey = canonicalJson(request.attributes)
    const prior = preparedByAsset.get(target.canonical)
    if (prior !== undefined) {
      if (prior.attributesKey !== attributesKey) {
        diagnostics.push(diagnostic(
          request.site,
          "VIBE5215",
          "one asset path is imported with conflicting attributes; the bounded module graph requires one canonical shape"
        ))
      }
      continue
    }
    preparedByAsset.set(target.canonical, {
      request,
      canonical: target.canonical,
      attributes: request.attributes,
      attributesKey,
      identity: target.identity
    })
  }
  if (diagnostics.some((entry) => entry.severity === "error")) return failed()

  const generatedOwners = new Map<string, string>()
  const attributesByAsset = new Map<string, string>()
  for (const prepared of preparedByAsset.values()) attributesByAsset.set(prepared.canonical, prepared.attributesKey)
  const issuing = new Set<string>()

  /**
   * Compile one admitted asset into its single canonical generated module and
   * recursively issue every generated module it references. One asset is one
   * module regardless of how many importers, re-exporters, or loaders reach it.
   */
  const issueModule = async (
    target: { readonly canonical: string; readonly identity: AssetFileIdentity; readonly attributes: Readonly<Record<string, unknown>> },
    site: DiagnosticSite,
    depth: number
  ): Promise<CompiledSourceAssetModule | undefined> => {
    const existing = modulesByAsset.get(target.canonical)
    if (existing !== undefined) return existing
    if (issuing.has(target.canonical)) {
      diagnostics.push(diagnostic(
        site,
        "VIBE5219",
        `generated asset module cycle: ${relative(compiler.root, target.canonical).split(sep).join("/")}`
      ))
      return undefined
    }
    const portablePath = relative(compiler.root, target.canonical).split(sep).join("/")
    let build: AssetBuild
    try {
      // Invoke the nominal implementation: an own-property override on an
      // otherwise authentic compiler must not become a provenance-forging
      // source-asset backend.
      build = await AssetCompiler.prototype.compile.call(
        compiler,
        relative(compiler.root, target.canonical),
        { ...target.attributes }
      )
      const afterCanonical = realpathSync(target.canonical)
      const afterMetadata = statSync(afterCanonical)
      if (
        afterCanonical !== target.canonical || !afterMetadata.isFile() ||
        !sameAssetFileIdentity(target.identity, assetFileIdentity(afterMetadata)) ||
        build.path !== portablePath
      ) {
        throw new Error(`asset changed filesystem identity between checked preflight and compilation: ${portablePath}`)
      }
    } catch (error) {
      diagnostics.push(diagnostic(
        site,
        "VIBE5213",
        error instanceof Error ? error.message : String(error)
      ))
      return undefined
    }
    for (const loaderDiagnostic of build.module.diagnostics) {
      diagnostics.push(diagnostic(
        site,
        "VIBE5214",
        loaderDiagnostic.message,
        loaderDiagnostic.level
      ))
    }
    const virtualRelative = `.vibelang-generated/assets/${build.logicalKey}.ts`
    const virtualAbsolute = resolve(compiler.root, virtualRelative)
    const generatedOwner = generatedOwners.get(virtualAbsolute)
    if (existsSync(virtualAbsolute) || (generatedOwner !== undefined && generatedOwner !== target.canonical)) {
      diagnostics.push(diagnostic(site, "VIBE5216", `generated asset identity collides with a real path: ${virtualRelative}`))
      return undefined
    }
    generatedOwners.set(virtualAbsolute, target.canonical)
    let source: string
    let references: readonly string[]
    try {
      ({ source, references } = generatedModule(build))
    } catch (error) {
      diagnostics.push(diagnostic(site, "VIBE5217", error instanceof Error ? error.message : String(error)))
      return undefined
    }
    issuing.add(target.canonical)
    try {
      for (const reference of references) {
        if (depth + 1 > MAX_GENERATED_MODULE_DEPTH) {
          diagnostics.push(diagnostic(
            site,
            "VIBE5219",
            `generated asset module graph exceeds ${MAX_GENERATED_MODULE_DEPTH} nested levels`
          ))
          return undefined
        }
        const dependency = build.dependencies.find(
          (candidate) => candidate.kind === "asset" && candidate.logicalKey === reference
        )
        if (dependency === undefined) {
          diagnostics.push(diagnostic(
            site,
            "VIBE5219",
            `generated asset module references an undeclared asset dependency: ${reference}`
          ))
          return undefined
        }
        const childAttributes = dependency.options ?? {}
        const childAlias = resolve(compiler.root, dependency.path)
        const child = admitAsset(childAlias, site)
        if (child === undefined) return undefined
        const childAttributesKey = canonicalJson(childAttributes)
        const priorAttributes = attributesByAsset.get(child.canonical)
        if (priorAttributes !== undefined && priorAttributes !== childAttributesKey) {
          diagnostics.push(diagnostic(
            site,
            "VIBE5215",
            "one asset path is imported with conflicting attributes; the bounded module graph requires one canonical shape"
          ))
          return undefined
        }
        attributesByAsset.set(child.canonical, childAttributesKey)
        const issued = await issueModule({ ...child, attributes: childAttributes }, site, depth + 1)
        if (issued === undefined) return undefined
        if (issued.logicalKey !== dependency.logicalKey || issued.contentKey !== dependency.digest) {
          diagnostics.push(diagnostic(
            site,
            "VIBE5219",
            `nested asset module did not reproduce its declared identity: ${dependency.path}`
          ))
          return undefined
        }
      }
    } finally {
      issuing.delete(target.canonical)
    }
    const issued = issueCompilerRuntimeSource({
      sourceFileName: virtualRelative,
      resolutionAliases: Object.freeze([portablePath]),
      source,
      declaration: build.module.declaration,
      logicalKey: build.logicalKey,
      contentKey: build.key,
      loader: build.loader,
      dependencies: Object.freeze([...build.dependencies]),
      cacheHit: build.cacheHit,
      references: Object.freeze([...references]),
      depth
    })
    modulesByAsset.set(target.canonical, issued)
    return issued
  }

  for (const prepared of [...preparedByAsset.values()]
    .sort((left, right) => compareText(left.canonical, right.canonical))) {
    await issueModule(
      { canonical: prepared.canonical, identity: prepared.identity, attributes: prepared.attributes },
      prepared.request.site,
      0
    )
  }
  diagnostics.sort((left, right) => compareText(left.fileName, right.fileName) ||
    left.line - right.line || left.column - right.column || compareText(left.code, right.code))
  const ok = !diagnostics.some((entry) => entry.severity === "error")
  const modules = ok
    ? [...modulesByAsset.values()].sort((left, right) => compareText(left.sourceFileName, right.sourceFileName))
    : []
  return Object.freeze({
    ok,
    modules: Object.freeze(modules),
    diagnostics: Object.freeze(diagnostics)
  })
}
