import { resolve } from "node:path"
import * as ts from "typescript-js"
import type { CompiledFlow } from "./authoring.ts"
import { encodePlanArtifact, loadCompiledFlow, validatePlanTemplate } from "./artifact.ts"
import {
  canonicalJson,
  derivedSchema,
  digest,
  expressionDependencies,
  fanOutSteps,
  structuralSchema,
  type ActionDescriptor,
  type ActionNode,
  type BranchNode,
  type ChildFlowNode,
  type DurableSchema,
  type DurableTypeDescriptor,
  type FanOutNode,
  type FanOutStep,
  type FanOutTemplateExpr,
  type JsonValue,
  type LoopNode,
  type LoopTemplateExpr,
  type PlanFragment,
  type PlanNode,
  type PlanTemplate,
  type SignalNode,
  type TimerNode,
  type ValueExpr
} from "./ir.ts"
import {
  actionDeclarationFromDescriptor,
  deriveDurableValueSchema,
  descriptorTypeScript,
  validateActionContractDescriptor
} from "./schema.ts"

const PROJECT_ROOT = "/vibelang-durable-source-compiler"
const MAX_SOURCE_BYTES = 2 * 1024 * 1024
const MAX_FAN_OUT_STEPS = 16
const MAX_CHILD_FLOW_DEPTH = 8
const MAX_LOOP_ROUNDS = 1000

export interface DurableSourceActionBinding {
  /** Exact module specifier used by authored source. */
  readonly moduleSpecifier: string
  /** Exact exported value. Local import aliases are resolved by the checker. */
  readonly exportName: string
  /** Compiler-emitted structural contract; legacy JSON-stub descriptors remain readable. */
  readonly descriptor: ActionDescriptor
}

/**
 * A statically resolvable, previously compiled durable Flow made invocable as
 * a child boundary. The provisional source spelling is `Exported.run(input)`;
 * the embedded, digest-pinned child Plan is the durable contract.
 */
export interface DurableSourceFlowBinding {
  /** Exact module specifier used by authored source. */
  readonly moduleSpecifier: string
  /** Exact exported value. Local import aliases are resolved by the checker. */
  readonly exportName: string
  /** Complete validated child Plan; it must carry structural Flow schemas. */
  readonly plan: PlanTemplate
}

export interface DurableSourceCompileOptions {
  readonly fileName?: string
  readonly flowId?: string
  readonly flowVersion?: number
  readonly actions: readonly DurableSourceActionBinding[]
  readonly flows?: readonly DurableSourceFlowBinding[]
}

export interface DurableSourceDiagnostic {
  readonly code: string
  readonly message: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly length: number
}

export interface DurableSourceCompileSuccess {
  readonly ok: true
  readonly diagnostics: readonly []
  readonly plan: PlanTemplate
  readonly artifact: Uint8Array
  readonly flow: CompiledFlow<unknown, unknown>
}

export interface DurableSourceCompileFailure {
  readonly ok: false
  readonly diagnostics: readonly DurableSourceDiagnostic[]
}

export type DurableSourceCompileResult = DurableSourceCompileSuccess | DurableSourceCompileFailure

class LoweringFailure extends Error {
  constructor(readonly diagnostic: DurableSourceDiagnostic) {
    super(diagnostic.message)
    this.name = "LoweringFailure"
  }
}

interface CheckedSource {
  readonly sourceFile: ts.SourceFile
  readonly checker: ts.TypeChecker
  readonly durableSymbol: ts.Symbol
  readonly sleepSymbol: ts.Symbol
  readonly signalSymbol: ts.Symbol
  readonly fanOutSymbol: ts.Symbol
  readonly sequentialSymbol: ts.Symbol
  readonly loopSymbol: ts.Symbol
  readonly actionsBySymbol: ReadonlyMap<ts.Symbol, ActionDescriptor>
  readonly flowsBySymbol: ReadonlyMap<ts.Symbol, PlanTemplate>
  readonly sourceDiagnostics: readonly ts.Diagnostic[]
}

type ModuleExport =
  | { readonly kind: "action"; readonly descriptor: ActionDescriptor }
  | { readonly kind: "flow"; readonly plan: PlanTemplate }

interface NormalizedModuleBinding {
  readonly moduleSpecifier: string
  readonly exportName: string
  readonly export: ModuleExport
  readonly virtualPath: string
}

const normalizeLogicalFileName = (name: string | undefined): string => {
  const candidate = (name ?? "durable-source.ts").replace(/\\/g, "/")
  const parts = candidate.split("/").filter((part) => part !== "" && part !== "." && part !== "..")
  const normalized = parts.join("/") || "durable-source.ts"
  return /\.[cm]?tsx?$/.test(normalized) ? normalized : `${normalized}.ts`
}

const canonicalSymbol = (checker: ts.TypeChecker, symbol: ts.Symbol | undefined): ts.Symbol | undefined => {
  if (symbol === undefined) return undefined
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
}

const symbolAtExpression = (checker: ts.TypeChecker, expression: ts.Expression): ts.Symbol | undefined => {
  if (ts.isPropertyAccessExpression(expression)) {
    return canonicalSymbol(checker, checker.getSymbolAtLocation(expression.name))
  }
  return canonicalSymbol(checker, checker.getSymbolAtLocation(expression))
}

const isTypeOnlyReference = (checker: ts.TypeChecker, expression: ts.Expression): boolean => {
  if (ts.isPropertyAccessExpression(expression) && isTypeOnlyReference(checker, expression.expression)) return true
  const location = ts.isPropertyAccessExpression(expression) ? expression.name : expression
  const symbol = checker.getSymbolAtLocation(location)
  if (symbol === undefined || !(symbol.flags & ts.SymbolFlags.Alias)) return false
  return (symbol.declarations ?? []).some((declaration) => {
    if (ts.isImportSpecifier(declaration)) {
      return declaration.isTypeOnly || declaration.parent.parent.isTypeOnly
    }
    if (ts.isNamespaceImport(declaration)) return declaration.parent.isTypeOnly
    if (ts.isImportClause(declaration)) return declaration.isTypeOnly
    return false
  })
}

const symbolIsAssigned = (checked: CheckedSource, symbol: ts.Symbol): boolean => {
  const targetContainsSymbol = (target: ts.Node): boolean => {
    let found = false
    const visit = (node: ts.Node): void => {
      if (found) return
      if (ts.isIdentifier(node) && checked.checker.getSymbolAtLocation(node) === symbol) {
        found = true
        return
      }
      ts.forEachChild(node, visit)
    }
    visit(target)
    return found
  }
  let assigned = false
  const visit = (node: ts.Node): void => {
    if (assigned) return
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      targetContainsSymbol(node.left)
    ) {
      assigned = true
      return
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) &&
      targetContainsSymbol(node.operand)
    ) {
      assigned = true
      return
    }
    if ((ts.isForInStatement(node) || ts.isForOfStatement(node)) && targetContainsSymbol(node.initializer)) {
      assigned = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(checked.sourceFile)
  return assigned
}

const diagnosticAt = (
  logicalFileName: string,
  sourceFile: ts.SourceFile,
  node: ts.Node | undefined,
  code: string,
  message: string
): DurableSourceDiagnostic => {
  const start = node?.getStart(sourceFile) ?? 0
  const position = sourceFile.getLineAndCharacterOfPosition(start)
  return Object.freeze({
    code,
    message,
    file: logicalFileName,
    line: position.line + 1,
    column: position.character + 1,
    length: Math.max(1, node?.getWidth(sourceFile) ?? 1)
  })
}

const flowDeclarationFromPlan = (exportName: string, plan: PlanTemplate): string => {
  const schemas = plan.flowSchemas
  if (schemas === undefined || schemas.input.shape !== "structural" || schemas.success.shape !== "structural") {
    // checkedSource rejects such bindings before declaration synthesis.
    return `export declare const ${exportName}: { run(input: never): never };`
  }
  return `export declare const ${exportName}: { run(input: ${descriptorTypeScript(schemas.input.descriptor)}): ${descriptorTypeScript(schemas.success.descriptor)} };`
}

const syntheticDeclarationFor = (exports: ReadonlyMap<string, ModuleExport>): string =>
  [...exports.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([name, moduleExport]) => moduleExport.kind === "action"
      ? actionDeclarationFromDescriptor(name, moduleExport.descriptor)
      : flowDeclarationFromPlan(name, moduleExport.plan))
    .join("\n")

const moduleExportDigest = (moduleExport: ModuleExport): string =>
  moduleExport.kind === "action" ? digest(moduleExport.descriptor) : moduleExport.plan.digest

