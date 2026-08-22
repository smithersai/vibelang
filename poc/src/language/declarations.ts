import { dirname, resolve } from "node:path";
import * as ts from "typescript-js";
import type { FunctionRows } from "./model.ts";

export const DECLARATION_EFFECT_TAG = "vibeEffects";
export const DECLARATION_EFFECT_VERSION = 1 as const;

export interface DeclarationSource {
  readonly fileName: string;
  readonly code: string;
  /** Compiler-inferred rows to preserve for exported function declarations. */
  readonly effects?: Readonly<Record<string, FunctionRows>>;
}

export interface DeclarationOutput {
  readonly fileName: string;
  readonly code: string;
}

export interface DeclarationEmitResult {
  readonly outputs: readonly DeclarationOutput[];
  readonly diagnostics: readonly ts.Diagnostic[];
  readonly ok: boolean;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function declarationOutputName(fileName: string): string {
  if (/\.(?:mts|mjs)$/.test(fileName)) return fileName.replace(/\.(?:mts|mjs)$/, ".d.mts");
  if (/\.(?:cts|cjs)$/.test(fileName)) return fileName.replace(/\.(?:cts|cjs)$/, ".d.cts");
  return fileName.replace(/\.(?:tsx?|jsx?)$/, ".d.ts");
}

/**
 * A row member is an identifier, optionally module-qualified as
 * `Name@module/path` when two project modules declare the same nominal name.
 * The qualifier mirrors the module identity used for runtime Error
 * registration, so declaration metadata and runtime identities agree.
 */
const ROW_MEMBER = /^[$A-Z_a-z][$0-9A-Z_a-z]*(?:@[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*)?$/;

function isRowMemberName(item: unknown): boolean {
  return typeof item === "string" && item.length <= 256 && ROW_MEMBER.test(item);
}

function exactSortedNames(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 1_024 || !value.every(isRowMemberName)) {
    throw new TypeError(`${label} must be an array of identifier names`);
  }
  const sorted = [...value].sort(compareText);
  if (sorted.some((item, index) => item !== value[index]) || new Set(sorted).size !== sorted.length) {
    throw new TypeError(`${label} must be sorted and unique`);
  }
  return Object.freeze(sorted);
}

function canonicalNames(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 1_024 || !value.every(isRowMemberName)) {
    throw new TypeError(`${label} must be an array of identifier names`);
  }
  const sorted = [...value].sort(compareText);
  if (new Set(sorted).size !== sorted.length) throw new TypeError(`${label} must be unique`);
  return Object.freeze(sorted);
}

function statementDeclarationName(statement: ts.Statement): string | undefined {
  if (ts.isFunctionDeclaration(statement) && statement.name) return statement.name.text;
  if (ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1) {
    const declaration = statement.declarationList.declarations[0]!;
    return ts.isIdentifier(declaration.name) ? declaration.name.text : undefined;
  }
  return undefined;
}

function hasExportModifier(statement: ts.Statement): boolean {
  return ts.canHaveModifiers(statement) &&
    Boolean(ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

interface ChannelTypeReference {
  readonly head: string;
  readonly arguments: readonly ts.TypeNode[];
  readonly rebuild: (arguments_: readonly ts.TypeNode[]) => ts.TypeNode;
}

function splitEffectVariableStatements(
  code: string,
  effects: Readonly<Record<string, FunctionRows>>,
  fileName: string,
): string {
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const statements: ts.Statement[] = [];
  let changed = false;
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length < 2 ||
      !statement.declarationList.declarations.some((declaration) =>
        ts.isIdentifier(declaration.name) && Object.hasOwn(effects, declaration.name.text))) {
      statements.push(statement);
      continue;
    }
    changed = true;
    for (const declaration of statement.declarationList.declarations) {
      statements.push(ts.factory.createVariableStatement(
        statement.modifiers,
        ts.factory.createVariableDeclarationList([declaration], statement.declarationList.flags),
      ));
    }
  }
  return changed
    ? ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(
        ts.factory.updateSourceFile(sourceFile, statements),
      )
    : code;
}

function channelTypeReference(
  node: ts.TypeNode,
  sourceFile: ts.SourceFile,
  factory: ts.NodeFactory,
): ChannelTypeReference | undefined {
  if (ts.isTypeReferenceNode(node) && node.typeArguments &&
    (ts.isIdentifier(node.typeName) ? node.typeName.text : node.typeName.right.text) === "Result") {
    return {
      head: `reference:${node.typeName.getText(sourceFile)}`,
      arguments: node.typeArguments,
      rebuild: (arguments_) => factory.updateTypeReferenceNode(node, node.typeName, factory.createNodeArray(arguments_)),
    };
  }
  if (ts.isImportTypeNode(node) && node.qualifier && node.typeArguments &&
    (ts.isIdentifier(node.qualifier) ? node.qualifier.text : node.qualifier.right.text) === "Result") {
    return {
      head: `import:${node.argument.getText(sourceFile)}:${node.qualifier.getText(sourceFile)}`,
      arguments: node.typeArguments,
      rebuild: (arguments_) => factory.updateImportTypeNode(
        node,
        node.argument,
        node.attributes,
        node.qualifier,
        factory.createNodeArray(arguments_),
        node.isTypeOf,
      ),
    };
  }
  return undefined;
}

