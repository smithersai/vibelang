/**
 * THE ONE TABLE of compiler options `.sm` legality depends on, and the only
 * validator over a project's `tsconfig.json`.
 *
 * [Compatibility](/specification/compatibility) §Mandatory and §Forbidden are
 * normative lists, and before this module neither was represented anywhere in
 * the product. `strict: true` was the sole member of the mandatory set that any
 * checker literal set, it was spelled independently in each of them, and no
 * `tsconfig.json` was read by either backend at all — no `readConfigFile`,
 * `parseJsonConfigFileContent`, `findConfigFile`, or
 * `getParsedCommandLineOfConfigFile` call existed in `src/` or `poc/src/`. The
 * CLI declared `--project`/`-p` as "Path to tsconfig.json or its directory" and
 * then either forwarded the string to a spawned `tsc` (non-`.sm` inputs) or
 * refused it outright as an unsupported option (`.sm` inputs). Neither branch
 * ever opened the file.
 *
 * The Go fork was not equally silent, and the register's claim that "none of
 * the eleven forbidden options is rejected" was wrong for it: its bridge has had
 * a closed allowlist over its options map since it was written, so
 * `experimentalDecorators` was already refused there. It was refused as a bare
 * `fmt.Errorf("unsupported compiler option %q", name)` travelling in the
 * envelope's `Error` field rather than in `Result.Diagnostics` — no code, no
 * file, no span — and the same arm refused the five missing MANDATORY options as
 * "unsupported" rather than requiring them. That allowlist is reused rather than
 * replaced: {@link FORBIDDEN_COMPILER_OPTIONS} and
 * {@link MANDATORY_COMPILER_OPTIONS} are mirrored into it, and
 * `compiler/forkbridge_options_test.go` fails if the two tables ever drift.
 *
 * WHY THE OPTIONS ARE NOT SPREAD OVER THE EMITTED PROGRAM'S RESOLVED IMPORTS.
 * §Configuration's second paragraph — "Imported `.ts` and `.tsx` keep their own
 * configuration. The escape-hatch guarantee in this page protects those files,
 * not `.sm`" — is load-bearing and was measured. Turning the five missing
 * options on inside {@link checkEmittedProject} without scoping moved **150 of
 * 515** conformance cases, and 143 of those 150 were one fact: this repository's
 * own runtime library, `poc/src/runtime/errors.ts` and `poc/src/runtime/wire.ts`,
 * does not type-check under `exactOptionalPropertyTypes`, so every case whose
 * emitted program resolved the runtime was rejected with a `TS2345` in a file
 * the authored program does not own and no expectation can name. The conformance
 * harness was already reporting those as integrity violations rather than
 * verdicts. Scoping the emitted check's diagnostics to the files the caller
 * handed it — the emitted `.sm` set — takes the same measurement to **7 of
 * 515**: two from the `!` provenance walk and five genuine authored
 * `noUncheckedIndexedAccess` violations in the corpus itself.
 */
import * as ts from "typescript-js";

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
 * the obligation is about the option appearing in a Smithers project's
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
 * Every program that decides `.sm` legality spreads this rather than restating
 * its members. Before this constant existed the five checker literals had
 * already drifted from one another — `poc/src/durable/source-compiler.ts` omits
 * `allowJs`, `checkJs`, `jsx`, and `allowImportingTsExtensions` and sets
 * `types: []` — which is the failure mode a shared spread removes for the
 * options that carry language semantics.
 */
export const MANDATORY_CHECKER_OPTIONS: ts.CompilerOptions = Object.freeze({
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  isolatedModules: true,
  verbatimModuleSyntax: true,
  useDefineForClassFields: true,
});

/** A `tsconfig.json` finding, positioned in the configuration file itself. */
export interface CompilerOptionDiagnostic {
  readonly code: "SMITHERS6001" | "SMITHERS6002" | "SMITHERS6003";
  readonly message: string;
  readonly fileName: string;
  /** Zero-based UTF-16 offset into the configuration file's text. */
  readonly start: number;
  readonly length: number;
  readonly line: number;
  readonly column: number;
}

/**
 * Names a Smithers project MAY set beyond the mandatory table.
 *
 * §Emit-Scoped's list plus the small set the compiler itself needs to be told
 * about a project. This is what makes SMITHERS6003 possible: without a positive
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
  "smithersEffectManifest",
];

const permitted = new Set(PERMITTED_COMPILER_OPTIONS);
const mandatory = new Set(MANDATORY_COMPILER_OPTIONS);
const forbidden = new Set(FORBIDDEN_COMPILER_OPTIONS);

/** Whether `name` is a name a Smithers project may mention at all. */
export function isKnownCompilerOption(name: string): boolean {
  return permitted.has(name) || mandatory.has(name) || forbidden.has(name);
}

