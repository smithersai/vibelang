/**
 * Host option tables and a thin adapter to native configuration validation.
 *
 * compatibility.mdx's Mandatory/Forbidden lists are language rules, not host
 * preferences. The Go gate checks the authored JSON AST; this module holds no
 * parser, checker or compiler-library objects. The tables remain available to
 * compiler callers and are checked for exact agreement with the native tables.
 *
 * Imported ordinary TypeScript retains its own configuration. The mandatory
 * defaults apply to authored VibeLang legality, not to every resolved library
 * implementation or to the compiler's own emitted class/import representation.
 */
import { getNativeCompiler } from "../compiler/native.ts";

/**
 * §Mandatory, verbatim, in the specification's own order.
 *
 * Every one is a boolean that MUST be `true`; §Configuration's first paragraph
 * forbids varying them by JavaScript host, so there is no "recommended" tier and
 * no per-target override. `strict` is listed for the same reason as the other
 * five even though it is the one option the product already set: a table that
 * omitted it could not diagnose a `tsconfig.json` that turned it off.
 */
export const MANDATORY_COMPILER_OPTIONS: readonly string[] = [
  "strict",
  "noUncheckedIndexedAccess",
  "exactOptionalPropertyTypes",
  "isolatedModules",
  "verbatimModuleSyntax",
  "useDefineForClassFields",
];

/**
 * §Forbidden, verbatim, in the specification's own order.
 *
 * "Options that upstream has deprecated or removed, and options that select
 * superseded behavior, MUST be rejected rather than ignored." Rejected, not
 * defaulted: setting `experimentalDecorators: false` is still an error, because
 * the obligation is about the option appearing in a VibeLang project's
 * configuration at all, not about the behavior a particular value selects.
 */
export const FORBIDDEN_COMPILER_OPTIONS: readonly string[] = [
  "keyofStringsOnly",
  "suppressImplicitAnyIndexErrors",
  "suppressExcessPropertyErrors",
  "noStrictGenericChecks",
  "noImplicitUseStrict",
  "out",
  "charset",
  "importsNotUsedAsValues",
  "preserveValueImports",
  "experimentalDecorators",
  "emitDecoratorMetadata",
];

/**
 * The mandatory set as checker input.
 *
 * Every program that decides `.vibe` legality spreads this rather than restating
 * its members. Before this constant existed the five checker literals had
 * already drifted from one another — `poc/src/durable/source-compiler.ts` omits
 * `allowJs`, `checkJs`, `jsx`, and `allowImportingTsExtensions` and sets
 * `types: []` — which is the failure mode a shared spread removes for the
 * options that carry language semantics.
 */
export const MANDATORY_CHECKER_OPTIONS: Readonly<Record<string, boolean>> = Object.freeze({
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  isolatedModules: true,
  verbatimModuleSyntax: true,
  useDefineForClassFields: true,
});

/** A `tsconfig.json` finding, positioned in the configuration file itself. */
export interface CompilerOptionDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly fileName: string;
  /** Zero-based UTF-16 offset into the configuration file's text. */
  readonly start: number;
  readonly length: number;
  readonly line: number;
  readonly column: number;
}

/**
 * Names a VibeLang project MAY set beyond the mandatory table.
 *
 * §Emit-Scoped's list plus the small set the compiler itself needs to be told
 * about a project. This is what makes VIBE6003 possible: without a positive
 * list, an unknown option is indistinguishable from a forbidden one that the
 * specification has not gotten around to naming, and the fail-closed reading of
 * §Forbidden's "MUST be rejected rather than ignored" is that an option nobody
 * has classified is not silently honored.
 */
const PERMITTED_COMPILER_OPTIONS: readonly string[] = [
  // §Emit-Scoped, verbatim.
  "target",
  "lib",
  "module",
  "moduleResolution",
  "jsx",
  "downlevelIteration",
  "importHelpers",
  "esModuleInterop",
  "allowSyntheticDefaultImports",
  // Project layout and emit products. None selects language legality.
  "rootDir",
  "outDir",
  "baseUrl",
  "paths",
  "types",
  "typeRoots",
  "declaration",
  "declarationMap",
  "declarationDir",
  "sourceMap",
  "inlineSources",
  "inlineSourceMap",
  "noEmit",
  "noEmitOnError",
  "emitDeclarationOnly",
  "removeComments",
  "newLine",
  "preserveConstEnums",
  "incremental",
  "composite",
  "tsBuildInfoFile",
  "skipLibCheck",
  "skipDefaultLibCheck",
  "allowJs",
  "checkJs",
  "resolveJsonModule",
  "allowImportingTsExtensions",
  "rewriteRelativeImportExtensions",
  "forceConsistentCasingInFileNames",
  "moduleDetection",
  "allowArbitraryExtensions",
  "customConditions",
  "noErrorTruncation",
  "pretty",
  // Additional soundness options. A project MAY tighten beyond the mandatory
  // set; it MUST NOT loosen below it.
  "noImplicitOverride",
  "noImplicitReturns",
  "noFallthroughCasesInSwitch",
  "noPropertyAccessFromIndexSignature",
  "noUnusedLocals",
  "noUnusedParameters",
  "allowUnreachableCode",
  "allowUnusedLabels",
  "strictNullChecks",
  "strictFunctionTypes",
  "strictBindCallApply",
  "strictPropertyInitialization",
  "strictBuiltinIteratorReturn",
  "noImplicitAny",
  "noImplicitThis",
  "alwaysStrict",
  "useUnknownInCatchVariables",
  // Compiler-owned inputs the bridge accepts as options rather than as request
  // fields.
  "comptimeTarget",
  "vibelangEffectManifest",
];

const permitted = new Set(PERMITTED_COMPILER_OPTIONS);
const mandatory = new Set(MANDATORY_COMPILER_OPTIONS);
const forbidden = new Set(FORBIDDEN_COMPILER_OPTIONS);

/** Whether `name` is a name a VibeLang project may mention at all. */
export function isKnownCompilerOption(name: string): boolean {
  return permitted.has(name) || mandatory.has(name) || forbidden.has(name);
}

/**
 * Validate the caller's own configuration with the pinned native JSON parser
 * and option gate. No extends file is followed and no compiler objects enter
 * this process. The host only adapts authored UTF-16 positions for the CLI.
 */
export function validateVibeLangTsconfig(
  fileName: string,
  text: string,
): readonly CompilerOptionDiagnostic[] {
  const diagnostics = getNativeCompiler().validateConfig({ path: fileName, text }).diagnostics;
  if (diagnostics.length === 0) return [];
  // Build this once: thousands of diagnostics after a large comment must not
  // repeatedly scan the entire source prefix.
  const starts = [0];
  for (const match of text.matchAll(/\r\n|[\n\r\u2028\u2029]/g)) starts.push(match.index + match[0].length);
  return diagnostics.map(issue => {
    const start = issue.span!.start;
    let low = 0, high = starts.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (starts[middle]! <= start) low = middle; else high = middle;
    }
    return {
      code: issue.code, message: issue.message, fileName,
      start, length: issue.span!.length, line: low + 1, column: start - starts[low]! + 1,
    };
  });
}