function combinedType(
  values: readonly ts.TypeNode[],
  sourceFile: ts.SourceFile,
  factory: ts.NodeFactory,
): ts.TypeNode {
  const nonNever = values.filter((value) => value.kind !== ts.SyntaxKind.NeverKeyword);
  const unique = new Map<string, ts.TypeNode>();
  for (const value of nonNever) unique.set(value.getText(sourceFile), value);
  const nodes = [...unique.values()];
  if (nodes.length === 0) return factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword);
  if (nodes.length === 1) return nodes[0]!;
  return factory.createUnionTypeNode(nodes);
}

/** Collapse compiler-generated unions such as Result<A, never> | Result<never, E>. */
export function normalizeDeclarationEffectChannels(
  code: string,
  effects: Readonly<Record<string, FunctionRows>>,
  fileName = "module.d.mts",
): string {
  code = splitEffectVariableStatements(code, effects, fileName);
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let changed = false;
  const transformed = ts.transform(sourceFile, [(context) => {
    const visitType: ts.Visitor = (node) => {
      if (ts.isUnionTypeNode(node)) {
        const references = node.types.map((type) => channelTypeReference(type, sourceFile, context.factory));
        if (references.every((reference): reference is ChannelTypeReference => reference !== undefined) &&
          references.length > 1 && references.every((reference) =>
            reference.head === references[0]!.head && reference.arguments.length === 2)) {
          changed = true;
          return references[0]!.rebuild([
            combinedType(references.map((reference) => reference.arguments[0]!), sourceFile, context.factory),
            combinedType(references.map((reference) => reference.arguments[1]!), sourceFile, context.factory),
          ]);
        }
      }
      return ts.visitEachChild(node, visitType, context);
    };
    return (file) => context.factory.updateSourceFile(file, file.statements.map((statement) => {
      const name = statementDeclarationName(statement);
      if (!name || !Object.hasOwn(effects, name) || effects[name]!.failures.length === 0) return statement;
      return ts.visitEachChild(statement, visitType, context) as ts.Statement;
    }));
  }]);
  const output = changed
    ? ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(transformed.transformed[0] as ts.SourceFile)
    : code;
  transformed.dispose();
  return output;
}

/**
 * Attach unstable, versioned compiler metadata without changing the TypeScript
 * callable type. A future phantom-type encoding can replace this tag after its
 * generic/overload behavior is specified.
 */
export function annotateDeclarationEffects(
  code: string,
  effects: Readonly<Record<string, FunctionRows>>,
  fileName = "module.d.mts",
): string {
  code = splitEffectVariableStatements(code, effects, fileName);
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const insertions: Array<{ readonly start: number; readonly text: string }> = [];
  for (const statement of sourceFile.statements) {
    if (!hasExportModifier(statement)) continue;
    const name = statementDeclarationName(statement);
    if (!name || !Object.hasOwn(effects, name)) continue;
    if (ts.getJSDocTags(statement).some((tag) => tag.tagName.text === DECLARATION_EFFECT_TAG)) {
      throw new TypeError(`declaration '${name}' already contains @${DECLARATION_EFFECT_TAG}`);
    }
    const row = effects[name]!;
    const failures = canonicalNames(row.failures, `${name}.failures`);
    const requirements = canonicalNames(row.requirements, `${name}.requirements`);
    const metadata = JSON.stringify({
      version: DECLARATION_EFFECT_VERSION,
      failures,
      requirements,
    });
    insertions.push({ start: statement.getStart(sourceFile), text: `/** @${DECLARATION_EFFECT_TAG} ${metadata} */\n` });
  }
  let output = code;
  for (const insertion of insertions.sort((left, right) => right.start - left.start)) {
    output = `${output.slice(0, insertion.start)}${insertion.text}${output.slice(insertion.start)}`;
  }
  return output;
}