function lineAndColumn(file: ts.SourceFile, start: number): { line: number; column: number } {
  const { line, character } = file.getLineAndCharacterOfPosition(start);
  return { line: line + 1, column: character + 1 };
}

/**
 * The `compilerOptions` object of a parsed `tsconfig.json`, as syntax.
 *
 * Read from the JSON AST rather than from `parseJsonConfigFileContent`'s
 * normalized bag because the normalized bag has no positions: §Forbidden's
 * obligation is to point at the option the author wrote, and a diagnostic
 * without a span cannot. `ts.parseJsonText` keeps the property nodes, so
 * SMITHERS6002 lands on the offending name and SMITHERS6001 lands on the
 * `compilerOptions` object that failed to contain one.
 */
function compilerOptionsObject(file: ts.JsonSourceFile): ts.ObjectLiteralExpression | undefined {
  const root = file.statements[0]?.expression;
  if (!root || !ts.isObjectLiteralExpression(root)) return undefined;
  for (const property of root.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = property.name;
    if (!ts.isStringLiteral(name) || name.text !== "compilerOptions") continue;
    return ts.isObjectLiteralExpression(property.initializer) ? property.initializer : undefined;
  }
  return undefined;
}

/**
 * Validate one `tsconfig.json` against §Mandatory and §Forbidden.
 *
 * `extends` is deliberately NOT followed. A base configuration is a different
 * file with a different span, and a diagnostic that pointed into a file the
 * author did not write would be worse than one that asks them to state the
 * obligation in the project that claims to be a Smithers project.
 * §Configuration's "MUST therefore be mandatory and MUST NOT vary by JavaScript
 * host" is a property of the project, so the project's own file is where it is
 * checked.
 */
export function validateSmithersTsconfig(
  fileName: string,
  text: string,
): readonly CompilerOptionDiagnostic[] {
  const file = ts.parseJsonText(fileName, text);
  const diagnostics: CompilerOptionDiagnostic[] = [];
  const at = (
    code: CompilerOptionDiagnostic["code"],
    message: string,
    start: number,
    length: number,
  ): void => {
    diagnostics.push({ code, message, fileName, start, length, ...lineAndColumn(file, start) });
  };

  const options = compilerOptionsObject(file);
  if (!options) {
    const start = file.statements[0]?.expression?.getStart(file) ?? 0;
    for (const name of MANDATORY_COMPILER_OPTIONS) {
      at(
        "SMITHERS6001",
        `a Smithers project MUST set '${name}: true'; this tsconfig has no compilerOptions`,
        start,
        Math.max(1, (file.statements[0]?.expression?.getEnd() ?? text.length) - start),
      );
    }
    return diagnostics;
  }

  const seen = new Map<string, ts.PropertyAssignment>();
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const nameNode = property.name;
    if (!ts.isStringLiteral(nameNode)) continue;
    seen.set(nameNode.text, property);
  }

  // §Forbidden and the unknown-name arm run over what the author wrote, in the
  // order they wrote it, so a configuration with several problems reports them
  // top to bottom rather than in table order.
  for (const [name, property] of seen) {
    const nameNode = property.name;
    const start = nameNode.getStart(file);
    const length = nameNode.getEnd() - start;
    if (forbidden.has(name)) {
      at(
        "SMITHERS6002",
        `'${name}' is a forbidden compiler option in a Smithers project and MUST be removed rather than set to a value`,
        start,
        length,
      );
      continue;
    }
    if (!isKnownCompilerOption(name)) {
      at("SMITHERS6003", `unsupported compiler option '${name}' in a Smithers project`, start, length);
    }
  }

  // §Mandatory runs over the table, so a missing option is reported even though
  // there is no syntax to point at. The span is the `compilerOptions` object
  // that should have contained it.
  const objectStart = options.getStart(file);
  const objectLength = options.getEnd() - objectStart;
  for (const name of MANDATORY_COMPILER_OPTIONS) {
    const property = seen.get(name);
    if (!property) {
      at("SMITHERS6001", `a Smithers project MUST set '${name}: true'`, objectStart, objectLength);
      continue;
    }
    if (property.initializer.kind !== ts.SyntaxKind.TrueKeyword) {
      const start = property.name.getStart(file);
      at(
        "SMITHERS6001",
        `a Smithers project MUST set '${name}: true'`,
        start,
        property.initializer.getEnd() - start,
      );
    }
  }

  return diagnostics;
}
