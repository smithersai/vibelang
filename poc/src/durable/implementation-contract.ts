import { dirname, normalize, resolve } from "node:path"
import { getNativeCompiler } from "../compiler/native.ts"
import type { ProjectDiagnostic, ProjectSource } from "../language/model.ts"
import { COMPILER_INTRINSIC_SPECIFIERS } from "../language/compiler-modules.ts"
import {
  canonicalJson,
  deepFreeze,
  digest,
  type ActionDescriptor,
  type ActionImplementationContract
} from "./ir.ts"
import { validateActionContractDescriptor, validateDurableSchema } from "./schema-runtime.ts"
import { identityFileName } from "./site-id.ts"
import {
  COMPILER_IDENTITY, nonEmpty, ActionImplementationContractError,
  assertActionImplementationContractMatchesAction, validateActionImplementationContract
} from "./implementation-validation.ts"

export {
  ActionImplementationContractError,
  assertActionImplementationContractMatchesAction, validateActionImplementationContract
} from "./implementation-validation.ts"

const authenticated = new WeakSet<object>()
const authenticatedBindings = new WeakMap<Function, Set<string>>()
const checkedValueBoundaries = new WeakSet<object>()

/**
 * The exact checked source project pinned by one compiler-issued contract.
 * Retained privately so the deployment build can emit a tree-shaken worker
 * bundle from the same checked sources the contract's projectDigest covers.
 */
export interface RetainedCheckedImplementationProject {
  readonly entryFile: string
  readonly exportName: string
  readonly sources: readonly { readonly fileName: string; readonly source: string }[]
  readonly projectDigest: string
  readonly rootDir: string | undefined
  readonly completion?: "value" | "promise"
}

const retainedProjects = new WeakMap<object, RetainedCheckedImplementationProject>()

export interface CompileActionImplementationOptions {
  readonly implementationId: string
  readonly implementationVersion: string
  readonly entryFile: string
  readonly exportName: string
  /** Exact compiler-derived Action contract this implementation provides. */
  readonly action: ActionDescriptor
  /**
   * Exact local callback paired opaquely with the checked export. The compiler
   * does not inspect Function.toString; this local association is not callback
   * or lexical-closure attestation.
   */
  readonly implementation: Function
  /** Complete checked `.vibe` source closure for the implementation. */
  readonly sources: readonly ProjectSource[]
  readonly rootDir?: string
}

/** Source-only compilation for provider bundle emission; no host callback. */
export type CompileActionImplementationSourceOptions = Omit<CompileActionImplementationOptions, "implementation">

/**
 * The portable spelling of one project source's name.
 *
 * Host addressing keys remain separate from the logical identities sent to
 * the native checker. The project root is applied once by identityFileName;
 * merely removing path traversal never made an absolute name portable.
 */
const logicalSourceName = (fileName: string, rootDir?: string): string => {
  const named = fileName.trim() === "" ? "" : identityFileName(fileName, rootDir)
  return named === "" || named === "." || named === ".." ? "implementation.vibe" : named
}

const canonicalCheckedExportDigest = (source: string, path: string): string => {
  // Native parsing/factory/erasure/printing, never callback introspection or
  // execution. The source project and nominal failure proof remain separate
  // authenticated contract inputs; this fingerprint does not attest captures.
  const canonical = getNativeCompiler().canonicalFunction(source)
  if (!canonical.ok) {
    throw new ActionImplementationContractError(`${path} is not a standalone function expression`)
  }
  return digest({ emittedFunction: canonical.code })
}

