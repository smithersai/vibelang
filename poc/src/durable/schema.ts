import { resolve } from "node:path"
import * as ts from "typescript-js"
import {
  assertJson,
  canonicalJson,
  deepFreeze,
  derivedSchema,
  digest,
  structuralSchema,
  type ActionDescriptor,
  type DurableObjectField,
  type DurableSchema,
  type DurableTypeDescriptor,
  type JsonValue,
  type StructuralDurableSchema
} from "./ir.ts"

const CONTRACT_ROOT = "/smithers-durable-contract-compiler"
const MAX_SOURCE_BYTES = 2 * 1024 * 1024
const MAX_DESCRIPTOR_DEPTH = 64
const MAX_DESCRIPTOR_NODES = 10_000
const MAX_UNION_VARIANTS = 128
const MAX_OBJECT_FIELDS = 1_024
const MAX_IDENTITY_LENGTH = 256

const RESULT_PRELUDE = `
interface Result<A, E extends Error> {
  readonly __smithersResult: { readonly success: A; readonly error: E }
}
`

const ACTION_PRELUDE = `
export declare abstract class Action<Signature extends (input: any) => any> {
  static run(input: never): never
}
`

export interface ActionContractDiagnostic {
  readonly code: "SMITHERS4200" | "SMITHERS4201" | "SMITHERS4202" | "SMITHERS4203"
  readonly message: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly length: number
}

export interface CompileActionContractOptions {
  readonly fileName?: string
  readonly exportName: string
  readonly id: string
  readonly version: number
}

export type CompileActionContractResult =
  | {
    readonly ok: true
    readonly diagnostics: readonly []
    readonly descriptor: ActionDescriptor
    /** Checked declaration used by the durable source compiler's virtual module. */
    readonly declaration: string
  }
  | { readonly ok: false; readonly diagnostics: readonly ActionContractDiagnostic[] }

export class DurableCodecError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DurableCodecError"
  }
}

class ContractFailure extends Error {
  constructor(
    readonly code: ActionContractDiagnostic["code"],
    readonly node: ts.Node,
    message: string
  ) {
    super(message)
    this.name = "ContractFailure"
  }
}

const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

const logicalFileName = (fileName: string | undefined): string => {
  const candidate = (fileName ?? "actions.sm").replace(/\\/g, "/")
  const parts = candidate.split("/").filter((part) => part !== "" && part !== "." && part !== "..")
  return parts.join("/") || "actions.sm"
}

const canonicalSymbol = (checker: ts.TypeChecker, symbol: ts.Symbol | undefined): ts.Symbol | undefined => {
  if (symbol === undefined) return undefined
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
}

const identifier = (value: string, label: string): string => {
  if (!/^[$A-Z_a-z][$0-9A-Z_a-z]*$/.test(value)) throw new TypeError(`${label} must be an identifier`)
  return value
}

const stableIdentity = (fileName: string, name: string): string => {
  const raw = `smithers:${fileName}#${name}@1`
  const normalized = raw.replace(/[^A-Za-z0-9._/@:+-]/g, "_")
  if (normalized.length > MAX_IDENTITY_LENGTH) {
    return `smithers:error/${digest({ fileName, name }).slice(0, 48)}@1`
  }
  return normalized
}

interface ContractProgram {
  readonly sourceFile: ts.SourceFile
  readonly resultFile: ts.SourceFile
  readonly actionFile: ts.SourceFile
  readonly checker: ts.TypeChecker
  readonly diagnostics: readonly ts.Diagnostic[]
}

const createContractProgram = (source: string, fileName: string): ContractProgram => {
  const compilerFileName = /\.[cm]?tsx?$/.test(fileName) ? fileName : `${fileName}.ts`
  const inputPath = resolve(CONTRACT_ROOT, "__input__", compilerFileName)
  const resultPath = resolve(CONTRACT_ROOT, "__compiler__", "result.d.ts")
  const actionPath = resolve(CONTRACT_ROOT, "__compiler__", "flows.d.ts")
  const virtualSources = new Map<string, string>([
    [inputPath, source],
    [resultPath, RESULT_PRELUDE],
    [actionPath, ACTION_PRELUDE]
  ])
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: []
  }
  const host = ts.createCompilerHost(options, true)
  const originalGetSourceFile = host.getSourceFile.bind(host)
  const originalFileExists = host.fileExists.bind(host)
  const originalReadFile = host.readFile.bind(host)
  const originalDirectoryExists = host.directoryExists?.bind(host)
  const originalRealpath = host.realpath?.bind(host)
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    const text = virtualSources.get(resolve(name))
    return text === undefined
      ? originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(resolve(name), text, languageVersion, true, ts.ScriptKind.TS)
  }
  host.fileExists = (name) => virtualSources.has(resolve(name)) || originalFileExists(name)
  host.readFile = (name) => virtualSources.get(resolve(name)) ?? originalReadFile(name)
  host.directoryExists = (name) => resolve(name).startsWith(CONTRACT_ROOT) || Boolean(originalDirectoryExists?.(name))
  host.realpath = (name) => virtualSources.has(resolve(name)) ? resolve(name) : (originalRealpath?.(name) ?? resolve(name))
  host.resolveModuleNames = (moduleNames, containingFile) => moduleNames.map((moduleName) => {
    if (moduleName === "smithers:flows") {
      return { resolvedFileName: actionPath, extension: ts.Extension.Dts, isExternalLibraryImport: true }
    }
    return ts.resolveModuleName(moduleName, containingFile, options, host).resolvedModule
  })
  const program = ts.createProgram([...virtualSources.keys()], options, host)
  const sourceFile = program.getSourceFile(inputPath)
  const resultFile = program.getSourceFile(resultPath)
  const actionFile = program.getSourceFile(actionPath)
  if (sourceFile === undefined || resultFile === undefined || actionFile === undefined) {
    throw new Error("durable contract compiler failed to create its virtual program")
  }
  const diagnostics = [
    ...program.getSyntacticDiagnostics(sourceFile),
    ...program.getSemanticDiagnostics(sourceFile)
  ].sort((left, right) => (left.start ?? 0) - (right.start ?? 0) || left.code - right.code)
  return { sourceFile, resultFile, actionFile, checker: program.getTypeChecker(), diagnostics }
}

