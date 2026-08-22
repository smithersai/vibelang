import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import * as ts from "typescript-js";
import type { AssetDependency } from "./assets.ts";
import { type ComptimeBuild, ComptimeCompiler } from "./comptime.ts";
import {
  DEFAULT_SCHEMA_RUNTIME_IMPORT,
  deriveSchemaDescriptor,
  emitSchemaCall,
  emitSchemaRuntimeImport,
  SCHEMA_MODULE_SPECIFIER,
  SCHEMA_PRELUDE,
  SCHEMA_RUNTIME_BINDING,
  SchemaDerivationError,
} from "./schema-derive.ts";
import type { SchemaDescriptor } from "./schema-runtime.ts";
import { canonical, compareStableStrings, digest, freezeStable, stableClone, type StableJson } from "./stable.ts";
import { recoverVibeSyntax, type RecoveredSource } from "../language/recover.ts";

export const COMPTIME_MODULE_SPECIFIER = "vibelang:comptime";
export const COMPTIME_RUNTIME_ERROR =
  '"vibelang:comptime" is compiler-only; compile this module before ordinary JavaScript execution';

/**
 * A loader may expose this source for the compiler-owned virtual module. Its
 * top-level throw rejects dependency evaluation before an importing module's
 * body (and therefore a comptime call argument) can run.
 */
export const COMPTIME_RUNTIME_GUARD_SOURCE =
  `export function comptime(_value) { throw new Error(${JSON.stringify(COMPTIME_RUNTIME_ERROR)}); }\n` +
  `throw new Error(${JSON.stringify(COMPTIME_RUNTIME_ERROR)});\n`;

export const ComptimeIntrinsicDiagnosticCode = Object.freeze({
  Syntax: "VCT1000",
  MissingIdentity: "VCT1001",
  UnrelatedIdentity: "VCT1002",
  Arity: "VCT1003",
  UnsupportedExpression: "VCT1004",
  NoncanonicalResult: "VCT1005",
  UnsupportedUse: "VCT1006",
  BuildFailure: "VCT1007",
  InternalIdentity: "VCT1008",
  SourceMapFailure: "VCT1009",
  InvalidFunction: "VCT1010",
  TrackedInput: "VCT1011",
  Budget: "VCT1012",
  TypeProduction: "VCT1013",
  // VCT12xx is the comptime type-reification family owned by Schema.derive.
  SchemaOutsideComptime: "VCT1200",
  SchemaCallShape: "VCT1201",
  SchemaUnrelatedIdentity: "VCT1202",
  SchemaImportShape: "VCT1203",
  SchemaUnsupportedType: "VCT1204",
  SchemaReservedIdentifier: "VCT1205",
  SchemaInternalIdentity: "VCT1206",
  SchemaBudget: "VCT1207",
} as const);

export interface ComptimeIntrinsicDiagnostic {
  readonly code: typeof ComptimeIntrinsicDiagnosticCode[keyof typeof ComptimeIntrinsicDiagnosticCode];
  readonly severity: "error";
  readonly message: string;
  readonly file: string;
  /** One-based line. */
  readonly line: number;
  /** One-based column. */
  readonly column: number;
  readonly length: number;
}

export interface ComptimeIntrinsicCall {
  readonly file: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
  readonly value: StableJson;
  readonly build: ComptimeBuild;
}

/** Authored UTF-16 range. Offsets are zero-based; lines and columns are one-based. */
export interface ComptimeSourceRange {
  readonly file: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
}