const assertClosedImports = (sources: readonly ProjectSource[], rootDir: string): void => {
  const root = resolve(rootDir)
  const names = new Set(sources.map((source) => resolve(root, source.fileName)))
  const inspected = getNativeCompiler().inspect(sources.map((source, index) => ({
    // These are inputs to the VibeLang project checker, not foreign runtime
    // modules. Preserve its parser dialect while isolating host path spelling.
    path: `source-${index}.vibe`, text: source.source, scriptKind: "typescript" as const,
  })))
  for (const [index, source] of sources.entries()) {
    const file = inspected.files[index]!
    if (file.diagnostics.some(diagnostic => diagnostic.category === "error")) {
      throw new ActionImplementationContractError(`implementation source ${source.fileName} did not pass native syntax checking`)
    }
    for (const edge of file.moduleSyntax) {
      if (!["import-declaration", "module-re-export", "import-equals", "dynamic-import"].includes(edge.kind)) continue
      const specifier = edge.specifier
      if (specifier === undefined) {
        throw new ActionImplementationContractError(`implementation contract cannot authenticate a non-literal module specifier in ${source.fileName}`)
      }
      // EXACT membership in the frontend's registry, never a prefix test. This
      // runs before native whole-project checking. Anything outside this set
      // remains an external import this contract cannot authenticate; the Go
      // checker must independently resolve every admitted binding as well.
      //
      // The prefix form this replaced let `vibelang/anything` and
      // `vibelang:anything` skip BOTH refusals below. A specifier resolving to
      // a real installed package under one of those prefixes then produced a
      // `compiler-derived` contract whose projectDigest never covered that
      // import edge — the same fail-open the withdrawn portability analyzer
      // (`poc/src/targets/classify.ts`, deleted 2026-08-23) had recorded
      // fixing. The file is gone; the hazard is not, so the exact-membership
      // rule below is the lesson kept.
      if (COMPILER_INTRINSIC_SPECIFIERS.has(specifier)) continue
      if (!specifier.startsWith(".")) {
        throw new ActionImplementationContractError(
          `implementation contract cannot authenticate external import '${specifier}'; bundle and pin it first`
        )
      }
      const exact = normalize(resolve(dirname(resolve(root, source.fileName)), specifier))
      const candidates = [exact, `${exact}.vibe`, resolve(exact, "index.vibe")]
      if (exact.endsWith(".js")) candidates.push(`${exact.slice(0, -3)}.vibe`)
      if (!candidates.some((candidate) => names.has(candidate))) {
        throw new ActionImplementationContractError(
          `implementation contract source closure is missing relative import '${specifier}' from ${source.fileName}`
        )
      }
    }
  }
}

/**
 * Compile the transitive `E`/`R` rows of an exported ordinary VibeLang function.
 * The returned object is frozen, content-addressed, and accepted by
 * `provideChecked` only in the compiler process that issued it. This local
 * callback pairing prevents accidental substitution after issuance, but is
 * deliberately not treated as source, closure, or emitted-module attestation.
 */
export const compileActionImplementationContract = (
  options: CompileActionImplementationOptions
): ActionImplementationContract => {
  const implementation = options.implementation
  if (typeof implementation !== "function") {
    throw new ActionImplementationContractError("implementation must be the emitted runtime function")
  }
  const contract = compileImplementation(options, false)
  const bindings = authenticatedBindings.get(implementation) ?? new Set<string>()
  bindings.add(contract.digest)
  authenticatedBindings.set(implementation, bindings)
  return contract
}

/**
 * Check a complete source closure for bundling, without pairing or inspecting a
 * host callback. Native Go derives the implementation's input/success codecs as
 * well as its E/R rows. This first source-only profile requires exact structural
 * codecs, not unproved assignability or a legacy JSON-value contract.
 *
 * The result can feed buildWorkerPoolBundle; it does not authorize execution,
 * attest an unrelated callback, or authenticate any emitted bytes by itself.
 */
export const compileActionImplementationSourceContract = (
  options: CompileActionImplementationSourceOptions
): ActionImplementationContract => compileImplementation(options, true)

