import { dirname, normalize, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import * as ts from "typescript-js"
import type { ProjectDiagnostic, ProjectSource } from "../language/model.ts"
import { buildSemanticProjectModels, COMPILER_INTRINSIC_SPECIFIERS } from "../language/semantic.ts"
import { compileAndCheckProject } from "../language/validate.ts"
import {
  assertJson,
  canonicalJson,
  deepFreeze,
  digest,
  type ActionDescriptor,
  type ActionImplementationContract,
  type DurableTypeDescriptor
} from "./ir.ts"
import {
  deriveDurableErrorSchema,
  validateActionContractDescriptor
} from "./schema.ts"

const COMPILER_IDENTITY = "smithers-action-implementation-v2" as const
const authenticated = new WeakSet<object>()
const authenticatedBindings = new WeakMap<Function, Set<string>>()

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
  /** Complete checked `.sm` source closure for the implementation. */
  readonly sources: readonly ProjectSource[]
  readonly rootDir?: string
}

export class ActionImplementationContractError extends Error {
  constructor(
    message: string,
    readonly diagnostics: readonly ProjectDiagnostic[] = []
  ) {
    super(message)
    this.name = "ActionImplementationContractError"
  }
}

const nonEmpty = (value: unknown, path: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ActionImplementationContractError(`${path} must be a non-empty string`)
  }
  return value
}

const digestValue = (value: unknown, path: string): string => {
  const candidate = nonEmpty(value, path)
  if (!/^[0-9a-f]{64}$/.test(candidate)) {
    throw new ActionImplementationContractError(`${path} must be a lowercase SHA-256 digest`)
  }
  return candidate
}

const sortedUniqueStrings = (value: unknown, path: string): readonly string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new ActionImplementationContractError(`${path} must be an array of non-empty strings`)
  }
  const expected = [...new Set(value)].sort()
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new ActionImplementationContractError(`${path} must be sorted and unique`)
  }
  return value as readonly string[]
}

const logicalSourceName = (fileName: string): string => {
  const parts = fileName.replace(/\\/g, "/").split("/")
    .filter((part) => part !== "" && part !== "." && part !== "..")
  return parts.join("/") || "implementation.sm"
}

const canonicalCheckedExportDigest = (source: string, path: string): string => {
  const withoutExport = source.replace(/^\s*export\s+(?:default\s+)?/, "")
  const transpiled = ts.transpileModule(`const __smithersImplementation = (${withoutExport})`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      removeComments: true
    },
    fileName: `${path}.ts`,
    reportDiagnostics: true
  })
  if (transpiled.diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    throw new ActionImplementationContractError(`${path} is not a standalone function expression`)
  }
  const emitted = ts.createSourceFile(`${path}.js`, transpiled.outputText, ts.ScriptTarget.ES2022, true)
  const statement = emitted.statements[0]
  const declaration = statement && ts.isVariableStatement(statement)
    ? statement.declarationList.declarations[0]
    : undefined
  if (declaration?.initializer === undefined) {
    throw new ActionImplementationContractError(`${path} is not a standalone function expression`)
  }
  const printed = ts.createPrinter({ removeComments: true }).printNode(
    ts.EmitHint.Expression,
    declaration.initializer,
    emitted
  )
  return digest({ emittedFunction: printed })
}

/**
 * Every syntactic form that names another module. `import ... from` was once
 * the only form checked, so `export { x } from "pkg"`, `export * from "pkg"`,
 * `export * as ns from "pkg"`, and `import x = require("pkg")` all reached an
 * external, unpinned package without ever meeting the closure refusal below —
 * the same fail-open as the prefix bug, through a different spelling.
 */
const moduleSpecifierSites = (file: ts.SourceFile): readonly { readonly specifier: string; readonly node: ts.Node }[] => {
  const sites: { specifier: string; node: ts.Node }[] = []
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      sites.push({ specifier: node.moduleSpecifier.text, node })
    } else if (
      ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      sites.push({ specifier: node.moduleReference.expression.text, node })
    } else if (
      ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined && ts.isStringLiteral(node.arguments[0])
    ) {
      sites.push({ specifier: (node.arguments[0] as ts.StringLiteral).text, node })
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(file, visit)
  return sites
}