/** Lowered UTF-16 range. Offsets are zero-based; lines and columns are one-based. */
export interface ComptimeGeneratedRange {
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export interface ComptimeLoweringEdit {
  readonly kind: "remove-import" | "function-marker" | "intrinsic-call" | "schema-runtime-import" | "type-alias";
  readonly generated: ComptimeGeneratedRange;
  readonly authored: ComptimeSourceRange;
  /** Semantic source used for generated replacement mappings. */
  readonly mappedOrigin: ComptimeSourceRange;
  /** The call argument and every project-local const initializer it read. */
  readonly origins: readonly ComptimeSourceRange[];
  readonly replacementDigest: string;
}

export interface ComptimeLoweringProvenance {
  readonly schema: "vibelang.comptime-lowering/v1";
  readonly frontend: "vibelang-comptime-static@2";
  readonly file: string;
  readonly authoredDigest: string;
  readonly loweredDigest: string;
  readonly edits: readonly ComptimeLoweringEdit[];
}

export interface ComptimeLoweredFile {
  readonly fileName: string;
  readonly code: string;
  /** Canonical JSON encoding of a version-3 source map. */
  readonly sourceMap: string;
  readonly provenance: ComptimeLoweringProvenance;
  /** Stable across cold/warm cache runs; suitable for downstream cache keys. */
  readonly identity: string;
}

export interface ComptimeIntrinsicResult {
  readonly ok: boolean;
  readonly calls: readonly ComptimeIntrinsicCall[];
  readonly diagnostics: readonly ComptimeIntrinsicDiagnostic[];
  /** Present only when every compiler-owned use was safely lowered. */
  readonly loweredSources?: Readonly<Record<string, string>>;
  /** Composition-ready lowered code, source map, and audit provenance. */
  readonly loweredFiles?: Readonly<Record<string, ComptimeLoweredFile>>;
}

export interface CompileComptimeIntrinsicsOptions {
  readonly compiler: ComptimeCompiler;
  /** Project-relative TypeScript, JavaScript, or `.vibe` source names. */
  readonly sources: Readonly<Record<string, string>>;
  /**
   * Module specifier the lowered code uses to reach the derived-schema runtime
   * engine. Only files that actually derive a schema gain the import edge.
   */
  readonly schemaRuntimeImport?: string;
}

/**
 * One staged module.
 *
 * `source` is the AUTHORED text: it is what the lowered file is cut from, what
 * every provenance range and source-map coordinate names, and what the
 * authored digest covers. `file` is parsed from `recovery.parseSource`, the
 * frontend's pre-parse recovery of the same module, because authored VibeLang
 * diverges from the TypeScript grammar in general expression positions and
 * stock TypeScript cannot parse it. Recovery is not length-preserving, so
 * every node offset is a DERIVED offset: map it with `toAuthoredStart` /
 * `toAuthoredEnd` before it reaches a diagnostic, a provenance range, or the
 * lowered text. A module with no divergent syntax recovers to itself, and then
 * derived and authored offsets are the same number.
 */
interface ProjectEntry {
  readonly publicName: string;
  readonly internalName: string;
  readonly source: string;
  readonly parseSource: string;
  readonly recovery: RecoveredSource;
  readonly authoredLineStarts: readonly number[];
  readonly file: ts.SourceFile;
  readonly syntacticDiagnostics: readonly ts.Diagnostic[];
}

/** Derived offset to the authored offset it was cut from. */
function toAuthoredStart(entry: ProjectEntry, offset: number): number {
  if (!entry.recovery.changed) return offset;
  return entry.recovery.toAuthored(offset) ?? entry.recovery.toAuthoredAnchor(offset);
}

/** Exclusive span ends stay exact when the final contained unit is exact. */
function toAuthoredEnd(entry: ProjectEntry, end: number): number {
  if (!entry.recovery.changed) return end;
  if (end <= 0) return 0;
  const last = entry.recovery.toAuthored(end - 1);
  return last !== undefined ? last + 1 : entry.recovery.toAuthoredAnchor(end);
}

/**
 * Two TypeScript parse errors are the deliberate shapes the checked frontend
 * reads authored VibeLang through, not evidence of unparseable source.
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
 * The comptime frontend does not report either; a module the language frontend
 * genuinely cannot parse is still rejected there at authored coordinates.
 */
const RECOVERY_HOST_KEYWORD = /^(?:if|switch|for|while)\b/;
const CLEANUP_MARKER_KEYWORD = /^(?:defer|errdefer)\b/;

function isRecoveryNoise(entry: ProjectEntry, diagnostic: ts.Diagnostic): boolean {
  const start = diagnostic.start ?? 0;
  if (diagnostic.code === 1109) return RECOVERY_HOST_KEYWORD.test(entry.parseSource.slice(start, start + 8));
  if (diagnostic.code === 1434) return CLEANUP_MARKER_KEYWORD.test(entry.parseSource.slice(start, start + 10));
  return false;
}

interface CheckedProject {
  readonly checker: ts.TypeChecker;
  readonly entries: readonly ProjectEntry[];
  readonly intrinsicSymbol?: ts.Symbol;
  readonly embedSymbol?: ts.Symbol;
  readonly schemaSymbol?: ts.Symbol;
  readonly deriveSymbol?: ts.Symbol;
}

/** Compiler-derived reification attached to one `Schema.derive<T>()` call. */
interface PendingSchema {
  readonly descriptor: SchemaDescriptor;
  /** Authored text of the type argument, so the success type stays exactly `T`. */
  readonly typeText: string;
}

interface PendingCall {
  readonly entry: ProjectEntry;
  readonly call: ts.CallExpression;
  readonly argument: ts.Expression;
  readonly value: StableJson;
  readonly mappedOrigin: ts.Expression;
  readonly origins: readonly ts.Expression[];
  readonly dependencies: readonly AssetDependency[];
  readonly schema?: PendingSchema;
}

type StaticFunctionNode = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;

interface StaticFunctionBinding {
  readonly node: StaticFunctionNode;
  readonly marker: ts.CallExpression;
  readonly erased: boolean;
  readonly declaration?: ts.VariableDeclaration;
}

interface Replacement {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly kind: ComptimeLoweringEdit["kind"];
  readonly authoredEntry: ProjectEntry;
  readonly mappedOrigin: ts.Node;
  readonly origins: readonly ts.Node[];
}

interface SourceMapping {
  readonly generatedLine: number;
  readonly generatedColumn: number;
  readonly source: number;
  readonly originalLine: number;
  readonly originalColumn: number;
}

const VIRTUAL_ROOT = resolve("/vibelang-comptime-project");
const PRELUDE_NAME = resolve(VIRTUAL_ROOT, "__vibelang_comptime__.d.ts");
const SCHEMA_PRELUDE_NAME = resolve(VIRTUAL_ROOT, "__vibelang_schema__.d.ts");
const PRELUDE = [
  "export declare function comptime<T>(value: T): T;",
  "export declare namespace comptime { const target: string; }",
  "export declare function embed(specifier: string): string;",
  "",
].join("\n");
/**
 * The compiler-owned declaration for `"vibelang:comptime"`. `loader-registration.ts`
 * merges the provisional `comptime.loader` registration surface into this same
 * text so there is one description of the module.
 */
export { PRELUDE as COMPTIME_PRELUDE };
const MAX_SOURCE_MAP_UNITS = 1_000_000;
const MAX_SOURCE_MAP_BYTES = 16 * 1024 * 1024;
/** Total interpreter operations for one comptime call and everything it calls. */
const MAX_EVALUATION_STEPS = 1_000_000;
/** Containers plus elements/properties materialized by one comptime call tree. */
const MAX_ALLOCATION_NODES = 100_000;
const MAX_CALL_DEPTH = 64;
const MAX_COMPTIME_STRING_LENGTH = 1_000_000;
const MAX_TYPE_ALIAS_TEXT = 100_000;
/** A declared-but-unassigned `let` local. Reading it is a deterministic error. */
const UNINITIALIZED: unique symbol = Symbol("vibelang.comptime.uninitialized");
const SOURCE_MAP_BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Resolve and lower the compiler-owned comptime intrinsic without importing or
 * executing any author module. This POC accepts canonical JSON-like syntax and
 * references to project-local `const` declarations initialized with that same
 * syntax.
 */
export async function compileComptimeIntrinsics(
  options: CompileComptimeIntrinsicsOptions,
): Promise<ComptimeIntrinsicResult> {
  const project = checkedProject(options.sources);
  const diagnostics: ComptimeIntrinsicDiagnostic[] = [];
  const pending: PendingCall[] = [];
  const importReplacements = new Map<ProjectEntry, Replacement[]>();
  const markerReplacements = new Map<ProjectEntry, Replacement[]>();
  const allowedCompilerNodes = new Set<ts.Node>();
  const namespaceImportSymbols = new Set<ts.Symbol>();
  const candidateNames = new Map<ProjectEntry, Set<string>>();
  const projectFiles = new Set(project.entries.map((item) => item.file));
  const entryByFile = new Map(project.entries.map((item) => [item.file, item] as const));
  const markedFunctions = new Map<ts.Symbol, StaticFunctionBinding>();
  const markerCalls = new Map<ts.CallExpression, StaticFunctionBinding>();
  const erasedInlineFunctions: StaticFunctionNode[] = [];
  let erasedInlineFunctionSet: ReadonlySet<ts.Node> = new Set();
  const invalidFunctionMarkers = new Set<ts.CallExpression>();
  const schemaDerivations = new Map<ts.CallExpression, PendingSchema>();
  const schemaEntries = new Set<ProjectEntry>();
  const typeProductions = new Map<PendingCall, TypeProductionPlan>();
  const schemaRuntimeImport = options.schemaRuntimeImport ?? DEFAULT_SCHEMA_RUNTIME_IMPORT;

  for (const entry of project.entries) {
    candidateNames.set(entry, new Set(["comptime"]));
    importReplacements.set(entry, []);
    markerReplacements.set(entry, []);
    if (entry.recovery.diagnostics.length > 0) {
      // Recovery refused a recognizably VibeLang construct: name the construct
      // instead of reporting the parser's cascade behind it. The offsets these
      // carry are already authored, so they bypass the derived-offset mapping.
      for (const refused of entry.recovery.diagnostics) {
        const authored = Math.min(Math.max(0, refused.start), entry.source.length);
        const location = locateOffset(entry.authoredLineStarts, authored);
        diagnostics.push(Object.freeze({
          code: ComptimeIntrinsicDiagnosticCode.Syntax,
          severity: "error",
          message: `${refused.code}: ${refused.message}`,
          file: entry.publicName,
          line: location.line + 1,
          column: location.column + 1,
          length: 1,
        }));
      }
    } else {
      for (const parseDiagnostic of entry.syntacticDiagnostics) {
        if (isRecoveryNoise(entry, parseDiagnostic)) continue;
        diagnostics.push(makeDiagnostic(
          entry,
          parseDiagnostic.start ?? 0,
          Math.max(1, parseDiagnostic.length ?? 1),
          ComptimeIntrinsicDiagnosticCode.Syntax,
          "source contains syntax that the comptime frontend cannot parse",
        ));
      }
    }
    collectImports(
      entry,
      project.checker,
      candidateNames.get(entry)!,
      namespaceImportSymbols,
      importReplacements.get(entry)!,
      diagnostics,
    );
  }

  if (!project.schemaSymbol || !project.deriveSymbol) {
    const first = project.entries[0];
    if (first) {
      diagnostics.push(makeDiagnostic(
        first,
        0,
        1,
        ComptimeIntrinsicDiagnosticCode.SchemaInternalIdentity,
        "compiler-owned schema module identities could not be established",
      ));
    }
  }

  if (!project.intrinsicSymbol || !project.embedSymbol || !project.schemaSymbol || !project.deriveSymbol) {
    const first = project.entries[0];
    if (first && (!project.intrinsicSymbol || !project.embedSymbol)) {
      diagnostics.push(makeDiagnostic(
        first,
        0,
        1,
        ComptimeIntrinsicDiagnosticCode.InternalIdentity,
        "compiler-owned comptime module identities could not be established",
      ));
    }
  } else {
    // Pass one records compile-time function values before evaluating any use.
    // This makes calls independent of source/module traversal order while still
    // requiring one checker-resolved compiler marker.
    for (const entry of project.entries) {
      visit(entry.file, (node) => {
        if (!ts.isCallExpression(node)) return;
        if (resolvedCallSymbol(node, project.checker) !== project.intrinsicSymbol) return;
        markTree(node.expression, allowedCompilerNodes);
        if (node.questionDotToken || node.arguments.length !== 1) return;
        const fn = resolveStaticFunction(node.arguments[0]!, project.checker, projectFiles);
        if (!fn) return;
        const directArgument = unwrapExpression(node.arguments[0]!);
        const erasedInline = ts.isArrowFunction(directArgument) || ts.isFunctionExpression(directArgument);
        if (!erasedInline && functionContainsCompilerUse(
          fn,
          project.checker,
          project.intrinsicSymbol!,
          project.embedSymbol!,
        )) {
          invalidFunctionMarkers.add(node);
          diagnostics.push(diagnosticForNode(
            entry,
            node.arguments[0]!,
            ComptimeIntrinsicDiagnosticCode.InvalidFunction,
            "a retained runtime function cannot contain comptime.target or embed; place phase-specific work in an inline compile-time function",
          ));
          return;
        }

        const binding: StaticFunctionBinding = { node: fn, marker: node, erased: erasedInline };
        if (ts.isCallExpression(node.parent) && node.parent.expression === node) {
          if (erasedInline) erasedInlineFunctions.push(fn);
          markerCalls.set(node.parent, binding);
          return;
        }
        const declaration = node.parent;
        if (ts.isVariableDeclaration(declaration) && declaration.initializer === node &&
          ts.isIdentifier(declaration.name) && ts.isVariableDeclarationList(declaration.parent) &&
          (declaration.parent.flags & ts.NodeFlags.Const) !== 0 && declaration.parent.declarations.length === 1 &&
          ts.isVariableStatement(declaration.parent.parent) &&
          (ts.getModifiers(declaration.parent.parent)?.length ?? 0) === 0) {
          const symbol = resolveSymbol(project.checker, project.checker.getSymbolAtLocation(declaration.name));
          if (symbol) {
            if (erasedInline) erasedInlineFunctions.push(fn);
            const withDeclaration: StaticFunctionBinding = { ...binding, declaration };
            markedFunctions.set(symbol, withDeclaration);
            markerReplacements.get(entry)!.push({
              start: declaration.parent.parent.getStart(entry.file),
              end: declaration.parent.parent.getEnd(),
              text: "",
              kind: "function-marker",
              authoredEntry: entry,
              mappedOrigin: node.arguments[0]!,
              origins: [node, node.arguments[0]!],
            });
            markTree(declaration.name, allowedCompilerNodes);
            return;
          }
        }
        diagnostics.push(diagnosticForNode(
          entry,
          node,
          ComptimeIntrinsicDiagnosticCode.InvalidFunction,
          "a compile-time function marker must be called immediately or initialize one private single-declaration const",
        ));
        invalidFunctionMarkers.add(node);
      });
    }

    erasedInlineFunctionSet = new Set<ts.Node>(erasedInlineFunctions);
    // Erased inline functions are marked only after pass one has recorded every
    // compile-time function, so a reference to a marker declared later in the
    // project (including inside an unselected target branch) is still allowed.
    for (const fn of erasedInlineFunctions) {
      markErasedFunctionCompilerUses(
        fn,
        project.checker,
        project.intrinsicSymbol!,
        project.embedSymbol!,
        markedFunctions,
        allowedCompilerNodes,
      );
    }

    // Reification is resolved before any comptime call is evaluated so that a
    // derive call in an illegal position is reported from its own source range
    // rather than as a generic unsupported comptime expression.
    for (const entry of project.entries) {
      visit(entry.file, (node) => {
        if (!ts.isCallExpression(node)) return;
        if (resolvedCallSymbol(node, project.checker) !== project.deriveSymbol) return;
        markTree(node.expression, allowedCompilerNodes);
        if (!comptimeRootFor(node, project.checker, project.intrinsicSymbol!)) {
          diagnostics.push(diagnosticForNode(
            entry,
            node,
            ComptimeIntrinsicDiagnosticCode.SchemaOutsideComptime,
            "Schema.derive is compiler-only; call it as the whole argument of an explicit comptime(...)",
          ));
          return;
        }
        if (node.questionDotToken || node.arguments.length !== 0 || node.typeArguments?.length !== 1) {
          diagnostics.push(diagnosticForNode(
            entry,
            node,
            ComptimeIntrinsicDiagnosticCode.SchemaCallShape,
            "Schema.derive takes exactly one type argument, no value arguments, and no optional chaining",
          ));
          return;
        }
        const typeNode = node.typeArguments[0]!;
        try {
          schemaDerivations.set(node, Object.freeze({
            descriptor: deriveSchemaDescriptor(project.checker, typeNode, node),
            typeText: typeNode.getText(entry.file),
          }));
          schemaEntries.add(entry);
        } catch (error) {
          if (!(error instanceof SchemaDerivationError)) throw error;
          diagnostics.push(diagnosticForNode(
            entry,
            typeNode,
            error.failure === "budget"
              ? ComptimeIntrinsicDiagnosticCode.SchemaBudget
              : ComptimeIntrinsicDiagnosticCode.SchemaUnsupportedType,
            `Schema.derive cannot reify this type: ${error.message}`,
          ));
        }
      });
    }

    for (const entry of schemaEntries) {
      visit(entry.file, (node) => {
        if (ts.isIdentifier(node) && node.text === SCHEMA_RUNTIME_BINDING) {
          diagnostics.push(diagnosticForNode(
            entry,
            node,
            ComptimeIntrinsicDiagnosticCode.SchemaReservedIdentifier,
            `${SCHEMA_RUNTIME_BINDING} is reserved for the generated derived-schema runtime binding`,
          ));
        }
      });
    }

    for (const entry of project.entries) {
      visit(entry.file, (node) => {
        if (!ts.isCallExpression(node)) return;
        const symbol = resolvedCallSymbol(node, project.checker);
        if (symbol === project.intrinsicSymbol) {
          markTree(node.expression, allowedCompilerNodes);
          if (node.questionDotToken || node.arguments.length !== 1) {
            diagnostics.push(diagnosticForNode(
              entry,
              node,
              ComptimeIntrinsicDiagnosticCode.Arity,
              "comptime must be called directly with exactly one argument",
            ));
            return;
          }
          const directArgument = unwrapExpression(node.arguments[0]!);
          if (ts.isCallExpression(directArgument) &&
            resolvedCallSymbol(directArgument, project.checker) === project.deriveSymbol) {
            const derived = schemaDerivations.get(directArgument);
            // A missing entry means the derivation already failed closed.
            if (derived) {
              pending.push({
                entry,
                call: node,
                argument: node.arguments[0]!,
                value: freezeStable(stableClone(derived.descriptor, "derived schema descriptor")),
                mappedOrigin: directArgument,
                origins: [directArgument],
                dependencies: Object.freeze([]),
                schema: derived,
              });
            }
            return;
          }
          if (looksLikeSchemaDerive(directArgument)) {
            const deriveTarget = resolvedCallSymbol(directArgument, project.checker);
            diagnostics.push(diagnosticForNode(
              entry,
              directArgument.expression,
              ComptimeIntrinsicDiagnosticCode.SchemaUnrelatedIdentity,
              deriveTarget
                ? `derive call does not resolve to the compiler intrinsic imported from ${JSON.stringify(SCHEMA_MODULE_SPECIFIER)}`
                : `derive call has no imported compiler identity from ${JSON.stringify(SCHEMA_MODULE_SPECIFIER)}`,
            ));
            return;
          }
          const fn = resolveStaticFunction(node.arguments[0]!, project.checker, projectFiles);
          if (fn) {
            if (invalidFunctionMarkers.has(node)) return;
            const immediateBinding = ts.isCallExpression(node.parent) ? markerCalls.get(node.parent) : undefined;
            const declaration = ts.isVariableDeclaration(node.parent) && node.parent.initializer === node
              ? node.parent
              : undefined;
            if (immediateBinding) {
              try {
                const invocation = node.parent as ts.CallExpression;
                const staticEvaluator = new StaticExpressionEvaluator(
                  project.checker,
                  projectFiles,
                  options.compiler,
                  project.intrinsicSymbol!,
                  project.embedSymbol!,
                  markedFunctions,
                  entryByFile,
                  allowedCompilerNodes,
                );
                const evaluated = staticEvaluator.invokeWithOrigins(
                  immediateBinding.node,
                  invocation.arguments,
                  invocation,
                  immediateBinding.erased,
                );
                pending.push(pendingCall(entry, invocation, invocation, evaluated));
              } catch (error) {
                recordStaticEvaluationFailure(diagnostics, entry, node, error);
              }
            } else if (!declaration || !ts.isIdentifier(declaration.name) ||
              !markedFunctions.has(resolveSymbol(project.checker, project.checker.getSymbolAtLocation(declaration.name))!)) {
              diagnostics.push(diagnosticForNode(
                entry,
                node,
                ComptimeIntrinsicDiagnosticCode.InvalidFunction,
                "compile-time function values cannot escape; call them directly or through their private const marker",
              ));
            }
            return;
          }
          try {
            const staticEvaluator = new StaticExpressionEvaluator(
              project.checker,
              projectFiles,
              options.compiler,
              project.intrinsicSymbol!,
              project.embedSymbol!,
              markedFunctions,
              entryByFile,
              allowedCompilerNodes,
            );
            const evaluated = staticEvaluator.evaluateWithOrigins(node.arguments[0]!);
            pending.push(pendingCall(entry, node, node.arguments[0]!, evaluated));
          } catch (error) {
            recordStaticEvaluationFailure(diagnostics, entry, node.arguments[0]!, error);
          }
          return;
        }

        const marked = symbol && markedFunctions.get(symbol);
        if (marked) {
          // A marked call nested inside an erased compile-time function or an
          // already-replaced comptime region is evaluated as part of invoking
          // its container, never as an independent lowering site.
          if (isWithinReplacedComptimeRegion(
            node,
            project.checker,
            project.intrinsicSymbol!,
            markedFunctions,
            markerCalls,
            erasedInlineFunctionSet,
          )) return;
          markTree(node.expression, allowedCompilerNodes);
          if (node.questionDotToken) {
            diagnostics.push(diagnosticForNode(
              entry,
              node,
              ComptimeIntrinsicDiagnosticCode.InvalidFunction,
              "compile-time function calls cannot use optional chaining",
            ));
            return;
          }
          try {
            const staticEvaluator = new StaticExpressionEvaluator(
              project.checker,
              projectFiles,
              options.compiler,
              project.intrinsicSymbol!,
              project.embedSymbol!,
              markedFunctions,
              entryByFile,
              allowedCompilerNodes,
            );
            const evaluated = staticEvaluator.invokeWithOrigins(marked.node, node.arguments, node, marked.erased);
            pending.push(pendingCall(entry, node, node, evaluated));
          } catch (error) {
            recordStaticEvaluationFailure(diagnostics, entry, node, error);
          }
          return;
        }

        if (looksLikeComptimeCall(node.expression, candidateNames.get(entry)!)) {
          const code = symbol
            ? ComptimeIntrinsicDiagnosticCode.UnrelatedIdentity
            : ComptimeIntrinsicDiagnosticCode.MissingIdentity;
          const message = symbol
            ? `call does not resolve to the compiler intrinsic imported from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)}`
            : `comptime call has no imported compiler identity from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)}`;
          diagnostics.push(diagnosticForNode(entry, node.expression, code, message));
        }
      });
    }

    for (const entry of project.entries) {
      visitSkippingImports(entry.file, (node) => {
        if (!ts.isIdentifier(node) || allowedCompilerNodes.has(node)) return;
        const raw = project.checker.getSymbolAtLocation(node);
        const resolved = resolveSymbol(project.checker, raw);
        if (resolved === project.schemaSymbol || resolved === project.deriveSymbol) {
          diagnostics.push(diagnosticForNode(
            entry,
            node,
            ComptimeIntrinsicDiagnosticCode.SchemaOutsideComptime,
            "compiler-owned schema values may only be used as Schema.derive<T>() inside an explicit comptime(...)",
          ));
          return;
        }
        if (resolved === project.intrinsicSymbol || resolved === project.embedSymbol ||
          markedFunctions.has(resolved!) || (raw !== undefined && namespaceImportSymbols.has(raw))) {
          diagnostics.push(diagnosticForNode(
            entry,
            node,
            ComptimeIntrinsicDiagnosticCode.UnsupportedUse,
            "compiler-owned comptime values may only be used within a checked compile-time evaluation",
          ));
        }
      });
    }

    analyzeTypeProductions(project, pending, typeProductions, diagnostics);
  }

  sortDiagnostics(diagnostics);
  if (diagnostics.length > 0) return failedResult(diagnostics);

  pending.sort((left, right) =>
    compareStableStrings(left.entry.publicName, right.entry.publicName) || left.call.getStart() - right.call.getStart());

  const replacements = new Map<ProjectEntry, Replacement[]>();
  for (const entry of project.entries) replacements.set(entry, [
    ...importReplacements.get(entry)!,
    ...markerReplacements.get(entry)!,
  ]);
  for (const item of pending) {
    const production = typeProductions.get(item);
    if (production?.eraseValue) {
      // Every use of the binding is a type, so the runtime const is erased and
      // the whole statement lowers to the value-derived literal type alias.
      replacements.get(item.entry)!.push({
        start: production.statement.getStart(item.entry.file),
        end: production.statement.getEnd(),
        text: production.aliasText,
        kind: "type-alias",
        authoredEntry: item.entry,
        mappedOrigin: item.mappedOrigin,
        origins: [item.argument, ...item.origins],
      });
      continue;
    }
    replacements.get(item.entry)!.push({
      start: item.call.getStart(item.entry.file),
      end: item.call.getEnd(),
      text: item.schema
        ? emitSchemaCall(item.schema.typeText, item.schema.descriptor)
        : emitStaticReplacement(item.value, item.entry.publicName),
      kind: "intrinsic-call",
      authoredEntry: item.entry,
      mappedOrigin: item.mappedOrigin,
      origins: [item.argument, ...item.origins],
    });
    if (production) {
      // Mixed value and type usage: TypeScript declaration merging makes the
      // same-named const plus type alias pair legal, so both are emitted.
      replacements.get(item.entry)!.push({
        start: production.statement.getEnd(),
        end: production.statement.getEnd(),
        text: `\n${production.aliasText}`,
        kind: "type-alias",
        authoredEntry: item.entry,
        mappedOrigin: item.mappedOrigin,
        origins: [item.argument, ...item.origins],
      });
    }
  }
  // Exactly one generated module edge per file that derives a schema. It is a
  // zero-width prepend so every authored offset keeps its own mapping and the
  // edge survives however the author spelled (or re-exported) the import.
  for (const entry of project.entries) {
    const first = pending.find((item) => item.entry === entry && item.schema !== undefined);
    if (!first) continue;
    replacements.get(entry)!.push({
      start: 0,
      end: 0,
      text: emitSchemaRuntimeImport(schemaRuntimeImport),
      kind: "schema-runtime-import",
      authoredEntry: entry,
      mappedOrigin: first.mappedOrigin,
      origins: [first.mappedOrigin],
    });
  }

  // Maps are part of the frontend's all-or-nothing contract. Validate and
  // prepare every one before touching the content-addressed cache.
  let loweredFiles: Readonly<Record<string, ComptimeLoweredFile>>;
  try {
    loweredFiles = lowerProject(project.entries, replacements);
  } catch (error) {
    const failure = error instanceof SourceMapGenerationError ? error : undefined;
    const entry = failure?.entry ?? project.entries[0];
    if (!entry) throw error;
    diagnostics.push(makeDiagnostic(
      entry,
      failure?.start ?? 0,
      1,
      ComptimeIntrinsicDiagnosticCode.SourceMapFailure,
      failure?.message ?? "comptime lowering could not produce a correct source map",
    ));
    return failedResult(diagnostics);
  }

  const settled = await Promise.allSettled(pending.map(async (item) => ({
    item,
    build: await options.compiler.evaluateStatic(item.value, {
      identity: {
        file: item.entry.publicName,
        sourceDigest: digest(item.entry.source),
        start: item.call.getStart(item.entry.file),
        end: item.call.getEnd(),
        argumentDigest: digest(item.argument.getText(item.entry.file)),
        // Reification is a distinct intrinsic: its descriptor bytes are the
        // cached value, and the authored type text is part of its identity.
        ...(item.schema ? { intrinsic: "vibelang:schema/derive@1", typeText: item.schema.typeText } : {}),
      },
      dependencies: item.dependencies,
    }),
  })));

  const completed: Array<{ readonly item: PendingCall; readonly build: ComptimeBuild }> = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      completed.push(result.value);
      return;
    }
    const item = pending[index]!;
    diagnostics.push(diagnosticForNode(
      item.entry,
      item.call,
      ComptimeIntrinsicDiagnosticCode.BuildFailure,
      "static comptime cache operation failed",
    ));
  });
  sortDiagnostics(diagnostics);
  if (diagnostics.length > 0) return failedResult(diagnostics);

  const calls = completed.map(({ item, build }) => {
    const location = item.entry.file.getLineAndCharacterOfPosition(item.call.getStart(item.entry.file));
    return Object.freeze({
      file: item.entry.publicName,
      start: item.call.getStart(item.entry.file),
      end: item.call.getEnd(),
      line: location.line + 1,
      column: location.character + 1,
      value: build.value,
      build,
    });
  });
  const lowered: Record<string, string> = Object.create(null);
  for (const entry of project.entries) lowered[entry.publicName] = loweredFiles[entry.publicName]!.code;
  return Object.freeze({
    ok: true,
    calls: Object.freeze(calls),
    diagnostics: Object.freeze([]),
    loweredSources: Object.freeze(lowered),
    loweredFiles,
  });
}