const compileImplementation = (
  options: CompileActionImplementationSourceOptions,
  durableBoundary: boolean
): ActionImplementationContract => {
  const implementationId = nonEmpty(options.implementationId, "implementationId")
  const implementationVersion = nonEmpty(options.implementationVersion, "implementationVersion")
  const entryFile = nonEmpty(options.entryFile, "entryFile")
  const exportName = nonEmpty(options.exportName, "exportName")
  let action: ActionDescriptor
  try {
    action = validateActionContractDescriptor(options.action)
  } catch (error) {
    throw new ActionImplementationContractError(
      error instanceof Error ? error.message : "action must be a valid compiler-derived descriptor"
    )
  }
  if (durableBoundary && [action.inputSchema, action.successSchema, action.errorSchema].some(schema => schema.shape !== "structural")) {
    throw new ActionImplementationContractError("source-only durable implementations require exact structural Action codecs")
  }
  const suppliedSources = options.sources
  if (!Array.isArray(suppliedSources) || suppliedSources.length === 0) {
    throw new ActionImplementationContractError("sources must contain the complete implementation project")
  }
  // Read host-owned getters only once. Checking, fingerprinting and retaining
  // different reads could otherwise certify source text the checker never saw.
  const sources = suppliedSources.map((source): ProjectSource => {
    if (source === null || typeof source !== "object") {
      throw new ActionImplementationContractError("sources must contain source records")
    }
    const fileName = nonEmpty(source.fileName, "sources[].fileName")
    const text = source.source
    if (typeof text !== "string") {
      throw new ActionImplementationContractError(`source ${fileName} must contain text`)
    }
    return { fileName, source: text }
  })
  const names = sources.map((source) => source.fileName)
  if (new Set(names).size !== names.length) {
    throw new ActionImplementationContractError("sources must have unique file names")
  }
  const entrySource = sources.find((source) => source.fileName === entryFile)
  if (entrySource === undefined) {
    throw new ActionImplementationContractError(`entry file ${entryFile} is absent from the source closure`)
  }

  const authoredRoot = options.rootDir
  const rootDir = authoredRoot ?? process.cwd()
  assertClosedImports(sources, rootDir)
  const files = sources.map(source => ({
    path: logicalSourceName(source.fileName, authoredRoot),
    kind: "vibelang" as const,
    text: source.source
  }))
  if (new Set(files.map(file => file.path)).size !== files.length) {
    throw new ActionImplementationContractError("implementation sources must have unique logical file identities")
  }
  const sourceByLogical = new Map(files.map((file, index) => [file.path, sources[index]!]))
  const checked = getNativeCompiler().checkedFunction({
    files,
    entryFile: logicalSourceName(entryFile, authoredRoot),
    exportName,
    ...(durableBoundary ? { durableBoundary: true } : {})
  })
  if (!checked.ok || checked.function === null) {
    const diagnostics: ProjectDiagnostic[] = checked.diagnostics.map(issue => {
      const original = sourceByLogical.get(issue.file ?? "")
      const start = issue.span?.start ?? 0
      const prefix = (original?.source ?? "").slice(0, start).split(/\r\n|[\n\r\u2028\u2029]/)
      return {
        fileName: original?.fileName ?? issue.file ?? entryFile,
        severity: issue.category === "warning" ? "warning" : "error",
        code: issue.code,
        message: issue.message,
        start, line: prefix.length, column: prefix.at(-1)!.length + 1
      }
    })
    throw new ActionImplementationContractError(
      checked.message + (diagnostics[0] === undefined ? "" : ": " + diagnostics[0].message),
      diagnostics
    )
  }
  const facts = checked.function
  let completion: "value" | "promise" | undefined
  if (durableBoundary) {
    const schemas = JSON.parse(facts.valueSchemasJson)
    completion = schemas.completion
    const inputSchema = validateDurableSchema(schemas.inputSchema, "input", "implementation input schema")
    const successSchema = validateDurableSchema(schemas.successSchema, "success", "implementation success schema")
    if (inputSchema.digest !== action.inputSchema.digest) {
      throw new ActionImplementationContractError(`implementation input schema does not exactly match Action ${action.id}`)
    }
    if (successSchema.digest !== action.successSchema.digest) {
      throw new ActionImplementationContractError(`implementation success schema does not exactly match Action ${action.id}`)
    }
  }
  const checkedFunctionSource = entrySource.source.slice(facts.span.start, facts.span.start + facts.span.length)
  const checkedExportDigest = canonicalCheckedExportDigest(checkedFunctionSource, `${entryFile}:${exportName}`)
  const typedFailures = [...facts.typedFailures]
  const panic = facts.panic
  // A structural empty failure channel has a real never codec. A null digest
  // belongs only to the legacy JSON-only descriptor, not to an infallible Action.
  const failureSchema = validateDurableSchema(JSON.parse(facts.failureSchemaJson), "error", "implementation failure schema")
  if (action.errorSchema.shape !== "structural" && typedFailures.length > 0) {
    throw new ActionImplementationContractError(
      `legacy Action ${action.id} cannot authenticate typed implementation failures; use compileActionContract`
    )
  }
  const failureSchemaDigest = action.errorSchema.shape === "structural" ? failureSchema.digest : null

  const projectSources = sources
    .map((source) => ({ fileName: source.fileName, source: source.source }))
    .sort((left, right) => left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0)
  const semantic = {
    formatVersion: 2 as const,
    source: "compiler-derived" as const,
    compilerIdentity: COMPILER_IDENTITY,
    implementationId,
    implementationVersion,
    actionId: action.id,
    actionVersion: action.version,
    actionContractDigest: action.contractDigest,
    actionErrorSchemaDigest: action.errorSchema.digest,
    entryFile,
    exportName,
    projectDigest: digest({ sources: projectSources }),
    checkedExportDigest,
    requirements: Object.freeze([...facts.requirements]),
    typedFailures: Object.freeze(typedFailures),
    panic,
    failureSchemaDigest
  }
  const contract = deepFreeze({ ...semantic, digest: digest(semantic) })
  assertActionImplementationContractMatchesAction(contract, action)
  authenticated.add(contract)
  if (durableBoundary) checkedValueBoundaries.add(contract)
  retainedProjects.set(contract, deepFreeze({
    entryFile,
    exportName,
    sources: projectSources,
    projectDigest: semantic.projectDigest,
    rootDir: authoredRoot,
    ...(completion === undefined ? {} : { completion })
  }))
  return contract
}