const assertClosedImports = (sources: readonly ProjectSource[], rootDir: string): void => {
  const root = resolve(rootDir)
  const names = new Set(sources.map((source) => resolve(root, source.fileName)))
  for (const source of sources) {
    const file = ts.createSourceFile(source.fileName, source.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    for (const { specifier } of moduleSpecifierSites(file)) {
      // EXACT membership in the frontend's registry, never a prefix test. This
      // runs immediately before `buildSemanticProjectModels`, so the two must
      // agree on what is compiler-owned: anything the frontend will treat as
      // foreign is an external import this contract cannot authenticate.
      //
      // The prefix form this replaced let `smthrs/anything` and
      // `smithers:anything` skip BOTH refusals below. A specifier resolving to
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
      const candidates = [exact, `${exact}.sm`, resolve(exact, "index.sm")]
      if (exact.endsWith(".js")) candidates.push(`${exact.slice(0, -3)}.sm`)
      if (!candidates.some((candidate) => names.has(candidate))) {
        throw new ActionImplementationContractError(
          `implementation contract source closure is missing relative import '${specifier}' from ${source.fileName}`
        )
      }
    }
  }
}

/** Validate serialized compiler evidence without granting it in-process trust. */
export const validateActionImplementationContract = (value: unknown): ActionImplementationContract => {
  let snapshot: ReturnType<typeof assertJson>
  try {
    snapshot = assertJson(value, "Action implementation contract")
  } catch (error) {
    throw new ActionImplementationContractError(error instanceof Error ? error.message : String(error))
  }
  if (snapshot === null || Array.isArray(snapshot) || typeof snapshot !== "object") {
    throw new ActionImplementationContractError("Action implementation contract must be an object")
  }
  const record = snapshot as Record<string, unknown>
  const expectedKeys = [
    "actionContractDigest", "actionErrorSchemaDigest", "actionId", "actionVersion", "checkedExportDigest",
    "compilerIdentity", "digest", "entryFile", "exportName", "failureSchemaDigest", "formatVersion",
    "implementationId", "implementationVersion", "panic", "projectDigest", "requirements", "source",
    "typedFailures"
  ]
  if (canonicalJson(Object.keys(record).sort()) !== canonicalJson(expectedKeys)) {
    throw new ActionImplementationContractError("Action implementation contract has unknown or missing fields")
  }
  if (record.formatVersion !== 2 || record.source !== "compiler-derived" || record.compilerIdentity !== COMPILER_IDENTITY) {
    throw new ActionImplementationContractError("Action implementation contract has an unsupported compiler format")
  }
  nonEmpty(record.implementationId, "implementationId")
  nonEmpty(record.implementationVersion, "implementationVersion")
  nonEmpty(record.actionId, "actionId")
  if (!Number.isSafeInteger(record.actionVersion) || (record.actionVersion as number) < 1) {
    throw new ActionImplementationContractError("actionVersion must be a positive safe integer")
  }
  digestValue(record.actionContractDigest, "actionContractDigest")
  digestValue(record.actionErrorSchemaDigest, "actionErrorSchemaDigest")
  nonEmpty(record.entryFile, "entryFile")
  nonEmpty(record.exportName, "exportName")
  digestValue(record.projectDigest, "projectDigest")
  digestValue(record.checkedExportDigest, "checkedExportDigest")
  sortedUniqueStrings(record.requirements, "requirements")
  sortedUniqueStrings(record.typedFailures, "typedFailures")
  if (typeof record.panic !== "boolean") throw new ActionImplementationContractError("panic must be boolean")
  if (record.failureSchemaDigest !== null) digestValue(record.failureSchemaDigest, "failureSchemaDigest")
  const claimed = digestValue(record.digest, "digest")
  const { digest: _claimed, ...semantic } = record
  if (digest(semantic) !== claimed) {
    throw new ActionImplementationContractError("Action implementation contract digest mismatch")
  }
  return deepFreeze(record as unknown as ActionImplementationContract)
}

const actionTypedFailureNames = (descriptor: ActionDescriptor): readonly string[] => {
  if (descriptor.errorSchema.shape !== "structural") return []
  const names: string[] = []
  const visit = (value: DurableTypeDescriptor): void => {
    if (value.kind === "error") {
      names.push(value.name)
      return
    }
    if (value.kind === "union") {
      for (const variant of value.variants) visit(variant)
      return
    }
    throw new ActionImplementationContractError(
      `Action ${descriptor.id} error schema is not a nominal Error or Error union`
    )
  }
  visit(descriptor.errorSchema.descriptor)
  const sorted = [...new Set(names)].sort()
  if (sorted.includes("Panic")) {
    throw new ActionImplementationContractError(
      `Action ${descriptor.id} uses reserved defect name Panic as a typed Error`
    )
  }
  return sorted
}

/**
 * Recheck serializable implementation evidence against the exact Action at
 * every provider/deployment boundary. This compares compiler-derived nominal
 * schema identity, not erased TypeScript names or runtime callback text.
 */
export const assertActionImplementationContractMatchesAction = (
  rawContract: ActionImplementationContract,
  rawAction: ActionDescriptor
): void => {
  const contract = validateActionImplementationContract(rawContract)
  let action: ActionDescriptor
  try {
    action = validateActionContractDescriptor(rawAction)
  } catch (error) {
    throw new ActionImplementationContractError(
      error instanceof Error ? error.message : "Action descriptor is invalid"
    )
  }
  if (
    contract.actionId !== action.id ||
    contract.actionVersion !== action.version ||
    contract.actionContractDigest !== action.contractDigest ||
    contract.actionErrorSchemaDigest !== action.errorSchema.digest
  ) {
    throw new ActionImplementationContractError(
      `implementation contract does not target exact Action ${action.id}@${action.version}`
    )
  }
  const declared = actionTypedFailureNames(action)
  if (action.errorSchema.shape === "structural") {
    if (canonicalJson(contract.typedFailures) !== canonicalJson(declared)) {
      throw new ActionImplementationContractError(
        `implementation typed failures ${contract.typedFailures.join(" | ") || "never"} do not exactly match ` +
        `Action ${action.id} failures ${declared.join(" | ") || "never"}`
      )
    }
    if (contract.failureSchemaDigest !== action.errorSchema.digest) {
      throw new ActionImplementationContractError(
        `implementation nominal failure schema does not exactly match Action ${action.id} error schema`
      )
    }
  } else if (contract.typedFailures.length > 0 || contract.failureSchemaDigest !== null) {
    throw new ActionImplementationContractError(
      `legacy Action ${action.id} cannot authenticate a nonempty typed failure row; use a structural compiler contract`
    )
  }
}

/**
 * Compile the transitive `E`/`R` rows of an exported ordinary Smithers function.
 * The returned object is frozen, content-addressed, and accepted by
 * `provideChecked` only in the compiler process that issued it. This local
 * callback pairing prevents accidental substitution after issuance, but is
 * deliberately not treated as source, closure, or emitted-module attestation.
 */
export const compileActionImplementationContract = (
  options: CompileActionImplementationOptions
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
  if (typeof options.implementation !== "function") {
    throw new ActionImplementationContractError("implementation must be the emitted runtime function")
  }
  if (!Array.isArray(options.sources) || options.sources.length === 0) {
    throw new ActionImplementationContractError("sources must contain the complete implementation project")
  }
  const names = options.sources.map((source) => nonEmpty(source.fileName, "sources[].fileName"))
  if (new Set(names).size !== names.length) {
    throw new ActionImplementationContractError("sources must have unique file names")
  }
  for (const source of options.sources) {
    if (typeof source.source !== "string") {
      throw new ActionImplementationContractError(`source ${source.fileName} must contain text`)
    }
  }
  const entrySource = options.sources.find((source) => source.fileName === entryFile)
  if (entrySource === undefined) {
    throw new ActionImplementationContractError(`entry file ${entryFile} is absent from the source closure`)
  }

  const rootDir = options.rootDir ?? process.cwd()
  assertClosedImports(options.sources, rootDir)
  const project = buildSemanticProjectModels(
    options.sources,
    options.rootDir === undefined ? {} : { rootDir: options.rootDir }
  )
  const analysis = project.analysis
  if (analysis.diagnostics.length > 0) {
    throw new ActionImplementationContractError(
      `implementation project did not pass the Smithers row checker (${analysis.diagnostics.length} diagnostic(s))`,
      analysis.diagnostics
    )
  }
  const entry = analysis.files[entryFile]
  const declaration = entry?.functions.find((candidate) => candidate.name === exportName && candidate.exported)
  const row = entry?.rows[exportName]
  if (entry === undefined || declaration === undefined || row === undefined) {
    throw new ActionImplementationContractError(
      `${entryFile} must export an ordinary checked function named ${exportName}`
    )
  }
  const model = project.models.get(entryFile)!
  const emitted = compileAndCheckProject(options.sources, {
    ...(options.rootDir === undefined ? {} : { rootDir: options.rootDir }),
    outDir: resolve(rootDir, ".smithers-action-implementation-check"),
    runtimeImport: resolve(dirname(fileURLToPath(import.meta.url)), "../runtime/index.ts"),
    sourceMap: false
  })
  if (!emitted.ok) {
    const first = emitted.emitDiagnostics[0]
    throw new ActionImplementationContractError(
      first === undefined
        ? "implementation project did not pass checked lowering"
        : `lowered implementation project failed TypeScript checking: ${ts.flattenDiagnosticMessageText(first.messageText, "\n")}`
    )
  }
  const checkedFunctionSource = entrySource.source.slice(declaration.start, declaration.end)
  const checkedExportDigest = canonicalCheckedExportDigest(checkedFunctionSource, `${entryFile}:${exportName}`)

  const rowFailures = [...row.failures].sort()
  const panic = rowFailures.includes("Panic")
  const typedFailures = rowFailures.filter((failure) => failure !== "Panic")
  const classDeclarations = new Map<string, ts.ClassDeclaration[]>()
  const logicalBySource = new Map<ts.SourceFile, string>()
  for (const [logicalName, sourceModel] of project.models) {
    logicalBySource.set(sourceModel.sourceFile, logicalSourceName(logicalName))
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) && node.name) {
        const declarations = classDeclarations.get(node.name.text) ?? []
        declarations.push(node)
        classDeclarations.set(node.name.text, declarations)
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceModel.sourceFile)
  }
  if (panic && (classDeclarations.get("Panic")?.length ?? 0) > 0) {
    throw new ActionImplementationContractError(
      "Panic is a reserved defect row and cannot also name a recoverable implementation Error"
    )
  }

  let failureSchemaDigest: string | null = null
  if (typedFailures.length > 0) {
    if (action.errorSchema.shape !== "structural") {
      throw new ActionImplementationContractError(
        `legacy Action ${action.id} cannot authenticate typed implementation failures; use compileActionContract`
      )
    }
    const failureTypes = typedFailures.map((failure) => {
      const declarations = classDeclarations.get(failure) ?? []
      if (declarations.length !== 1 || declarations[0]!.name === undefined) {
        throw new ActionImplementationContractError(
          `typed failure ${failure} must resolve to exactly one Error class in the checked source closure`
        )
      }
      return model.checker.getTypeAtLocation(declarations[0]!.name!)
    })
    let derived
    try {
      derived = deriveDurableErrorSchema(
        model.checker,
        model.sourceFile,
        model.functions.find((candidate) => candidate.publicName === exportName && candidate.exported)?.node ?? model.sourceFile,
        failureTypes,
        (sourceFile) => {
          const logicalName = logicalBySource.get(sourceFile)
          if (logicalName === undefined) {
            throw new ActionImplementationContractError(
              `typed failure declaration ${sourceFile.fileName} is outside the checked source closure`
            )
          }
          return logicalName
        }
      )
    } catch (error) {
      throw error instanceof ActionImplementationContractError
        ? error
        : new ActionImplementationContractError(
            `implementation typed failure schema is not durable: ${error instanceof Error ? error.message : String(error)}`
          )
    }
    failureSchemaDigest = derived.digest
  }

  const projectSources = options.sources
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
    requirements: Object.freeze([...row.requirements].sort()),
    typedFailures: Object.freeze(typedFailures),
    panic,
    failureSchemaDigest
  }
  const contract = deepFreeze({ ...semantic, digest: digest(semantic) })
  assertActionImplementationContractMatchesAction(contract, action)
  authenticated.add(contract)
  const bindings = authenticatedBindings.get(options.implementation) ?? new Set<string>()
  bindings.add(contract.digest)
  authenticatedBindings.set(options.implementation, bindings)
  retainedProjects.set(contract, deepFreeze({
    entryFile,
    exportName,
    sources: projectSources,
    projectDigest: semantic.projectDigest,
    rootDir: options.rootDir
  }))
  return contract
}

/**
 * @internal Bundle-emission seam. Only the exact frozen contract object issued
 * by `compileActionImplementationContract` in this process can recover its
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

/** Internal authority gate: hashes alone provide integrity, not compiler provenance. */
export const requireCompilerAuthenticatedContract = (value: unknown): ActionImplementationContract => {
  if (value === null || (typeof value !== "object" && typeof value !== "function") || !authenticated.has(value)) {
    throw new ActionImplementationContractError(
      "provideChecked requires the exact frozen contract object issued by compileActionImplementationContract"
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