interface StaticEvaluationResult {
  readonly value: StableJson;
  readonly mappedOrigin: ts.Expression;
  readonly origins: readonly ts.Expression[];
  readonly dependencies: readonly AssetDependency[];
}

function pendingCall(
  entry: ProjectEntry,
  call: ts.CallExpression,
  argument: ts.Expression,
  evaluated: StaticEvaluationResult,
): PendingCall {
  return {
    entry,
    call,
    argument,
    value: freezeStable(stableClone(evaluated.value, "comptime syntax result")),
    mappedOrigin: evaluated.mappedOrigin,
    origins: evaluated.origins,
    dependencies: evaluated.dependencies,
  };
}

/** How one `const Name = comptime(...)` binding lowers when used as a type. */
interface TypeProductionPlan {
  readonly statement: ts.VariableStatement;
  /** True when every project use is a type, so no runtime const is emitted. */
  readonly eraseValue: boolean;
  /** Complete `type Name = ...;` statement, `export`-prefixed when needed. */
  readonly aliasText: string;
}

class TypeAliasEmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TypeAliasEmissionError";
  }
}

/**
 * Detect comptime bindings used in type position and plan the same-named
 * `type` alias whose shape is the value's deep-readonly literal type — the
 * exact type `as const` emission already gives the value. When the binding is
 * used only as a type and never escapes the declaring module, the runtime
 * const is erased entirely.
 */
function analyzeTypeProductions(
  project: CheckedProject,
  pending: readonly PendingCall[],
  plans: Map<PendingCall, TypeProductionPlan>,
  diagnostics: ComptimeIntrinsicDiagnostic[],
): void {
  interface Candidate {
    readonly item: PendingCall;
    readonly statement: ts.VariableStatement;
    readonly nameNode: ts.Identifier;
    readonly name: string;
    exported: boolean;
    typeUses: number;
    valueUses: number;
  }
  const candidates: Candidate[] = [];
  const bySymbol = new Map<ts.Symbol, Candidate>();
  for (const item of pending) {
    const declaration = typeProducingDeclaration(item.call);
    if (!declaration) continue;
    const statement = declaration.parent.parent as ts.VariableStatement;
    const modifiers = ts.getModifiers(statement) ?? [];
    if (modifiers.some((modifier) => modifier.kind !== ts.SyntaxKind.ExportKeyword)) continue;
    const nameNode = declaration.name as ts.Identifier;
    const symbol = resolveSymbol(project.checker, project.checker.getSymbolAtLocation(nameNode));
    if (!symbol || bySymbol.has(symbol)) continue;
    const candidate: Candidate = {
      item,
      statement,
      nameNode,
      name: nameNode.text,
      exported: modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
      typeUses: 0,
      valueUses: 0,
    };
    candidates.push(candidate);
    bySymbol.set(symbol, candidate);
  }
  if (candidates.length === 0) return;

  // Names each file can legally spell for a candidate. The checker resolves a
  // type reference to a value-only binding as a declaration-less transient
  // error symbol, so type uses are attributed through this visible-name map.
  const scopeByFile = new Map<ts.SourceFile, Map<string, Candidate>>();
  for (const entry of project.entries) scopeByFile.set(entry.file, new Map());
  for (const candidate of candidates) {
    scopeByFile.get(candidate.statement.getSourceFile())?.set(candidate.name, candidate);
  }
  for (const entry of project.entries) {
    for (const statement of entry.file.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const element of bindings.elements) {
        const resolved = resolveSymbol(project.checker, project.checker.getSymbolAtLocation(element.name));
        const candidate = resolved && bySymbol.get(resolved);
        if (candidate) {
          scopeByFile.get(entry.file)!.set(element.name.text, candidate);
          candidate.exported = true;
        }
      }
    }
  }

  for (const entry of project.entries) {
    visit(entry.file, (node) => {
      if (!ts.isIdentifier(node)) return;
      const parent = node.parent;
      if (ts.isVariableDeclaration(parent) && parent.name === node) return;
      if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return;
      if (ts.isExportSpecifier(parent)) {
        const resolved = resolveSymbol(project.checker, project.checker.getSymbolAtLocation(node));
        const candidate = resolved && bySymbol.get(resolved);
        if (candidate) candidate.exported = true;
        return;
      }
      const raw = ts.isShorthandPropertyAssignment(parent) && parent.name === node
        ? project.checker.getShorthandAssignmentValueSymbol(parent) ?? project.checker.getSymbolAtLocation(node)
        : project.checker.getSymbolAtLocation(node);
      const resolved = resolveSymbol(project.checker, raw);
      const direct = resolved ? bySymbol.get(resolved) : undefined;
      if (direct) {
        if (isTypeUsage(node)) direct.typeUses += 1;
        else direct.valueUses += 1;
        return;
      }
      if (isTypeUsage(node) && (raw === undefined || (raw.declarations ?? []).length === 0)) {
        const scoped = scopeByFile.get(entry.file)?.get(node.text);
        if (scoped) scoped.typeUses += 1;
      }
    });
  }

  for (const candidate of candidates) {
    if (candidate.typeUses === 0) continue;
    const entry = candidate.item.entry;
    if (candidate.item.schema) {
      diagnostics.push(diagnosticForNode(
        entry,
        candidate.nameNode,
        ComptimeIntrinsicDiagnosticCode.TypeProduction,
        "a schema-derived comptime binding does not lower to a literal type alias; use its parse result types instead",
      ));
      continue;
    }
    if ([".js", ".jsx", ".mjs", ".cjs"].includes(extname(entry.publicName).toLowerCase())) {
      diagnostics.push(diagnosticForNode(
        entry,
        candidate.nameNode,
        ComptimeIntrinsicDiagnosticCode.TypeProduction,
        "a JavaScript module cannot receive a generated comptime type alias",
      ));
      continue;
    }
    let aliasType: string;
    try {
      aliasType = emitLiteralType(candidate.item.value);
    } catch (error) {
      if (!(error instanceof TypeAliasEmissionError)) throw error;
      diagnostics.push(diagnosticForNode(
        entry,
        candidate.nameNode,
        ComptimeIntrinsicDiagnosticCode.TypeProduction,
        `comptime value cannot become a type alias: ${error.message}`,
      ));
      continue;
    }
    plans.set(candidate.item, Object.freeze({
      statement: candidate.statement,
      eraseValue: candidate.valueUses === 0 && !candidate.exported,
      aliasText: `${candidate.exported ? "export " : ""}type ${candidate.name} = ${aliasType};`,
    }));
  }
}

/**
 * True when the node sits inside source that comptime lowering already
 * replaces wholesale: an erased inline compile-time function, a `comptime(...)`
 * argument, an immediate marker invocation, or another marked call.
 */
function isWithinReplacedComptimeRegion(
  node: ts.Node,
  checker: ts.TypeChecker,
  intrinsicSymbol: ts.Symbol,
  markedFunctions: ReadonlyMap<ts.Symbol, StaticFunctionBinding>,
  markerCalls: ReadonlyMap<ts.CallExpression, StaticFunctionBinding>,
  erasedInlineFunctions: ReadonlySet<ts.Node>,
): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (erasedInlineFunctions.has(current)) return true;
    if (ts.isCallExpression(current)) {
      if (markerCalls.has(current)) return true;
      const symbol = resolvedCallSymbol(current, checker);
      if (symbol === intrinsicSymbol) return true;
      if (symbol && markedFunctions.has(symbol)) return true;
    }
  }
  return false;
}

/** The exact `const Name = comptime(...)` statement shape that can produce a type. */
function typeProducingDeclaration(call: ts.CallExpression): ts.VariableDeclaration | undefined {
  let current: ts.Node = call;
  while (current.parent &&
    (ts.isParenthesizedExpression(current.parent) || ts.isAsExpression(current.parent) ||
      ts.isSatisfiesExpression(current.parent) || ts.isNonNullExpression(current.parent) ||
      ts.isTypeAssertionExpression(current.parent))) current = current.parent;
  const declaration = current.parent;
  if (!declaration || !ts.isVariableDeclaration(declaration) || declaration.initializer !== current) return undefined;
  if (!ts.isIdentifier(declaration.name)) return undefined;
  const list = declaration.parent;
  if (!ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Const) === 0 ||
    list.declarations.length !== 1) return undefined;
  const statement = list.parent;
  if (!ts.isVariableStatement(statement) || !ts.isSourceFile(statement.parent)) return undefined;
  return declaration;
}

/** True when the identifier is read as a type, treating `typeof X` as a value use. */
function isTypeUsage(node: ts.Identifier): boolean {
  let current: ts.Node = node;
  while (current.parent) {
    const parent = current.parent;
    if (ts.isTypeQueryNode(parent)) return false;
    if (ts.isTypeNode(parent)) return true;
    if (ts.isQualifiedName(parent) && parent.left === current) {
      current = parent;
      continue;
    }
    return false;
  }
  return false;
}

function emitLiteralType(value: StableJson): string {
  const text = literalTypeText(value);
  if (text.length > MAX_TYPE_ALIAS_TEXT) {
    throw new TypeAliasEmissionError(`generated type alias exceeds ${MAX_TYPE_ALIAS_TEXT} characters`);
  }
  return text;
}

/** The deep-readonly literal type `as const` derives for the same value. */
function literalTypeText(value: StableJson): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? "readonly []" : `readonly [${value.map(literalTypeText).join(", ")}]`;
  }
  const keys = Object.keys(value).sort(compareStableStrings);
  if (keys.length === 0) return "{}";
  return `{ ${keys.map((key) => `readonly ${JSON.stringify(key)}: ${literalTypeText(value[key]!)};`).join(" ")} }`;
}

function recordStaticEvaluationFailure(
  diagnostics: ComptimeIntrinsicDiagnostic[],
  entry: ProjectEntry,
  fallback: ts.Node,
  error: unknown,
): void {
  if (error instanceof StaticEvaluationError) {
    diagnostics.push(diagnosticForNode(entry, error.node, error.code, error.message));
    return;
  }
  diagnostics.push(diagnosticForNode(
    entry,
    fallback,
    ComptimeIntrinsicDiagnosticCode.NoncanonicalResult,
    "comptime expression did not produce canonical JSON data",
  ));
}

function resolvedCallSymbol(call: ts.CallExpression, checker: ts.TypeChecker): ts.Symbol | undefined {
  const symbolNode = callableSymbolNode(call.expression);
  return symbolNode ? resolveSymbol(checker, checker.getSymbolAtLocation(symbolNode)) : undefined;
}

function resolveStaticFunction(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<ts.SourceFile>,
): StaticFunctionNode | undefined {
  const unwrapped = unwrapExpression(expression);
  if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) return unwrapped;
  if (!ts.isIdentifier(unwrapped)) return undefined;
  const symbol = resolveSymbol(checker, checker.getSymbolAtLocation(unwrapped));
  const declarations = symbol?.declarations ?? [];
  if (declarations.length !== 1) return undefined;
  const declaration = declarations[0]!;
  if (!projectFiles.has(declaration.getSourceFile())) return undefined;
  if (ts.isFunctionDeclaration(declaration) && declaration.body) return declaration;
  if (ts.isVariableDeclaration(declaration) && declaration.initializer &&
    ts.isVariableDeclarationList(declaration.parent) && (declaration.parent.flags & ts.NodeFlags.Const) !== 0) {
    const initializer = unwrapExpression(declaration.initializer);
    if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) return initializer;
  }
  return undefined;
}

function markErasedFunctionCompilerUses(
  fn: StaticFunctionNode,
  checker: ts.TypeChecker,
  intrinsicSymbol: ts.Symbol,
  embedSymbol: ts.Symbol,
  markedFunctions: ReadonlyMap<ts.Symbol, StaticFunctionBinding>,
  allowed: Set<ts.Node>,
): void {
  visit(fn, (node) => {
    if (ts.isCallExpression(node) && resolvedCallSymbol(node, checker) === embedSymbol) {
      markTree(node.expression, allowed);
      return;
    }
    if (ts.isIdentifier(node)) {
      const resolved = resolveSymbol(checker, checker.getSymbolAtLocation(node));
      if (resolved && markedFunctions.has(resolved)) markTree(node, allowed);
      return;
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === "target") {
      const root = callableSymbolNode(node.expression as ts.LeftHandSideExpression);
      if (root && resolveSymbol(checker, checker.getSymbolAtLocation(root)) === intrinsicSymbol) {
        markTree(node, allowed);
      }
    }
  });
}