const diagnosticAt = (
  fileName: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  code: ActionContractDiagnostic["code"],
  message: string
): ActionContractDiagnostic => {
  const start = node.getStart(sourceFile)
  const position = sourceFile.getLineAndCharacterOfPosition(start)
  return Object.freeze({
    code,
    message,
    file: fileName,
    line: position.line + 1,
    column: position.character + 1,
    length: Math.max(1, node.getWidth(sourceFile))
  })
}

const compilerSymbol = (
  file: ts.SourceFile,
  checker: ts.TypeChecker,
  predicate: (node: ts.Node) => node is ts.DeclarationStatement
): ts.Symbol => {
  const declaration = file.statements.find(predicate)
  const name = declaration && "name" in declaration ? declaration.name : undefined
  const symbol = name && ts.isIdentifier(name) ? checker.getSymbolAtLocation(name) : undefined
  if (symbol === undefined) throw new Error("durable contract compiler failed to bind its prelude")
  return symbol
}

const typeReferenceArguments = (type: ts.Type, checker: ts.TypeChecker): readonly ts.Type[] => {
  if (!(type.flags & ts.TypeFlags.Object)) return []
  try {
    return checker.getTypeArguments(type as ts.TypeReference)
  } catch {
    return []
  }
}

const typeReferenceSymbol = (type: ts.Type, checker: ts.TypeChecker): ts.Symbol | undefined => {
  const reference = type as ts.TypeReference
  return canonicalSymbol(checker, reference.target?.symbol ?? type.aliasSymbol ?? type.symbol)
}

const declarationHasTypeParameters = (symbol: ts.Symbol | undefined): boolean =>
  Boolean(symbol?.declarations?.some((declaration) =>
    "typeParameters" in declaration && (declaration.typeParameters as ts.NodeArray<ts.TypeParameterDeclaration> | undefined)?.length
  ))

const descriptorKey = (descriptor: DurableTypeDescriptor): string => canonicalJson(descriptor as unknown as JsonValue)

class DescriptorBuilder {
  private nodes = 0
  private readonly active = new Set<ts.Type>()

  constructor(
    private readonly checker: ts.TypeChecker,
    private readonly sourceFile: ts.SourceFile,
    private readonly logicalNameForSource: (sourceFile: ts.SourceFile) => string,
    private readonly anchor: ts.Node,
    private readonly errorSymbol: ts.Symbol
  ) {}

