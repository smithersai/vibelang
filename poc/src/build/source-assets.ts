import { existsSync, readFileSync, realpathSync, statSync, type Stats } from "node:fs"
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path"
import * as ts from "typescript-js"
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
import { recoverSmithersSyntax, type RecoveredSource } from "../language/recover.ts"

const CODE_EXTENSIONS = new Set([
  ".sm", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
  ".d.ts", ".d.mts", ".d.cts"
])
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
/** Sibling spelling generated asset modules use to reference each other. */
const GENERATED_MODULE_SPECIFIER = /^\.\/([0-9a-f]{64})\.ts$/
const CODE_RESOLUTION_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowJs: true,
  checkJs: true,
  allowImportingTsExtensions: true,
  jsx: ts.JsxEmit.React
}

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
  readonly compiler: AssetCompiler
  readonly sources: readonly SourceAssetInput[]
  /**
   * **Provisional.** Project files that declare a source-level
   * `comptime.loader(type, fn)` registration, given project-relative or as an
   * absolute path beneath the project root. Each is read from disk, recognized
   * by TypeScript checker identity, and registered as a sandboxed loader.
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
  /** Node used for whole-form diagnostics. */
  readonly node: ts.Node
  /** Node used for specifier-scoped diagnostics. */
  readonly specifierNode: ts.Node
  readonly sourceFile: ts.SourceFile
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
  readonly sourceFile: ts.SourceFile
  readonly node: ts.Node
}

const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