function functionContainsCompilerUse(
  fn: StaticFunctionNode,
  checker: ts.TypeChecker,
  intrinsicSymbol: ts.Symbol,
  embedSymbol: ts.Symbol,
): boolean {
  let found = false;
  visit(fn, (node) => {
    if (found) return;
    if (ts.isCallExpression(node) && resolvedCallSymbol(node, checker) === embedSymbol) {
      found = true;
      return;
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === "target") {
      const root = callableSymbolNode(node.expression as ts.LeftHandSideExpression);
      if (root && resolveSymbol(checker, checker.getSymbolAtLocation(root)) === intrinsicSymbol) found = true;
    }
  });
  return found;
}

class StaticEvaluationError extends Error {
  constructor(
    readonly code:
      | typeof ComptimeIntrinsicDiagnosticCode.UnsupportedExpression
      | typeof ComptimeIntrinsicDiagnosticCode.NoncanonicalResult
      | typeof ComptimeIntrinsicDiagnosticCode.Budget,
    readonly node: ts.Node,
    message: string,
  ) {
    super(message);
    this.name = "StaticEvaluationError";
  }
}

type LocalValue = StableJson | typeof UNINITIALIZED;

interface LocalBinding {
  value: LocalValue;
  readonly mutable: boolean;
}

type Completion =
  | { readonly kind: "return"; readonly value: StableJson; readonly origin: ts.Expression }
  | { readonly kind: "break" }
  | { readonly kind: "continue" };

const COMPOUND_ASSIGNMENT = new Map<ts.SyntaxKind, ts.SyntaxKind>([
  [ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.PlusToken],
  [ts.SyntaxKind.MinusEqualsToken, ts.SyntaxKind.MinusToken],
  [ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.AsteriskToken],
  [ts.SyntaxKind.SlashEqualsToken, ts.SyntaxKind.SlashToken],
  [ts.SyntaxKind.PercentEqualsToken, ts.SyntaxKind.PercentToken],
  [ts.SyntaxKind.AsteriskAsteriskEqualsToken, ts.SyntaxKind.AsteriskAsteriskToken],
]);

class StaticExpressionEvaluator {
  readonly #memo = new Map<ts.Symbol, StableJson>();
  readonly #active = new Set<ts.Symbol>();
  readonly #origins = new Set<ts.Expression>();
  readonly #dependencies = new Map<string, AssetDependency>();
  readonly #locals: Array<Map<ts.Symbol, LocalBinding>> = [];
  readonly #phaseSpecificAllowed: boolean[] = [true];
  /** Containers constructed by this evaluation. Everything else is immutable. */
  readonly #owned = new WeakSet<object>();
  #callDepth = 0;
  #steps = 0;
  #allocations = 0;

  constructor(
    readonly checker: ts.TypeChecker,
    readonly projectFiles: ReadonlySet<ts.SourceFile>,
    readonly compiler: ComptimeCompiler,
    readonly intrinsicSymbol: ts.Symbol,
    readonly embedSymbol: ts.Symbol,
    readonly markedFunctions: ReadonlyMap<ts.Symbol, StaticFunctionBinding>,
    readonly entryByFile: ReadonlyMap<ts.SourceFile, ProjectEntry>,
    readonly allowedCompilerNodes: Set<ts.Node>,
  ) {}

  evaluateWithOrigins(node: ts.Expression): StaticEvaluationResult {
    const value = this.evaluate(node);
    return this.#result(value, this.#primaryOrigin(node, new Set()));
  }

  invokeWithOrigins(
    fn: StaticFunctionNode,
    argumentsList: readonly ts.Expression[],
    call: ts.CallExpression,
    allowPhaseSpecific = true,
  ): StaticEvaluationResult {
    if (argumentsList.some(ts.isSpreadElement)) {
      this.unsupported(call, "compile-time function calls do not support spread arguments");
    }
    const values = argumentsList.map((argument) => this.evaluate(argument));
    this.#origins.add(call);
    const invoked = this.#invoke(fn, values, allowPhaseSpecific);
    return this.#result(invoked.value, invoked.origin);
  }