const checkedSource = (
  source: string,
  logicalFileName: string,
  rawBindings: readonly DurableSourceActionBinding[],
  rawFlowBindings: readonly DurableSourceFlowBinding[]
): CheckedSource => {
  // Keep caller-controlled logical paths in a separate subtree so a file named
  // like one of our declarations cannot replace a compiler-owned intrinsic.
  const mainPath = resolve(PROJECT_ROOT, "__input__", logicalFileName)
  const flowsPath = resolve(PROJECT_ROOT, "__virtual__/flows.d.ts")
  const normalizedBindings: NormalizedModuleBinding[] = []
  const modules = new Map<string, { path: string; exports: Map<string, ModuleExport> }>()
  const bindExport = (
    index: number,
    label: "Action" | "Flow",
    moduleSpecifier: string,
    exportName: string,
    moduleExport: ModuleExport
  ): void => {
    if (typeof moduleSpecifier !== "string" || moduleSpecifier.trim() === "") {
      throw new TypeError(`${label} binding ${index} needs a non-empty module specifier`)
    }
    if (moduleSpecifier === "vibelang:flows") {
      throw new TypeError(`${label} bindings cannot replace the compiler-owned vibelang:flows module`)
    }
    if (!/^[$A-Z_a-z][$0-9A-Z_a-z]*$/.test(exportName)) {
      throw new TypeError(`${label} binding ${index} has unsupported export name ${JSON.stringify(exportName)}`)
    }
    let module = modules.get(moduleSpecifier)
    if (module === undefined) {
      module = {
        path: resolve(PROJECT_ROOT, `__virtual__/actions-${modules.size}.d.ts`),
        exports: new Map()
      }
      modules.set(moduleSpecifier, module)
    }
    const existing = module.exports.get(exportName)
    if (existing !== undefined && moduleExportDigest(existing) !== moduleExportDigest(moduleExport)) {
      throw new TypeError(`Conflicting descriptor bindings for ${moduleSpecifier}#${exportName}`)
    }
    module.exports.set(exportName, moduleExport)
    normalizedBindings.push({
      moduleSpecifier,
      exportName,
      export: moduleExport,
      virtualPath: module.path
    })
  }
  for (const [index, binding] of rawBindings.entries()) {
    bindExport(index, "Action", binding.moduleSpecifier, binding.exportName, {
      kind: "action",
      descriptor: validateActionContractDescriptor(binding.descriptor)
    })
  }
  for (const [index, binding] of rawFlowBindings.entries()) {
    const plan = validatePlanTemplate(binding.plan)
    const schemas = plan.flowSchemas
    if (schemas === undefined || schemas.input.shape !== "structural" || schemas.success.shape !== "structural") {
      throw new TypeError(
        `Flow binding ${index} (${plan.flowId}) requires compiler-derived structural Flow input/success schemas`
      )
    }
    bindExport(index, "Flow", binding.moduleSpecifier, binding.exportName, { kind: "flow", plan })
  }

  const virtualSources = new Map<string, string>([
    [mainPath, source],
    [flowsPath, [
      "export declare function durable<Function>(source: Function): unknown;",
      "export declare function sleep(milliseconds: number): null;",
      "/** Provisional source spelling; the compiler-owned Plan contract is normative for this POC. */",
      "export declare function waitSignal<Payload>(identity: string): Payload;",
      "export declare function fanOut<Item>(items: readonly Item[], key: (item: Item) => unknown, body: (item: Item) => unknown): readonly unknown[];",
      "/** Provisional explicit sequencing intrinsic: a durable control edge without a data edge. */",
      "export declare function sequential<First, Second>(first: First, second: Second): readonly [First, Second];",
      "/** Provisional round-budgeted while-style loop template; each round's Action success becomes the next state. */",
      "export declare function loopWhile<State>(initial: State, condition: (state: State) => boolean, body: (state: State) => { unwrap(): State }, maxRounds: number): State;"
    ].join("\n")],
    ...[...modules.values()].map((module) => [
      module.path,
      syntheticDeclarationFor(module.exports)
    ] as const)
  ])
  const modulePaths = new Map<string, string>([["vibelang:flows", flowsPath]])
  for (const [moduleSpecifier, module] of modules) modulePaths.set(moduleSpecifier, module.path)
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: []
  }
  const host = ts.createCompilerHost(compilerOptions, true)
  const originalGetSourceFile = host.getSourceFile.bind(host)
  const originalFileExists = host.fileExists.bind(host)
  const originalReadFile = host.readFile.bind(host)
  const originalDirectoryExists = host.directoryExists?.bind(host)
  const originalRealpath = host.realpath?.bind(host)
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const text = virtualSources.get(resolve(fileName))
    return text === undefined
      ? originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(resolve(fileName), text, languageVersion, true, ts.ScriptKind.TS)
  }
  host.fileExists = (fileName) => virtualSources.has(resolve(fileName)) || originalFileExists(fileName)
  host.readFile = (fileName) => virtualSources.get(resolve(fileName)) ?? originalReadFile(fileName)
  host.directoryExists = (directoryName) =>
    resolve(directoryName).startsWith(PROJECT_ROOT) || Boolean(originalDirectoryExists?.(directoryName))
  host.realpath = (fileName) => virtualSources.has(resolve(fileName))
    ? resolve(fileName)
    : (originalRealpath?.(fileName) ?? resolve(fileName))
  host.resolveModuleNames = (moduleNames, containingFile) => moduleNames.map((moduleName) => {
    const virtualPath = modulePaths.get(moduleName)
    if (virtualPath !== undefined) {
      return {
        resolvedFileName: virtualPath,
        extension: ts.Extension.Dts,
        isExternalLibraryImport: true
      }
    }
    return ts.resolveModuleName(moduleName, containingFile, compilerOptions, host).resolvedModule
  })
  const program = ts.createProgram([...virtualSources.keys()], compilerOptions, host)
  const sourceFile = program.getSourceFile(mainPath)
  const flowsFile = program.getSourceFile(flowsPath)
  if (sourceFile === undefined || flowsFile === undefined) throw new Error("Durable source compiler failed to create virtual source files")
  const checker = program.getTypeChecker()
  const durableDeclaration = flowsFile.statements
    .filter(ts.isFunctionDeclaration)
    .find((declaration) => declaration.name?.text === "durable")
  const sleepDeclaration = flowsFile.statements
    .filter(ts.isFunctionDeclaration)
    .find((declaration) => declaration.name?.text === "sleep")
  const signalDeclaration = flowsFile.statements
    .filter(ts.isFunctionDeclaration)
    .find((declaration) => declaration.name?.text === "waitSignal")
  const fanOutDeclaration = flowsFile.statements
    .filter(ts.isFunctionDeclaration)
    .find((declaration) => declaration.name?.text === "fanOut")
  const sequentialDeclaration = flowsFile.statements
    .filter(ts.isFunctionDeclaration)
    .find((declaration) => declaration.name?.text === "sequential")
  const loopDeclaration = flowsFile.statements
    .filter(ts.isFunctionDeclaration)
    .find((declaration) => declaration.name?.text === "loopWhile")
  const durableSymbol = durableDeclaration?.name && checker.getSymbolAtLocation(durableDeclaration.name)
  const sleepSymbol = sleepDeclaration?.name && checker.getSymbolAtLocation(sleepDeclaration.name)
  const signalSymbol = signalDeclaration?.name && checker.getSymbolAtLocation(signalDeclaration.name)
  const fanOutSymbol = fanOutDeclaration?.name && checker.getSymbolAtLocation(fanOutDeclaration.name)
  const sequentialSymbol = sequentialDeclaration?.name && checker.getSymbolAtLocation(sequentialDeclaration.name)
  const loopSymbol = loopDeclaration?.name && checker.getSymbolAtLocation(loopDeclaration.name)
  if (
    durableSymbol === undefined || sleepSymbol === undefined || signalSymbol === undefined ||
    fanOutSymbol === undefined || sequentialSymbol === undefined || loopSymbol === undefined
  ) {
    throw new Error("Durable source compiler failed to bind its compiler-owned intrinsics")
  }
  const actionsBySymbol = new Map<ts.Symbol, ActionDescriptor>()
  const flowsBySymbol = new Map<ts.Symbol, PlanTemplate>()
  for (const binding of normalizedBindings) {
    const moduleFile = program.getSourceFile(binding.virtualPath)
    const declaration = moduleFile?.statements
      .filter(ts.isVariableStatement)
      .flatMap((statement) => [...statement.declarationList.declarations])
      .find((candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === binding.exportName)
    const symbol = declaration && checker.getSymbolAtLocation(declaration.name)
    if (symbol === undefined) throw new Error(`Durable source compiler failed to bind ${binding.exportName}`)
    if (binding.export.kind === "action") actionsBySymbol.set(symbol, binding.export.descriptor)
    else flowsBySymbol.set(symbol, binding.export.plan)
  }
  // The checker may recover a duplicate local/import declaration as the
  // imported symbol. Reject those invalid programs before trusting identity.
  const declarationConflictCodes = new Set([
    2300, 2395, 2440, 2451,
    // Structural Action declarations make these ordinary checker failures a
    // durable contract error before Plan IR can be emitted.
    2322, 2339, 2345, 2353, 2741
  ])
  const sourceDiagnostics = [
    ...program.getSyntacticDiagnostics(sourceFile),
    ...program.getSemanticDiagnostics(sourceFile)
      .filter((diagnostic) => declarationConflictCodes.has(diagnostic.code))
  ].sort((left, right) => (left.start ?? 0) - (right.start ?? 0) || left.code - right.code)
  return {
    sourceFile,
    checker,
    durableSymbol,
    sleepSymbol,
    signalSymbol,
    fanOutSymbol,
    sequentialSymbol,
    loopSymbol,
    actionsBySymbol,
    flowsBySymbol,
    sourceDiagnostics
  }
}

const unwrapParentheses = (expression: ts.Expression): ts.Expression => {
  let current = expression
  while (ts.isParenthesizedExpression(current)) current = current.expression
  return current
}

const isStableScalarKeyType = (type: ts.Type): boolean => {
  if (type.isUnion()) return type.types.length > 0 && type.types.every(isStableScalarKeyType)
  return (type.flags & (
    ts.TypeFlags.String | ts.TypeFlags.StringLiteral |
    ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral |
    ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral
  )) !== 0
}

const findDurableCalls = (checked: CheckedSource): readonly ts.CallExpression[] => {
  const found: ts.CallExpression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = unwrapParentheses(node.expression)
      if (
        !isTypeOnlyReference(checked.checker, callee) &&
        symbolAtExpression(checked.checker, callee) === checked.durableSymbol
      ) {
        found.push(node)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(checked.sourceFile)
  return found
}

const resolvedFunction = (
  checked: CheckedSource,
  call: ts.CallExpression,
  fail: (node: ts.Node, code: string, message: string) => never
): ts.FunctionExpression | ts.ArrowFunction | ts.FunctionDeclaration => {
  if (
    call.arguments.length !== 1 || call.typeArguments !== undefined || call.questionDotToken !== undefined ||
    (call.expression.flags & ts.NodeFlags.OptionalChain) !== 0
  ) {
    return fail(call, "VIBE4103", "durable(...) requires exactly one statically resolvable function argument")
  }
  const argument = unwrapParentheses(call.arguments[0])
  if (ts.isFunctionExpression(argument) || ts.isArrowFunction(argument)) return argument
  if (!ts.isIdentifier(argument)) {
    return fail(argument, "VIBE4103", "durable(...) argument is not an inline or statically resolvable function")
  }
  const symbol = checked.checker.getSymbolAtLocation(argument)
  if (symbol !== undefined && symbolIsAssigned(checked, symbol)) {
    return fail(argument, "VIBE4103", "durable(...) function binding is assigned and cannot be resolved statically")
  }
  const declarations = symbol?.declarations ?? []
  const functions = declarations.filter((declaration): declaration is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(declaration) && declaration.body !== undefined)
  const variables = declarations.filter(ts.isVariableDeclaration).flatMap((declaration) => {
    if (
      !ts.isVariableDeclarationList(declaration.parent) ||
      !(declaration.parent.flags & ts.NodeFlags.Const)
    ) return []
    const initializer = declaration.initializer && unwrapParentheses(declaration.initializer)
    return initializer && (ts.isFunctionExpression(initializer) || ts.isArrowFunction(initializer)) ? [initializer] : []
  })
  const candidates = [...functions, ...variables]
  if (candidates.length !== 1 || candidates[0].getSourceFile() !== checked.sourceFile) {
    return fail(argument, "VIBE4103", "durable(...) function must resolve uniquely within the compiled source file")
  }
  return candidates[0]
}

const declarationNameFor = (
  call: ts.CallExpression,
  sourceFunction: ts.FunctionExpression | ts.ArrowFunction | ts.FunctionDeclaration
): string => {
  if (ts.isVariableDeclaration(call.parent) && ts.isIdentifier(call.parent.name)) return call.parent.name.text
  if (sourceFunction.name !== undefined && ts.isIdentifier(sourceFunction.name)) return sourceFunction.name.text
  return "Flow"
}

const flowErrorSchema = (actions: readonly ActionDescriptor[]): DurableSchema | undefined => {
  if (actions.length === 0) return undefined
  const schemas = actions.map((action) => action.errorSchema)
  if (schemas.some((schema) => schema.shape !== "structural")) return derivedSchema("error")
  const flattened = schemas.flatMap((schema) => {
    const descriptor = (schema as Extract<DurableSchema, { shape: "structural" }>).descriptor
    return descriptor.kind === "union" ? descriptor.variants : [descriptor]
  })
  const unique = new Map(flattened.map((descriptor) => [
    canonicalJson(descriptor as unknown as JsonValue),
    descriptor
  ]))
  const ordered = [...unique.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, descriptor]) => descriptor)
  const descriptor: DurableTypeDescriptor = ordered.length === 1
    ? ordered[0]
    : { kind: "union", variants: ordered }
  return structuralSchema("error", descriptor)
}

const canonicalUnion = (variants: readonly DurableTypeDescriptor[]): DurableTypeDescriptor => {
  const flattened = variants.flatMap((variant) => variant.kind === "union" ? variant.variants : [variant])
  const unique = new Map(flattened.map((variant) => [
    canonicalJson(variant as unknown as JsonValue),
    variant
  ]))
  const ordered = [...unique.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, variant]) => variant)
  return ordered.length === 1 ? ordered[0] : { kind: "union", variants: ordered }
}

/** Lexical environment available inside one fan-out per-item template. */
interface FanOutTemplateEnv {
  readonly itemSymbol: ts.Symbol
  readonly bindings: Map<ts.Symbol, FanOutTemplateExpr>
}

/** Height of a Plan's embedded child tree: 1 for a leaf Plan. */
const childFlowEmbeddingDepth = (plan: PlanTemplate): number => {
  let deepest = 0
  for (const child of plan.childFlows ?? []) {
    deepest = Math.max(deepest, childFlowEmbeddingDepth(child))
  }
  return 1 + deepest
}