  value(type: ts.Type, path: string, depth = 0, optional = false): DurableTypeDescriptor {
    if (depth > MAX_DESCRIPTOR_DEPTH) this.fail(`${path} exceeds the durable type depth limit`)
    this.nodes += 1
    if (this.nodes > MAX_DESCRIPTOR_NODES) this.fail("durable contract exceeds the descriptor node limit")

    if (type.flags & ts.TypeFlags.Any) this.fail(`${path} uses any and needs an explicit durable codec`)
    if (type.flags & ts.TypeFlags.Unknown) this.fail(`${path} uses unknown and needs an explicit durable codec`)
    if (type.flags & ts.TypeFlags.TypeParameter) this.fail(`${path} contains an unresolved generic type`)
    if (type.flags & ts.TypeFlags.Never) this.fail(`${path} is never and has no durable value representation`)
    if (type.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) {
      this.fail(`${path} contains undefined/void; only an optional object field may be absent`)
    }
    if (type.flags & ts.TypeFlags.ESSymbolLike) this.fail(`${path} contains a symbol, which is not durable`)
    if (type.flags & ts.TypeFlags.BigIntLike) this.fail(`${path} contains bigint, which is not in canonical JSON`)
    if (type.flags & ts.TypeFlags.Null) return { kind: "null" }
    if (type.flags & ts.TypeFlags.StringLiteral) {
      return { kind: "literal", value: (type as ts.StringLiteralType).value }
    }
    if (type.flags & ts.TypeFlags.NumberLiteral) {
      const value = (type as ts.NumberLiteralType).value
      if (!Number.isFinite(value) || Object.is(value, -0)) this.fail(`${path} has a non-canonical number literal`)
      return { kind: "literal", value }
    }
    if (type.flags & ts.TypeFlags.BooleanLiteral) {
      return { kind: "literal", value: (type as ts.Type & { readonly intrinsicName?: string }).intrinsicName === "true" }
    }
    if (type.flags & ts.TypeFlags.String) return { kind: "string" }
    if (type.flags & ts.TypeFlags.Number) return { kind: "number" }
    if (type.flags & ts.TypeFlags.Boolean) return { kind: "boolean" }

    if (type.isUnion()) {
      let members = [...type.types]
      const undefinedMembers = members.filter((member) => member.flags & ts.TypeFlags.Undefined)
      if (undefinedMembers.length > 0) {
        if (!optional) this.fail(`${path} includes undefined outside an optional object field`)
        members = members.filter((member) => !(member.flags & ts.TypeFlags.Undefined))
      }
      if (members.length === 0) this.fail(`${path} has no durable union variants`)
      if (members.length === 1) return this.value(members[0], path, depth + 1)
      if (members.length > MAX_UNION_VARIANTS) this.fail(`${path} exceeds the durable union variant limit`)
      const variants = members.map((member, index) => this.value(member, `${path} variant ${index + 1}`, depth + 1))
      const unique = new Map(variants.map((variant) => [descriptorKey(variant), variant]))
      return { kind: "union", variants: [...unique.entries()].sort(([left], [right]) => compareText(left, right)).map(([, value]) => value) }
    }
    if (type.isIntersection()) this.fail(`${path} uses an intersection; publish one resolved plain-data shape`)

    if (!(type.flags & ts.TypeFlags.Object)) this.fail(`${path} uses unsupported type ${this.checker.typeToString(type)}`)
    const referenceSymbol = typeReferenceSymbol(type, this.checker)
    if (promiseArgument(type, this.checker) !== undefined) {
      this.fail(`${path} contains a nested Promise, which cannot cross a persistence boundary`)
    }
    if (this.checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0 ||
      this.checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length > 0) {
      this.fail(`${path} contains executable function/class authority`)
    }
    if (this.checker.isTupleType(type)) {
      const reference = type as ts.TypeReference & { readonly target?: { readonly elementFlags?: readonly ts.ElementFlags[] } }
      const flags = reference.target?.elementFlags ?? []
      if (flags.some((flag) => flag !== ts.ElementFlags.Required)) {
        this.fail(`${path} uses optional/rest tuple elements, which need an explicit durable representation`)
      }
      const items = typeReferenceArguments(type, this.checker)
        .map((item, index) => this.value(item, `${path}[${index}]`, depth + 1))
      return { kind: "tuple", items }
    }
    if (this.checker.isArrayType(type)) {
      const [element] = typeReferenceArguments(type, this.checker)
      if (element === undefined) this.fail(`${path} has an unresolved array element`)
      return { kind: "array", element: this.value(element, `${path}[]`, depth + 1) }
    }
    if (referenceSymbol?.declarations?.some((declaration) => declaration.getSourceFile().isDeclarationFile)) {
      this.fail(`${path} contains class instance/host object ${this.checker.typeToString(type)}; only plain structural data is durable`)
    }
    if (this.checker.getIndexInfosOfType(type).length > 0) {
      this.fail(`${path} uses an index signature; publish an exact bounded object or array`)
    }
    if (declarationHasTypeParameters(type.aliasSymbol) || declarationHasTypeParameters(referenceSymbol)) {
      this.fail(`${path} uses a generic declaration; publish a non-generic durable boundary type`)
    }
    const objectFlags = (type as ts.ObjectType).objectFlags
    const targetFlags = ((type as ts.TypeReference).target as ts.ObjectType | undefined)?.objectFlags ?? 0
    if ((objectFlags | targetFlags) & ts.ObjectFlags.Class) {
      this.fail(`${path} contains class instance ${this.checker.typeToString(type)}; only nominal Error payloads are supported`)
    }
    if (this.active.has(type)) this.fail(`${path} is recursive and needs an explicit durable representation`)
    this.active.add(type)
    try {
      const properties = this.checker.getPropertiesOfType(type)
      if (properties.length > MAX_OBJECT_FIELDS) this.fail(`${path} exceeds the durable object field limit`)
      const fields = properties.map((property) => {
        const declarations = property.declarations ?? []
        if (declarations.length === 0) this.fail(`${path}.${property.getName()} has no compiler-owned declaration`)
        if (declarations.some((declaration) => ts.isMethodSignature(declaration) || ts.isMethodDeclaration(declaration) ||
          ts.isGetAccessorDeclaration(declaration) || ts.isSetAccessorDeclaration(declaration))) {
          this.fail(`${path}.${property.getName()} is executable/accessor state`)
        }
        const name = property.getName()
        if (name.startsWith("__@")) this.fail(`${path} has a symbol-named property`)
        const declaration = property.valueDeclaration ?? declarations[0]
        const isOptional = Boolean(property.flags & ts.SymbolFlags.Optional)
        const propertyType = this.checker.getTypeOfSymbolAtLocation(property, declaration)
        return {
          name,
          optional: isOptional,
          value: this.value(propertyType, `${path}.${name}`, depth + 1, isOptional)
        } satisfies DurableObjectField
      }).sort((left, right) => compareText(left.name, right.name))
      for (let index = 1; index < fields.length; index++) {
        if (fields[index - 1].name === fields[index].name) this.fail(`${path} has duplicate field ${fields[index].name}`)
      }
      return { kind: "object", fields }
    } finally {
      this.active.delete(type)
    }
  }