  evaluate(node: ts.Expression): StableJson {
    this.#step(node);
    const unwrapped = unwrapExpression(node);
    if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) return unwrapped.text;
    if (ts.isNumericLiteral(unwrapped)) {
      const value = Number(unwrapped.text);
      if (!Number.isFinite(value)) this.noncanonical(unwrapped, "numeric literal is not finite canonical JSON");
      return value;
    }
    if (unwrapped.kind === ts.SyntaxKind.NullKeyword) return null;
    if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isBigIntLiteral(unwrapped)) this.noncanonical(unwrapped, "bigint is not canonical JSON");
    if (ts.isPrefixUnaryExpression(unwrapped)) {
      if (unwrapped.operator === ts.SyntaxKind.PlusPlusToken || unwrapped.operator === ts.SyntaxKind.MinusMinusToken) {
        return this.#update(unwrapped, unwrapped.operator, true);
      }
      const operand = this.evaluate(unwrapped.operand);
      if (unwrapped.operator === ts.SyntaxKind.ExclamationToken) return !this.#truthy(operand);
      if (unwrapped.operator === ts.SyntaxKind.PlusToken && typeof operand === "number") return operand;
      if (unwrapped.operator === ts.SyntaxKind.MinusToken && typeof operand === "number") {
        return this.#canonicalNumber(-operand, unwrapped);
      }
      this.unsupported(unwrapped, "this unary operation is not supported by the bounded comptime evaluator");
    }
    if (ts.isPostfixUnaryExpression(unwrapped)) return this.#update(unwrapped, unwrapped.operator, false);
    if (ts.isConditionalExpression(unwrapped)) {
      return this.#truthy(this.evaluate(unwrapped.condition))
        ? this.evaluate(unwrapped.whenTrue)
        : this.evaluate(unwrapped.whenFalse);
    }
    if (ts.isBinaryExpression(unwrapped)) return this.#binary(unwrapped);
    if (ts.isTemplateExpression(unwrapped)) {
      let value = unwrapped.head.text;
      for (const span of unwrapped.templateSpans) {
        const expression = this.evaluate(span.expression);
        if (expression !== null && typeof expression === "object") {
          this.unsupported(span.expression, "template interpolation requires a scalar comptime value");
        }
        value = this.#guardString(value + String(expression) + span.literal.text, span);
      }
      return value;
    }
    if (ts.isArrayLiteralExpression(unwrapped)) {
      const result: StableJson[] = [];
      for (const element of unwrapped.elements) {
        if (ts.isOmittedExpression(element)) this.noncanonical(element, "sparse array holes are not canonical JSON");
        if (ts.isSpreadElement(element)) this.unsupported(element, "array spread is not statically supported");
        result.push(this.evaluate(element as ts.Expression));
      }
      this.#allocate(unwrapped, result.length + 1);
      return this.#own(result);
    }
    if (ts.isObjectLiteralExpression(unwrapped)) {
      const result = Object.create(null) as Record<string, StableJson>;
      for (const property of unwrapped.properties) {
        if (ts.isShorthandPropertyAssignment(property)) {
          const key = property.name.text;
          if (Object.hasOwn(result, key)) this.noncanonical(property.name, `duplicate object key ${JSON.stringify(key)} is not canonical`);
          result[key] = this.#identifier(property.name);
          continue;
        }
        if (!ts.isPropertyAssignment(property)) {
          this.unsupported(property, "object spread, methods, and accessors are not statically supported");
        }
        const key = propertyName(property.name);
        if (key === undefined) this.unsupported(property.name, "computed object keys are not statically supported");
        if (Object.hasOwn(result, key)) this.noncanonical(property.name, `duplicate object key ${JSON.stringify(key)} is not canonical`);
        result[key] = this.evaluate(property.initializer);
      }
      this.#allocate(unwrapped, unwrapped.properties.length + 1);
      return this.#own(result);
    }
    if (ts.isPropertyAccessExpression(unwrapped)) return this.#property(unwrapped);
    if (ts.isElementAccessExpression(unwrapped)) return this.#element(unwrapped);
    if (ts.isCallExpression(unwrapped)) return this.#call(unwrapped);
    if (ts.isIdentifier(unwrapped)) return this.#identifier(unwrapped);
    this.unsupported(unwrapped, `expression kind ${ts.SyntaxKind[unwrapped.kind]} is not in the static JSON subset`);
  }

  #result(value: StableJson, mappedOrigin: ts.Expression): StaticEvaluationResult {
    return {
      value,
      mappedOrigin,
      origins: Object.freeze([...this.#origins]),
      dependencies: Object.freeze([...this.#dependencies.values()].sort((left, right) =>
        compareStableStrings(left.path, right.path) || compareStableStrings(canonical(left), canonical(right)))),
    };
  }

  #invoke(
    fn: StaticFunctionNode,
    args: readonly StableJson[],
    allowPhaseSpecific = this.#phaseSpecificAllowed.at(-1) ?? true,
  ): { readonly value: StableJson; readonly origin: ts.Expression } {
    if (this.#callDepth >= MAX_CALL_DEPTH) {
      this.budget(fn, `compile-time evaluation exceeded ${MAX_CALL_DEPTH} nested calls`);
    }
    if (!fn.body) this.unsupported(fn, "compile-time function must have an implementation body");
    if (fn.asteriskToken || (ts.getModifiers(fn)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false) ||
      fn.typeParameters?.length) {
      this.unsupported(fn, "bounded compile-time functions cannot be async, generators, or generic");
    }
    if (fn.parameters.length !== args.length) {
      this.unsupported(fn, `compile-time function expected ${fn.parameters.length} arguments but received ${args.length}`);
    }
    const locals = new Map<ts.Symbol, LocalBinding>();
    for (let index = 0; index < fn.parameters.length; index++) {
      const parameter = fn.parameters[index]!;
      if (!ts.isIdentifier(parameter.name) || parameter.dotDotDotToken || parameter.initializer || parameter.questionToken) {
        this.unsupported(parameter, "compile-time function parameters must be required identifiers");
      }
      const symbol = resolveSymbol(this.checker, this.checker.getSymbolAtLocation(parameter.name));
      if (!symbol) this.unsupported(parameter.name, "compile-time parameter has no checker identity");
      locals.set(symbol, { value: args[index]!, mutable: true });
    }
    this.#locals.push(locals);
    this.#phaseSpecificAllowed.push((this.#phaseSpecificAllowed.at(-1) ?? true) && allowPhaseSpecific);
    this.#callDepth += 1;
    try {
      if (!ts.isBlock(fn.body)) {
        return { value: this.evaluate(fn.body), origin: this.#primaryOrigin(fn.body, new Set()) };
      }
      const completion = this.#statements(fn.body.statements);
      if (!completion) this.unsupported(fn.body, "compile-time function completed without returning a value");
      if (completion.kind !== "return") {
        this.unsupported(fn.body, "break and continue must stay inside a compile-time loop");
      }
      return { value: completion.value, origin: completion.origin };
    } finally {
      this.#callDepth -= 1;
      this.#phaseSpecificAllowed.pop();
      this.#locals.pop();
    }
  }

  #statements(statements: readonly ts.Statement[]): Completion | undefined {
    for (const statement of statements) {
      const completion = this.#statement(statement);
      if (completion) return completion;
    }
    return undefined;
  }

  #statement(statement: ts.Statement): Completion | undefined {
    this.#step(statement);
    if (ts.isVariableStatement(statement)) {
      this.#declare(statement.declarationList);
      return undefined;
    }
    if (ts.isExpressionStatement(statement)) {
      this.evaluate(statement.expression);
      return undefined;
    }
    if (ts.isReturnStatement(statement)) {
      if (!statement.expression) this.noncanonical(statement, "compile-time functions must return canonical data");
      this.#origins.add(statement.expression);
      return {
        kind: "return",
        value: this.evaluate(statement.expression),
        origin: this.#primaryOrigin(statement.expression, new Set()),
      };
    }
    if (ts.isIfStatement(statement)) {
      const selected = this.#truthy(this.evaluate(statement.expression))
        ? statement.thenStatement
        : statement.elseStatement;
      return selected ? this.#statement(selected) : undefined;
    }
    if (ts.isWhileStatement(statement)) {
      while (this.#truthy(this.evaluate(statement.expression))) {
        this.#step(statement);
        const completion = this.#statement(statement.statement);
        if (completion?.kind === "return") return completion;
        if (completion?.kind === "break") break;
      }
      return undefined;
    }
    if (ts.isDoStatement(statement)) {
      do {
        this.#step(statement);
        const completion = this.#statement(statement.statement);
        if (completion?.kind === "return") return completion;
        if (completion?.kind === "break") break;
      } while (this.#truthy(this.evaluate(statement.expression)));
      return undefined;
    }
    if (ts.isForStatement(statement)) {
      this.#locals.push(new Map());
      try {
        if (statement.initializer) {
          if (ts.isVariableDeclarationList(statement.initializer)) this.#declare(statement.initializer);
          else this.evaluate(statement.initializer);
        }
        while (statement.condition === undefined || this.#truthy(this.evaluate(statement.condition))) {
          this.#step(statement);
          const completion = this.#statement(statement.statement);
          if (completion?.kind === "return") return completion;
          if (completion?.kind === "break") break;
          if (statement.incrementor) this.evaluate(statement.incrementor);
        }
        return undefined;
      } finally {
        this.#locals.pop();
      }
    }
    if (ts.isForOfStatement(statement)) return this.#forOf(statement);
    if (ts.isForInStatement(statement)) {
      this.unsupported(statement, "for-in is not supported at comptime; iterate Object.keys(...) with for-of");
    }
    if (ts.isBreakStatement(statement)) {
      if (statement.label) this.unsupported(statement, "labeled break is not supported by the bounded comptime evaluator");
      return { kind: "break" };
    }
    if (ts.isContinueStatement(statement)) {
      if (statement.label) this.unsupported(statement, "labeled continue is not supported by the bounded comptime evaluator");
      return { kind: "continue" };
    }
    if (ts.isBlock(statement)) {
      this.#locals.push(new Map());
      try {
        return this.#statements(statement.statements);
      } finally {
        this.#locals.pop();
      }
    }
    if (ts.isEmptyStatement(statement)) return undefined;
    this.unsupported(statement, `statement kind ${ts.SyntaxKind[statement.kind]} is not in the bounded comptime function subset`);
  }

  #declare(list: ts.VariableDeclarationList): void {
    const mutable = (list.flags & ts.NodeFlags.Let) !== 0;
    if (!mutable && (list.flags & ts.NodeFlags.Const) === 0) {
      this.unsupported(list, "compile-time local bindings must be const or let");
    }
    for (const declaration of list.declarations) {
      if (!ts.isIdentifier(declaration.name)) {
        this.unsupported(declaration, "compile-time local declarations bind one plain identifier");
      }
      if (!declaration.initializer && !mutable) {
        this.unsupported(declaration, "compile-time const locals require an initializer");
      }
      const symbol = resolveSymbol(this.checker, this.checker.getSymbolAtLocation(declaration.name));
      if (!symbol) this.unsupported(declaration.name, "compile-time local binding has no checker identity");
      let value: LocalValue = UNINITIALIZED;
      if (declaration.initializer) {
        this.#origins.add(declaration.initializer);
        value = this.evaluate(declaration.initializer);
      }
      this.#locals.at(-1)!.set(symbol, { value, mutable });
    }
  }

  #forOf(statement: ts.ForOfStatement): Completion | undefined {
    if (statement.awaitModifier) this.unsupported(statement, "for-await is not supported at comptime");
    const initializer = statement.initializer;
    if (!ts.isVariableDeclarationList(initializer) || initializer.declarations.length !== 1) {
      this.unsupported(statement.initializer, "comptime for-of requires a single const or let binding");
    }
    const mutable = (initializer.flags & ts.NodeFlags.Let) !== 0;
    if (!mutable && (initializer.flags & ts.NodeFlags.Const) === 0) {
      this.unsupported(initializer, "comptime for-of requires a single const or let binding");
    }
    const declaration = initializer.declarations[0]!;
    if (!ts.isIdentifier(declaration.name) || declaration.initializer) {
      this.unsupported(declaration, "comptime for-of binds one plain identifier");
    }
    const symbol = resolveSymbol(this.checker, this.checker.getSymbolAtLocation(declaration.name));
    if (!symbol) this.unsupported(declaration.name, "compile-time local binding has no checker identity");
    const iterable = this.evaluate(statement.expression);
    const items: Iterable<StableJson> = Array.isArray(iterable)
      ? iterable
      : typeof iterable === "string"
        ? [...iterable]
        : this.unsupported(statement.expression, "comptime for-of iterates arrays and strings");
    for (const item of items) {
      this.#step(statement);
      this.#locals.push(new Map([[symbol, { value: item, mutable }]]));
      try {
        const completion = this.#statement(statement.statement);
        if (completion?.kind === "return") return completion;
        if (completion?.kind === "break") break;
      } finally {
        this.#locals.pop();
      }
    }
    return undefined;
  }

  #binary(node: ts.BinaryExpression): StableJson {
    const kind = node.operatorToken.kind;
    if (kind === ts.SyntaxKind.EqualsToken || COMPOUND_ASSIGNMENT.has(kind)) return this.#assign(node);
    const left = this.evaluate(node.left);
    if (kind === ts.SyntaxKind.AmpersandAmpersandToken) return this.#truthy(left) ? this.evaluate(node.right) : left;
    if (kind === ts.SyntaxKind.BarBarToken) return this.#truthy(left) ? left : this.evaluate(node.right);
    if (kind === ts.SyntaxKind.QuestionQuestionToken) return left === null ? this.evaluate(node.right) : left;
    const right = this.evaluate(node.right);
    switch (kind) {
      case ts.SyntaxKind.EqualsEqualsEqualsToken: return canonical(left) === canonical(right);
      case ts.SyntaxKind.ExclamationEqualsEqualsToken: return canonical(left) !== canonical(right);
      case ts.SyntaxKind.PlusToken:
      case ts.SyntaxKind.MinusToken:
      case ts.SyntaxKind.AsteriskToken:
      case ts.SyntaxKind.SlashToken:
      case ts.SyntaxKind.PercentToken:
      case ts.SyntaxKind.AsteriskAsteriskToken:
        return this.#applyBinaryOperator(kind, left, right, node);
      case ts.SyntaxKind.LessThanToken:
      case ts.SyntaxKind.LessThanEqualsToken:
      case ts.SyntaxKind.GreaterThanToken:
      case ts.SyntaxKind.GreaterThanEqualsToken:
        if ((typeof left === "number" && typeof right === "number") ||
          (typeof left === "string" && typeof right === "string")) {
          if (kind === ts.SyntaxKind.LessThanToken) return left < right;
          if (kind === ts.SyntaxKind.LessThanEqualsToken) return left <= right;
          if (kind === ts.SyntaxKind.GreaterThanToken) return left > right;
          return left >= right;
        }
        break;
    }
    this.unsupported(node, "this binary operation is not supported for the supplied comptime values");
  }

  #applyBinaryOperator(kind: ts.SyntaxKind, left: StableJson, right: StableJson, node: ts.Node): StableJson {
    if (kind === ts.SyntaxKind.PlusToken) {
      if (typeof left === "number" && typeof right === "number") return this.#canonicalNumber(left + right, node);
      if ((typeof left === "string" || typeof left === "number") &&
        (typeof right === "string" || typeof right === "number")) {
        return this.#guardString(String(left) + String(right), node);
      }
      this.unsupported(node, "this binary operation is not supported for the supplied comptime values");
    }
    if (typeof left !== "number" || typeof right !== "number") {
      this.unsupported(node, "this binary operation is not supported for the supplied comptime values");
    }
    const value = kind === ts.SyntaxKind.MinusToken ? left - right
      : kind === ts.SyntaxKind.AsteriskToken ? left * right
        : kind === ts.SyntaxKind.SlashToken ? left / right
          : kind === ts.SyntaxKind.PercentToken ? left % right
            : kind === ts.SyntaxKind.AsteriskAsteriskToken ? left ** right
              : undefined;
    if (value === undefined) this.unsupported(node, "this binary operation is not supported for the supplied comptime values");
    return this.#canonicalNumber(value, node);
  }

  #assign(node: ts.BinaryExpression): StableJson {
    const operator = COMPOUND_ASSIGNMENT.get(node.operatorToken.kind);
    const target = unwrapExpression(node.left);
    if (ts.isIdentifier(target)) {
      const binding = this.#localBinding(target);
      if (!binding) {
        this.unsupported(target, `cannot assign to ${JSON.stringify(target.text)}: only compile-time function locals are assignable`);
      }
      if (!binding.mutable) this.unsupported(target, `cannot assign to compile-time const ${JSON.stringify(target.text)}`);
      let next: StableJson;
      if (operator === undefined) {
        next = this.evaluate(node.right);
      } else {
        if (binding.value === UNINITIALIZED) {
          this.unsupported(target, `compile-time local ${JSON.stringify(target.text)} is read before assignment`);
        }
        next = this.#applyBinaryOperator(operator, binding.value, this.evaluate(node.right), node);
      }
      binding.value = next;
      return next;
    }
    if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
      const receiver = this.evaluate(target.expression);
      const key = this.#memberKey(target);
      this.#assertMutable(receiver, target);
      const next = operator === undefined
        ? this.evaluate(node.right)
        : this.#applyBinaryOperator(operator, this.#member(receiver, key, target), this.evaluate(node.right), node);
      this.#setMember(receiver, key, next, target);
      return next;
    }
    this.unsupported(node.left, "this assignment target is not supported by the bounded comptime evaluator");
  }

  #update(
    node: ts.PrefixUnaryExpression | ts.PostfixUnaryExpression,
    operator: ts.SyntaxKind.PlusPlusToken | ts.SyntaxKind.MinusMinusToken,
    prefix: boolean,
  ): StableJson {
    const target = unwrapExpression(node.operand);
    const delta = operator === ts.SyntaxKind.PlusPlusToken ? 1 : -1;
    if (ts.isIdentifier(target)) {
      const binding = this.#localBinding(target);
      if (!binding) {
        this.unsupported(target, `cannot assign to ${JSON.stringify(target.text)}: only compile-time function locals are assignable`);
      }
      if (!binding.mutable) this.unsupported(target, `cannot assign to compile-time const ${JSON.stringify(target.text)}`);
      if (typeof binding.value !== "number") this.unsupported(node, "++ and -- require a numeric comptime value");
      const current = binding.value;
      const next = this.#canonicalNumber(current + delta, node);
      binding.value = next;
      return prefix ? next : current;
    }
    if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
      const receiver = this.evaluate(target.expression);
      const key = this.#memberKey(target);
      this.#assertMutable(receiver, target);
      const current = this.#member(receiver, key, target);
      if (typeof current !== "number") this.unsupported(node, "++ and -- require a numeric comptime value");
      const next = this.#canonicalNumber(current + delta, node);
      this.#setMember(receiver, key, next, target);
      return prefix ? next : current;
    }
    this.unsupported(node, "++ and -- require an assignable comptime target");
  }

  #memberKey(target: ts.PropertyAccessExpression | ts.ElementAccessExpression): string {
    if (ts.isPropertyAccessExpression(target)) {
      if (ts.isPrivateIdentifier(target.name)) {
        this.unsupported(target.name, "private member access is not supported at comptime");
      }
      return target.name.text;
    }
    const key = this.evaluate(target.argumentExpression);
    if (typeof key !== "string" && typeof key !== "number") {
      this.unsupported(target.argumentExpression, "comptime element keys must be strings or numbers");
    }
    return String(key);
  }

  #setMember(receiver: StableJson[] | Record<string, StableJson>, key: string, value: StableJson, node: ts.Node): void {
    if (Array.isArray(receiver)) {
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index < 0 || index > receiver.length) {
        this.unsupported(node, `array index ${JSON.stringify(key)} is outside the mutable comptime array`);
      }
      if (index === receiver.length) this.#allocate(node, 1);
      receiver[index] = value;
      return;
    }
    if (!Object.hasOwn(receiver, key)) this.#allocate(node, 1);
    receiver[key] = value;
  }

  #localBinding(node: ts.Identifier): LocalBinding | undefined {
    const symbol = resolveSymbol(this.checker, this.checker.getSymbolAtLocation(node));
    if (!symbol) return undefined;
    for (let index = this.#locals.length - 1; index >= 0; index--) {
      const binding = this.#locals[index]!.get(symbol);
      if (binding) return binding;
    }
    return undefined;
  }

  #assertMutable(value: StableJson, node: ts.Node): asserts value is StableJson[] | Record<string, StableJson> {
    if (value === null || typeof value !== "object" || !this.#owned.has(value) || Object.isFrozen(value)) {
      this.unsupported(node, "comptime mutation requires an array or object constructed by this compile-time evaluation");
    }
  }

  #own<T extends object>(value: T): T {
    this.#owned.add(value);
    return value;
  }

  #ownDeep(value: StableJson, node: ts.Node): StableJson {
    if (value !== null && typeof value === "object") {
      this.#allocate(node, 1);
      this.#owned.add(value);
      for (const child of Array.isArray(value) ? value : Object.values(value)) this.#ownDeep(child, node);
    }
    return value;
  }

  /** Deep-freeze a memoized module value so no later mutation can reach it. */
  #release<T extends StableJson>(value: T): T {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
      this.#owned.delete(value);
      for (const child of Array.isArray(value) ? value : Object.values(value)) this.#release(child);
      Object.freeze(value);
    }
    return value;
  }

  #property(node: ts.PropertyAccessExpression): StableJson {
    if (node.name.text === "target" && this.#resolvesToIntrinsic(node.expression)) {
      if (!(this.#phaseSpecificAllowed.at(-1) ?? true)) {
        this.unsupported(node, "a runtime-retained function cannot observe comptime.target");
      }
      markTree(node, this.allowedCompilerNodes);
      return this.compiler.target;
    }
    return this.#member(this.evaluate(node.expression), node.name.text, node);
  }

  #element(node: ts.ElementAccessExpression): StableJson {
    if (!node.argumentExpression) this.unsupported(node, "comptime element access requires an index");
    const key = this.evaluate(node.argumentExpression);
    if (typeof key !== "string" && typeof key !== "number") {
      this.unsupported(node.argumentExpression, "comptime element keys must be strings or numbers");
    }
    return this.#member(this.evaluate(node.expression), String(key), node);
  }

  #member(value: StableJson, key: string, node: ts.Node): StableJson {
    if (typeof value === "string" && key === "length") return value.length;
    if (Array.isArray(value)) {
      if (key === "length") return value.length;
      const index = Number(key);
      if (Number.isSafeInteger(index) && index >= 0 && index < value.length) return value[index]!;
      this.unsupported(node, `array index ${JSON.stringify(key)} is outside the comptime value`);
    }
    if (value !== null && typeof value === "object" && Object.hasOwn(value, key)) return value[key]!;
    this.unsupported(node, `property ${JSON.stringify(key)} is absent from the comptime value`);
  }

  #call(node: ts.CallExpression): StableJson {
    if (node.questionDotToken || node.arguments.some(ts.isSpreadElement)) {
      this.unsupported(node, "bounded comptime calls do not support optional chaining or spread arguments");
    }
    const symbol = resolvedCallSymbol(node, this.checker);
    if (symbol === this.embedSymbol) {
      if (!(this.#phaseSpecificAllowed.at(-1) ?? true)) {
        this.unsupported(node, "a runtime-retained function cannot call the compiler-only embed intrinsic");
      }
      markTree(node.expression, this.allowedCompilerNodes);
      if (node.arguments.length !== 1) this.unsupported(node, "embed requires exactly one relative text path");
      const specifier = this.evaluate(node.arguments[0]!);
      if (typeof specifier !== "string") this.unsupported(node.arguments[0]!, "embed path must evaluate to a string");
      const entry = this.entryByFile.get(node.getSourceFile());
      if (!entry) this.unsupported(node, "embed call is outside the checked comptime project");
      try {
        const tracked = this.compiler.readTrackedText(specifier, { from: entry.publicName });
        this.#dependencies.set(`${tracked.dependency.path}\0${tracked.dependency.access}`, tracked.dependency);
        this.#origins.add(node);
        return tracked.value;
      } catch (error) {
        this.unsupported(node, `tracked embed failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const marked = symbol ? this.markedFunctions.get(symbol) : undefined;
    if (marked) {
      markTree(node.expression, this.allowedCompilerNodes);
      const args = node.arguments.map((argument) => this.evaluate(argument));
      // A marker call is compile-time by definition: every marked call site is
      // separately lowered to its value, so the invoked function's phase
      // nature is its own rather than the calling context's.
      this.#phaseSpecificAllowed.push(true);
      try {
        return this.#invoke(marked.node, args, marked.erased).value;
      } finally {
        this.#phaseSpecificAllowed.pop();
      }
    }

    const localFunction = resolveStaticFunction(node.expression, this.checker, this.projectFiles);
    if (localFunction) {
      const args = node.arguments.map((argument) => this.evaluate(argument));
      return this.#invoke(localFunction, args).value;
    }

    if (ts.isPropertyAccessExpression(node.expression)) {
      const receiverNode = node.expression.expression;
      const member = node.expression.name.text;
      if (ts.isIdentifier(receiverNode) && this.#isAmbientBuiltin(receiverNode, "JSON")) {
        if (member === "parse" && node.arguments.length === 1) {
          const source = this.evaluate(node.arguments[0]!);
          if (typeof source !== "string") this.unsupported(node.arguments[0]!, "JSON.parse comptime input must be text");
          try {
            return this.#ownDeep(stableClone(JSON.parse(source), "comptime JSON.parse result"), node);
          } catch (error) {
            if (error instanceof StaticEvaluationError) throw error;
            this.noncanonical(node, `JSON.parse did not produce canonical data: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        if (member === "stringify" && node.arguments.length === 1) {
          return this.#guardString(canonical(this.evaluate(node.arguments[0]!)), node);
        }
      }
      if (ts.isIdentifier(receiverNode) && this.#isAmbientBuiltin(receiverNode, "Math")) {
        const methods = new Set(["abs", "ceil", "floor", "max", "min", "round", "sign", "trunc"]);
        if (!methods.has(member)) this.unsupported(node, `Math.${member} is not a permitted deterministic comptime operation`);
        const args = node.arguments.map((argument) => this.evaluate(argument));
        if (args.some((argument) => typeof argument !== "number")) this.unsupported(node, `Math.${member} requires numeric comptime arguments`);
        const operation = Math[member as keyof Math] as unknown;
        if (typeof operation !== "function") this.unsupported(node, `Math.${member} is unavailable`);
        return this.#canonicalNumber((operation as (...values: number[]) => number)(...(args as number[])), node);
      }
      if (ts.isIdentifier(receiverNode) && this.#isAmbientBuiltin(receiverNode, "Object")) {
        return this.#objectCall(member, node);
      }
      const receiver = this.evaluate(receiverNode);
      if (typeof receiver === "string") {
        const args = node.arguments.map((argument) => this.evaluate(argument));
        return this.#stringCall(receiver, member, args, node);
      }
      if (Array.isArray(receiver)) return this.#arrayCall(receiver, member, node);
    }
    this.unsupported(node, "call is not a compiler intrinsic, project-local pure function, or whitelisted deterministic operation");
  }

  #objectCall(member: string, node: ts.CallExpression): StableJson {
    if (!["keys", "values", "entries", "fromEntries"].includes(member)) {
      this.unsupported(node, `Object.${member} is not a permitted deterministic comptime operation`);
    }
    if (node.arguments.length !== 1) this.unsupported(node, `Object.${member} requires exactly one argument`);
    const argument = this.evaluate(node.arguments[0]!);
    if (member === "fromEntries") {
      if (!Array.isArray(argument)) {
        this.unsupported(node.arguments[0]!, "Object.fromEntries requires an array of [key, value] pairs");
      }
      this.#allocate(node, argument.length + 1);
      const result = this.#own(Object.create(null) as Record<string, StableJson>);
      for (const pair of argument) {
        if (!Array.isArray(pair) || pair.length !== 2 || (typeof pair[0] !== "string" && typeof pair[0] !== "number")) {
          this.unsupported(node.arguments[0]!, "Object.fromEntries entries must be [string | number, value] pairs");
        }
        result[String(pair[0])] = pair[1]!;
      }
      return result;
    }
    if (argument === null || typeof argument !== "object" || Array.isArray(argument)) {
      this.unsupported(node.arguments[0]!, `Object.${member} requires a comptime object`);
    }
    const keys = Object.keys(argument);
    if (member === "keys") {
      this.#allocate(node, keys.length + 1);
      return this.#own([...keys]);
    }
    if (member === "values") {
      this.#allocate(node, keys.length + 1);
      return this.#own(keys.map((key) => argument[key]!));
    }
    this.#allocate(node, keys.length * 3 + 1);
    return this.#own(keys.map((key) => this.#own([key, argument[key]!] as StableJson[])));
  }

  #arrayCall(receiver: StableJson[], member: string, node: ts.CallExpression): StableJson {
    const evaluateArguments = (): StableJson[] => node.arguments.map((argument) => this.evaluate(argument));
    const safeInteger = (value: StableJson): value is number => typeof value === "number" && Number.isSafeInteger(value);
    switch (member) {
      case "push": {
        const items = evaluateArguments();
        this.#assertMutable(receiver, node);
        this.#allocate(node, items.length);
        receiver.push(...items);
        return receiver.length;
      }
      case "pop": {
        if (node.arguments.length !== 0) this.unsupported(node, "pop takes no comptime arguments");
        this.#assertMutable(receiver, node);
        if (receiver.length === 0) this.noncanonical(node, "pop on an empty comptime array produces undefined");
        return receiver.pop()!;
      }
      case "splice": {
        const args = evaluateArguments();
        this.#assertMutable(receiver, node);
        if (args.length < 1 || !safeInteger(args[0]) || (args.length >= 2 && !safeInteger(args[1]))) {
          this.unsupported(node, "splice requires integer start and deleteCount comptime arguments");
        }
        const removed = args.length >= 2
          ? receiver.splice(args[0] as number, args[1] as number, ...args.slice(2))
          : receiver.splice(args[0] as number);
        this.#allocate(node, Math.max(0, args.length - 2) + removed.length + 1);
        return this.#own(removed);
      }
      case "slice": {
        const args = evaluateArguments();
        if (args.length > 2 || !args.every(safeInteger)) {
          this.unsupported(node, "slice requires up to two integer comptime arguments");
        }
        const result = receiver.slice(args[0] as number | undefined, args[1] as number | undefined);
        this.#allocate(node, result.length + 1);
        return this.#own(result);
      }
      case "concat": {
        const args = evaluateArguments();
        const result = receiver.concat(...args);
        this.#allocate(node, result.length + 1);
        return this.#own(result);
      }
      case "join": {
        const args = evaluateArguments();
        if (args.length > 1 || (args.length === 1 && typeof args[0] !== "string")) {
          this.unsupported(node, "join takes at most one string separator");
        }
        const parts = receiver.map((element) => {
          if (element === null) return "";
          if (typeof element === "object") this.unsupported(node, "join requires scalar comptime elements");
          return String(element);
        });
        return this.#guardString(parts.join(args.length === 1 ? (args[0] as string) : ","), node);
      }
      case "includes":
      case "indexOf": {
        const args = evaluateArguments();
        if (args.length !== 1 || (args[0] !== null && typeof args[0] === "object")) {
          this.unsupported(node, `${member} requires one scalar comptime argument`);
        }
        return member === "includes" ? receiver.includes(args[0]!) : receiver.indexOf(args[0]!);
      }
      case "map":
      case "filter": {
        if (node.arguments.length !== 1) {
          this.unsupported(node, "comptime map and filter take exactly one callback argument");
        }
        const callback = this.#callbackFunction(node, 1, 3);
        const snapshot = receiver.slice();
        const result: StableJson[] = [];
        this.#allocate(node, snapshot.length + 1);
        for (let index = 0; index < snapshot.length; index++) {
          const args = ([snapshot[index]!, index, receiver] as StableJson[]).slice(0, callback.parameters.length);
          const value = this.#invoke(callback, args).value;
          if (member === "map") result.push(value);
          else if (this.#truthy(value)) result.push(snapshot[index]!);
        }
        return this.#own(result);
      }
      case "reduce": {
        if (node.arguments.length !== 2) {
          this.unsupported(node, "comptime reduce requires a callback and an explicit initial value");
        }
        const callback = this.#callbackFunction(node, 2, 4);
        let accumulator = this.evaluate(node.arguments[1]!);
        const snapshot = receiver.slice();
        for (let index = 0; index < snapshot.length; index++) {
          const args = ([accumulator, snapshot[index]!, index, receiver] as StableJson[]).slice(0, callback.parameters.length);
          accumulator = this.#invoke(callback, args).value;
        }
        return accumulator;
      }
    }
    this.unsupported(node, `array method ${member} is not supported for these comptime arguments`);
  }

  #callbackFunction(node: ts.CallExpression, minimumArity: number, maximumArity: number): StaticFunctionNode {
    const callbackExpression = node.arguments[0];
    if (!callbackExpression) this.unsupported(node, "this array method requires a callback argument");
    const callback = resolveStaticFunction(callbackExpression, this.checker, this.projectFiles);
    if (!callback) {
      this.unsupported(callbackExpression, "comptime array callbacks must be inline or project-local functions");
    }
    if (callback.parameters.length < minimumArity || callback.parameters.length > maximumArity) {
      this.unsupported(
        callbackExpression,
        `comptime array callback must declare between ${minimumArity} and ${maximumArity} parameters`,
      );
    }
    return callback;
  }

  #stringCall(receiver: string, member: string, args: readonly StableJson[], node: ts.CallExpression): StableJson {
    if (member === "trim" && args.length === 0) return receiver.trim();
    if (member === "trimStart" && args.length === 0) return receiver.trimStart();
    if (member === "trimEnd" && args.length === 0) return receiver.trimEnd();
    if (member === "toLowerCase" && args.length === 0) return receiver.toLowerCase();
    if (member === "toUpperCase" && args.length === 0) return receiver.toUpperCase();
    if (["includes", "startsWith", "endsWith"].includes(member) && args.length === 1 && typeof args[0] === "string") {
      return member === "includes" ? receiver.includes(args[0])
        : member === "startsWith" ? receiver.startsWith(args[0]) : receiver.endsWith(args[0]);
    }
    if ((member === "indexOf" || member === "lastIndexOf") && args.length === 1 && typeof args[0] === "string") {
      return member === "indexOf" ? receiver.indexOf(args[0]) : receiver.lastIndexOf(args[0]);
    }
    if (member === "replaceAll" && args.length === 2 && args.every((argument) => typeof argument === "string")) {
      return this.#guardString(receiver.replaceAll(args[0] as string, args[1] as string), node);
    }
    if (member === "slice" && args.length >= 1 && args.length <= 2 &&
      args.every((argument) => typeof argument === "number" && Number.isSafeInteger(argument))) {
      return receiver.slice(args[0] as number, args[1] as number | undefined);
    }
    if (member === "split" && args.length === 1 && typeof args[0] === "string") {
      const parts = receiver.split(args[0]);
      this.#allocate(node, parts.length + 1);
      return this.#own(parts);
    }
    if (member === "repeat" && args.length === 1 && typeof args[0] === "number" &&
      Number.isSafeInteger(args[0]) && args[0] >= 0) {
      if (receiver.length * args[0] > MAX_COMPTIME_STRING_LENGTH) {
        this.budget(node, `comptime string exceeds ${MAX_COMPTIME_STRING_LENGTH} UTF-16 units`);
      }
      return receiver.repeat(args[0]);
    }
    if ((member === "padStart" || member === "padEnd") && args.length >= 1 && args.length <= 2 &&
      typeof args[0] === "number" && Number.isSafeInteger(args[0]) && args[0] >= 0 &&
      (args.length === 1 || typeof args[1] === "string")) {
      if (args[0] > MAX_COMPTIME_STRING_LENGTH) {
        this.budget(node, `comptime string exceeds ${MAX_COMPTIME_STRING_LENGTH} UTF-16 units`);
      }
      return member === "padStart"
        ? receiver.padStart(args[0], args[1] as string | undefined)
        : receiver.padEnd(args[0], args[1] as string | undefined);
    }
    this.unsupported(node, `string method ${member} is not supported for these comptime arguments`);
  }

  #identifier(node: ts.Identifier): StableJson {
    if (node.text === "undefined" || node.text === "NaN" || node.text === "Infinity") {
      this.noncanonical(node, `${node.text} is not canonical JSON`);
    }
    const rawSymbol = ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
      ? this.checker.getShorthandAssignmentValueSymbol(node.parent) ?? this.checker.getSymbolAtLocation(node)
      : this.checker.getSymbolAtLocation(node);
    const symbol = resolveSymbol(this.checker, rawSymbol);
    if (!symbol) this.unsupported(node, `dynamic identifier ${JSON.stringify(node.text)} cannot be evaluated statically`);
    for (let index = this.#locals.length - 1; index >= 0; index--) {
      const binding = this.#locals[index]!.get(symbol);
      if (binding) {
        if (binding.value === UNINITIALIZED) {
          this.unsupported(node, `compile-time local ${JSON.stringify(node.text)} is read before assignment`);
        }
        return binding.value;
      }
    }
    if (this.#memo.has(symbol)) return this.#memo.get(symbol)!;
    const declarations = symbol.declarations ?? [];
    if (declarations.length !== 1 || !ts.isVariableDeclaration(declarations[0])) {
      this.unsupported(node, `identifier ${JSON.stringify(node.text)} is not a single local const declaration`);
    }
    const declaration = declarations[0];
    if (!this.projectFiles.has(declaration.getSourceFile()) || !declaration.initializer ||
      !ts.isVariableDeclarationList(declaration.parent) || !(declaration.parent.flags & ts.NodeFlags.Const)) {
      this.unsupported(node, `identifier ${JSON.stringify(node.text)} is not initialized by project-local const data`);
    }
    this.#origins.add(declaration.initializer);
    if (this.#active.has(symbol)) this.unsupported(node, `cyclic const reference ${JSON.stringify(node.text)} cannot be evaluated`);
    this.#active.add(symbol);
    try {
      const value = this.#release(this.evaluate(declaration.initializer));
      this.#memo.set(symbol, value);
      return value;
    } finally {
      this.#active.delete(symbol);
    }
  }

  #resolvesToIntrinsic(expression: ts.Expression): boolean {
    const symbolNode = callableSymbolNode(expression as ts.LeftHandSideExpression);
    return symbolNode !== undefined &&
      resolveSymbol(this.checker, this.checker.getSymbolAtLocation(symbolNode)) === this.intrinsicSymbol;
  }

  #isAmbientBuiltin(node: ts.Identifier, name: string): boolean {
    if (node.text !== name) return false;
    const symbol = resolveSymbol(this.checker, this.checker.getSymbolAtLocation(node));
    return symbol !== undefined && (symbol.declarations ?? []).every((declaration) => !this.projectFiles.has(declaration.getSourceFile()));
  }

  #truthy(value: StableJson): boolean {
    if (value === null || value === false || value === "" || value === 0) return false;
    return true;
  }

  #canonicalNumber(value: number, node: ts.Node): number {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      this.noncanonical(node, "numeric comptime result is non-finite or negative zero");
    }
    return value;
  }

  #guardString(value: string, node: ts.Node): string {
    if (value.length > MAX_COMPTIME_STRING_LENGTH) {
      this.budget(node, `comptime string exceeds ${MAX_COMPTIME_STRING_LENGTH} UTF-16 units`);
    }
    return value;
  }

  #step(node: ts.Node): void {
    if (++this.#steps > MAX_EVALUATION_STEPS) {
      this.budget(node, `comptime evaluation exceeded the ${MAX_EVALUATION_STEPS} step budget`);
    }
  }

  #allocate(node: ts.Node, count: number): void {
    this.#allocations += count;
    if (this.#allocations > MAX_ALLOCATION_NODES) {
      this.budget(node, `comptime evaluation exceeded the ${MAX_ALLOCATION_NODES} allocation-node budget`);
    }
  }

  #primaryOrigin(node: ts.Expression, seen: Set<ts.Symbol>): ts.Expression {
    const unwrapped = unwrapExpression(node);
    if (!ts.isIdentifier(unwrapped)) return unwrapped;
    const symbol = resolveSymbol(this.checker, this.checker.getSymbolAtLocation(unwrapped));
    if (!symbol || seen.has(symbol)) return unwrapped;
    const declarations = symbol.declarations ?? [];
    const declaration = declarations.length === 1 && ts.isVariableDeclaration(declarations[0])
      ? declarations[0]
      : undefined;
    if (!declaration?.initializer || !this.projectFiles.has(declaration.getSourceFile())) return unwrapped;
    seen.add(symbol);
    return this.#primaryOrigin(declaration.initializer, seen);
  }

  unsupported(node: ts.Node, message: string): never {
    throw new StaticEvaluationError(ComptimeIntrinsicDiagnosticCode.UnsupportedExpression, node, message);
  }

  noncanonical(node: ts.Node, message: string): never {
    throw new StaticEvaluationError(ComptimeIntrinsicDiagnosticCode.NoncanonicalResult, node, message);
  }

  budget(node: ts.Node, message: string): never {
    throw new StaticEvaluationError(ComptimeIntrinsicDiagnosticCode.Budget, node, message);
  }
}