/**
 * @internal Bundle-emission seam. Only the exact frozen contract object issued
 * by either implementation compiler in this process can recover its
 * pinned checked source project; serialized or forged contracts cannot.
 */
export const retainedCheckedImplementationProject = (
  contract: ActionImplementationContract
): RetainedCheckedImplementationProject => {
  const authenticatedContract = requireCompilerAuthenticatedContract(contract)
  const retained = retainedProjects.get(authenticatedContract)
  if (retained === undefined || retained.projectDigest !== authenticatedContract.projectDigest) {
    throw new ActionImplementationContractError(
      "checked implementation sources were not retained for this contract in this process"
    )
  }
  return retained
}

/** @internal Source-only bundle gate; serialized row contracts are not proofs. */
export const requireCompilerCheckedValueBoundary = (value: unknown): ActionImplementationContract => {
  const contract = requireCompilerAuthenticatedContract(value)
  if (!checkedValueBoundaries.has(contract)) {
    throw new ActionImplementationContractError("provider bundle requires the source-only compiler's exact checked value-boundary contract")
  }
  return contract
}

/** Internal authority gate: hashes alone provide integrity, not compiler provenance. */
export const requireCompilerAuthenticatedContract = (value: unknown): ActionImplementationContract => {
  if (value === null || (typeof value !== "object" && typeof value !== "function") || !authenticated.has(value)) {
    throw new ActionImplementationContractError(
      "requires the exact frozen contract object issued by compileActionImplementationContract or compileActionImplementationSourceContract"
    )
  }
  validateActionImplementationContract(value)
  return value as ActionImplementationContract
}

/** Internal binding gate: the contract and callback must have been issued as one compiler pair. */
export const requireCompilerAuthenticatedImplementation = (
  contract: ActionImplementationContract,
  implementation: Function
): void => {
  if (!authenticatedBindings.get(implementation)?.has(contract.digest)) {
    throw new ActionImplementationContractError(
      "provideChecked requires the exact runtime callback paired with its compiler-issued contract"
    )
  }
}