  error(type: ts.Type, path: string, depth = 0): DurableTypeDescriptor {
    if (type.isUnion()) {
      if (type.types.length > MAX_UNION_VARIANTS) this.fail(`${path} exceeds the Error union variant limit`)
      const variants = type.types.map((member, index) => this.error(member, `${path} variant ${index + 1}`, depth + 1))
      const unique = new Map(variants.map((variant) => [descriptorKey(variant), variant]))
      if (unique.size === 1) return unique.values().next().value!
      return { kind: "union", variants: [...unique.entries()].sort(([left], [right]) => compareText(left, right)).map(([, value]) => value) }
    }
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter)) {
      this.fail(`${path} must name a concrete Error class or union`)
    }
    const symbol = typeReferenceSymbol(type, this.checker) ?? canonicalSymbol(this.checker, type.symbol)
    const declaration = symbol?.declarations?.find(ts.isClassDeclaration)
    if (declaration === undefined || declaration.name === undefined) {
      this.fail(`${path} must be an ordinary named class extending Error`)
    }
    if (!this.extendsError(declaration, new Set())) {
      this.fail(`${path} ${declaration.name.text} does not extend Error`)
    }
    const payload = this.errorPayload(declaration, path, depth + 1, new Set())
    return {
      kind: "error",
      identity: stableIdentity(this.logicalNameForSource(declaration.getSourceFile()), declaration.name.text),
      name: declaration.name.text,
      payload
    }
  }

  private extendsError(declaration: ts.ClassDeclaration, visited: Set<ts.ClassDeclaration>): boolean {
    if (visited.has(declaration)) return false
    visited.add(declaration)
    for (const clause of declaration.heritageClauses ?? []) {
      if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue
      for (const base of clause.types) {
        const type = this.checker.getTypeAtLocation(base)
        const symbol = typeReferenceSymbol(type, this.checker) ?? canonicalSymbol(this.checker, type.symbol)
        if (symbol === this.errorSymbol) return true
        const baseClass = symbol?.declarations?.find(ts.isClassDeclaration)
        if (baseClass !== undefined && this.extendsError(baseClass, visited)) return true
      }
    }
    return false
  }

  private errorPayload(
    declaration: ts.ClassDeclaration,
    path: string,
    depth: number,
    visited: Set<ts.ClassDeclaration>
  ): Extract<DurableTypeDescriptor, { readonly kind: "object" }> {
    if (visited.has(declaration)) this.fail(`${path} has a recursive Error inheritance chain`)
    visited.add(declaration)
    const fields = new Map<string, DurableObjectField>()
    for (const heritage of declaration.heritageClauses ?? []) {
      if (heritage.token !== ts.SyntaxKind.ExtendsKeyword) continue
      for (const baseNode of heritage.types) {
        const baseType = this.checker.getTypeAtLocation(baseNode)
        const baseSymbol = typeReferenceSymbol(baseType, this.checker) ?? canonicalSymbol(this.checker, baseType.symbol)
        if (baseSymbol === this.errorSymbol) continue
        const baseDeclaration = baseSymbol?.declarations?.find(ts.isClassDeclaration)
        if (baseDeclaration === undefined) this.fail(`${path} has an unsupported Error base class`)
        for (const field of this.errorPayload(baseDeclaration, path, depth + 1, visited).fields) fields.set(field.name, field)
      }
    }
    for (const member of declaration.members) {
      if (ts.isPropertyDeclaration(member)) {
        if (member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)) continue
        if (member.name && ts.isPrivateIdentifier(member.name)) this.fail(`${path} has a private Error payload field`)
        if (member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword)) {
          this.fail(`${path} has a private/protected Error payload field`)
        }
        if (member.type === undefined || member.name === undefined ||
          !(ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) || ts.isNumericLiteral(member.name))) {
          this.fail(`${path} Error payload fields need static names and explicit types`)
        }
        const name = member.name.text
        const optional = Boolean(member.questionToken)
        fields.set(name, {
          name,
          optional,
          value: this.value(this.checker.getTypeFromTypeNode(member.type), `${path}.${name}`, depth + 1, optional)
        })
      } else if (ts.isConstructorDeclaration(member)) {
        for (const parameter of member.parameters) {
          const isProperty = Boolean(parameter.modifiers?.some((modifier) =>
            modifier.kind === ts.SyntaxKind.PublicKeyword || modifier.kind === ts.SyntaxKind.PrivateKeyword ||
            modifier.kind === ts.SyntaxKind.ProtectedKeyword || modifier.kind === ts.SyntaxKind.ReadonlyKeyword
          ))
          if (!isProperty) continue
          if (parameter.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword)) {
            this.fail(`${path} has a private/protected Error constructor field`)
          }
          if (!ts.isIdentifier(parameter.name) || parameter.type === undefined || parameter.dotDotDotToken !== undefined) {
            this.fail(`${path} Error constructor fields need identifier names and explicit non-rest types`)
          }
          const name = parameter.name.text
          const optional = Boolean(parameter.questionToken || parameter.initializer)
          fields.set(name, {
            name,
            optional,
            value: this.value(this.checker.getTypeFromTypeNode(parameter.type), `${path}.${name}`, depth + 1, optional)
          })
        }
      }
    }
    visited.delete(declaration)
    const ordered = [...fields.values()].sort((left, right) => compareText(left.name, right.name))
    if (ordered.length > MAX_OBJECT_FIELDS) this.fail(`${path} exceeds the Error payload field limit`)
    return { kind: "object", fields: ordered }
  }

  private fail(message: string): never {
    throw new ContractFailure("SMITHERS4203", this.anchor, message)
  }
}

const resultArguments = (
  type: ts.Type,
  checker: ts.TypeChecker,
  resultSymbol: ts.Symbol
): readonly [ts.Type, ts.Type] | undefined => {
  if (typeReferenceSymbol(type, checker) !== resultSymbol) return undefined
  const arguments_ = typeReferenceArguments(type, checker)
  return arguments_.length === 2 ? [arguments_[0], arguments_[1]] : undefined
}

const promiseArgument = (type: ts.Type, checker: ts.TypeChecker): ts.Type | undefined => {
  const symbol = typeReferenceSymbol(type, checker)
  if (symbol?.getName() !== "Promise" || !symbol.declarations?.some((declaration) => declaration.getSourceFile().isDeclarationFile)) {
    return undefined
  }
  const arguments_ = typeReferenceArguments(type, checker)
  return arguments_.length === 1 ? arguments_[0] : undefined
}

/** @internal Renders a checked descriptor as TypeScript type syntax for virtual declarations. */
export const descriptorTypeScript = (descriptor: DurableTypeDescriptor): string => {
  switch (descriptor.kind) {
    case "null": return "null"
    case "boolean": return "boolean"
    case "number": return "number"
    case "string": return "string"
    case "literal": return JSON.stringify(descriptor.value)
    case "array": return `readonly (${descriptorTypeScript(descriptor.element)})[]`
    case "tuple": return `readonly [${descriptor.items.map(descriptorTypeScript).join(", ")}]`
    case "object": return `{ ${descriptor.fields.map((field) =>
      `readonly ${JSON.stringify(field.name)}${field.optional ? "?" : ""}: ${descriptorTypeScript(field.value)}`
    ).join("; ")} }`
    case "union": return descriptor.variants.map((variant) => `(${descriptorTypeScript(variant)})`).join(" | ")
    case "error": return `{ readonly version: 1; readonly identity: ${JSON.stringify(descriptor.identity)}; readonly payload: ${descriptorTypeScript(descriptor.payload)} }`
  }
}

/** @internal Checker handoff used before a Flow signature is erased. */
export const deriveDurableValueSchema = (
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  anchor: ts.Node,
  type: ts.Type,
  role: "input" | "success",
  label: string
): StructuralDurableSchema => {
  const errorSymbol = canonicalSymbol(
    checker,
    checker.resolveName("Error", anchor, ts.SymbolFlags.Type, false)
  )
  if (errorSymbol === undefined) throw new DurableCodecError("compiler could not resolve the built-in Error type")
  try {
    const builder = new DescriptorBuilder(
      checker,
      sourceFile,
      () => logicalFileName(sourceFile.fileName),
      anchor,
      errorSymbol
    )
    return structuralSchema(role, validateDurableTypeDescriptor(builder.value(type, label)))
  } catch (error) {
    if (error instanceof ContractFailure) throw new DurableCodecError(error.message)
    throw error
  }
}