function checkedProject(sources: Readonly<Record<string, string>>): CheckedProject {
  const sourceEntries = Object.entries(sources).sort(([left], [right]) => compareStableStrings(left, right));
  if (sourceEntries.length === 0) throw new TypeError("comptime frontend requires at least one source file");
  const staged = sourceEntries.map(([publicName, source]) => {
    if (typeof source !== "string") throw new TypeError(`source ${JSON.stringify(publicName)} must be text`);
    const internalName = safeVirtualName(publicName);
    // The comptime frontend checks the frontend's recovered text so authored
    // VibeLang expression control flow parses here exactly as it does in the
    // language frontend. `source` stays authored: the lowered file is cut from
    // it, so the module the frontend receives keeps its authored spelling.
    const recovery = recoverVibeSyntax(source);
    return {
      publicName,
      internalName,
      source,
      parseSource: recovery.parseSource,
      recovery,
      authoredLineStarts: computeLineStarts(source),
    };
  });
  if (new Set(staged.map((entry) => entry.internalName)).size !== staged.length) {
    throw new TypeError("comptime source names collide after path normalization");
  }
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true,
    checkJs: true,
    strict: true,
    types: [],
    skipLibCheck: true,
    noEmit: true,
    allowImportingTsExtensions: true,
  };
  const preludeFile = ts.createSourceFile(PRELUDE_NAME, PRELUDE, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const schemaPreludeFile = ts.createSourceFile(
    SCHEMA_PRELUDE_NAME,
    SCHEMA_PRELUDE,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const sourceFiles = new Map(staged.map((entry) => [
    entry.internalName,
    ts.createSourceFile(entry.internalName, entry.parseSource, ts.ScriptTarget.Latest, true, scriptKind(entry.publicName)),
  ]));
  const host = ts.createCompilerHost(options, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const originalDirectoryExists = host.directoryExists?.bind(host);
  const virtualDirectories = new Set<string>([VIRTUAL_ROOT]);
  for (const fileName of sourceFiles.keys()) {
    let directory = dirname(fileName);
    while (directory.startsWith(VIRTUAL_ROOT)) {
      virtualDirectories.add(directory);
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  const preludes = new Map([[PRELUDE_NAME, { file: preludeFile, source: PRELUDE }], [
    SCHEMA_PRELUDE_NAME,
    { file: schemaPreludeFile, source: SCHEMA_PRELUDE },
  ]]);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    const normalized = resolve(name);
    const prelude = preludes.get(normalized);
    if (prelude) return prelude.file;
    return sourceFiles.get(normalized) ?? originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  };
  host.fileExists = (name) => preludes.has(resolve(name)) || sourceFiles.has(resolve(name)) || originalFileExists(name);
  host.readFile = (name) => {
    const normalized = resolve(name);
    const prelude = preludes.get(normalized);
    if (prelude) return prelude.source;
    return staged.find((entry) => entry.internalName === normalized)?.parseSource ?? originalReadFile(name);
  };
  host.directoryExists = (name) => virtualDirectories.has(resolve(name)) || Boolean(originalDirectoryExists?.(name));
  host.realpath = (name) => {
    const normalized = resolve(name);
    return preludes.has(normalized) || sourceFiles.has(normalized) ? normalized : resolve(name);
  };
  host.resolveModuleNames = (moduleNames, containingFile) => moduleNames.map((moduleName) => {
    if (moduleName === COMPTIME_MODULE_SPECIFIER) {
      return { resolvedFileName: PRELUDE_NAME, extension: ts.Extension.Dts, isExternalLibraryImport: true };
    }
    if (moduleName === SCHEMA_MODULE_SPECIFIER) {
      return { resolvedFileName: SCHEMA_PRELUDE_NAME, extension: ts.Extension.Dts, isExternalLibraryImport: true };
    }
    const target = resolveVirtualModule(containingFile, moduleName, sourceFiles);
    return target ? {
      resolvedFileName: target,
      extension: extensionFor(target),
      isExternalLibraryImport: false,
    } : undefined;
  });
  const program = ts.createProgram({
    rootNames: [...sourceFiles.keys(), ...preludes.keys()],
    options,
    host,
  });
  const checker = program.getTypeChecker();
  const fileEntries: ProjectEntry[] = staged.map((entry) => ({
    ...entry,
    file: program.getSourceFile(entry.internalName) ?? sourceFiles.get(entry.internalName)!,
    syntacticDiagnostics: program.getSyntacticDiagnostics(
      program.getSourceFile(entry.internalName) ?? sourceFiles.get(entry.internalName)!,
    ),
  }));
  const checkedPrelude = program.getSourceFile(PRELUDE_NAME);
  const declarations = checkedPrelude?.statements.filter(ts.isFunctionDeclaration) ?? [];
  const intrinsicDeclaration = declarations.find((declaration) => declaration.name?.text === "comptime");
  const embedDeclaration = declarations.find((declaration) => declaration.name?.text === "embed");
  const intrinsicSymbol = intrinsicDeclaration?.name
    ? resolveSymbol(checker, checker.getSymbolAtLocation(intrinsicDeclaration.name))
    : undefined;
  const embedSymbol = embedDeclaration?.name
    ? resolveSymbol(checker, checker.getSymbolAtLocation(embedDeclaration.name))
    : undefined;
  const checkedSchemaPrelude = program.getSourceFile(SCHEMA_PRELUDE_NAME);
  const schemaNamespace = checkedSchemaPrelude?.statements.find((statement): statement is ts.ModuleDeclaration =>
    ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name) && statement.name.text === "Schema");
  const schemaSymbol = schemaNamespace
    ? resolveSymbol(checker, checker.getSymbolAtLocation(schemaNamespace.name))
    : undefined;
  const deriveDeclaration = schemaNamespace?.body && ts.isModuleBlock(schemaNamespace.body)
    ? schemaNamespace.body.statements.find((statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === "derive")
    : undefined;
  const deriveSymbol = deriveDeclaration?.name
    ? resolveSymbol(checker, checker.getSymbolAtLocation(deriveDeclaration.name))
    : undefined;
  return { checker, entries: fileEntries, intrinsicSymbol, embedSymbol, schemaSymbol, deriveSymbol };
}

function collectImports(
  entry: ProjectEntry,
  checker: ts.TypeChecker,
  candidates: Set<string>,
  namespaceSymbols: Set<ts.Symbol>,
  replacements: Replacement[],
  diagnostics: ComptimeIntrinsicDiagnostic[],
): void {
  for (const statement of entry.file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (statement.moduleSpecifier.text === SCHEMA_MODULE_SPECIFIER) {
      collectSchemaImport(entry, checker, statement, namespaceSymbols, replacements, diagnostics);
      continue;
    }
    const exact = statement.moduleSpecifier.text === COMPTIME_MODULE_SPECIFIER;
    if (exact) replacements.push({
      start: statement.getStart(entry.file),
      end: statement.getEnd(),
      text: "",
      kind: "remove-import",
      authoredEntry: entry,
      mappedOrigin: statement,
      origins: [statement],
    });
    if (!clause) continue;
    if (clause.name) {
      if (clause.name.text === "comptime") candidates.add(clause.name.text);
      if (exact) diagnostics.push(diagnosticForNode(
        entry,
        clause.name,
        ComptimeIntrinsicDiagnosticCode.UnsupportedUse,
        "the compiler-owned comptime module has no default import",
      ));
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        const imported = element.propertyName?.text ?? element.name.text;
        if (imported === "comptime") candidates.add(element.name.text);
        if (exact && (!["comptime", "embed"].includes(imported) || clause.isTypeOnly || element.isTypeOnly)) {
          diagnostics.push(diagnosticForNode(
            entry,
            element,
            ComptimeIntrinsicDiagnosticCode.UnsupportedUse,
            "the compiler-owned module only exposes the value intrinsics named comptime and embed",
          ));
        }
      }
    } else if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      const raw = checker.getSymbolAtLocation(clause.namedBindings.name);
      if (exact && raw) namespaceSymbols.add(raw);
      if (exact && clause.isTypeOnly) diagnostics.push(diagnosticForNode(
        entry,
        clause.namedBindings,
        ComptimeIntrinsicDiagnosticCode.UnsupportedUse,
        "the compiler-owned comptime namespace is a value import",
      ));
    }
  }
}

/**
 * The compiler-owned schema module carries no runtime value: its import is
 * erased, and only files that derive a schema gain the generated runtime edge.
 */
function collectSchemaImport(
  entry: ProjectEntry,
  checker: ts.TypeChecker,
  statement: ts.ImportDeclaration,
  namespaceSymbols: Set<ts.Symbol>,
  replacements: Replacement[],
  diagnostics: ComptimeIntrinsicDiagnostic[],
): void {
  replacements.push({
    start: statement.getStart(entry.file),
    end: statement.getEnd(),
    text: "",
    kind: "remove-import",
    authoredEntry: entry,
    mappedOrigin: statement,
    origins: [statement],
  });
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(extname(entry.publicName).toLowerCase())) {
    diagnostics.push(diagnosticForNode(
      entry,
      statement,
      ComptimeIntrinsicDiagnosticCode.SchemaImportShape,
      `${JSON.stringify(SCHEMA_MODULE_SPECIFIER)} requires a TypeScript-family source because Schema.derive takes a type argument`,
    ));
  }
  const clause = statement.importClause;
  if (!clause) return;
  if (clause.name) {
    diagnostics.push(diagnosticForNode(
      entry,
      clause.name,
      ComptimeIntrinsicDiagnosticCode.SchemaImportShape,
      "the compiler-owned schema module has no default import",
    ));
  }
  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    for (const element of clause.namedBindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (imported !== "Schema" || clause.isTypeOnly || element.isTypeOnly) {
        diagnostics.push(diagnosticForNode(
          entry,
          element,
          ComptimeIntrinsicDiagnosticCode.SchemaImportShape,
          "the compiler-owned schema module only exposes the value namespace named Schema",
        ));
      }
    }
  } else if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
    const raw = checker.getSymbolAtLocation(clause.namedBindings.name);
    if (raw) namespaceSymbols.add(raw);
    if (clause.isTypeOnly) {
      diagnostics.push(diagnosticForNode(
        entry,
        clause.namedBindings,
        ComptimeIntrinsicDiagnosticCode.SchemaImportShape,
        "the compiler-owned schema namespace is a value import",
      ));
    }
  }
}