const isInside = (root: string, file: string): boolean => {
  const path = relative(root, file)
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`))
}

const extensionOf = (fileName: string): string => {
  const lower = fileName.toLowerCase()
  if (lower.endsWith(".d.mts")) return ".d.mts"
  if (lower.endsWith(".d.cts")) return ".d.cts"
  if (lower.endsWith(".d.ts")) return ".d.ts"
  return extname(lower)
}

/**
 * Authored coordinates for a `.sm` source file whose asset preflight parses
 * the frontend's recovered text instead of the authored text.
 *
 * `recoverSmithersSyntax` is not length-preserving: it hoists expression-position
 * `if`/`switch` values and rewrites conditional declarations, so a derived
 * offset is not an authored offset. Every diagnostic this module reports is
 * source-located, so each derived offset is mapped back through the recovery's
 * exact piecewise map before a line and column is taken from the AUTHORED text.
 */
interface AuthoredPositions {
  readonly recovery: RecoveredSource
  readonly lineStarts: readonly number[]
}

const authoredPositions = new WeakMap<ts.SourceFile, AuthoredPositions>()

const computeLineStarts = (text: string): readonly number[] => {
  const starts = [0]
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code === 13) {
      if (text.charCodeAt(index + 1) === 10) index++
      starts.push(index + 1)
    } else if (code === 10 || code === 0x2028 || code === 0x2029) {
      starts.push(index + 1)
    }
  }
  return starts
}

const locateOffset = (
  starts: readonly number[],
  offset: number
): { readonly line: number; readonly column: number } => {
  let low = 0
  let high = starts.length
  while (low + 1 < high) {
    const middle = (low + high) >>> 1
    if (starts[middle]! <= offset) low = middle
    else high = middle
  }
  return { line: low + 1, column: offset - starts[low]! + 1 }
}

/** Derived offset in `file` to a line and column in its authored source. */
const locate = (file: ts.SourceFile, offset: number): { readonly line: number; readonly column: number } => {
  const authored = authoredPositions.get(file)
  if (!authored) {
    const location = file.getLineAndCharacterOfPosition(offset)
    return { line: location.line + 1, column: location.character + 1 }
  }
  const { recovery, lineStarts } = authored
  const mapped = recovery.toAuthored(offset) ?? recovery.toAuthoredAnchor(offset)
  return locateOffset(lineStarts, Math.max(0, Math.min(mapped, recovery.authoredSource.length)))
}

const point = (file: ts.SourceFile, node: ts.Node): { readonly line: number; readonly column: number } =>
  locate(file, node.getStart(file))

/** Authored offset of a node parsed from a recovered `.sm` source. */
const authoredStart = (file: ts.SourceFile, node: ts.Node): number => {
  const offset = node.getStart(file)
  const authored = authoredPositions.get(file)
  if (!authored) return offset
  return authored.recovery.toAuthored(offset) ?? authored.recovery.toAuthoredAnchor(offset)
}

/**
 * Two TypeScript parse errors are the deliberate shapes the checked frontend
 * reads authored Smithers through, not evidence of unparseable source.
 *
 * `TS1109` ("Expression expected.") at a control keyword is the bounded
 * initializer host and same-line return recovery: `const t = if (c) { a } else
 * { b }` and `return switch (x) { ... }` are exactly the forms the checked
 * planner claims through TypeScript's own missing-expression recovery.
 *
 * `TS1434` ("Unexpected keyword or identifier.") at a `defer`/`errdefer`
 * marker is the cleanup form: TypeScript recovers `defer cleanup()` as two
 * adjacent expression statements, and the semantic defer pass owns its shape
 * diagnostic and lowering plan.
 *
 * Dropping them never makes this the syntax authority for `.sm`: a source
 * the frontend cannot parse is still rejected there as SMITHERS1000 at authored
 * coordinates, and a construct recovery refused outright is reported above by
 * its own SMITHERS17xx diagnostic.
 */
const RECOVERY_HOST_KEYWORD = /^(?:if|switch|for|while)\b/
const CLEANUP_MARKER_KEYWORD = /^(?:defer|errdefer)\b/

const isRecoveryNoise = (parseSource: string, code: number, start: number): boolean => {
  if (code === 1109) return RECOVERY_HOST_KEYWORD.test(parseSource.slice(start, start + 8))
  if (code === 1434) return CLEANUP_MARKER_KEYWORD.test(parseSource.slice(start, start + 10))
  return false
}

const diagnostic = (
  file: ts.SourceFile,
  node: ts.Node,
  code: string,
  message: string,
  severity: "error" | "warning" = "error"
): SourceAssetDiagnostic => ({ code, severity, message, fileName: file.fileName, ...point(file, node) })

const attributeName = (name: ts.Node): string | undefined =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined

/** Shared `with { ... }` reader for import and re-export declarations. */
const declaredAttributes = (
  attributes: ts.ImportAttributes | undefined,
  file: ts.SourceFile,
  diagnostics: SourceAssetDiagnostic[]
): Readonly<Record<string, string>> | undefined => {
  if (attributes === undefined) return undefined
  if (attributes.token !== ts.SyntaxKind.WithKeyword) {
    diagnostics.push(diagnostic(file, attributes, "SMITHERS5202", "asset imports use `with { ... }`; legacy import assertions are unsupported"))
    return undefined
  }
  const output = Object.create(null) as Record<string, string>
  for (const entry of attributes.elements) {
    const name = attributeName(entry.name)
    if (name === undefined || !/^[A-Za-z][A-Za-z0-9-]*$/.test(name)) {
      diagnostics.push(diagnostic(file, entry.name, "SMITHERS5203", "asset import attribute names must be static identifiers"))
      continue
    }
    if (Object.hasOwn(output, name)) {
      diagnostics.push(diagnostic(file, entry.name, "SMITHERS5204", `duplicate asset import attribute '${name}'`))
      continue
    }
    if (!ts.isStringLiteral(entry.value)) {
      diagnostics.push(diagnostic(file, entry.value, "SMITHERS5205", `asset import attribute '${name}' must be a string literal`))
      continue
    }
    output[name] = entry.value.text
  }
  return Object.freeze(output)
}

const isPotentialAsset = (specifier: string, attributes: Readonly<Record<string, string>> | undefined): boolean =>
  attributes?.type !== undefined || (
    specifier.startsWith(".") && extensionOf(specifier) !== "" && !CODE_EXTENSIONS.has(extensionOf(specifier))
  )

const allNamedImportsAreTypeOnly = (clause: ts.ImportClause): boolean =>
  clause.name === undefined && clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings) &&
  clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((element) => element.isTypeOnly)

const allNamedExportsAreTypeOnly = (clause: ts.NamedExportBindings): boolean =>
  ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((element) => element.isTypeOnly)

const literalSpecifier = (node: ts.Expression | undefined): string | undefined =>
  node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined

const dynamicImportSpecifier = (node: ts.CallExpression): string | undefined => {
  if (node.expression.kind !== ts.SyntaxKind.ImportKeyword) return undefined
  return literalSpecifier(node.arguments[0])
}

const importTypeSpecifier = (node: ts.ImportTypeNode): string | undefined =>
  ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)
    ? node.argument.literal.text
    : undefined

/**
 * Read `import(specifier, { with: { ... } })`. Only a fully literal options
 * object is admitted; every other shape keeps the deferred-form diagnostic so
 * an attribute the compiler cannot evaluate never selects a loader.
 */
const dynamicImportAttributes = (
  node: ts.CallExpression,
  file: ts.SourceFile,
  diagnostics: SourceAssetDiagnostic[]
): { readonly ok: boolean; readonly attributes?: Readonly<Record<string, string>> } => {
  const deferred = (target: ts.Node): { readonly ok: false } => {
    diagnostics.push(diagnostic(
      file,
      target,
      "SMITHERS5218",
      "dynamic asset imports require a literal specifier and a literal `with { ... }` attribute object"
    ))
    return { ok: false }
  }
  if (node.arguments.length > 2) return deferred(node)
  const options = node.arguments[1]
  if (options === undefined) return { ok: true }
  if (!ts.isObjectLiteralExpression(options) || options.properties.length !== 1) return deferred(options)
  const property = options.properties[0]!
  if (!ts.isPropertyAssignment(property) || attributeName(property.name) !== "with") return deferred(property)
  if (!ts.isObjectLiteralExpression(property.initializer)) return deferred(property.initializer)
  const output = Object.create(null) as Record<string, string>
  let ok = true
  for (const entry of property.initializer.properties) {
    if (!ts.isPropertyAssignment(entry)) {
      ok = false
      deferred(entry)
      continue
    }
    const name = attributeName(entry.name)
    if (name === undefined || !/^[A-Za-z][A-Za-z0-9-]*$/.test(name)) {
      ok = false
      diagnostics.push(diagnostic(file, entry.name, "SMITHERS5203", "asset import attribute names must be static identifiers"))
      continue
    }
    if (Object.hasOwn(output, name)) {
      ok = false
      diagnostics.push(diagnostic(file, entry.name, "SMITHERS5204", `duplicate asset import attribute '${name}'`))
      continue
    }
    if (!ts.isStringLiteral(entry.initializer)) {
      ok = false
      diagnostics.push(diagnostic(file, entry.initializer, "SMITHERS5205", `asset import attribute '${name}' must be a string literal`))
      continue
    }
    output[name] = entry.initializer.text
  }
  return ok ? { ok, attributes: Object.freeze(output) } : { ok }
}

const collectRequests = (
  compiler: AssetCompiler,
  sources: readonly SourceAssetInput[],
  diagnostics: SourceAssetDiagnostic[]
): CollectedRequests => {
  const requests: AssetRequest[] = []
  const seenSources = new Set<string>()
  const ordinaryAliases = new Set<string>()
  const recordOrdinaryAlias = (importer: string, specifier: string): void => {
    const lexical = resolve(dirname(importer), specifier)
    ordinaryAliases.add(lexical)
    const resolvedModule = ts.resolveModuleName(
      specifier,
      importer,
      CODE_RESOLUTION_OPTIONS,
      ts.sys
    ).resolvedModule
    if (resolvedModule !== undefined) ordinaryAliases.add(resolve(resolvedModule.resolvedFileName))
  }
  for (const input of sources) {
    if (typeof input.fileName !== "string" || typeof input.source !== "string") {
      throw new TypeError("source asset inputs require fileName and source strings")
    }
    const importer = resolve(compiler.root, input.fileName)
    if (!isInside(compiler.root, importer) || importer === compiler.root) {
      throw new TypeError(`source asset importer escapes the project root: ${input.fileName}`)
    }
    if (seenSources.has(importer)) throw new TypeError(`duplicate source asset importer: ${input.fileName}`)
    seenSources.add(importer)
    // A `.sm` importer is authored in Smithers, which diverges from the
    // TypeScript grammar in general expression positions. The preflight runs
    // the frontend's own pre-parse recovery first so those modules reach the
    // same AST the checked frontend sees; a source with no divergent syntax
    // recovers to itself, so this path stays byte-identical for it.
    const recovery = importer.endsWith(".sm") ? recoverSmithersSyntax(input.source) : undefined
    const sourceFile = ts.createSourceFile(
      importer,
      recovery ? recovery.parseSource : input.source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    )
    if (recovery?.changed) {
      authoredPositions.set(sourceFile, { recovery, lineStarts: computeLineStarts(recovery.authoredSource) })
    }
    if (recovery !== undefined && recovery.diagnostics.length > 0) {
      // Recovery refused a recognizably Smithers construct. The construct is
      // named by its own diagnostic at authored coordinates; reporting the
      // parser's cascade on top of it would bury the cause under raw TS noise.
      const lineStarts = computeLineStarts(recovery.authoredSource)
      for (const refused of recovery.diagnostics) {
        diagnostics.push({
          code: refused.code,
          severity: refused.severity,
          message: refused.message,
          fileName: importer,
          ...locateOffset(lineStarts, Math.max(0, Math.min(refused.start, recovery.authoredSource.length)))
        })
      }
    } else {
      const parseDiagnostics = (sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? []
      for (const parsed of parseDiagnostics) {
        const start = parsed.start ?? 0
        if (recovery && isRecoveryNoise(recovery.parseSource, parsed.code, start)) continue
        diagnostics.push({
          code: `TS${parsed.code}`,
          severity: "error",
          message: ts.flattenDiagnosticMessageText(parsed.messageText, "\n"),
          fileName: importer,
          ...locate(sourceFile, start)
        })
      }
    }
    const record = (
      specifier: string,
      attributes: Readonly<Record<string, string>>,
      form: AssetRequestForm,
      node: ts.Node,
      specifierNode: ts.Node
    ): void => {
      requests.push({
        importer,
        specifier,
        absoluteAlias: resolve(dirname(importer), specifier),
        attributes,
        form,
        node,
        specifierNode,
        sourceFile
      })
    }
    for (const statement of sourceFile.statements) {
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const specifier = statement.moduleSpecifier.text
        const attributes = declaredAttributes(statement.attributes, sourceFile, diagnostics)
        if (statement.attributes !== undefined && attributes === undefined) continue
        if (!isPotentialAsset(specifier, attributes)) {
          if (specifier.startsWith(".")) recordOrdinaryAlias(importer, specifier)
          continue
        }
        if (!specifier.startsWith(".")) {
          diagnostics.push(diagnostic(sourceFile, statement.moduleSpecifier, "SMITHERS5207", "asset imports must use a relative path"))
          continue
        }
        if (statement.exportClause === undefined) {
          diagnostics.push(diagnostic(
            sourceFile,
            statement,
            "SMITHERS5206",
            "`export * from` an asset is unsupported; re-export the named bindings or a namespace binding"
          ))
          continue
        }
        if (statement.isTypeOnly || allNamedExportsAreTypeOnly(statement.exportClause)) {
          diagnostics.push(diagnostic(sourceFile, statement, "SMITHERS5208", "asset imports require runtime bindings and cannot be type-only or side-effect-only"))
          continue
        }
        if (attributes === undefined || typeof attributes.type !== "string" || attributes.type.trim() === "") {
          diagnostics.push(diagnostic(sourceFile, statement, "SMITHERS5201", "non-code imports require `with { type: \"...\" }`"))
          continue
        }
        record(specifier, attributes, "re-export", statement, statement.moduleSpecifier)
        continue
      }
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      const specifier = statement.moduleSpecifier.text
      const attributes = declaredAttributes(statement.attributes, sourceFile, diagnostics)
      if (statement.attributes !== undefined && attributes === undefined) continue
      if (!isPotentialAsset(specifier, attributes)) {
        if (specifier.startsWith(".")) recordOrdinaryAlias(importer, specifier)
        continue
      }
      if (!specifier.startsWith(".")) {
        diagnostics.push(diagnostic(sourceFile, statement.moduleSpecifier, "SMITHERS5207", "asset imports must use a relative path"))
        continue
      }
      if (
        statement.importClause === undefined || statement.importClause.isTypeOnly ||
        allNamedImportsAreTypeOnly(statement.importClause)
      ) {
        diagnostics.push(diagnostic(sourceFile, statement, "SMITHERS5208", "asset imports require runtime bindings and cannot be type-only or side-effect-only"))
        continue
      }
      if (attributes === undefined || typeof attributes.type !== "string" || attributes.type.trim() === "") {
        diagnostics.push(diagnostic(sourceFile, statement, "SMITHERS5201", "non-code imports require `with { type: \"...\" }`"))
        continue
      }
      record(specifier, attributes, "import", statement, statement.moduleSpecifier)
    }
    const visitExpressions = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const specifier = dynamicImportSpecifier(node)
        const parsed = dynamicImportAttributes(node, sourceFile, diagnostics)
        if (specifier === undefined) {
          // A computed specifier cannot be proven to be code, so an attributed
          // form stays closed; a bare one belongs to the runtime module graph.
          if (parsed.ok && node.arguments.length > 1) {
            diagnostics.push(diagnostic(
              sourceFile,
              node,
              "SMITHERS5218",
              "dynamic asset imports require a literal specifier and a literal `with { ... }` attribute object"
            ))
          }
        } else if (parsed.ok) {
          if (!isPotentialAsset(specifier, parsed.attributes)) {
            if (specifier.startsWith(".")) recordOrdinaryAlias(importer, specifier)
          } else if (!specifier.startsWith(".")) {
            diagnostics.push(diagnostic(sourceFile, node.arguments[0]!, "SMITHERS5207", "asset imports must use a relative path"))
          } else if (
            parsed.attributes === undefined || typeof parsed.attributes.type !== "string" ||
            parsed.attributes.type.trim() === ""
          ) {
            diagnostics.push(diagnostic(sourceFile, node, "SMITHERS5201", "non-code imports require `with { type: \"...\" }`"))
          } else {
            record(specifier, parsed.attributes, "dynamic-import", node, node.arguments[0]!)
          }
        }
      } else if (ts.isImportTypeNode(node)) {
        const specifier = importTypeSpecifier(node)
        if (specifier !== undefined && isPotentialAsset(specifier, undefined)) {
          diagnostics.push(diagnostic(
            sourceFile,
            node,
            "SMITHERS5208",
            "asset modules cannot be imported through a type-only import() query"
          ))
        }
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        // `import x = require("...")` and `export import x = require("...")`
        // are runtime module edges with no place to put import attributes, so
        // a non-code target can never select a loader through them. Leaving the
        // form unhandled let a non-code specifier skip the attribute rule every
        // other import form obeys, and hid a code path from the code/asset
        // identity reconciliation that stops a generated module shadowing it.
        const specifier = literalSpecifier(node.moduleReference.expression)
        if (specifier === undefined) {
          diagnostics.push(diagnostic(
            sourceFile,
            node.moduleReference,
            "SMITHERS5205",
            "import-assignment specifiers must be string literals"
          ))
        } else if (!isPotentialAsset(specifier, undefined)) {
          if (specifier.startsWith(".")) recordOrdinaryAlias(importer, specifier)
        } else {
          diagnostics.push(diagnostic(
            sourceFile,
            node,
            "SMITHERS5201",
            "non-code imports require `with { type: \"...\" }`, which an import assignment cannot carry"
          ))
        }
      }
      ts.forEachChild(node, visitExpressions)
    }
    visitExpressions(sourceFile)
  }
  return {
    // Recovery can hoist a construct ahead of the statement that contained it,
    // so requests are ordered by AUTHORED position: issuance order, and every
    // identity derived from it, stays the order the module was written in.
    requests: requests.sort((left, right) => compareText(left.importer, right.importer) ||
      authoredStart(left.sourceFile, left.node) - authoredStart(right.sourceFile, right.node)),
    ordinaryAliases,
    sourceNames: seenSources
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

const safeGeneratedPropertyName = (name: ts.PropertyName): boolean =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ||
  (ts.isComputedPropertyName(name) && (
    ts.isStringLiteral(name.expression) || ts.isNumericLiteral(name.expression)
  ))

const assertSafeGeneratedByteArray = (expression: ts.Expression): void => {
  if (!ts.isArrayLiteralExpression(expression)) {
    throw new TypeError("compiler-generated Uint8Array values require one literal byte array")
  }
  for (const element of expression.elements) {
    if (
      ts.isOmittedExpression(element) || ts.isSpreadElement(element) ||
      !ts.isNumericLiteral(element) || !Number.isSafeInteger(Number(element.text)) ||
      Number(element.text) < 0 || Number(element.text) > 255
    ) {
      throw new TypeError("compiler-generated Uint8Array values must contain only integer bytes")
    }
  }
}

const assertSafeGeneratedExpression = (expressionValue: ts.Expression, bindings: ReadonlySet<string>): void => {
  let expression = expressionValue
  while (
    ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) expression = expression.expression
  if (
    expression.kind === ts.SyntaxKind.NullKeyword || expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword || ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression) || ts.isNumericLiteral(expression)
  ) return
  if (
    ts.isPrefixUnaryExpression(expression) &&
    (expression.operator === ts.SyntaxKind.MinusToken || expression.operator === ts.SyntaxKind.PlusToken) &&
    ts.isNumericLiteral(expression.operand)
  ) return
  if (ts.isIdentifier(expression) && bindings.has(expression.text)) return
  if (ts.isArrayLiteralExpression(expression)) {
    for (const element of expression.elements) {
      if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) {
        throw new TypeError("compiler-generated asset arrays cannot contain holes or spreads")
      }
      assertSafeGeneratedExpression(element, bindings)
    }
    return
  }
  if (ts.isObjectLiteralExpression(expression)) {
    for (const property of expression.properties) {
      if (!ts.isPropertyAssignment(property) || !safeGeneratedPropertyName(property.name)) {
        throw new TypeError("compiler-generated asset objects support only static data properties")
      }
      if (
        !ts.isComputedPropertyName(property.name) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        property.name.text === "__proto__"
      ) {
        throw new TypeError("compiler-generated asset objects must use a computed '__proto__' data property")
      }
      assertSafeGeneratedExpression(property.initializer, bindings)
    }
    return
  }
  if (
    ts.isNewExpression(expression) && ts.isIdentifier(expression.expression) &&
    expression.expression.text === "Uint8Array" && expression.typeArguments === undefined &&
    expression.arguments?.length === 1
  ) {
    assertSafeGeneratedByteArray(expression.arguments[0]!)
    return
  }
  throw new TypeError(`compiler-generated asset module contains executable expression ${ts.SyntaxKind[expression.kind]}`)
}