/**
 * @internal Whole-project handoff for checked Action implementations. Each
 * nominal Error identity is derived from its declaring logical source file,
 * matching the standalone Action contract compiler rather than comparing only
 * class names or erased TypeScript text.
 */
export const deriveDurableErrorSchema = (
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  anchor: ts.Node,
  errorTypes: readonly ts.Type[],
  logicalNameForSource: (sourceFile: ts.SourceFile) => string
): StructuralDurableSchema => {
  if (errorTypes.length === 0) throw new DurableCodecError("typed failure schema requires at least one Error type")
  const errorSymbol = canonicalSymbol(
    checker,
    checker.resolveName("Error", anchor, ts.SymbolFlags.Type, false)
  )
  if (errorSymbol === undefined) throw new DurableCodecError("compiler could not resolve the built-in Error type")
  try {
    const builder = new DescriptorBuilder(
      checker,
      sourceFile,
      logicalNameForSource,
      anchor,
      errorSymbol
    )
    const variants = errorTypes.map((type, index) =>
      validateDurableTypeDescriptor(builder.error(type, `Action implementation error ${index + 1}`)))
    const unique = new Map(variants.map((variant) => [descriptorKey(variant), variant]))
    const descriptor: DurableTypeDescriptor = unique.size === 1
      ? unique.values().next().value!
      : {
          kind: "union",
          variants: [...unique.entries()]
            .sort(([left], [right]) => compareText(left, right))
            .map(([, value]) => value)
        }
    return structuralSchema("error", validateDurableTypeDescriptor(descriptor))
  } catch (error) {
    if (error instanceof ContractFailure) throw new DurableCodecError(error.message)
    throw error
  }
}

export const actionDeclarationFromDescriptor = (exportName: string, descriptor: ActionDescriptor): string => {
  identifier(exportName, "Action export name")
  if (descriptor.inputSchema.shape !== "structural" || descriptor.successSchema.shape !== "structural") {
    return `export declare const ${exportName}: { run(input: unknown): { unwrap(): unknown } };`
  }
  return `export declare const ${exportName}: { run(input: ${descriptorTypeScript(descriptor.inputSchema.descriptor)}): { unwrap(): ${descriptorTypeScript(descriptor.successSchema.descriptor)} } };`
}

const validateSchemaContract = (value: JsonValue, role: DurableSchema["role"], path: string): DurableSchema => {
  const record = exactRecord(value, path)
  if (record.format !== "canonical-json" || record.schemaVersion !== 1 || record.role !== role || typeof record.digest !== "string") {
    throw new DurableCodecError(`${path} has an unsupported schema envelope`)
  }
  if (record.shape === "json-value" && record.source === "compiler-derived-poc-stub") {
    if (canonicalJson(Object.keys(record).sort()) !== canonicalJson(["digest", "format", "role", "schemaVersion", "shape", "source"])) {
      throw new DurableCodecError(`${path} has unexpected fields`)
    }
    const semantic = { format: "canonical-json", schemaVersion: 1, role, shape: "json-value", source: "compiler-derived-poc-stub" }
    if (digest(semantic) !== record.digest) throw new DurableCodecError(`${path} digest mismatch`)
    return record as unknown as DurableSchema
  }
  if (record.shape !== "structural" || record.source !== "compiler-derived" ||
    canonicalJson(Object.keys(record).sort()) !== canonicalJson(["descriptor", "digest", "format", "role", "schemaVersion", "shape", "source"])) {
    throw new DurableCodecError(`${path} has an unsupported structural schema envelope`)
  }
  const descriptor = validateDurableTypeDescriptor(record.descriptor)
  const semantic = { format: "canonical-json", schemaVersion: 1, role, shape: "structural", source: "compiler-derived", descriptor }
  if (digest(semantic) !== record.digest) throw new DurableCodecError(`${path} digest mismatch`)
  return record as unknown as DurableSchema
}

/** Validate persisted/compiler-emitted schema evidence before trusting it. */
export const validateDurableSchema = (
  value: unknown,
  role: DurableSchema["role"],
  label = "durable schema"
): DurableSchema => validateSchemaContract(assertJson(value, label), role, label)

/** Validate compiler output before using it to synthesize a trusted declaration. */
export const validateActionContractDescriptor = (value: unknown): ActionDescriptor => {
  const normalized = assertJson(value, "Action descriptor")
  const record = exactRecord(normalized, "Action descriptor")
  if (canonicalJson(Object.keys(record).sort()) !== canonicalJson([
    "contractDigest", "errorSchema", "id", "inputSchema", "successSchema", "version"
  ])) throw new DurableCodecError("Action descriptor has unexpected fields")
  if (typeof record.id !== "string" || record.id.trim() === "" || !Number.isSafeInteger(record.version) || (record.version as number) < 1 ||
    typeof record.contractDigest !== "string" || !/^[0-9a-f]{64}$/.test(record.contractDigest)) {
    throw new DurableCodecError("Action descriptor has invalid identity fields")
  }
  const inputSchema = validateSchemaContract(record.inputSchema, "input", "Action input schema")
  const successSchema = validateSchemaContract(record.successSchema, "success", "Action success schema")
  const errorSchema = validateSchemaContract(record.errorSchema, "error", "Action error schema")
  const semantic = { id: record.id, version: record.version, inputSchema, successSchema, errorSchema }
  if (digest(semantic) !== record.contractDigest) throw new DurableCodecError("Action contract digest mismatch")
  return deepFreeze({ ...semantic, contractDigest: record.contractDigest } as ActionDescriptor)
}