function resolveVirtualModule(
  containingFile: string,
  specifier: string,
  files: ReadonlyMap<string, ts.SourceFile>,
): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const exact = resolve(dirname(containingFile), specifier);
  const candidates = [exact];
  if (!extname(exact)) {
    for (const extension of [".ts", ".tsx", ".vibe", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]) {
      candidates.push(`${exact}${extension}`, resolve(exact, `index${extension}`));
    }
    candidates.push(`${exact}.vibe.ts`, resolve(exact, "index.vibe.ts"));
  }
  if (/\.(?:mjs|cjs|js)$/.test(exact)) {
    const stem = exact.replace(/\.(?:mjs|cjs|js)$/, "");
    candidates.push(`${stem}.ts`, `${stem}.mts`, `${stem}.cts`, `${stem}.vibe`, `${stem}.vibe.ts`);
  }
  if (exact.endsWith(".vibe")) candidates.push(`${exact}.ts`);
  return candidates.find((candidate) => files.has(candidate));
}

function safeVirtualName(name: string): string {
  if (typeof name !== "string" || name.length === 0 || name.includes("\0")) {
    throw new TypeError("comptime source names must be non-empty paths without NUL bytes");
  }
  const portable = name.replaceAll("\\", "/").replace(/^\/+/, "");
  // TypeScript will parse an explicitly provided unknown extension but does
  // not bind its imports. Give `.vibe` an internal `.ts` suffix while keeping
  // the authored name in all public diagnostics and identities.
  const internal = resolve(VIRTUAL_ROOT, portable.endsWith(".vibe") ? `${portable}.ts` : portable);
  const back = relative(VIRTUAL_ROOT, internal);
  if (back === ".." || back.startsWith(`..${sep}`) || isAbsolute(back)) {
    throw new TypeError(`comptime source name escaped the virtual project: ${name}`);
  }
  return internal;
}

function scriptKind(fileName: string): ts.ScriptKind {
  const extension = extname(fileName).toLowerCase();
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") return ts.ScriptKind.JS;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  return ts.ScriptKind.TS;
}

function extensionFor(fileName: string): ts.Extension {
  const extension = extname(fileName).toLowerCase();
  if (extension === ".js") return ts.Extension.Js;
  if (extension === ".jsx") return ts.Extension.Jsx;
  if (extension === ".mjs") return ts.Extension.Mjs;
  if (extension === ".cjs") return ts.Extension.Cjs;
  if (extension === ".tsx") return ts.Extension.Tsx;
  if (extension === ".mts") return ts.Extension.Mts;
  if (extension === ".cts") return ts.Extension.Cts;
  return ts.Extension.Ts;
}

function resolveSymbol(checker: ts.TypeChecker, symbol: ts.Symbol | undefined): ts.Symbol | undefined {
  let current = symbol;
  const seen = new Set<ts.Symbol>();
  while (current && (current.flags & ts.SymbolFlags.Alias) && !seen.has(current)) {
    seen.add(current);
    try {
      current = checker.getAliasedSymbol(current);
    } catch {
      return undefined;
    }
  }
  return current;
}

function callableSymbolNode(expression: ts.LeftHandSideExpression): ts.Node | undefined {
  if (ts.isIdentifier(expression)) return expression;
  if (ts.isPropertyAccessExpression(expression)) return expression.name;
  return undefined;
}

/**
 * The explicit comptime root a derive call sits directly under, ignoring
 * parentheses and type-only wrappers. Anything else is not a comptime root.
 */
function comptimeRootFor(
  node: ts.CallExpression,
  checker: ts.TypeChecker,
  intrinsicSymbol: ts.Symbol,
): ts.CallExpression | undefined {
  let current: ts.Node = node;
  while (
    current.parent && ts.isExpression(current as ts.Expression) &&
    (ts.isParenthesizedExpression(current.parent) || ts.isAsExpression(current.parent) ||
      ts.isSatisfiesExpression(current.parent) || ts.isNonNullExpression(current.parent) ||
      ts.isTypeAssertionExpression(current.parent))
  ) current = current.parent;
  const parent = current.parent;
  if (!parent || !ts.isCallExpression(parent) || parent.questionDotToken) return undefined;
  if (parent.arguments.length !== 1 || parent.arguments[0] !== current) return undefined;
  return resolvedCallSymbol(parent, checker) === intrinsicSymbol ? parent : undefined;
}

/** Spelling-only shape of a reification call, used to reject imposters. */
function looksLikeSchemaDerive(expression: ts.Expression): expression is ts.CallExpression {
  return ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === "derive" && (expression.typeArguments?.length ?? 0) > 0;
}

function looksLikeComptimeCall(expression: ts.LeftHandSideExpression, candidateNames: ReadonlySet<string>): boolean {
  if (ts.isIdentifier(expression)) return candidateNames.has(expression.text);
  return ts.isPropertyAccessExpression(expression) && expression.name.text === "comptime";
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current)
  ) current = current.expression;
  return current;
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text;
  }
  if (ts.isNumericLiteral(name)) return String(Number(name.text));
  return undefined;
}

function emitStaticLiteral(value: StableJson): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return canonical(value);
  }
  if (Array.isArray(value)) return `[${value.map(emitStaticLiteral).join(",")}]`;
  return `({${Object.keys(value).sort(compareStableStrings)
    .map((key) => `[${JSON.stringify(key)}]:${emitStaticLiteral(value[key]!)}`).join(",")}})`;
}

function emitStaticReplacement(value: StableJson, fileName: string): string {
  const literal = emitStaticLiteral(value);
  return [".js", ".jsx", ".mjs", ".cjs"].includes(extname(fileName).toLowerCase())
    ? literal
    : `(${literal} as const)`;
}