const literalDescriptor = (value: JsonValue): DurableTypeDescriptor => {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return { kind: "literal", value }
  }
  if (Array.isArray(value)) return { kind: "tuple", items: value.map(literalDescriptor) }
  return {
    kind: "object",
    fields: Object.keys(value).sort().map((name) => ({
      name,
      optional: false,
      value: literalDescriptor(value[name])
    }))
  }
}

const projectDescriptor = (
  descriptor: DurableTypeDescriptor,
  path: readonly string[],
  fail: (message: string) => never
): DurableTypeDescriptor => {
  if (path.length === 0) return descriptor
  if (descriptor.kind === "union") {
    return canonicalUnion(descriptor.variants.map((variant) => projectDescriptor(variant, path, fail)))
  }
  const [head, ...tail] = path
  if (descriptor.kind === "object") {
    const field = descriptor.fields.find((candidate) => candidate.name === head)
    if (field === undefined) return fail(`Flow output projects missing durable field ${head}`)
    return projectDescriptor(field.value, tail, fail)
  }
  if (descriptor.kind === "tuple" && /^(0|[1-9][0-9]*)$/.test(head)) {
    const item = descriptor.items[Number(head)]
    if (item === undefined) return fail(`Flow output projects missing durable tuple index ${head}`)
    return projectDescriptor(item, tail, fail)
  }
  if (descriptor.kind === "array" && /^(0|[1-9][0-9]*)$/.test(head)) {
    return projectDescriptor(descriptor.element, tail, fail)
  }
  return fail(`Flow output cannot project ${head} from durable ${descriptor.kind}`)
}

const flowSuccessDescriptor = (
  expression: ValueExpr,
  input: DurableTypeDescriptor,
  nodes: readonly PlanNode[],
  actions: readonly ActionDescriptor[],
  childFlows: ReadonlyMap<string, PlanTemplate>,
  fail: (message: string) => never
): DurableTypeDescriptor => {
  switch (expression.kind) {
    case "literal": return literalDescriptor(expression.value)
    case "input": return projectDescriptor(input, expression.path, fail)
    case "node": {
      const findNode = (fragmentNodes: readonly PlanNode[]): PlanNode | undefined => {
        for (const candidate of fragmentNodes) {
          if (candidate.id === expression.nodeId) return candidate
          if (candidate.kind === "branch") {
            const nested = findNode([...candidate.whenTrue.nodes, ...candidate.whenFalse.nodes])
            if (nested !== undefined) return nested
          }
        }
        return undefined
      }
      const node = findNode(nodes)
      if (node?.kind === "action") {
        const action = actions.find((candidate) => candidate.id === node.actionId)
        if (action === undefined || action.successSchema.shape !== "structural") {
          return fail(`Flow output references an Action without a structural success descriptor`)
        }
        return projectDescriptor(action.successSchema.descriptor, expression.path, fail)
      }
      if (node?.kind === "branch") {
        const joined = canonicalUnion([
          flowSuccessDescriptor(node.whenTrue.output, input, nodes, actions, childFlows, fail),
          flowSuccessDescriptor(node.whenFalse.output, input, nodes, actions, childFlows, fail)
        ])
        return projectDescriptor(joined, expression.path, fail)
      }
      if (node?.kind === "timer") {
        return projectDescriptor({ kind: "null" }, expression.path, fail)
      }
      if (node?.kind === "signal") {
        return projectDescriptor(node.payloadSchema.descriptor, expression.path, fail)
      }
      if (node?.kind === "fanout") {
        const steps = fanOutSteps(node)
        const lastStep = steps[steps.length - 1]!
        const action = actions.find((candidate) => candidate.id === lastStep.actionId)
        if (action === undefined || action.successSchema.shape !== "structural") {
          return fail(`Flow output references a fan-out Action without a structural success descriptor`)
        }
        return projectDescriptor(
          { kind: "array", element: action.successSchema.descriptor },
          expression.path,
          fail
        )
      }
      if (node?.kind === "loop") {
        const action = actions.find((candidate) => candidate.id === node.actionId)
        if (action === undefined || action.successSchema.shape !== "structural") {
          return fail(`Flow output references a loop Action without a structural success descriptor`)
        }
        // Zero rounds yields the initial state; otherwise the final round's
        // Action success. The descriptor is their canonical union.
        const joined = canonicalUnion([
          flowSuccessDescriptor(node.initial, input, nodes, actions, childFlows, fail),
          action.successSchema.descriptor
        ])
        return projectDescriptor(joined, expression.path, fail)
      }
      if (node?.kind === "childFlow") {
        const child = childFlows.get(node.planDigest)
        const success = child?.flowSchemas?.success
        if (success === undefined || success.shape !== "structural") {
          return fail(`Flow output references a child Flow without a structural success descriptor`)
        }
        return projectDescriptor(success.descriptor, expression.path, fail)
      }
      return fail(`Flow output references a node without a supported success descriptor`)
    }
    case "array": return {
      kind: "tuple",
      items: expression.items.map((item) => flowSuccessDescriptor(item, input, nodes, actions, childFlows, fail))
    }
    case "object": return {
      kind: "object",
      fields: Object.keys(expression.fields).sort().map((name) => ({
        name,
        optional: false,
        value: flowSuccessDescriptor(expression.fields[name], input, nodes, actions, childFlows, fail)
      }))
    }
    case "unary": return { kind: "boolean" }
    case "binary": return ["eq", "neq", "gt", "gte", "lt", "lte", "and", "or"].includes(expression.operator)
      ? { kind: "boolean" }
      : expression.operator === "add"
        ? { kind: "number" }
        : { kind: "string" }
  }
}