/** Inputs for one checked `class X extends Action<Signature>` declaration. */
export interface DeriveActionContractOptions {
  readonly checker: ts.TypeChecker
  readonly sourceFile: ts.SourceFile
  readonly declaration: ts.ClassDeclaration
  /** Symbol of the compiler-owned `Action` base; heritage is matched by identity. */
  readonly actionSymbol: ts.Symbol
  /** Symbol of the compiler-owned `Result` interface. */
  readonly resultSymbol: ts.Symbol
  /** Symbol of the built-in `Error` type used to recognize nominal failures. */
  readonly errorSymbol: ts.Symbol
  /** Name used in diagnostics, normally the declared class name. */
  readonly label: string
  readonly id: string
  readonly version: number
  readonly logicalNameForSource: (file: ts.SourceFile) => string
  /**
   * Allow the ONE weakening `docs/src/pages/specification/durable-execution.mdx`
   * (Locked) leaves room for: a failure channel that is wholly the built-in
   * `Error` has no nominal payload this compiler can describe, so it records the
   * weaker json-value error contract rather than costing the author the input
   * and success contracts it CAN describe.
   *
   * It is not a general "derivation failed, accept anything" switch, and must
   * never become one. The same page says "`any` and `unknown` MUST require an
   * explicit codec at the boundary" and "Every value crossing an Action or Flow
   * persistence boundary MUST satisfy the compiler-checked durable codec
   * contract" — so `Result<A, any>`, a structural impostor that does not extend
   * Error, and a payload over the descriptor budgets are all still refused with
   * this on. Before that narrowing, the durable source compiler ACCEPTED a
   * declaration the standalone contract compiler refuses, and the two answers
   * disagreed on identical source.
   *
   * The standalone contract compiler leaves this off entirely and fails closed
   * even for the built-in `Error`.
   */
  readonly weakenUnderivableErrors?: boolean
}

/**
 * Every constituent of the declared failure channel is the built-in `Error`
 * itself. Identity, not spelling: a user class named `Error` resolves to its own
 * declaration and is an ordinary nominal failure this compiler describes.
 */
const isWhollyBuiltInErrorChannel = (
  type: ts.Type,
  checker: ts.TypeChecker,
  errorSymbol: ts.Symbol
): boolean => {
  const constituents = type.isUnion() ? type.types : [type]
  return constituents.length > 0 && constituents.every((member) =>
    (typeReferenceSymbol(member, checker) ?? canonicalSymbol(checker, member.symbol)) === errorSymbol)
}

/**
 * @internal The one derivation from a checked Action declaration to a durable
 * contract descriptor. Both the standalone contract compiler and the durable
 * source compiler route through it, so the same class produces the same
 * descriptor whether its contract was compiled ahead of time and supplied as a
 * binding or derived in place from the checked program.
 */