class SourceMapGenerationError extends Error {
  constructor(readonly entry: ProjectEntry, readonly start: number, message: string) {
    super(message);
    this.name = "SourceMapGenerationError";
  }
}

interface EmittedSpan {
  readonly generatedStart: number;
  readonly text: string;
  readonly origin: ProjectEntry;
  readonly originalStart: number;
  readonly exact: boolean;
}

interface PendingProvenanceEdit {
  readonly replacement: Replacement;
  /** Authored span the replacement text stands in for. */
  readonly authoredStart: number;
  readonly authoredEnd: number;
  readonly generatedStart: number;
  readonly generatedEnd: number;
}

/**
 * One replacement resolved into authored coordinates. `Replacement.start` and
 * `.end` are offsets into the DERIVED parse text, because they come from nodes
 * of the recovered source file; the lowered file is cut from the authored text,
 * so each span is mapped before anything reads it. `derivedStart` is kept only
 * so a failure can be reported through `makeDiagnostic`, which expects a
 * derived offset.
 */
interface AuthoredReplacement {
  readonly replacement: Replacement;
  readonly derivedStart: number;
  readonly start: number;
  readonly end: number;
}

function lowerProject(
  entries: readonly ProjectEntry[],
  replacements: ReadonlyMap<ProjectEntry, readonly Replacement[]>,
): Readonly<Record<string, ComptimeLoweredFile>> {
  const entryByFile = new Map(entries.map((entry) => [entry.file, entry]));
  const output: Record<string, ComptimeLoweredFile> = Object.create(null);
  for (const entry of entries) output[entry.publicName] = lowerFile(entry, replacements.get(entry) ?? [], entryByFile);
  return Object.freeze(output);
}

function lowerFile(
  entry: ProjectEntry,
  replacements: readonly Replacement[],
  entryByFile: ReadonlyMap<ts.SourceFile, ProjectEntry>,
): ComptimeLoweredFile {
  const ordered: AuthoredReplacement[] = replacements
    .map((replacement) => ({
      replacement,
      derivedStart: replacement.start,
      start: toAuthoredStart(entry, replacement.start),
      end: toAuthoredEnd(entry, replacement.end),
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const parts: string[] = [];
  const spans: EmittedSpan[] = [];
  const pendingEdits: PendingProvenanceEdit[] = [];
  const sourceEntries = new Set<ProjectEntry>([entry]);
  let authoredCursor = 0;
  let generatedCursor = 0;

  const appendExact = (start: number, end: number): void => {
    const text = entry.source.slice(start, end);
    if (text.length === 0) return;
    parts.push(text);
    spans.push({ generatedStart: generatedCursor, text, origin: entry, originalStart: start, exact: true });
    generatedCursor += text.length;
  };

  for (const { replacement, derivedStart, start, end } of ordered) {
    if (
      replacement.authoredEntry !== entry || start < authoredCursor || end < start ||
      end > entry.source.length
    ) {
      throw new SourceMapGenerationError(entry, Math.max(0, derivedStart), "overlapping or invalid comptime source replacement");
    }
    const mappedEntry = entryByFile.get(replacement.mappedOrigin.getSourceFile());
    if (!mappedEntry) {
      throw new SourceMapGenerationError(entry, derivedStart, "comptime replacement origin is outside the checked project");
    }
    sourceEntries.add(mappedEntry);
    for (const origin of replacement.origins) {
      const originEntry = entryByFile.get(origin.getSourceFile());
      if (!originEntry) {
        throw new SourceMapGenerationError(entry, derivedStart, "comptime provenance origin is outside the checked project");
      }
      sourceEntries.add(originEntry);
    }

    appendExact(authoredCursor, start);
    const generatedStart = generatedCursor;
    if (replacement.text.length > 0) {
      parts.push(replacement.text);
      spans.push({
        generatedStart,
        text: replacement.text,
        origin: mappedEntry,
        originalStart: toAuthoredStart(mappedEntry, replacement.mappedOrigin.getStart(mappedEntry.file)),
        exact: false,
      });
      generatedCursor += replacement.text.length;
    }
    pendingEdits.push({ replacement, authoredStart: start, authoredEnd: end, generatedStart, generatedEnd: generatedCursor });
    authoredCursor = end;
  }
  appendExact(authoredCursor, entry.source.length);

  const code = parts.join("");
  if (code.length > MAX_SOURCE_MAP_UNITS) {
    throw new SourceMapGenerationError(
      entry,
      0,
      `comptime source map exceeds the ${MAX_SOURCE_MAP_UNITS} UTF-16 unit POC limit`,
    );
  }

  const orderedSources = [
    entry,
    ...[...sourceEntries].filter((source) => source !== entry)
      .sort((left, right) => compareStableStrings(left.publicName, right.publicName)),
  ];
  const sourceIndex = new Map(orderedSources.map((source, index) => [source, index]));
  const lineStarts = new Map(orderedSources.map((source) => [source, computeLineStarts(source.source)]));
  const generatedLineStarts = computeLineStarts(code);
  const mappingsByCoordinate = new Map<string, SourceMapping>();
  const addMapping = (generatedOffset: number, origin: ProjectEntry, originalOffset: number): void => {
    if (generatedOffset < 0 || generatedOffset > code.length || originalOffset < 0 || originalOffset > origin.source.length) {
      throw new SourceMapGenerationError(entry, 0, "comptime source map contains an out-of-range coordinate");
    }
    const generated = locateOffset(generatedLineStarts, generatedOffset);
    const original = locateOffset(lineStarts.get(origin)!, originalOffset);
    mappingsByCoordinate.set(`${generated.line}:${generated.column}`, {
      generatedLine: generated.line,
      generatedColumn: generated.column,
      source: sourceIndex.get(origin)!,
      originalLine: original.line,
      originalColumn: original.column,
    });
  };

  for (const span of spans) {
    for (let offset = 0; offset < span.text.length; offset++) {
      if (isLineBreakUnit(span.text, offset)) continue;
      addMapping(
        span.generatedStart + offset,
        span.origin,
        span.exact ? span.originalStart + offset : span.originalStart,
      );
    }
  }
  for (const edit of pendingEdits) {
    // This boundary is the only generated representation of an erased import.
    // For a replaced call it also restores exact attribution for following text.
    addMapping(edit.generatedEnd, entry, edit.authoredEnd);
  }
  addMapping(code.length, entry, entry.source.length);

  const mappings = encodeSourceMappings([...mappingsByCoordinate.values()]);
  const edits = pendingEdits.map(({ replacement, authoredStart, authoredEnd, generatedStart, generatedEnd }) => Object.freeze({
    kind: replacement.kind,
    generated: generatedRange(code, generatedLineStarts, generatedStart, generatedEnd),
    authored: sourceRange(entry, authoredStart, authoredEnd, lineStarts.get(entry)!),
    mappedOrigin: rangeForNode(replacement.mappedOrigin, entryByFile, lineStarts),
    origins: Object.freeze(uniqueOriginRanges(replacement.origins, entryByFile, lineStarts)),
    replacementDigest: digest(replacement.text),
  } satisfies ComptimeLoweringEdit));
  const provenance = Object.freeze({
    schema: "vibelang.comptime-lowering/v1",
    frontend: "vibelang-comptime-static@2",
    file: entry.publicName,
    authoredDigest: digest(entry.source),
    loweredDigest: digest(code),
    edits: Object.freeze(edits),
  } satisfies ComptimeLoweringProvenance);
  const sourceMap = canonical({
    version: 3,
    file: entry.publicName,
    sourceRoot: "",
    sources: orderedSources.map((source) => source.publicName),
    sourcesContent: orderedSources.map((source) => source.source),
    names: [],
    mappings,
    x_vibelang_comptime: provenance,
  });
  if (Buffer.byteLength(sourceMap, "utf8") > MAX_SOURCE_MAP_BYTES) {
    throw new SourceMapGenerationError(
      entry,
      0,
      `comptime source map exceeds the ${MAX_SOURCE_MAP_BYTES} byte POC limit`,
    );
  }
  const identity = digest({
    schema: "vibelang.comptime-lowered-file/v1",
    file: entry.publicName,
    authoredDigest: provenance.authoredDigest,
    loweredDigest: provenance.loweredDigest,
    sourceMapDigest: digest(sourceMap),
    provenanceDigest: digest(provenance),
  });
  return Object.freeze({ fileName: entry.publicName, code, sourceMap, provenance, identity });
}

function generatedRange(
  code: string,
  starts: readonly number[],
  start: number,
  end: number,
): ComptimeGeneratedRange {
  if (start < 0 || end < start || end > code.length) throw new TypeError("invalid generated comptime range");
  const first = locateOffset(starts, start);
  const last = locateOffset(starts, end);
  return Object.freeze({
    start,
    end,
    line: first.line + 1,
    column: first.column + 1,
    endLine: last.line + 1,
    endColumn: last.column + 1,
  });
}

/** `start` and `end` are AUTHORED offsets. */
function sourceRange(
  entry: ProjectEntry,
  start: number,
  end: number,
  starts: readonly number[],
): ComptimeSourceRange {
  if (start < 0 || end < start || end > entry.source.length) {
    // `SourceMapGenerationError` carries a derived offset, because the handler
    // reports it through `makeDiagnostic`.
    const derived = entry.recovery.toDerived(Math.max(0, start)) ?? Math.max(0, start);
    throw new SourceMapGenerationError(entry, derived, "invalid authored comptime provenance range");
  }
  const first = locateOffset(starts, start);
  const last = locateOffset(starts, end);
  return Object.freeze({
    file: entry.publicName,
    start,
    end,
    line: first.line + 1,
    column: first.column + 1,
    endLine: last.line + 1,
    endColumn: last.column + 1,
  });
}

function rangeForNode(
  node: ts.Node,
  entryByFile: ReadonlyMap<ts.SourceFile, ProjectEntry>,
  lineStarts: ReadonlyMap<ProjectEntry, readonly number[]>,
): ComptimeSourceRange {
  const entry = entryByFile.get(node.getSourceFile());
  if (!entry) throw new TypeError("comptime provenance node is outside the checked project");
  return sourceRange(
    entry,
    toAuthoredStart(entry, node.getStart(entry.file)),
    toAuthoredEnd(entry, node.getEnd()),
    lineStarts.get(entry)!,
  );
}

function uniqueOriginRanges(
  nodes: readonly ts.Node[],
  entryByFile: ReadonlyMap<ts.SourceFile, ProjectEntry>,
  lineStarts: ReadonlyMap<ProjectEntry, readonly number[]>,
): readonly ComptimeSourceRange[] {
  const ranges = nodes.map((node) => rangeForNode(node, entryByFile, lineStarts));
  const unique = new Map(ranges.map((range) => [`${range.file}\0${range.start}\0${range.end}`, range]));
  return [...unique.values()].sort((left, right) =>
    compareStableStrings(left.file, right.file) || left.start - right.start || left.end - right.end);
}

function computeLineStarts(text: string): readonly number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 13) {
      if (text.charCodeAt(index + 1) === 10) index++;
      starts.push(index + 1);
    } else if (code === 10 || code === 0x2028 || code === 0x2029) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function locateOffset(starts: readonly number[], offset: number): { readonly line: number; readonly column: number } {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle]! <= offset) low = middle;
    else high = middle;
  }
  return { line: low, column: offset - starts[low]! };
}

function isLineBreakUnit(text: string, offset: number): boolean {
  const code = text.charCodeAt(offset);
  return code === 10 || code === 13 || code === 0x2028 || code === 0x2029;
}

function encodeSourceMappings(mappings: readonly SourceMapping[]): string {
  const ordered = [...mappings].sort((left, right) =>
    left.generatedLine - right.generatedLine || left.generatedColumn - right.generatedColumn);
  const maximumLine = ordered.at(-1)?.generatedLine ?? 0;
  const lines: string[] = [];
  let index = 0;
  let previousSource = 0;
  let previousOriginalLine = 0;
  let previousOriginalColumn = 0;
  for (let line = 0; line <= maximumLine; line++) {
    let previousGeneratedColumn = 0;
    const segments: string[] = [];
    while (ordered[index]?.generatedLine === line) {
      const mapping = ordered[index++]!;
      segments.push(
        encodeSourceMapVlq(mapping.generatedColumn - previousGeneratedColumn) +
        encodeSourceMapVlq(mapping.source - previousSource) +
        encodeSourceMapVlq(mapping.originalLine - previousOriginalLine) +
        encodeSourceMapVlq(mapping.originalColumn - previousOriginalColumn),
      );
      previousGeneratedColumn = mapping.generatedColumn;
      previousSource = mapping.source;
      previousOriginalLine = mapping.originalLine;
      previousOriginalColumn = mapping.originalColumn;
    }
    lines.push(segments.join(","));
  }
  return lines.join(";");
}

function encodeSourceMapVlq(value: number): string {
  if (!Number.isSafeInteger(value)) throw new TypeError("source-map coordinate is not a safe integer");
  let current = Math.abs(value) * 2 + (value < 0 ? 1 : 0);
  let encoded = "";
  do {
    let digit = current % 32;
    current = Math.floor(current / 32);
    if (current > 0) digit += 32;
    encoded += SOURCE_MAP_BASE64[digit];
  } while (current > 0);
  return encoded;
}

function visit(root: ts.Node, callback: (node: ts.Node) => void): void {
  callback(root);
  ts.forEachChild(root, (child) => visit(child, callback));
}

function visitSkippingImports(root: ts.Node, callback: (node: ts.Node) => void): void {
  if (ts.isImportDeclaration(root)) return;
  callback(root);
  ts.forEachChild(root, (child) => visitSkippingImports(child, callback));
}

function markTree(root: ts.Node, output: Set<ts.Node>): void {
  output.add(root);
  ts.forEachChild(root, (child) => markTree(child, output));
}

function diagnosticForNode(
  entry: ProjectEntry,
  node: ts.Node,
  code: ComptimeIntrinsicDiagnostic["code"],
  message: string,
): ComptimeIntrinsicDiagnostic {
  const start = node.getStart(entry.file);
  return makeDiagnostic(entry, start, Math.max(1, node.getEnd() - start), code, message);
}

/** `start` is a DERIVED offset; the reported location is authored. */
function makeDiagnostic(
  entry: ProjectEntry,
  start: number,
  length: number,
  code: ComptimeIntrinsicDiagnostic["code"],
  message: string,
): ComptimeIntrinsicDiagnostic {
  const safeStart = Math.min(Math.max(0, start), entry.parseSource.length);
  const authored = Math.min(Math.max(0, toAuthoredStart(entry, safeStart)), entry.source.length);
  const location = locateOffset(entry.authoredLineStarts, authored);
  return Object.freeze({
    code,
    severity: "error",
    message,
    file: entry.publicName,
    line: location.line + 1,
    column: location.column + 1,
    length: Math.max(1, length),
  });
}

function sortDiagnostics(diagnostics: ComptimeIntrinsicDiagnostic[]): void {
  diagnostics.sort((left, right) =>
    compareStableStrings(left.file, right.file) || left.line - right.line || left.column - right.column ||
    compareStableStrings(left.code, right.code) || compareStableStrings(left.message, right.message));
}

function failedResult(diagnostics: readonly ComptimeIntrinsicDiagnostic[]): ComptimeIntrinsicResult {
  return Object.freeze({
    ok: false,
    calls: Object.freeze([]),
    diagnostics: Object.freeze([...diagnostics]),
  });
}