const flowSchemas = (
  checked: CheckedSource,
  sourceFunction: ts.FunctionExpression | ts.ArrowFunction | ts.FunctionDeclaration,
  output: ValueExpr,
  nodes: readonly PlanNode[],
  actions: readonly ActionDescriptor[],
  childFlows: ReadonlyMap<string, PlanTemplate>,
  fail: (node: ts.Node, code: string, message: string) => never
): NonNullable<PlanTemplate["flowSchemas"]> => {
  const signature = checked.checker.getSignatureFromDeclaration(sourceFunction)
  const parameter = sourceFunction.parameters[0]
  if (signature === undefined || parameter === undefined) {
    return fail(sourceFunction, "VIBE4110", "compiler could not derive the durable Flow signature")
  }
  try {
    const inputType = checked.checker.getTypeAtLocation(parameter)
    const input = deriveDurableValueSchema(
      checked.checker,
      checked.sourceFile,
      parameter,
      inputType,
      "input",
      "Flow input"
    )
    let success: DurableSchema
    try {
      const successDescriptor = flowSuccessDescriptor(
        output,
        input.descriptor,
        nodes,
        actions,
        childFlows,
        (message) => { throw new TypeError(message) }
      )
      success = structuralSchema("success", successDescriptor)
    } catch (error) {
      if (!actions.some((action) => action.successSchema.shape !== "structural")) throw error
      // Legacy Action.define artifacts remain readable but state their weaker
      // contract explicitly; compiler-derived Action bindings never take this
      // compatibility path.
      success = derivedSchema("success")
    }
    const error = flowErrorSchema(actions)
    return {
      input,
      success,
      ...(error === undefined ? {} : { error })
    }
  } catch (error) {
    return fail(
      sourceFunction,
      "VIBE4110",
      `durable Flow boundary is not structurally encodable: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

class FunctionLowerer {
  readonly nodes: PlanNode[] = []
  readonly usedActions = new Map<string, ActionDescriptor>()
  /** Embedded child Plans keyed by their pinned digest. */
  readonly usedChildFlows = new Map<string, PlanTemplate>()
  readonly values = new Map<ts.Symbol, ValueExpr>()
  readonly occurrences = new Map<string, number>()
  readonly nodeIds = new Set<string>()
  readonly fanOutNodeIds = new Set<string>()
  readonly signalIds = new Set<string>()
  /** True once the emitted Plan requires format version 2 features. */
  usesFormatVersion2 = false
  private activeNodes: PlanNode[] = this.nodes
  private sequencingDependency: string | undefined

  constructor(
    readonly checked: CheckedSource,
    readonly logicalFileName: string,
    readonly flowId: string,
    readonly flowVersion: number,
    readonly functionName: string,
    readonly fail: (node: ts.Node, code: string, message: string) => never
  ) {}

  lower(sourceFunction: ts.FunctionExpression | ts.ArrowFunction | ts.FunctionDeclaration): ValueExpr {
    if (sourceFunction.body === undefined || !ts.isBlock(sourceFunction.body)) {
      return this.fail(sourceFunction, "VIBE4104", "durable source functions require a block body with an explicit return")
    }
    if (sourceFunction.asteriskToken !== undefined || ts.getModifiers(sourceFunction)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
      return this.fail(sourceFunction, "VIBE4104", "async and generator durable source functions are outside the bounded lowering subset")
    }
    if (sourceFunction.parameters.length !== 1) {
      return this.fail(sourceFunction, "VIBE4104", "durable source functions require exactly one input parameter")
    }
    const parameter = sourceFunction.parameters[0]
    if (!ts.isIdentifier(parameter.name) || parameter.initializer !== undefined || parameter.dotDotDotToken !== undefined) {
      return this.fail(parameter, "VIBE4104", "durable input must be one plain identifier without an initializer")
    }
    const inputSymbol = this.checked.checker.getSymbolAtLocation(parameter.name)
    if (inputSymbol === undefined) return this.fail(parameter, "VIBE4199", "compiler could not resolve the durable input binding")
    this.values.set(inputSymbol, { kind: "input", path: [] })

    let output: ValueExpr | undefined
    for (const statement of sourceFunction.body.statements) {
      if (output !== undefined) {
        return this.fail(statement, "VIBE4109", "statements after the durable return are not supported")
      }
      if (ts.isEmptyStatement(statement)) continue
      if (ts.isVariableStatement(statement)) {
        if (!(statement.declarationList.flags & ts.NodeFlags.Const)) {
          return this.fail(statement, "VIBE4105", "durable straight-line bindings must use const")
        }
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) {
            return this.fail(declaration, "VIBE4105", "durable const bindings require one identifier and an initializer")
          }
          const symbol = this.checked.checker.getSymbolAtLocation(declaration.name)
          if (symbol === undefined) return this.fail(declaration.name, "VIBE4199", "compiler could not resolve const binding")
          const expression = this.lowerExpression(declaration.initializer, `const:${declaration.name.text}`)
          this.values.set(symbol, expression)
        }
        continue
      }
      if (ts.isReturnStatement(statement)) {
        if (statement.expression === undefined) return this.fail(statement, "VIBE4109", "durable return requires a value")
        output = this.lowerExpression(statement.expression, "return", true)
        continue
      }
      if (ts.isExpressionStatement(statement)) {
        const expression = unwrapParentheses(statement.expression)
        const lowered = ts.isCallExpression(expression)
          ? this.lowerTimerCall(expression, "sleep") ?? this.lowerSequentialCall(expression, "sequential")
          : undefined
        if (lowered !== undefined) continue
        return this.fail(
          statement,
          "VIBE4108",
          "only compiler-owned sleep(...) and sequential(...) are supported as durable expression statements"
        )
      }
      if (ts.isIfStatement(statement) || ts.isSwitchStatement(statement)) {
        return this.fail(statement, "VIBE4106", "runtime branches require explicit Plan branch lowering, which this subset does not guess")
      }
      if (
        ts.isForStatement(statement) || ts.isForInStatement(statement) || ts.isForOfStatement(statement) ||
        ts.isWhileStatement(statement) || ts.isDoStatement(statement)
      ) {
        return this.fail(statement, "VIBE4107", "runtime loops require parameterized Plan templates and are not unrolled by this subset")
      }
      return this.fail(statement, "VIBE4108", `unsupported durable statement ${ts.SyntaxKind[statement.kind]}`)
    }
    if (output === undefined) return this.fail(sourceFunction.body, "VIBE4109", "durable source function must return a value")
    return output
  }

  private lowerExpression(
    expressionValue: ts.Expression,
    anchor: string,
    allowFinalAction = false
  ): ValueExpr {
    const expression = unwrapParentheses(expressionValue)
    if (ts.isIdentifier(expression)) {
      const symbol = this.checked.checker.getSymbolAtLocation(expression)
      const value = symbol && this.values.get(symbol)
      if (value !== undefined) return value
      return this.fail(expression, "VIBE4110", `unsupported runtime capture ${expression.text}; only input and prior const bindings are available`)
    }
    if (expression.kind === ts.SyntaxKind.NullKeyword) return { kind: "literal", value: null }
    if (expression.kind === ts.SyntaxKind.TrueKeyword) return { kind: "literal", value: true }
    if (expression.kind === ts.SyntaxKind.FalseKeyword) return { kind: "literal", value: false }
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return { kind: "literal", value: expression.text }
    }
    if (ts.isNumericLiteral(expression)) {
      const value = Number(expression.text)
      if (!Number.isFinite(value)) return this.fail(expression, "VIBE4111", "non-finite numeric literal is not durable")
      return { kind: "literal", value }
    }
    if (
      ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(expression.operand)
    ) {
      const value = -Number(expression.operand.text)
      if (!Number.isFinite(value) || Object.is(value, -0)) {
        return this.fail(expression, "VIBE4111", "non-canonical numeric literal is not durable")
      }
      return { kind: "literal", value }
    }
    if (ts.isObjectLiteralExpression(expression)) {
      const fields = Object.create(null) as Record<string, ValueExpr>
      for (const property of expression.properties) {
        let name: string
        let initializer: ts.Expression
        if (ts.isPropertyAssignment(property)) {
          name = this.propertyName(property.name)
          initializer = property.initializer
        } else if (ts.isShorthandPropertyAssignment(property)) {
          name = property.name.text
          initializer = property.name
        } else {
          return this.fail(property, "VIBE4111", "durable objects do not support spreads, methods, or accessors in this subset")
        }
        if (Object.hasOwn(fields, name)) return this.fail(property, "VIBE4111", `duplicate durable object field ${name}`)
        fields[name] = this.lowerExpression(initializer, `${anchor}.${name}`)
      }
      return { kind: "object", fields }
    }
    if (ts.isArrayLiteralExpression(expression)) {
      const items = expression.elements.map((element, index) => {
        if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) {
          return this.fail(element, "VIBE4111", "durable arrays cannot contain holes or spreads")
        }
        return this.lowerExpression(element, `${anchor}[${index}]`)
      })
      return { kind: "array", items }
    }
    if (ts.isPropertyAccessExpression(expression)) {
      if (expression.questionDotToken !== undefined) {
        return this.fail(expression, "VIBE4106", "optional projections require explicit Plan branch lowering")
      }
      return this.project(this.lowerExpression(expression.expression, anchor), expression.name.text, expression)
    }
    if (ts.isElementAccessExpression(expression)) {
      if (expression.questionDotToken !== undefined) {
        return this.fail(expression, "VIBE4106", "optional projections require explicit Plan branch lowering")
      }
      const argument = expression.argumentExpression && unwrapParentheses(expression.argumentExpression)
      const key = argument && (ts.isStringLiteral(argument) || ts.isNumericLiteral(argument)) ? argument.text : undefined
      if (key === undefined) return this.fail(expression, "VIBE4111", "durable projection keys must be static string or numeric literals")
      return this.project(this.lowerExpression(expression.expression, anchor), key, expression)
    }
    if (ts.isConditionalExpression(expression)) {
      return this.lowerConditionalExpression(expression, anchor, allowFinalAction)
    }
    if (ts.isCallExpression(expression)) {
      const signal = this.lowerSignalCall(expression, anchor)
      if (signal !== undefined) return signal
      const fanOut = this.lowerFanOutCall(expression, anchor)
      if (fanOut !== undefined) return fanOut
      const loop = this.lowerLoopCall(expression, anchor)
      if (loop !== undefined) return loop
      const timer = this.lowerTimerCall(expression, anchor)
      if (timer !== undefined) return timer
      const sequenced = this.lowerSequentialCall(expression, anchor)
      if (sequenced !== undefined) return sequenced
      const childFlow = this.lowerChildFlowCall(expression, anchor)
      if (childFlow !== undefined) return childFlow
      if (
        ts.isPropertyAccessExpression(expression.expression) && expression.expression.name.text === "unwrap" &&
        expression.arguments.length === 0 && expression.typeArguments === undefined &&
        expression.questionDotToken === undefined && expression.expression.questionDotToken === undefined
      ) {
        const candidate = unwrapParentheses(expression.expression.expression)
        if (ts.isCallExpression(candidate)) {
          const lowered = this.lowerActionCall(candidate, anchor)
          if (lowered !== undefined) {
            this.sequencingDependency = lowered.nodeId
            return lowered
          }
        }
        return this.fail(expression, "VIBE4112", "unwrap() is supported only directly on an imported Action.run(...) call")
      }
      const lowered = this.lowerActionCall(expression, anchor)
      if (lowered !== undefined) {
        if (!allowFinalAction) {
          return this.fail(
            expression,
            "VIBE4115",
            "an intermediate Action.run(...) must use .unwrap(); only the final returned Result may remain wrapped"
          )
        }
        return lowered
      }
      return this.fail(expression, "VIBE4112", "higher-order and dynamic calls are unavailable in durable source lowering")
    }
    return this.fail(expression, "VIBE4111", `unsupported durable expression ${ts.SyntaxKind[expression.kind]}`)
  }

  private lowerSignalCall(
    call: ts.CallExpression,
    anchor: string
  ): { readonly kind: "node"; readonly nodeId: string; readonly path: readonly string[] } | undefined {
    const callee = unwrapParentheses(call.expression)
    if (
      isTypeOnlyReference(this.checked.checker, callee) ||
      symbolAtExpression(this.checked.checker, callee) !== this.checked.signalSymbol
    ) return undefined
    if (
      call.arguments.length !== 1 || call.typeArguments?.length !== 1 ||
      call.questionDotToken !== undefined || (call.expression.flags & ts.NodeFlags.OptionalChain) !== 0
    ) {
      return this.fail(
        call,
        "VIBE4118",
        "provisional compiler-owned waitSignal<Payload>(\"identity\") requires one explicit payload type and one static identity"
      )
    }
    const identityExpression = unwrapParentheses(call.arguments[0])
    if (!ts.isStringLiteral(identityExpression) && !ts.isNoSubstitutionTemplateLiteral(identityExpression)) {
      return this.fail(
        call.arguments[0],
        "VIBE4118",
        "durable signal identity must be a string literal, not a runtime value"
      )
    }
    const signalId = identityExpression.text
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(signalId)) {
      return this.fail(
        identityExpression,
        "VIBE4118",
        "durable signal identity must be 1-128 portable characters"
      )
    }
    if (this.signalIds.has(signalId)) {
      return this.fail(identityExpression, "VIBE4118", `durable signal identity ${signalId} is duplicated in this Flow`)
    }
    let payloadSchema
    try {
      const typeNode = call.typeArguments[0]
      payloadSchema = deriveDurableValueSchema(
        this.checked.checker,
        this.checked.sourceFile,
        typeNode,
        this.checked.checker.getTypeFromTypeNode(typeNode),
        "input",
        `signal ${signalId} payload`
      )
    } catch (error) {
      return this.fail(
        call.typeArguments[0],
        "VIBE4118",
        `durable signal payload is not structurally encodable: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    this.signalIds.add(signalId)
    const signalContractDigest = digest({ signalId, payloadSchema })
    const identity = {
      file: this.logicalFileName,
      flowId: this.flowId,
      flowVersion: this.flowVersion,
      functionName: this.functionName,
      kind: "signal",
      anchor,
      signalId,
      signalContractDigest
    }
    const occurrenceKey = digest(identity)
    const occurrence = this.occurrences.get(occurrenceKey) ?? 0
    this.occurrences.set(occurrenceKey, occurrence + 1)
    const id = `src-${digest({ ...identity, occurrence }).slice(0, 24)}`
    if (this.nodeIds.has(id)) return this.fail(call, "VIBE4199", `stable durable node id collision ${id}`)
    this.nodeIds.add(id)
    const position = this.checked.sourceFile.getLineAndCharacterOfPosition(call.getStart(this.checked.sourceFile))
    const node: SignalNode = {
      kind: "signal",
      id,
      signalId,
      payloadSchema,
      signalContractDigest,
      dependencies: [],
      controlDependencies: this.sequencingDependency === undefined ? [] : [this.sequencingDependency],
      debug: {
        label: `signal:${signalId}`,
        callSite: `${this.logicalFileName}:${position.line + 1}:${position.character + 1}`
      }
    }
    this.activeNodes.push(node)
    this.sequencingDependency = id
    return { kind: "node", nodeId: id, path: [] }
  }

  private lowerTimerCall(
    call: ts.CallExpression,
    anchor: string
  ): { readonly kind: "node"; readonly nodeId: string; readonly path: readonly string[] } | undefined {
    const callee = unwrapParentheses(call.expression)
    if (
      isTypeOnlyReference(this.checked.checker, callee) ||
      symbolAtExpression(this.checked.checker, callee) !== this.checked.sleepSymbol
    ) return undefined
    if (
      call.arguments.length !== 1 || call.typeArguments !== undefined || call.questionDotToken !== undefined ||
      (call.expression.flags & ts.NodeFlags.OptionalChain) !== 0
    ) {
      return this.fail(call, "VIBE4116", "compiler-owned sleep(...) requires one statically bound duration argument")
    }
    const durationMs = this.lowerExpression(call.arguments[0], `${anchor}:duration`)
    if (
      durationMs.kind === "literal" &&
      (typeof durationMs.value !== "number" || !Number.isSafeInteger(durationMs.value) || durationMs.value < 0)
    ) {
      return this.fail(
        call.arguments[0],
        "VIBE4116",
        "durable sleep duration must be a non-negative safe integer number of milliseconds"
      )
    }
    const identity = {
      file: this.logicalFileName,
      flowId: this.flowId,
      flowVersion: this.flowVersion,
      functionName: this.functionName,
      kind: "timer",
      anchor,
      durationMs
    }
    const occurrenceKey = digest(identity)
    const occurrence = this.occurrences.get(occurrenceKey) ?? 0
    this.occurrences.set(occurrenceKey, occurrence + 1)
    const id = `src-${digest({ ...identity, occurrence }).slice(0, 24)}`
    if (this.nodeIds.has(id)) return this.fail(call, "VIBE4199", `stable durable node id collision ${id}`)
    this.nodeIds.add(id)
    const position = this.checked.sourceFile.getLineAndCharacterOfPosition(call.getStart(this.checked.sourceFile))
    const node: TimerNode = {
      kind: "timer",
      id,
      durationMs,
      dependencies: expressionDependencies(durationMs),
      controlDependencies: this.sequencingDependency === undefined ? [] : [this.sequencingDependency],
      debug: {
        label: "sleep",
        callSite: `${this.logicalFileName}:${position.line + 1}:${position.character + 1}`
      }
    }
    this.activeNodes.push(node)
    this.sequencingDependency = id
    return { kind: "node", nodeId: id, path: [] }
  }

  /**
   * Provisional compiler-owned `sequential(first, second)`: a durable control
   * edge between two independent Action calls so their order survives restart
   * without inventing a data dependency. Both success values remain available
   * as an ordered tuple.
   */
  private lowerSequentialCall(
    call: ts.CallExpression,
    anchor: string
  ): ValueExpr | undefined {
    const callee = unwrapParentheses(call.expression)
    if (
      isTypeOnlyReference(this.checked.checker, callee) ||
      symbolAtExpression(this.checked.checker, callee) !== this.checked.sequentialSymbol
    ) return undefined
    if (
      call.arguments.length !== 2 || call.typeArguments !== undefined || call.questionDotToken !== undefined ||
      (call.expression.flags & ts.NodeFlags.OptionalChain) !== 0
    ) {
      return this.fail(
        call,
        "VIBE4119",
        "compiler-owned sequential(first, second) requires exactly two direct imported Action.run(...) arguments"
      )
    }
    const lowerArgument = (
      argument: ts.Expression,
      suffix: string
    ): { readonly kind: "node"; readonly nodeId: string; readonly path: readonly string[] } => {
      const unwrapped = unwrapParentheses(argument)
      const lowered = ts.isCallExpression(unwrapped)
        ? this.lowerActionCall(unwrapped, `${anchor}:${suffix}`)
        : undefined
      if (lowered === undefined) {
        return this.fail(argument, "VIBE4119", "sequential(...) arguments must be direct imported Action.run(...) calls")
      }
      return lowered
    }
    const first = lowerArgument(call.arguments[0], "first")
    // The explicit durable control edge: the second Action may not start until
    // the first holds a committed terminal exit, although no data flows.
    this.sequencingDependency = first.nodeId
    const second = lowerArgument(call.arguments[1], "second")
    this.sequencingDependency = second.nodeId
    return { kind: "array", items: [first, second] }
  }

  /**
   * Provisional `ChildFlow.run(input)` lowering for a compiler-bound, already
   * compiled durable Flow. The child Plan is embedded and digest-pinned; the
   * child executes as its own attached execution with its own journal.
   */
  private lowerChildFlowCall(
    call: ts.CallExpression,
    anchor: string
  ): { readonly kind: "node"; readonly nodeId: string; readonly path: readonly string[] } | undefined {
    if (
      !ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== "run" ||
      call.questionDotToken !== undefined || call.expression.questionDotToken !== undefined
    ) return undefined
    const flowReference = unwrapParentheses(call.expression.expression)
    if (isTypeOnlyReference(this.checked.checker, flowReference)) return undefined
    const flowSymbol = symbolAtExpression(this.checked.checker, flowReference)
    const childPlan = flowSymbol && this.checked.flowsBySymbol.get(flowSymbol)
    if (childPlan === undefined) return undefined
    if (call.arguments.length !== 1 || call.typeArguments !== undefined) {
      return this.fail(call, "VIBE4120", `${childPlan.flowId}.run requires exactly one input argument in durable source`)
    }
    // Inline recursion is structurally impossible (a Plan cannot embed its own
    // digest), and mutual recursion cannot escape this explicit round budget.
    if (childFlowEmbeddingDepth(childPlan) >= MAX_CHILD_FLOW_DEPTH) {
      return this.fail(
        call,
        "VIBE4120",
        `child Flow ${childPlan.flowId} exceeds the child-boundary round budget of ${MAX_CHILD_FLOW_DEPTH}`
      )
    }
    const input = this.lowerExpression(call.arguments[0], `${anchor}:input`)
    for (const candidate of this.usedChildFlows.values()) {
      if (
        candidate.flowId === childPlan.flowId &&
        candidate.flowVersion === childPlan.flowVersion &&
        candidate.digest !== childPlan.digest
      ) {
        return this.fail(
          call,
          "VIBE4114",
          `child Flow ${childPlan.flowId}@${childPlan.flowVersion} resolves to incompatible durable Plans`
        )
      }
    }
    // One Action id must carry one exact contract across the embedded tree.
    for (const action of childPlan.actions) {
      const existing = this.usedActions.get(action.id)
      if (existing !== undefined && existing.contractDigest !== action.contractDigest) {
        return this.fail(call, "VIBE4114", `Action id ${action.id} resolves to incompatible durable contracts`)
      }
    }
    for (const action of childPlan.actions) this.usedActions.set(action.id, action)
    this.usedChildFlows.set(childPlan.digest, childPlan)
    this.usesFormatVersion2 = true
    const identity = {
      file: this.logicalFileName,
      flowId: this.flowId,
      flowVersion: this.flowVersion,
      functionName: this.functionName,
      kind: "childFlow",
      anchor,
      childFlowId: childPlan.flowId,
      childFlowVersion: childPlan.flowVersion,
      childPlanDigest: childPlan.digest,
      input
    }
    const occurrenceKey = digest(identity)
    const occurrence = this.occurrences.get(occurrenceKey) ?? 0
    this.occurrences.set(occurrenceKey, occurrence + 1)
    const id = `src-${digest({ ...identity, occurrence }).slice(0, 24)}`
    if (this.nodeIds.has(id)) return this.fail(call, "VIBE4199", `stable durable node id collision ${id}`)
    this.nodeIds.add(id)
    const position = this.checked.sourceFile.getLineAndCharacterOfPosition(call.getStart(this.checked.sourceFile))
    const node: ChildFlowNode = {
      kind: "childFlow",
      id,
      flowId: childPlan.flowId,
      flowVersion: childPlan.flowVersion,
      planDigest: childPlan.digest,
      input,
      dependencies: expressionDependencies(input),
      controlDependencies: this.sequencingDependency === undefined ? [] : [this.sequencingDependency],
      debug: {
        label: `childFlow:${childPlan.flowId}`,
        callSite: `${this.logicalFileName}:${position.line + 1}:${position.character + 1}`
      }
    }
    this.activeNodes.push(node)
    // A child boundary is an effectful sub-program; later source expressions
    // observe its completion like an unwrapped Action.
    this.sequencingDependency = id
    return { kind: "node", nodeId: id, path: [] }
  }

  private inlineFanOutCallback(
    expressionValue: ts.Expression,
    label: "key" | "body",
    allowBlock = false
  ): { readonly itemSymbol: ts.Symbol; readonly body: ts.Expression | ts.Block } {
    const expression = unwrapParentheses(expressionValue)
    if (
      !ts.isArrowFunction(expression) || (!allowBlock && ts.isBlock(expression.body)) ||
      expression.parameters.length !== 1 || expression.typeParameters !== undefined ||
      ts.getModifiers(expression)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
    ) {
      return this.fail(
        expression,
        "VIBE4117",
        allowBlock
          ? `durable fanOut ${label} must be one inline, synchronous arrow with one item parameter`
          : `durable fanOut ${label} must be one inline, synchronous expression arrow with one item parameter`
      )
    }
    const parameter = expression.parameters[0]
    if (
      !ts.isIdentifier(parameter.name) || parameter.initializer !== undefined ||
      parameter.dotDotDotToken !== undefined || parameter.questionToken !== undefined
    ) {
      return this.fail(
        parameter,
        "VIBE4117",
        `durable fanOut ${label} parameter must be one required item identifier`
      )
    }
    const itemSymbol = this.checked.checker.getSymbolAtLocation(parameter.name)
    if (itemSymbol === undefined) return this.fail(parameter.name, "VIBE4199", "compiler could not bind fanOut item")
    return { itemSymbol, body: expression.body }
  }

  private lowerFanOutTemplate(
    expressionValue: ts.Expression,
    env: FanOutTemplateEnv
  ): FanOutTemplateExpr {
    const expression = unwrapParentheses(expressionValue)
    if (ts.isIdentifier(expression)) {
      const symbol = this.checked.checker.getSymbolAtLocation(expression)
      if (symbol === env.itemSymbol) {
        return { kind: "item", path: [] }
      }
      const bound = symbol && env.bindings.get(symbol)
      if (bound !== undefined) return bound
      return this.fail(
        expression,
        "VIBE4117",
        `durable fanOut templates cannot capture ${expression.text}; use only the current item, earlier steps, and literals`
      )
    }
    if (expression.kind === ts.SyntaxKind.NullKeyword) return { kind: "literal", value: null }
    if (expression.kind === ts.SyntaxKind.TrueKeyword) return { kind: "literal", value: true }
    if (expression.kind === ts.SyntaxKind.FalseKeyword) return { kind: "literal", value: false }
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return { kind: "literal", value: expression.text }
    }
    if (ts.isNumericLiteral(expression)) {
      const value = Number(expression.text)
      if (!Number.isFinite(value)) return this.fail(expression, "VIBE4117", "fanOut template number is not canonical")
      return { kind: "literal", value }
    }
    if (
      ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(expression.operand)
    ) {
      const value = -Number(expression.operand.text)
      if (!Number.isFinite(value) || Object.is(value, -0)) {
        return this.fail(expression, "VIBE4117", "fanOut template number is not canonical")
      }
      return { kind: "literal", value }
    }
    if (ts.isObjectLiteralExpression(expression)) {
      const fields = Object.create(null) as Record<string, FanOutTemplateExpr>
      for (const property of expression.properties) {
        let name: string
        let initializer: ts.Expression
        if (ts.isPropertyAssignment(property)) {
          name = this.propertyName(property.name)
          initializer = property.initializer
        } else if (ts.isShorthandPropertyAssignment(property)) {
          name = property.name.text
          initializer = property.name
        } else {
          return this.fail(property, "VIBE4117", "fanOut input objects do not support spreads, methods, or accessors")
        }
        if (Object.hasOwn(fields, name)) return this.fail(property, "VIBE4117", `duplicate fanOut input field ${name}`)
        fields[name] = this.lowerFanOutTemplate(initializer, env)
      }
      return { kind: "object", fields }
    }
    if (ts.isArrayLiteralExpression(expression)) {
      const items = expression.elements.map((element) => {
        if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) {
          return this.fail(element, "VIBE4117", "fanOut input arrays cannot contain holes or spreads")
        }
        return this.lowerFanOutTemplate(element, env)
      })
      return { kind: "array", items }
    }
    if (ts.isPropertyAccessExpression(expression)) {
      if (expression.questionDotToken !== undefined) {
        return this.fail(expression, "VIBE4117", "fanOut item keys and inputs cannot use optional projection")
      }
      return this.projectFanOutTemplate(
        this.lowerFanOutTemplate(expression.expression, env),
        expression.name.text,
        expression
      )
    }
    if (ts.isElementAccessExpression(expression)) {
      if (expression.questionDotToken !== undefined) {
        return this.fail(expression, "VIBE4117", "fanOut item keys and inputs cannot use optional projection")
      }
      const argument = expression.argumentExpression && unwrapParentheses(expression.argumentExpression)
      const key = argument && (ts.isStringLiteral(argument) || ts.isNumericLiteral(argument)) ? argument.text : undefined
      if (key === undefined) return this.fail(expression, "VIBE4117", "fanOut item projection keys must be static")
      return this.projectFanOutTemplate(
        this.lowerFanOutTemplate(expression.expression, env),
        key,
        expression
      )
    }
    return this.fail(
      expression,
      "VIBE4117",
      `unsupported fanOut template expression ${ts.SyntaxKind[expression.kind]}`
    )
  }

  private projectFanOutTemplate(
    value: FanOutTemplateExpr,
    key: string,
    node: ts.Node
  ): FanOutTemplateExpr {
    if (value.kind === "item") return { kind: "item", path: [...value.path, key] }
    if (value.kind === "step") return { kind: "step", step: value.step, path: [...value.path, key] }
    if (value.kind === "object" && Object.hasOwn(value.fields, key)) return value.fields[key]
    if (value.kind === "array") {
      if (!/^(0|[1-9][0-9]*)$/.test(key)) {
        return this.fail(node, "VIBE4117", `cannot project ${JSON.stringify(key)} from this fanOut template`)
      }
      const index = Number(key)
      if (Number.isSafeInteger(index) && index >= 0 && index < value.items.length) return value.items[index]
    }
    if (value.kind === "literal" && value.value !== null && typeof value.value === "object") {
      if (Array.isArray(value.value)) {
        if (!/^(0|[1-9][0-9]*)$/.test(key)) {
          return this.fail(node, "VIBE4117", `cannot project ${JSON.stringify(key)} from this fanOut template`)
        }
        const index = Number(key)
        if (Number.isSafeInteger(index) && index >= 0 && index < value.value.length) {
          return { kind: "literal", value: value.value[index] }
        }
      } else if (Object.hasOwn(value.value, key)) {
        return { kind: "literal", value: value.value[key] }
      }
    }
    return this.fail(node, "VIBE4117", `cannot project ${JSON.stringify(key)} from this fanOut template`)
  }

  private lowerFanOutCall(
    call: ts.CallExpression,
    anchor: string
  ): { readonly kind: "node"; readonly nodeId: string; readonly path: readonly string[] } | undefined {
    const callee = unwrapParentheses(call.expression)
    if (
      isTypeOnlyReference(this.checked.checker, callee) ||
      symbolAtExpression(this.checked.checker, callee) !== this.checked.fanOutSymbol
    ) return undefined
    if (
      call.arguments.length !== 3 || call.typeArguments !== undefined || call.questionDotToken !== undefined ||
      (call.expression.flags & ts.NodeFlags.OptionalChain) !== 0
    ) {
      return this.fail(
        call,
        "VIBE4117",
        "compiler-owned fanOut(items, item => item.key, item => Action.run(input)) requires exactly three static arguments"
      )
    }

    const items = this.lowerExpression(call.arguments[0], `${anchor}:items`)
    if (expressionDependencies(items).some((dependency) => this.fanOutNodeIds.has(dependency))) {
      return this.fail(call.arguments[0], "VIBE4117", "nested fanOut is outside the bounded runtime template subset")
    }
    const keyCallback = this.inlineFanOutCallback(call.arguments[1], "key")
    if (ts.isBlock(keyCallback.body)) {
      return this.fail(keyCallback.body, "VIBE4117", "durable fanOut key must be one expression arrow")
    }
    if (!isStableScalarKeyType(this.checked.checker.getTypeAtLocation(keyCallback.body))) {
      return this.fail(
        keyCallback.body,
        "VIBE4117",
        "durable fanOut key must statically be a string, number, or boolean"
      )
    }
    const key = this.lowerFanOutTemplate(keyCallback.body, {
      itemSymbol: keyCallback.itemSymbol,
      bindings: new Map()
    })
    if (key.kind !== "item") {
      return this.fail(keyCallback.body, "VIBE4117", "durable fanOut key must be a direct projection of the current item")
    }

    const bodyCallback = this.inlineFanOutCallback(call.arguments[2], "body", true)
    const env: FanOutTemplateEnv = { itemSymbol: bodyCallback.itemSymbol, bindings: new Map() }
    const steps = this.lowerFanOutBody(bodyCallback.body, env)
    const stepped = steps.length > 1
    if (stepped) this.usesFormatVersion2 = true

    const stepIdentities = steps.map((step) => ({
      actionId: step.descriptor.id,
      actionVersion: step.descriptor.version,
      actionContractDigest: step.descriptor.contractDigest,
      input: step.input
    }))
    // The single-step encoding stays byte- and identity-stable with the
    // original flat fan-out so existing artifacts and node ids do not churn.
    const identity = {
      file: this.logicalFileName,
      flowId: this.flowId,
      flowVersion: this.flowVersion,
      functionName: this.functionName,
      kind: "fanout",
      anchor,
      items,
      keyPath: key.path,
      ...(stepped
        ? { steps: stepIdentities }
        : {
          actionId: stepIdentities[0]!.actionId,
          actionVersion: stepIdentities[0]!.actionVersion,
          actionContractDigest: stepIdentities[0]!.actionContractDigest,
          input: stepIdentities[0]!.input
        })
    }
    const occurrenceKey = digest(identity)
    const occurrence = this.occurrences.get(occurrenceKey) ?? 0
    this.occurrences.set(occurrenceKey, occurrence + 1)
    const id = `src-${digest({ ...identity, occurrence }).slice(0, 24)}`
    if (this.nodeIds.has(id)) return this.fail(call, "VIBE4199", `stable durable node id collision ${id}`)
    this.nodeIds.add(id)
    this.fanOutNodeIds.add(id)
    const position = this.checked.sourceFile.getLineAndCharacterOfPosition(call.getStart(this.checked.sourceFile))
    const shared = {
      id,
      items,
      keyPath: key.path,
      dependencies: expressionDependencies(items),
      controlDependencies: this.sequencingDependency === undefined ? [] : [this.sequencingDependency],
      debug: {
        label: `fanOut:${stepIdentities.map((step) => step.actionId).join("+")}`,
        callSite: `${this.logicalFileName}:${position.line + 1}:${position.character + 1}`
      }
    }
    const node: FanOutNode = stepped
      ? { kind: "fanout", ...shared, steps: stepIdentities }
      : {
        kind: "fanout",
        ...shared,
        actionId: stepIdentities[0]!.actionId,
        actionVersion: stepIdentities[0]!.actionVersion,
        actionContractDigest: stepIdentities[0]!.actionContractDigest,
        input: stepIdentities[0]!.input
      }
    this.activeNodes.push(node)
    this.sequencingDependency = id
    return { kind: "node", nodeId: id, path: [] }
  }

  /**
   * Lowers a fan-out body into its ordered per-item Action steps. An
   * expression body is exactly one Action.run(template) call. A block body is
   * a bounded straight-line sequence: const bindings that are either pure
   * template projections or `Action.run(template).unwrap()` steps, ending with
   * a returned final Action.run(template) call.
   */
  private lowerFanOutBody(
    body: ts.Expression | ts.Block,
    env: FanOutTemplateEnv
  ): readonly { readonly descriptor: ActionDescriptor; readonly input: FanOutTemplateExpr }[] {
    const steps: { descriptor: ActionDescriptor; input: FanOutTemplateExpr }[] = []
    const lowerRun = (expressionValue: ts.Expression, requireUnwrap: boolean): number => {
      const expression = unwrapParentheses(expressionValue)
      let runCandidate: ts.Expression = expression
      if (requireUnwrap) {
        if (
          !ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression) ||
          expression.expression.name.text !== "unwrap" || expression.arguments.length !== 0 ||
          expression.typeArguments !== undefined || expression.questionDotToken !== undefined ||
          expression.expression.questionDotToken !== undefined
        ) {
          return this.fail(
            expressionValue,
            "VIBE4117",
            "intermediate fanOut steps must be direct imported Action.run(...).unwrap() calls"
          )
        }
        runCandidate = unwrapParentheses(expression.expression.expression)
      }
      if (
        !ts.isCallExpression(runCandidate) || !ts.isPropertyAccessExpression(runCandidate.expression) ||
        runCandidate.expression.name.text !== "run" || runCandidate.questionDotToken !== undefined ||
        runCandidate.expression.questionDotToken !== undefined
      ) {
        return this.fail(runCandidate, "VIBE4117", "durable fanOut steps must be direct imported Action.run(input) calls")
      }
      const actionReference = unwrapParentheses(runCandidate.expression.expression)
      if (isTypeOnlyReference(this.checked.checker, actionReference)) {
        return this.fail(actionReference, "VIBE4117", "fanOut body Action must be a runtime import")
      }
      const actionSymbol = symbolAtExpression(this.checked.checker, actionReference)
      const descriptor = actionSymbol && this.checked.actionsBySymbol.get(actionSymbol)
      if (descriptor === undefined) {
        return this.fail(actionReference, "VIBE4117", "fanOut body must target one compiler-bound Action")
      }
      if (runCandidate.arguments.length !== 1 || runCandidate.typeArguments !== undefined) {
        return this.fail(runCandidate, "VIBE4117", `${descriptor.id}.run requires exactly one fanOut item input`)
      }
      const input = this.lowerFanOutTemplate(runCandidate.arguments[0], env)
      const prior = this.usedActions.get(descriptor.id)
      if (prior !== undefined && prior.contractDigest !== descriptor.contractDigest) {
        return this.fail(runCandidate, "VIBE4114", `Action id ${descriptor.id} resolves to incompatible durable contracts`)
      }
      this.usedActions.set(descriptor.id, descriptor)
      if (steps.length >= MAX_FAN_OUT_STEPS) {
        return this.fail(runCandidate, "VIBE4117", `fanOut bodies support at most ${MAX_FAN_OUT_STEPS} Action steps`)
      }
      steps.push({ descriptor, input })
      return steps.length - 1
    }
    if (!ts.isBlock(body)) {
      lowerRun(body, false)
      return steps
    }
    let returned = false
    for (const statement of body.statements) {
      if (returned) {
        return this.fail(statement, "VIBE4117", "statements after the fanOut body return are not supported")
      }
      if (ts.isEmptyStatement(statement)) continue
      if (ts.isVariableStatement(statement)) {
        if (!(statement.declarationList.flags & ts.NodeFlags.Const)) {
          return this.fail(statement, "VIBE4117", "fanOut body bindings must use const")
        }
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) {
            return this.fail(declaration, "VIBE4117", "fanOut body const bindings require one identifier and an initializer")
          }
          const symbol = this.checked.checker.getSymbolAtLocation(declaration.name)
          if (symbol === undefined) {
            return this.fail(declaration.name, "VIBE4199", "compiler could not resolve fanOut body binding")
          }
          const initializer = unwrapParentheses(declaration.initializer)
          const isUnwrapCall = ts.isCallExpression(initializer) &&
            ts.isPropertyAccessExpression(initializer.expression) &&
            initializer.expression.name.text === "unwrap"
          if (isUnwrapCall) {
            const stepIndex = lowerRun(initializer, true)
            env.bindings.set(symbol, { kind: "step", step: stepIndex, path: [] })
          } else {
            env.bindings.set(symbol, this.lowerFanOutTemplate(declaration.initializer, env))
          }
        }
        continue
      }
      if (ts.isReturnStatement(statement)) {
        if (statement.expression === undefined) {
          return this.fail(statement, "VIBE4117", "fanOut body must return its final Action.run(...) call")
        }
        lowerRun(statement.expression, false)
        returned = true
        continue
      }
      return this.fail(statement, "VIBE4117", `unsupported fanOut body statement ${ts.SyntaxKind[statement.kind]}`)
    }
    if (!returned) return this.fail(body, "VIBE4117", "fanOut body must return its final Action.run(...) call")
    return steps
  }

  private inlineLoopCallback(
    expressionValue: ts.Expression,
    label: "condition" | "body"
  ): { readonly stateSymbol: ts.Symbol; readonly body: ts.Expression } {
    const expression = unwrapParentheses(expressionValue)
    if (
      !ts.isArrowFunction(expression) || ts.isBlock(expression.body) ||
      expression.parameters.length !== 1 || expression.typeParameters !== undefined ||
      ts.getModifiers(expression)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
    ) {
      return this.fail(
        expression,
        "VIBE4121",
        `durable loopWhile ${label} must be one inline, synchronous expression arrow with one state parameter`
      )
    }
    const parameter = expression.parameters[0]
    if (
      !ts.isIdentifier(parameter.name) || parameter.initializer !== undefined ||
      parameter.dotDotDotToken !== undefined || parameter.questionToken !== undefined
    ) {
      return this.fail(parameter, "VIBE4121", `durable loopWhile ${label} parameter must be one required state identifier`)
    }
    const stateSymbol = this.checked.checker.getSymbolAtLocation(parameter.name)
    if (stateSymbol === undefined) return this.fail(parameter.name, "VIBE4199", "compiler could not bind loop state")
    return { stateSymbol, body: expression.body }
  }

  private lowerLoopTemplate(
    expressionValue: ts.Expression,
    stateSymbol: ts.Symbol
  ): LoopTemplateExpr {
    const expression = unwrapParentheses(expressionValue)
    if (ts.isIdentifier(expression)) {
      if (this.checked.checker.getSymbolAtLocation(expression) === stateSymbol) {
        return { kind: "state", path: [] }
      }
      return this.fail(
        expression,
        "VIBE4121",
        `durable loop templates cannot capture ${expression.text}; use only the current state and literals`
      )
    }
    if (expression.kind === ts.SyntaxKind.NullKeyword) return { kind: "literal", value: null }
    if (expression.kind === ts.SyntaxKind.TrueKeyword) return { kind: "literal", value: true }
    if (expression.kind === ts.SyntaxKind.FalseKeyword) return { kind: "literal", value: false }
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return { kind: "literal", value: expression.text }
    }
    if (ts.isNumericLiteral(expression)) {
      const value = Number(expression.text)
      if (!Number.isFinite(value)) return this.fail(expression, "VIBE4121", "loop template number is not canonical")
      return { kind: "literal", value }
    }
    if (
      ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(expression.operand)
    ) {
      const value = -Number(expression.operand.text)
      if (!Number.isFinite(value) || Object.is(value, -0)) {
        return this.fail(expression, "VIBE4121", "loop template number is not canonical")
      }
      return { kind: "literal", value }
    }
    if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) {
      return { kind: "unary", operator: "not", value: this.lowerLoopTemplate(expression.operand, stateSymbol) }
    }
    if (ts.isBinaryExpression(expression)) {
      const operator = this.loopBinaryOperator(expression)
      return {
        kind: "binary",
        operator,
        left: this.lowerLoopTemplate(expression.left, stateSymbol),
        right: this.lowerLoopTemplate(expression.right, stateSymbol)
      }
    }
    if (ts.isObjectLiteralExpression(expression)) {
      const fields = Object.create(null) as Record<string, LoopTemplateExpr>
      for (const property of expression.properties) {
        let name: string
        let initializer: ts.Expression
        if (ts.isPropertyAssignment(property)) {
          name = this.propertyName(property.name)
          initializer = property.initializer
        } else if (ts.isShorthandPropertyAssignment(property)) {
          name = property.name.text
          initializer = property.name
        } else {
          return this.fail(property, "VIBE4121", "loop templates do not support spreads, methods, or accessors")
        }
        if (Object.hasOwn(fields, name)) return this.fail(property, "VIBE4121", `duplicate loop template field ${name}`)
        fields[name] = this.lowerLoopTemplate(initializer, stateSymbol)
      }
      return { kind: "object", fields }
    }
    if (ts.isArrayLiteralExpression(expression)) {
      const items = expression.elements.map((element) => {
        if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) {
          return this.fail(element, "VIBE4121", "loop template arrays cannot contain holes or spreads")
        }
        return this.lowerLoopTemplate(element, stateSymbol)
      })
      return { kind: "array", items }
    }
    if (ts.isPropertyAccessExpression(expression)) {
      if (expression.questionDotToken !== undefined) {
        return this.fail(expression, "VIBE4121", "loop templates cannot use optional projection")
      }
      return this.projectLoopTemplate(
        this.lowerLoopTemplate(expression.expression, stateSymbol),
        expression.name.text,
        expression
      )
    }
    if (ts.isElementAccessExpression(expression)) {
      if (expression.questionDotToken !== undefined) {
        return this.fail(expression, "VIBE4121", "loop templates cannot use optional projection")
      }
      const argument = expression.argumentExpression && unwrapParentheses(expression.argumentExpression)
      const key = argument && (ts.isStringLiteral(argument) || ts.isNumericLiteral(argument)) ? argument.text : undefined
      if (key === undefined) return this.fail(expression, "VIBE4121", "loop template projection keys must be static")
      return this.projectLoopTemplate(
        this.lowerLoopTemplate(expression.expression, stateSymbol),
        key,
        expression
      )
    }
    return this.fail(expression, "VIBE4121", `unsupported loop template expression ${ts.SyntaxKind[expression.kind]}`)
  }

  private loopBinaryOperator(expression: ts.BinaryExpression): Extract<LoopTemplateExpr, { kind: "binary" }>["operator"] {
    switch (expression.operatorToken.kind) {
      case ts.SyntaxKind.EqualsEqualsEqualsToken: return "eq"
      case ts.SyntaxKind.ExclamationEqualsEqualsToken: return "neq"
      case ts.SyntaxKind.GreaterThanToken: return "gt"
      case ts.SyntaxKind.GreaterThanEqualsToken: return "gte"
      case ts.SyntaxKind.LessThanToken: return "lt"
      case ts.SyntaxKind.LessThanEqualsToken: return "lte"
      case ts.SyntaxKind.AmpersandAmpersandToken: return "and"
      case ts.SyntaxKind.BarBarToken: return "or"
      case ts.SyntaxKind.PlusToken: {
        const type = this.checked.checker.getTypeAtLocation(expression)
        if ((type.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral)) !== 0) return "concat"
        if ((type.flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) !== 0) return "add"
        return this.fail(expression, "VIBE4121", "loop template + must be statically number or string")
      }
      default:
        return this.fail(
          expression.operatorToken,
          "VIBE4121",
          `unsupported loop template operator ${ts.SyntaxKind[expression.operatorToken.kind]}`
        )
    }
  }

  private projectLoopTemplate(
    value: LoopTemplateExpr,
    key: string,
    node: ts.Node
  ): LoopTemplateExpr {
    if (value.kind === "state") return { kind: "state", path: [...value.path, key] }
    if (value.kind === "object" && Object.hasOwn(value.fields, key)) return value.fields[key]
    if (value.kind === "array") {
      if (!/^(0|[1-9][0-9]*)$/.test(key)) {
        return this.fail(node, "VIBE4121", `cannot project ${JSON.stringify(key)} from this loop template`)
      }
      const index = Number(key)
      if (Number.isSafeInteger(index) && index >= 0 && index < value.items.length) return value.items[index]
    }
    if (value.kind === "literal" && value.value !== null && typeof value.value === "object") {
      if (Array.isArray(value.value)) {
        if (!/^(0|[1-9][0-9]*)$/.test(key)) {
          return this.fail(node, "VIBE4121", `cannot project ${JSON.stringify(key)} from this loop template`)
        }
        const index = Number(key)
        if (Number.isSafeInteger(index) && index >= 0 && index < value.value.length) {
          return { kind: "literal", value: value.value[index] }
        }
      } else if (Object.hasOwn(value.value, key)) {
        return { kind: "literal", value: value.value[key] }
      }
    }
    return this.fail(node, "VIBE4121", `cannot project ${JSON.stringify(key)} from this loop template`)
  }

  /**
   * Provisional compiler-owned
   * `loopWhile(initial, state => condition, state => Action.run(input), maxRounds)`
   * lowering: a runtime-round while template whose per-round Action success
   * becomes the next durable state, with an explicit literal round budget.
   */
  private lowerLoopCall(
    call: ts.CallExpression,
    anchor: string
  ): { readonly kind: "node"; readonly nodeId: string; readonly path: readonly string[] } | undefined {
    const callee = unwrapParentheses(call.expression)
    if (
      isTypeOnlyReference(this.checked.checker, callee) ||
      symbolAtExpression(this.checked.checker, callee) !== this.checked.loopSymbol
    ) return undefined
    if (
      call.arguments.length !== 4 || call.typeArguments !== undefined || call.questionDotToken !== undefined ||
      (call.expression.flags & ts.NodeFlags.OptionalChain) !== 0
    ) {
      return this.fail(
        call,
        "VIBE4121",
        "compiler-owned loopWhile(initial, state => condition, state => Action.run(input), maxRounds) requires exactly four static arguments"
      )
    }
    const initial = this.lowerExpression(call.arguments[0], `${anchor}:initial`)

    const conditionCallback = this.inlineLoopCallback(call.arguments[1], "condition")
    const isBoolean = (type: ts.Type): boolean =>
      (type.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) !== 0 ||
      (type.isUnion() && type.types.length > 0 && type.types.every(isBoolean))
    if (!isBoolean(this.checked.checker.getTypeAtLocation(conditionCallback.body))) {
      return this.fail(conditionCallback.body, "VIBE4121", "durable loopWhile condition must statically be boolean")
    }
    const condition = this.lowerLoopTemplate(conditionCallback.body, conditionCallback.stateSymbol)

    const bodyCallback = this.inlineLoopCallback(call.arguments[2], "body")
    const body = unwrapParentheses(bodyCallback.body)
    if (
      !ts.isCallExpression(body) || !ts.isPropertyAccessExpression(body.expression) ||
      body.expression.name.text !== "run" || body.questionDotToken !== undefined ||
      body.expression.questionDotToken !== undefined
    ) {
      return this.fail(body, "VIBE4121", "durable loopWhile body must be exactly one imported Action.run(input) call")
    }
    const actionReference = unwrapParentheses(body.expression.expression)
    if (isTypeOnlyReference(this.checked.checker, actionReference)) {
      return this.fail(actionReference, "VIBE4121", "loopWhile body Action must be a runtime import")
    }
    const actionSymbol = symbolAtExpression(this.checked.checker, actionReference)
    const descriptor = actionSymbol && this.checked.actionsBySymbol.get(actionSymbol)
    if (descriptor === undefined) {
      return this.fail(actionReference, "VIBE4121", "loopWhile body must target one compiler-bound Action")
    }
    if (body.arguments.length !== 1 || body.typeArguments !== undefined) {
      return this.fail(body, "VIBE4121", `${descriptor.id}.run requires exactly one loop state input`)
    }
    const bodyTemplate = this.lowerLoopTemplate(body.arguments[0], bodyCallback.stateSymbol)
    const prior = this.usedActions.get(descriptor.id)
    if (prior !== undefined && prior.contractDigest !== descriptor.contractDigest) {
      return this.fail(body, "VIBE4114", `Action id ${descriptor.id} resolves to incompatible durable contracts`)
    }
    this.usedActions.set(descriptor.id, descriptor)

    const budgetExpression = unwrapParentheses(call.arguments[3])
    if (!ts.isNumericLiteral(budgetExpression)) {
      return this.fail(call.arguments[3], "VIBE4121", "durable loopWhile round budget must be a static numeric literal")
    }
    const maxRounds = Number(budgetExpression.text)
    if (!Number.isSafeInteger(maxRounds) || maxRounds < 1 || maxRounds > MAX_LOOP_ROUNDS) {
      return this.fail(
        budgetExpression,
        "VIBE4121",
        `durable loopWhile round budget must be an integer between 1 and ${MAX_LOOP_ROUNDS}`
      )
    }

    this.usesFormatVersion2 = true
    const identity = {
      file: this.logicalFileName,
      flowId: this.flowId,
      flowVersion: this.flowVersion,
      functionName: this.functionName,
      kind: "loop",
      anchor,
      initial,
      condition,
      actionId: descriptor.id,
      actionVersion: descriptor.version,
      actionContractDigest: descriptor.contractDigest,
      body: bodyTemplate,
      maxRounds
    }
    const occurrenceKey = digest(identity)
    const occurrence = this.occurrences.get(occurrenceKey) ?? 0
    this.occurrences.set(occurrenceKey, occurrence + 1)
    const id = `src-${digest({ ...identity, occurrence }).slice(0, 24)}`
    if (this.nodeIds.has(id)) return this.fail(call, "VIBE4199", `stable durable node id collision ${id}`)
    this.nodeIds.add(id)
    const position = this.checked.sourceFile.getLineAndCharacterOfPosition(call.getStart(this.checked.sourceFile))
    const node: LoopNode = {
      kind: "loop",
      id,
      initial,
      condition,
      actionId: descriptor.id,
      actionVersion: descriptor.version,
      actionContractDigest: descriptor.contractDigest,
      body: bodyTemplate,
      maxRounds,
      dependencies: expressionDependencies(initial),
      controlDependencies: this.sequencingDependency === undefined ? [] : [this.sequencingDependency],
      debug: {
        label: `loopWhile:${descriptor.id}`,
        callSite: `${this.logicalFileName}:${position.line + 1}:${position.character + 1}`
      }
    }
    this.activeNodes.push(node)
    this.sequencingDependency = id
    return { kind: "node", nodeId: id, path: [] }
  }

  private lowerConditionalExpression(
    expression: ts.ConditionalExpression,
    anchor: string,
    allowFinalAction: boolean
  ): ValueExpr {
    const conditionType = this.checked.checker.getTypeAtLocation(expression.condition)
    const isBoolean = (type: ts.Type): boolean =>
      (type.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) !== 0 ||
      (type.isUnion() && type.types.length > 0 && type.types.every(isBoolean))
    if (!isBoolean(conditionType)) {
      return this.fail(
        expression.condition,
        "VIBE4106",
        "durable conditional expressions require a statically boolean condition"
      )
    }

    const condition = this.lowerExpression(expression.condition, `${anchor}:condition`)
    const parentSequencing = this.sequencingDependency
    const whenTrue = this.lowerFragment(expression.whenTrue, `${anchor}:true`, allowFinalAction)
    const whenFalse = this.lowerFragment(expression.whenFalse, `${anchor}:false`, allowFinalAction)
    const identity = {
      file: this.logicalFileName,
      flowId: this.flowId,
      flowVersion: this.flowVersion,
      functionName: this.functionName,
      kind: "branch",
      anchor,
      condition
    }
    const occurrenceKey = digest(identity)
    const occurrence = this.occurrences.get(occurrenceKey) ?? 0
    this.occurrences.set(occurrenceKey, occurrence + 1)
    const id = `src-${digest({ ...identity, occurrence }).slice(0, 24)}`
    if (this.nodeIds.has(id)) return this.fail(expression, "VIBE4199", `stable durable node id collision ${id}`)
    this.nodeIds.add(id)
    const position = this.checked.sourceFile.getLineAndCharacterOfPosition(expression.questionToken.getStart(this.checked.sourceFile))
    const node: BranchNode = {
      kind: "branch",
      id,
      condition,
      whenTrue,
      whenFalse,
      dependencies: expressionDependencies(condition),
      controlDependencies: parentSequencing === undefined ? [] : [parentSequencing],
      debug: {
        label: "conditional",
        callSite: `${this.logicalFileName}:${position.line + 1}:${position.character + 1}`
      }
    }
    this.activeNodes.push(node)
    // Any later source expression must observe the selected arm before it can
    // proceed, including an arm whose value itself has no data dependency.
    this.sequencingDependency = id
    return { kind: "node", nodeId: id, path: [] }
  }

  private lowerFragment(
    expression: ts.Expression,
    anchor: string,
    allowFinalAction: boolean
  ): PlanFragment {
    const parentNodes = this.activeNodes
    const parentSequencing = this.sequencingDependency
    const nodes: PlanNode[] = []
    this.activeNodes = nodes
    this.sequencingDependency = undefined
    try {
      return {
        nodes,
        output: this.lowerExpression(expression, anchor, allowFinalAction)
      }
    } finally {
      this.activeNodes = parentNodes
      this.sequencingDependency = parentSequencing
    }
  }

  private lowerActionCall(
    call: ts.CallExpression,
    anchor: string
  ): { readonly kind: "node"; readonly nodeId: string; readonly path: readonly string[] } | undefined {
    if (
      !ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== "run" ||
      call.questionDotToken !== undefined || call.expression.questionDotToken !== undefined
    ) return undefined
    const actionReference = unwrapParentheses(call.expression.expression)
    if (isTypeOnlyReference(this.checked.checker, actionReference)) return undefined
    const actionSymbol = symbolAtExpression(this.checked.checker, actionReference)
    const descriptor = actionSymbol && this.checked.actionsBySymbol.get(actionSymbol)
    if (descriptor === undefined) return undefined
    if (call.arguments.length !== 1 || call.typeArguments !== undefined) {
      return this.fail(call, "VIBE4113", `${descriptor.id}.run requires exactly one input argument in durable source`)
    }
    const input = this.lowerExpression(call.arguments[0], `${anchor}:input`)
    const prior = this.usedActions.get(descriptor.id)
    if (prior !== undefined && prior.contractDigest !== descriptor.contractDigest) {
      return this.fail(call, "VIBE4114", `Action id ${descriptor.id} resolves to incompatible durable contracts`)
    }
    this.usedActions.set(descriptor.id, descriptor)
    const identity = {
      file: this.logicalFileName,
      flowId: this.flowId,
      flowVersion: this.flowVersion,
      functionName: this.functionName,
      anchor,
      actionId: descriptor.id,
      actionVersion: descriptor.version,
      actionContractDigest: descriptor.contractDigest,
      input
    }
    const occurrenceKey = digest(identity)
    const occurrence = this.occurrences.get(occurrenceKey) ?? 0
    this.occurrences.set(occurrenceKey, occurrence + 1)
    const id = `src-${digest({ ...identity, occurrence }).slice(0, 24)}`
    if (this.nodeIds.has(id)) return this.fail(call, "VIBE4199", `stable durable node id collision ${id}`)
    this.nodeIds.add(id)
    const position = this.checked.sourceFile.getLineAndCharacterOfPosition(call.getStart(this.checked.sourceFile))
    const node: ActionNode = {
      kind: "action",
      id,
      actionId: descriptor.id,
      actionVersion: descriptor.version,
      actionContractDigest: descriptor.contractDigest,
      input,
      dependencies: expressionDependencies(input),
      controlDependencies: this.sequencingDependency === undefined ? [] : [this.sequencingDependency],
      debug: {
        label: descriptor.id,
        callSite: `${this.logicalFileName}:${position.line + 1}:${position.character + 1}`
      }
    }
    this.activeNodes.push(node)
    return { kind: "node", nodeId: id, path: [] }
  }

  private propertyName(name: ts.PropertyName): string {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
    return this.fail(name, "VIBE4111", "durable object field names must be static")
  }

  private project(value: ValueExpr, key: string, node: ts.Node): ValueExpr {
    if (value.kind === "input" || value.kind === "node") return { ...value, path: [...value.path, key] }
    if (value.kind === "object" && Object.hasOwn(value.fields, key)) return value.fields[key]
    if (value.kind === "array") {
      const index = Number(key)
      if (Number.isSafeInteger(index) && index >= 0 && index < value.items.length) return value.items[index]
    }
    if (value.kind === "literal" && value.value !== null && typeof value.value === "object") {
      if (Array.isArray(value.value)) {
        const index = Number(key)
        if (Number.isSafeInteger(index) && index >= 0 && index < value.value.length) {
          return { kind: "literal", value: value.value[index] }
        }
      } else if (Object.hasOwn(value.value, key)) {
        return { kind: "literal", value: value.value[key] }
      }
    }
    return this.fail(node, "VIBE4111", `cannot project ${JSON.stringify(key)} from this durable expression`)
  }
}