export const deriveActionContract = (options: DeriveActionContractOptions): ActionDescriptor => {
  const { checker, sourceFile, declaration, actionSymbol, resultSymbol, errorSymbol, label } = options
  if (typeof options.id !== "string" || options.id.trim() === "") throw new TypeError("Action id must be non-empty")
  if (!Number.isSafeInteger(options.version) || options.version < 1) {
    throw new TypeError("Action version must be a positive safe integer")
  }
  const actionBases = (declaration.heritageClauses ?? [])
    .filter((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
    .flatMap((clause) => [...clause.types])
    .filter((base) => canonicalSymbol(checker, checker.getSymbolAtLocation(base.expression)) === actionSymbol)
  if (actionBases.length !== 1 || actionBases[0].typeArguments?.length !== 1) {
    throw new ContractFailure("SMITHERS4202", declaration, `${label} must extend the compiler-owned Action with exactly one function signature`)
  }
  const signatureNode = actionBases[0].typeArguments[0]
  const signatureType = checker.getTypeFromTypeNode(signatureNode)
  const signatures = checker.getSignaturesOfType(signatureType, ts.SignatureKind.Call)
  if (signatures.length !== 1) {
    throw new ContractFailure("SMITHERS4202", signatureNode, "Action contract must contain exactly one non-overloaded call signature")
  }
  const signature = signatures[0]
  const parameters = signature.getParameters()
  const parameterDeclaration = parameters[0]?.valueDeclaration ?? parameters[0]?.declarations?.[0]
  if (parameters.length !== 1 || parameterDeclaration === undefined ||
    (ts.isParameter(parameterDeclaration) && (parameterDeclaration.questionToken !== undefined || parameterDeclaration.dotDotDotToken !== undefined))) {
    throw new ContractFailure("SMITHERS4202", signatureNode, "Action signature requires exactly one required non-rest input parameter")
  }
  const inputType = checker.getTypeOfSymbolAtLocation(parameters[0], parameterDeclaration)
  let returnType = checker.getReturnTypeOfSignature(signature)
  const promised = promiseArgument(returnType, checker)
  if (promised !== undefined) {
    returnType = promised
    if (promiseArgument(returnType, checker) !== undefined) {
      throw new ContractFailure("SMITHERS4203", signatureNode, "nested Promise is not a durable Action value")
    }
  }
  const result = resultArguments(returnType, checker, resultSymbol)
  if (result === undefined) {
    throw new ContractFailure("SMITHERS4202", signatureNode, "bounded Action contracts must return Result<Success, Error> or Promise<Result<Success, Error>>")
  }
  const builder = new DescriptorBuilder(checker, sourceFile, options.logicalNameForSource, signatureNode, errorSymbol)
  const input = validateDurableTypeDescriptor(builder.value(inputType, `${label} input`))
  const success = validateDurableTypeDescriptor(builder.value(result[0], `${label} success`))
  const inputSchema = structuralSchema("input", input)
  const successSchema = structuralSchema("success", success)
  let errorSchema: DurableSchema
  try {
    errorSchema = structuralSchema("error", validateDurableTypeDescriptor(builder.error(result[1], `${label} error`)))
  } catch (failure) {
    // Reachable from BOTH derivation entry points. `compileActionContract`
    // never sets the option, so this refuses every underivable failure channel
    // there; the durable source compiler sets it and reaches the weakening only
    // for the built-in `Error`. Anything else — `any`, a structural impostor, a
    // payload over budget — is refused on both paths.
    if (options.weakenUnderivableErrors !== true ||
      !isWhollyBuiltInErrorChannel(result[1], checker, errorSymbol)) throw failure
    errorSchema = derivedSchema("error")
  }
  const contract = { id: options.id, version: options.version, inputSchema, successSchema, errorSchema }
  return deepFreeze({ ...contract, contractDigest: digest(contract) } as ActionDescriptor)
}

export const compileActionContract = (
  source: string,
  options: CompileActionContractOptions
): CompileActionContractResult => {
  const fileName = logicalFileName(options?.fileName)
  let sourceFile = ts.createSourceFile(fileName, typeof source === "string" ? source : "", ts.ScriptTarget.ESNext, true)
  try {
    if (typeof source !== "string") throw new TypeError("Action contract source must be a string")
    if (new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES) {
      return { ok: false, diagnostics: [diagnosticAt(fileName, sourceFile, sourceFile, "SMITHERS4201", "Action contract source exceeds the input size limit")] }
    }
    const exportName = identifier(options.exportName, "Action export name")
    if (typeof options.id !== "string" || options.id.trim() === "") throw new TypeError("Action id must be non-empty")
    if (!Number.isSafeInteger(options.version) || options.version < 1) throw new TypeError("Action version must be a positive safe integer")
    const program = createContractProgram(source, fileName)
    sourceFile = program.sourceFile
    if (program.diagnostics.length > 0) {
      return {
        ok: false,
        diagnostics: program.diagnostics.slice(0, 32).map((diagnostic) => diagnosticAt(
          fileName,
          sourceFile,
          diagnostic.file === sourceFile && diagnostic.start !== undefined
            ? findNarrowestNode(sourceFile, diagnostic.start)
            : sourceFile,
          "SMITHERS4200",
          ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
        ))
      }
    }
    const checker = program.checker
    const actionSymbol = compilerSymbol(program.actionFile, checker, ts.isClassDeclaration)
    const resultSymbol = compilerSymbol(program.resultFile, checker, ts.isInterfaceDeclaration)
    const resultDeclaration = program.resultFile.statements.find(ts.isInterfaceDeclaration)!
    const errorConstraint = resultDeclaration.typeParameters?.[1]?.constraint
    const errorName = errorConstraint && ts.isTypeReferenceNode(errorConstraint) ? errorConstraint.typeName : undefined
    const errorSymbol = errorName ? canonicalSymbol(checker, checker.getSymbolAtLocation(errorName)) : undefined
    if (errorSymbol === undefined) throw new Error("durable contract compiler failed to bind Error")

    const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
    const exported = moduleSymbol && checker.getExportsOfModule(moduleSymbol)
      .find((symbol) => symbol.getName() === exportName)
    const declaration = canonicalSymbol(checker, exported)?.declarations?.find(ts.isClassDeclaration)
    if (declaration === undefined || declaration.name === undefined) {
      throw new ContractFailure("SMITHERS4202", sourceFile, `export ${exportName} must be one abstract class extending compiler-owned Action<Signature>`)
    }
    const descriptor = deriveActionContract({
      checker,
      sourceFile,
      declaration,
      actionSymbol,
      resultSymbol,
      errorSymbol,
      label: exportName,
      id: options.id,
      version: options.version,
      logicalNameForSource: () => fileName
    })
    return Object.freeze({
      ok: true,
      diagnostics: [] as const,
      descriptor,
      declaration: actionDeclarationFromDescriptor(exportName, descriptor)
    })
  } catch (error) {
    const failure = error instanceof ContractFailure
      ? error
      : new ContractFailure("SMITHERS4201", sourceFile, error instanceof Error ? error.message : String(error))
    return { ok: false, diagnostics: [diagnosticAt(fileName, sourceFile, failure.node, failure.code, failure.message)] }
  }
}

const findNarrowestNode = (sourceFile: ts.SourceFile, position: number): ts.Node => {
  let found: ts.Node = sourceFile
  const visit = (node: ts.Node): void => {
    if (node.getFullStart() <= position && position < node.getEnd()) {
      found = node
      ts.forEachChild(node, visit)
    }
  }
  visit(sourceFile)
  return found
}

const exactRecord = (value: JsonValue, path: string): Record<string, JsonValue> => {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new DurableCodecError(`${path} expected an exact object`)
  }
  return value
}

const validateDescriptorInner = (
  value: JsonValue,
  path: string,
  depth: number,
  counter: { value: number }
): DurableTypeDescriptor => {
  if (depth > MAX_DESCRIPTOR_DEPTH) throw new DurableCodecError(`${path} exceeds the descriptor depth limit`)
  counter.value += 1
  if (counter.value > MAX_DESCRIPTOR_NODES) throw new DurableCodecError(`${path} exceeds the descriptor node limit`)
  const record = exactRecord(value, path)
  if (typeof record.kind !== "string") throw new DurableCodecError(`${path}.kind must be a string`)
  const keys = (expected: readonly string[]): void => {
    const actual = Object.keys(record).sort()
    const wanted = [...expected].sort()
    if (canonicalJson(actual) !== canonicalJson(wanted)) throw new DurableCodecError(`${path} has unexpected fields`)
  }
  switch (record.kind) {
    case "null": case "boolean": case "number": case "string":
      keys(["kind"])
      return record as unknown as DurableTypeDescriptor
    case "literal":
      keys(["kind", "value"])
      if (!(record.value === null || typeof record.value === "boolean" || typeof record.value === "string" ||
        (typeof record.value === "number" && Number.isFinite(record.value) && !Object.is(record.value, -0)))) {
        throw new DurableCodecError(`${path}.value is not a canonical scalar literal`)
      }
      return record as unknown as DurableTypeDescriptor
    case "array":
      keys(["kind", "element"])
      return { kind: "array", element: validateDescriptorInner(record.element, `${path}.element`, depth + 1, counter) }
    case "tuple":
      keys(["kind", "items"])
      if (!Array.isArray(record.items)) throw new DurableCodecError(`${path}.items must be an array`)
      return { kind: "tuple", items: record.items.map((item, index) => validateDescriptorInner(item, `${path}.items[${index}]`, depth + 1, counter)) }
    case "object": {
      keys(["kind", "fields"])
      if (!Array.isArray(record.fields) || record.fields.length > MAX_OBJECT_FIELDS) {
        throw new DurableCodecError(`${path}.fields must be a bounded array`)
      }
      const fields = record.fields.map((item, index) => {
        const field = exactRecord(item, `${path}.fields[${index}]`)
        if (canonicalJson(Object.keys(field).sort()) !== canonicalJson(["name", "optional", "value"])) {
          throw new DurableCodecError(`${path}.fields[${index}] has unexpected fields`)
        }
        if (typeof field.name !== "string" || field.name === "" || typeof field.optional !== "boolean") {
          throw new DurableCodecError(`${path}.fields[${index}] has an invalid name/optional flag`)
        }
        return {
          name: field.name,
          optional: field.optional,
          value: validateDescriptorInner(field.value, `${path}.fields[${index}].value`, depth + 1, counter)
        }
      })
      const names = fields.map((field) => field.name)
      if (canonicalJson(names) !== canonicalJson([...new Set(names)].sort(compareText))) {
        throw new DurableCodecError(`${path}.fields must be sorted and unique`)
      }
      return { kind: "object", fields }
    }
    case "union": {
      keys(["kind", "variants"])
      if (!Array.isArray(record.variants) || record.variants.length < 2 || record.variants.length > MAX_UNION_VARIANTS) {
        throw new DurableCodecError(`${path}.variants must contain 2-${MAX_UNION_VARIANTS} items`)
      }
      const variants = record.variants.map((item, index) => validateDescriptorInner(item, `${path}.variants[${index}]`, depth + 1, counter))
      const identities = variants.map(descriptorKey)
      if (canonicalJson(identities) !== canonicalJson([...new Set(identities)].sort(compareText))) {
        throw new DurableCodecError(`${path}.variants must be canonically sorted and unique`)
      }
      return { kind: "union", variants }
    }
    case "error": {
      keys(["kind", "identity", "name", "payload"])
      if (typeof record.identity !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/@:+-]{0,255}$/.test(record.identity) ||
        typeof record.name !== "string" || !/^[$A-Z_a-z][$0-9A-Z_a-z]*$/.test(record.name)) {
        throw new DurableCodecError(`${path} has invalid nominal Error identity`)
      }
      const payload = validateDescriptorInner(record.payload, `${path}.payload`, depth + 1, counter)
      if (payload.kind !== "object") throw new DurableCodecError(`${path}.payload must be an object descriptor`)
      return { kind: "error", identity: record.identity, name: record.name, payload }
    }
    default:
      throw new DurableCodecError(`${path}.kind is unsupported`)
  }
}