/**
 * Admit one generated module and return the generated asset modules it
 * references. A reference is admitted only when it names a sibling generated
 * module by logical key and the loader declared that exact edge through the
 * tracked context; nothing else may become an import.
 */
const assertSafeGeneratedModule = (
  sourceFile: ts.SourceFile,
  declaredLogicalKeys: ReadonlySet<string>
): readonly string[] => {
  const bindings = new Set<string>()
  const references = new Set<string>()
  const bindName = (name: ts.BindingName): void => {
    if (!ts.isIdentifier(name) || name.text === "Uint8Array" || bindings.has(name.text)) {
      throw new TypeError("compiler-generated asset bindings require unique plain identifiers")
    }
    bindings.add(name.text)
  }
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (statement.modifiers !== undefined || statement.attributes !== undefined) {
      throw new TypeError("compiler-generated asset imports cannot carry modifiers or import attributes")
    }
    if (!ts.isStringLiteral(statement.moduleSpecifier)) {
      throw new TypeError("compiler-generated asset imports require a literal module specifier")
    }
    const matched = GENERATED_MODULE_SPECIFIER.exec(statement.moduleSpecifier.text)
    if (matched === null) {
      throw new TypeError(
        "compiler-generated asset modules may only import another generated asset module as \"./<logicalKey>.ts\""
      )
    }
    const logicalKey = matched[1]!
    if (!declaredLogicalKeys.has(logicalKey)) {
      throw new TypeError(`compiler-generated asset module references an undeclared asset dependency: ${logicalKey}`)
    }
    const clause = statement.importClause
    if (clause === undefined || clause.isTypeOnly) {
      throw new TypeError("compiler-generated asset imports require runtime bindings")
    }
    if (clause.name !== undefined) bindName(clause.name)
    if (clause.namedBindings !== undefined) {
      if (!ts.isNamedImports(clause.namedBindings)) {
        throw new TypeError("compiler-generated asset modules cannot bind an import namespace")
      }
      for (const element of clause.namedBindings.elements) {
        if (element.isTypeOnly) throw new TypeError("compiler-generated asset imports require runtime bindings")
        bindName(element.name)
      }
    }
    if (clause.name === undefined && clause.namedBindings === undefined) {
      throw new TypeError("compiler-generated asset imports require runtime bindings")
    }
    references.add(logicalKey)
  }
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) continue
    if (ts.isVariableStatement(statement)) {
      // An exact declaration form, not a bit test. `ts.NodeFlags.AwaitUsing` is
      // `Const | Using`, so `flags & Const` admits `await using`, which is an
      // immutable binding — the meaning that test carries everywhere else — but
      // not inert data: it evaluates a `Symbol.asyncDispose` lookup and a
      // top-level await inside a module this compiler stamps `@throws {never}`,
      // and it is a SyntaxError under the declared engine. This grammar is the
      // containment boundary for loader output, so it must name the one form it
      // accepts rather than test one bit of it.
      const declarationForm = statement.declarationList.flags &
        (ts.NodeFlags.Const | ts.NodeFlags.Let | ts.NodeFlags.Using)
      if (declarationForm !== ts.NodeFlags.Const) {
        throw new TypeError("compiler-generated asset bindings must be const")
      }
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.initializer === undefined) {
          throw new TypeError("compiler-generated asset bindings require unique plain identifiers and initializers")
        }
        assertSafeGeneratedExpression(declaration.initializer, bindings)
        bindName(declaration.name)
      }
      continue
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      assertSafeGeneratedExpression(statement.expression, bindings)
      continue
    }
    throw new TypeError(`compiler-generated asset module contains executable statement ${ts.SyntaxKind[statement.kind]}`)
  }
  return [...references].sort(compareText)
}