export const compileDurableSource = (
  source: string,
  options: DurableSourceCompileOptions
): DurableSourceCompileResult => {
  let logicalFileName = "durable-source.ts"
  let sourceFile: ts.SourceFile | undefined
  try {
    if (typeof source !== "string") throw new TypeError("Durable source must be a string")
    if (options === null || typeof options !== "object") throw new TypeError("Durable source compiler options are required")
    logicalFileName = normalizeLogicalFileName(options.fileName)
    if (new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES) {
      return {
        ok: false,
        diagnostics: [Object.freeze({
          code: "VIBE4101",
          message: "durable source exceeds the compiler input size limit",
          file: logicalFileName,
          line: 1,
          column: 1,
          length: 1
        })]
      }
    }
    const checked = checkedSource(source, logicalFileName, options.actions, options.flows ?? [])
    sourceFile = checked.sourceFile
    if (checked.sourceDiagnostics.length > 0) {
      const parse = checked.sourceDiagnostics[0]
      const start = parse.start ?? 0
      const position = checked.sourceFile.getLineAndCharacterOfPosition(start)
      return {
        ok: false,
        diagnostics: [Object.freeze({
          code: "VIBE4100",
          message: ts.flattenDiagnosticMessageText(parse.messageText, "\n"),
          file: logicalFileName,
          line: position.line + 1,
          column: position.character + 1,
          length: Math.max(1, parse.length ?? 1)
        })]
      }
    }
    const fail = (node: ts.Node, code: string, message: string): never => {
      throw new LoweringFailure(diagnosticAt(logicalFileName, checked.sourceFile, node, code, message))
    }
    const calls = findDurableCalls(checked)
    if (calls.length === 0) fail(checked.sourceFile, "VIBE4102", "no imported vibelang:flows durable(...) call was found")
    if (calls.length > 1) fail(calls[1], "VIBE4102", "bounded durable source compilation accepts exactly one durable(...) declaration")
    const call = calls[0]
    const sourceFunction = resolvedFunction(checked, call, fail)
    const declarationName = declarationNameFor(call, sourceFunction)
    const flowId = options.flowId ?? `${logicalFileName}#${declarationName}`
    const flowVersion = options.flowVersion ?? 1
    if (typeof flowId !== "string" || flowId.trim() === "") fail(call, "VIBE4101", "durable Flow id must be non-empty")
    if (!Number.isSafeInteger(flowVersion) || flowVersion < 1) fail(call, "VIBE4101", "durable Flow version must be a positive safe integer")
    const lowerer = new FunctionLowerer(
      checked,
      logicalFileName,
      flowId,
      flowVersion,
      sourceFunction.name?.text ?? declarationName,
      fail
    )
    const output = lowerer.lower(sourceFunction)
    const actions = [...lowerer.usedActions.values()]
      .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    const childFlows = [...lowerer.usedChildFlows.values()]
      .sort((left, right) => left.digest < right.digest ? -1 : left.digest > right.digest ? 1 : 0)
    const childFlowsByDigest = new Map(childFlows.map((child) => [child.digest, child]))
    const schemas = flowSchemas(checked, sourceFunction, output, lowerer.nodes, actions, childFlowsByDigest, fail)
    // The compiler emits the minimal Plan format a program needs so plans in
    // the pre-existing subset keep their exact bytes, digests, and node ids.
    const formatVersion = lowerer.usesFormatVersion2 ? 2 as const : 1 as const
    const semantic = {
      formatVersion,
      flowId,
      flowVersion,
      flowSchemas: schemas,
      nodes: lowerer.nodes,
      output,
      requirements: actions.map((action) => action.id),
      actions,
      ...(childFlows.length === 0 ? {} : { childFlows })
    }
    const plan = validatePlanTemplate({ ...semantic, digest: digest(semantic) })
    const artifact = encodePlanArtifact(plan)
    return Object.freeze({
      ok: true,
      diagnostics: [] as const,
      plan,
      artifact,
      flow: loadCompiledFlow(artifact)
    })
  } catch (error) {
    if (error instanceof LoweringFailure) return { ok: false, diagnostics: [error.diagnostic] }
    const fallback = sourceFile ?? ts.createSourceFile(
      logicalFileName,
      typeof source === "string" ? source : "",
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TS
    )
    return {
      ok: false,
      diagnostics: [diagnosticAt(
        logicalFileName,
        fallback,
        fallback,
        "VIBE4199",
        `durable source compiler failed closed: ${error instanceof Error ? error.message : String(error)}`
      )]
    }
  }
}

export const DurableSourceCompiler = Object.freeze({ compile: compileDurableSource })