export const validateDurableTypeDescriptor = (value: unknown): DurableTypeDescriptor => {
  const normalized = assertJson(value, "Durable type descriptor")
  return deepFreeze(validateDescriptorInner(normalized, "descriptor", 0, { value: 0 }))
}

const validateValueInner = (descriptor: DurableTypeDescriptor, value: JsonValue, path: string, depth: number): void => {
  if (depth > MAX_DESCRIPTOR_DEPTH) throw new DurableCodecError(`${path} exceeds the durable value depth limit`)
  switch (descriptor.kind) {
    case "null": if (value === null) return; break
    case "boolean": if (typeof value === "boolean") return; break
    case "number": if (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0)) return; break
    case "string": if (typeof value === "string") return; break
    case "literal": if (Object.is(value, descriptor.value)) return; break
    case "array":
      if (Array.isArray(value)) {
        value.forEach((item, index) => validateValueInner(descriptor.element, item, `${path}[${index}]`, depth + 1))
        return
      }
      break
    case "tuple":
      if (Array.isArray(value) && value.length === descriptor.items.length) {
        descriptor.items.forEach((item, index) => validateValueInner(item, value[index], `${path}[${index}]`, depth + 1))
        return
      }
      break
    case "object": {
      if (value === null || Array.isArray(value) || typeof value !== "object") break
      const actual = Object.keys(value).sort(compareText)
      const allowed = descriptor.fields.map((field) => field.name)
      if (actual.some((name) => !allowed.includes(name))) throw new DurableCodecError(`${path} has an unexpected field`)
      for (const field of descriptor.fields) {
        if (!Object.hasOwn(value, field.name)) {
          if (!field.optional) throw new DurableCodecError(`${path}.${field.name} is required`)
          continue
        }
        validateValueInner(field.value, value[field.name], `${path}.${field.name}`, depth + 1)
      }
      return
    }
    case "union":
      for (const variant of descriptor.variants) {
        try {
          validateValueInner(variant, value, path, depth + 1)
          return
        } catch (error) {
          if (!(error instanceof DurableCodecError)) throw error
        }
      }
      break
    case "error": {
      if (value === null || Array.isArray(value) || typeof value !== "object") break
      if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(["identity", "payload", "version"]) ||
        value.version !== 1 || value.identity !== descriptor.identity) {
        throw new DurableCodecError(`${path} expected nominal Error ${descriptor.identity}`)
      }
      validateValueInner(descriptor.payload, value.payload, `${path}.payload`, depth + 1)
      return
    }
  }
  throw new DurableCodecError(`${path} does not satisfy durable ${descriptor.kind}`)
}

export const validateDurableValue = (schema: DurableSchema, value: unknown, label = "durable value"): JsonValue => {
  const normalized = assertJson(value, label)
  if (schema.shape === "json-value") return normalized
  const descriptor = validateDurableTypeDescriptor(schema.descriptor)
  validateValueInner(descriptor, normalized, label, 0)
  return deepFreeze(normalized)
}

export const durableErrorPayload = (
  schema: StructuralDurableSchema,
  identity: string,
  payload: unknown
): JsonValue => validateDurableValue(schema, { version: 1, identity, payload }, "durable Error")

export const DurableContractCompiler = Object.freeze({ compile: compileActionContract })