/** Strictly decode compiler-owned effect tags for future declaration consumers. */
export function readDeclarationEffects(
  code: string,
  fileName = "module.d.mts",
): Readonly<Record<string, FunctionRows>> {
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const rows: Record<string, FunctionRows> = Object.create(null);
  for (const statement of sourceFile.statements) {
    const tags = ts.getJSDocTags(statement).filter((tag) => tag.tagName.text === DECLARATION_EFFECT_TAG);
    if (tags.length === 0) continue;
    const name = statementDeclarationName(statement);
    if (!hasExportModifier(statement) || !name || tags.length !== 1 || Object.hasOwn(rows, name)) {
      throw new TypeError(`invalid @${DECLARATION_EFFECT_TAG} declaration metadata`);
    }
    const comment = tags[0]!.comment;
    if (typeof comment !== "string" || comment.length > 65_536) {
      throw new TypeError(`@${DECLARATION_EFFECT_TAG} metadata must be bounded JSON text`);
    }
    const parsed: unknown = JSON.parse(comment);
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new TypeError(`@${DECLARATION_EFFECT_TAG} metadata must be an object`);
    }
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).sort(compareText).join(",") !== "failures,requirements,version" ||
      record.version !== DECLARATION_EFFECT_VERSION) {
      throw new TypeError(`@${DECLARATION_EFFECT_TAG} metadata has an unsupported envelope`);
    }
    const failures = exactSortedNames(record.failures, `${name}.failures`);
    const requirements = exactSortedNames(record.requirements, `${name}.requirements`);
    const canonical = JSON.stringify({ version: DECLARATION_EFFECT_VERSION, failures, requirements });
    if (comment !== canonical) {
      throw new TypeError(`@${DECLARATION_EFFECT_TAG} metadata must use its canonical encoding`);
    }
    rows[name] = Object.freeze({ failures, requirements });
  }
  return Object.freeze(rows);
}

/**
 * Emit declarations for already-lowered modules through one stock TypeScript
 * Program. Inputs and outputs are virtual; callers decide whether to write.
 */
export function emitProjectDeclarations(sources: readonly DeclarationSource[]): DeclarationEmitResult {
  if (sources.length === 0) return { outputs: [], diagnostics: [], ok: true };
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true,
    checkJs: true,
    allowImportingTsExtensions: true,
    declaration: true,
    emitDeclarationOnly: true,
    noEmitOnError: true,
    skipLibCheck: true,
    strict: true,
  };
  const sourceByName = new Map<string, { code: string; sourceFile: ts.SourceFile }>();
  const expectedOutputs = new Set<string>();
  const effectsByOutput = new Map<string, Readonly<Record<string, FunctionRows>>>();
  for (const source of sources) {
    const fileName = resolve(source.fileName);
    if (sourceByName.has(fileName)) throw new TypeError(`duplicate declaration source '${fileName}'`);
    const outputName = resolve(declarationOutputName(fileName));
    if (expectedOutputs.has(outputName)) throw new TypeError(`duplicate declaration output '${outputName}'`);
    expectedOutputs.add(outputName);
    sourceByName.set(fileName, {
      code: source.code,
      sourceFile: ts.createSourceFile(fileName, source.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
    });
    if (source.effects) effectsByOutput.set(outputName, source.effects);
  }

  const host = ts.createCompilerHost(options, true);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    const authored = sourceByName.get(resolve(name));
    return authored?.sourceFile ?? getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  };
  host.fileExists = (name) => sourceByName.has(resolve(name)) || fileExists(name);
  host.readFile = (name) => sourceByName.get(resolve(name))?.code ?? readFile(name);
  host.resolveModuleNames = (moduleNames, containingFile) => moduleNames.map((moduleName) => {
    if (moduleName.startsWith(".")) {
      const authored = resolve(dirname(containingFile), moduleName);
      if (sourceByName.has(authored)) {
        return { resolvedFileName: authored, extension: ts.Extension.Ts, isExternalLibraryImport: false };
      }
    }
    return ts.resolveModuleName(moduleName, containingFile, options, host).resolvedModule;
  });

  const emitted = new Map<string, string>();
  host.writeFile = (fileName, code) => {
    const output = resolve(fileName);
    // Imported implementation dependencies belong to their package, not this
    // declaration batch. TypeScript can otherwise emit them when an API caller
    // points a module import directly at a `.ts` file.
    if (!expectedOutputs.has(output)) return;
    if (emitted.has(output)) throw new TypeError(`duplicate declaration output '${output}'`);
    emitted.set(output, code);
  };
  const rootNames = [...sourceByName.keys()].sort(compareText);
  const program = ts.createProgram({ rootNames, options, host });
  const preEmit = ts.getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  const result = preEmit.length === 0 ? program.emit(undefined, host.writeFile, undefined, true) : undefined;
  const diagnostics = [
    ...preEmit,
    ...(result?.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error),
  ];
  const outputs = [...emitted].sort(([left], [right]) => compareText(left, right))
    .map(([fileName, code]) => ({
      fileName,
      code: effectsByOutput.has(fileName)
        ? annotateDeclarationEffects(
            normalizeDeclarationEffectChannels(code, effectsByOutput.get(fileName)!, fileName),
            effectsByOutput.get(fileName)!,
            fileName,
          )
        : code,
    }));
  return {
    outputs,
    diagnostics,
    ok: diagnostics.length === 0 && result?.emitSkipped !== true && outputs.length === expectedOutputs.size,
  };
}