const generatedModule = (build: AssetBuild): { readonly source: string; readonly references: readonly string[] } => {
  const source = `${GENERATED_MARKER}\n` +
    `// Compiler-generated asset ${JSON.stringify(relative(dirname(build.path), build.path))}; ` +
    `logical=${build.logicalKey} content=${build.key}\n` +
    build.module.emittedTypeScript
  const parsed = ts.createSourceFile("asset.generated.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const parseDiagnostics = (parsed as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? []
  if (parseDiagnostics.length > 0) {
    throw new TypeError(`asset loader emitted invalid TypeScript: ${ts.flattenDiagnosticMessageText(parseDiagnostics[0]!.messageText, "\n")}`)
  }
  const declaredLogicalKeys = new Set(
    build.dependencies
      .filter((dependency) => dependency.kind === "asset" && typeof dependency.logicalKey === "string")
      .map((dependency) => dependency.logicalKey!)
  )
  const references = assertSafeGeneratedModule(parsed, declaredLogicalKeys)
  if (Buffer.byteLength(source, "utf8") > MAX_GENERATED_SOURCE_BYTES) {
    throw new RangeError(`generated asset module exceeds ${MAX_GENERATED_SOURCE_BYTES} bytes`)
  }
  return { source, references }
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
    const id = `smithers:project-loader/${portablePathOf(compiler.root, registration.fileName)}`
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
  if (diagnostics.some((entry) => entry.severity === "error")) return failed()
  const loaderCandidates = collectLoaderFileCandidates(compiler, sources, options.loaders, diagnostics)
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
        site.sourceFile,
        site.node,
        "SMITHERS5209",
        error instanceof Error ? error.message : String(error)
      ))
      return undefined
    }
    const already = admitted.get(canonical)
    if (already !== undefined) return { canonical, identity: already }
    if (collected.sourceNames.has(canonical) || collected.ordinaryAliases.has(canonical)) {
      diagnostics.push(diagnostic(
        site.sourceFile,
        site.node,
        "SMITHERS5215",
        "one path cannot be both a compiler asset module and an authored/runtime code module"
      ))
      return undefined
    }
    const identity = `${metadata.dev}:${metadata.ino}`
    const codeOwner = codeIdentityOwners.get(identity)
    if (codeOwner !== undefined) {
      diagnostics.push(diagnostic(
        site.sourceFile,
        site.node,
        "SMITHERS5215",
        `one file identity cannot be both a compiler asset module and an authored/runtime code module: ${codeOwner} and ${canonical}`
      ))
      return undefined
    }
    const priorIdentity = identityOwners.get(identity)
    if (priorIdentity !== undefined && priorIdentity !== canonical) {
      diagnostics.push(diagnostic(site.sourceFile, site.node, "SMITHERS5210", `asset hard-link aliases are forbidden: ${priorIdentity} and ${canonical}`))
      return undefined
    }
    if (identityOwners.size >= maximumAssets) {
      diagnostics.push(diagnostic(site.sourceFile, site.node, "SMITHERS5211", `asset graph exceeds ${maximumAssets} files`))
      return undefined
    }
    if (totalBytes + metadata.size > maximumTotalAssetBytes) {
      diagnostics.push(diagnostic(site.sourceFile, site.node, "SMITHERS5212", `asset graph exceeds ${maximumTotalAssetBytes} bytes`))
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
    const site: DiagnosticSite = { sourceFile: request.sourceFile, node: request.specifierNode }
    const target = admitAsset(request.absoluteAlias, site)
    if (target === undefined) continue
    const attributesKey = canonicalJson(request.attributes)
    const prior = preparedByAsset.get(target.canonical)
    if (prior !== undefined) {
      if (prior.attributesKey !== attributesKey) {
        diagnostics.push(diagnostic(
          request.sourceFile,
          request.node,
          "SMITHERS5215",
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
        site.sourceFile,
        site.node,
        "SMITHERS5219",
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
        site.sourceFile,
        site.node,
        "SMITHERS5213",
        error instanceof Error ? error.message : String(error)
      ))
      return undefined
    }
    for (const loaderDiagnostic of build.module.diagnostics) {
      diagnostics.push(diagnostic(
        site.sourceFile,
        site.node,
        "SMITHERS5214",
        loaderDiagnostic.message,
        loaderDiagnostic.level
      ))
    }
    const virtualRelative = `.smithers-generated/assets/${build.logicalKey}.ts`
    const virtualAbsolute = resolve(compiler.root, virtualRelative)
    const generatedOwner = generatedOwners.get(virtualAbsolute)
    if (existsSync(virtualAbsolute) || (generatedOwner !== undefined && generatedOwner !== target.canonical)) {
      diagnostics.push(diagnostic(site.sourceFile, site.node, "SMITHERS5216", `generated asset identity collides with a real path: ${virtualRelative}`))
      return undefined
    }
    generatedOwners.set(virtualAbsolute, target.canonical)
    let source: string
    let references: readonly string[]
    try {
      ({ source, references } = generatedModule(build))
    } catch (error) {
      diagnostics.push(diagnostic(site.sourceFile, site.node, "SMITHERS5217", error instanceof Error ? error.message : String(error)))
      return undefined
    }
    issuing.add(target.canonical)
    try {
      for (const reference of references) {
        if (depth + 1 > MAX_GENERATED_MODULE_DEPTH) {
          diagnostics.push(diagnostic(
            site.sourceFile,
            site.node,
            "SMITHERS5219",
            `generated asset module graph exceeds ${MAX_GENERATED_MODULE_DEPTH} nested levels`
          ))
          return undefined
        }
        const dependency = build.dependencies.find(
          (candidate) => candidate.kind === "asset" && candidate.logicalKey === reference
        )
        if (dependency === undefined) {
          diagnostics.push(diagnostic(
            site.sourceFile,
            site.node,
            "SMITHERS5219",
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
            site.sourceFile,
            site.node,
            "SMITHERS5215",
            "one asset path is imported with conflicting attributes; the bounded module graph requires one canonical shape"
          ))
          return undefined
        }
        attributesByAsset.set(child.canonical, childAttributesKey)
        const issued = await issueModule({ ...child, attributes: childAttributes }, site, depth + 1)
        if (issued === undefined) return undefined
        if (issued.logicalKey !== dependency.logicalKey || issued.contentKey !== dependency.digest) {
          diagnostics.push(diagnostic(
            site.sourceFile,
            site.node,
            "SMITHERS5219",
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
      { sourceFile: prepared.request.sourceFile, node: prepared.request.node },
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
