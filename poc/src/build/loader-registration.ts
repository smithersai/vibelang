import { extname, isAbsolute, relative, resolve, sep } from "node:path"
import * as ts from "typescript-js"
import { COMPTIME_MODULE_SPECIFIER, COMPTIME_PRELUDE } from "./comptime-intrinsic.ts"
import { digest } from "./stable.ts"

/* --------------------------------------------------------------------------
 * Provisional source-level loader registration
 *
 * docs/ASSET_LOADERS.md leaves open question 2 ("loader declaration and
 * registration APIs, including conflict precedence") unanswered and shows
 * `comptime.loader(...)` only as a proposed spelling. Everything in this module
 * is a labelled-**provisional** candidate for that slot: a project file whose
 * DEFAULT export is `comptime.loader(<type literal>, <function>)` registers a
 * loader for one import-attribute `type`.
 *
 * Two rules are not provisional and are enforced here:
 *
 *   - `comptime` is recognized by TypeScript checker identity against the
 *     compiler-owned `"vibelang:comptime"` declaration, never by spelling. An
 *     unrelated local object with a `loader` method never gains authority.
 *   - Recognition is purely AST/checker level. The loader file is NEVER
 *     imported or executed in this process; it only ever runs inside the
 *     existing no-permission Deno sandbox.
 *
 * Because the sandbox cannot resolve `"vibelang:comptime"` (it has no imports
 * at all), recognition also produces the compiler-lowered module the sandbox
 * receives: the compiler-owned import is erased and the registration call is
 * replaced by the loader function itself. The authored bytes still enter the
 * loader's implementation digest, so editing the loader file invalidates every
 * asset it produced.
 * -------------------------------------------------------------------------- */

/** `VCT13xx` is the loader-registration family; `VCT10xx`/`VCT12xx` are taken. */
export const LoaderRegistrationDiagnosticCode = Object.freeze({
  Syntax: "VCT1300",
  ModuleShape: "VCT1301",
  RegistrationShape: "VCT1302",
  UnrelatedIdentity: "VCT1303",
  MissingIdentity: "VCT1304",
  CallShape: "VCT1305",
  InternalIdentity: "VCT1306",
  LoaderType: "VCT1307",
  LoaderFunction: "VCT1308",
  EscapingRegistration: "VCT1309",
  BuiltinPrecedence: "VCT1310",
  DuplicateRegistration: "VCT1311",
  RegistrationFailure: "VCT1312",
  SourceMismatch: "VCT1313",
} as const)

export type LoaderRegistrationDiagnosticCodeValue =
  typeof LoaderRegistrationDiagnosticCode[keyof typeof LoaderRegistrationDiagnosticCode]

export interface LoaderRegistrationDiagnostic {
  readonly code: LoaderRegistrationDiagnosticCodeValue
  readonly severity: "error" | "warning"
  readonly message: string
  /** The file name exactly as it was supplied to recognition. */
  readonly fileName: string
  /** One-based. */
  readonly line: number
  /** One-based. */
  readonly column: number
}

export interface LoaderRegistration {
  readonly fileName: string
  /** Import-attribute `type` this file registers. */
  readonly type: string
  /**
   * Compiler-lowered module handed to the sandbox. The compiler-owned import
   * is erased and `export default comptime.loader(type, fn)` becomes
   * `export default fn`, which is the shape `loader-runner.js` invokes.
   */
  readonly sandboxSource: string
  readonly authoredDigest: string
  readonly sandboxDigest: string
  /** Zero-based offset of the registration call, for caller diagnostics. */
  readonly line: number
  readonly column: number
}

export interface LoaderRegistrationAnalysis {
  readonly ok: boolean
  readonly registration?: LoaderRegistration
  readonly diagnostics: readonly LoaderRegistrationDiagnostic[]
}

const VIRTUAL_ROOT = resolve("/vibelang-loader-project")
const PRELUDE_NAME = resolve(VIRTUAL_ROOT, "__vibelang_comptime__.d.ts")
/**
 * The registration surface merges into the SAME compiler-owned declaration the
 * comptime lowering frontend uses, so there is one description of
 * `"vibelang:comptime"`. `comptime.loader` is meaningful only in a loader file,
 * which is never a lowered project source, so the lowering pass never sees it.
 */
const LOADER_PRELUDE = `${COMPTIME_PRELUDE}\n${[
  "export declare namespace comptime {",
  "  interface LoaderRegistration { readonly type: string; }",
  "  function loader<A, C, M>(type: string, load: (asset: A, context: C) => M): LoaderRegistration;",
  "}",
  "",
].join("\n")}`

const LOADER_EXTENSIONS = new Set([".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"])
/** Same shape `AssetCompiler` requires of an import-attribute `type`. */
const LOADER_TYPE = /^[a-z][a-z0-9-]*$/
const GLOB_CHARACTER = /[*?[\]{}]/
const MAX_LOADER_SOURCE_BYTES = 1024 * 1024

interface Replacement {
  readonly start: number
  readonly end: number
  readonly text: string
}

const aliasTarget = (checker: ts.TypeChecker, symbol: ts.Symbol | undefined): ts.Symbol | undefined => {
  let current = symbol
  const seen = new Set<ts.Symbol>()
  while (current !== undefined && (current.flags & ts.SymbolFlags.Alias) !== 0 && !seen.has(current)) {
    seen.add(current)
    try {
      current = checker.getAliasedSymbol(current)
    } catch {
      return undefined
    }
  }
  return current
}

const scriptKindFor = (fileName: string): ts.ScriptKind => {
  const extension = extname(fileName).toLowerCase()
  return extension === ".js" || extension === ".mjs" || extension === ".cjs" ? ts.ScriptKind.JS : ts.ScriptKind.TS
}

const unwrap = (node: ts.Expression): ts.Expression => {
  let current = node
  while (
    ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current)
  ) current = current.expression
  return current
}

const markTree = (root: ts.Node, output: Set<ts.Node>): void => {
  output.add(root)
  ts.forEachChild(root, (child) => { markTree(child, output) })
}

const visit = (root: ts.Node, callback: (node: ts.Node) => void): void => {
  callback(root)
  ts.forEachChild(root, (child) => { visit(child, callback) })
}

const applyReplacements = (source: string, replacements: readonly Replacement[]): string => {
  let output = source
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    output = output.slice(0, replacement.start) + replacement.text + output.slice(replacement.end)
  }
  return output
}

/**
 * Cheap spelling-only trigger for auto-discovery. It selects candidate files
 * from a project's authored sources without granting any authority: every
 * candidate still has to survive checker-identity recognition below.
 */
export const looksLikeLoaderRegistration = (source: string, fileName = "candidate.ts"): boolean => {
  if (typeof source !== "string" || !source.includes(COMPTIME_MODULE_SPECIFIER)) return false
  if (Buffer.byteLength(source, "utf8") > MAX_LOADER_SOURCE_BYTES) return false
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, scriptKindFor(fileName))
  return file.statements.some((statement) => {
    if (!ts.isExportAssignment(statement) || statement.isExportEquals === true) return false
    const expression = unwrap(statement.expression)
    return ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression) &&
      expression.expression.name.text === "loader"
  })
}

interface CheckedLoaderFile {
  readonly checker: ts.TypeChecker
  readonly file: ts.SourceFile
  readonly syntactic: readonly ts.Diagnostic[]
  readonly comptimeSymbol?: ts.Symbol
  readonly loaderSymbol?: ts.Symbol
}

/**
 * One checked file plus the compiler-owned declaration. The loader file is
 * parsed and bound, never loaded: this program has no emit and no host access
 * to the loader's own directory beyond the single supplied text.
 */
const checkLoaderFile = (fileName: string, source: string): CheckedLoaderFile => {
  const portable = fileName.replaceAll("\\", "/").replace(/^\/+/, "").replace(/^[A-Za-z]:/, "")
  const internalName = resolve(VIRTUAL_ROOT, portable)
  const back = relative(VIRTUAL_ROOT, internalName)
  if (back === "" || back === ".." || back.startsWith(`..${sep}`) || isAbsolute(back)) {
    throw new TypeError(`loader file name escaped the virtual project: ${fileName}`)
  }
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true,
    checkJs: false,
    strict: true,
    types: [],
    skipLibCheck: true,
    noEmit: true,
    allowImportingTsExtensions: true,
  }
  const preludeFile = ts.createSourceFile(PRELUDE_NAME, LOADER_PRELUDE, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const loaderFile = ts.createSourceFile(internalName, source, ts.ScriptTarget.Latest, true, scriptKindFor(fileName))
  const host = ts.createCompilerHost(options, true)
  const originalGetSourceFile = host.getSourceFile.bind(host)
  const originalFileExists = host.fileExists.bind(host)
  const originalReadFile = host.readFile.bind(host)
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) => {
    const normalized = resolve(name)
    if (normalized === PRELUDE_NAME) return preludeFile
    if (normalized === internalName) return loaderFile
    return originalGetSourceFile(name, languageVersion, onError, shouldCreate)
  }
  host.fileExists = (name) => {
    const normalized = resolve(name)
    return normalized === PRELUDE_NAME || normalized === internalName || originalFileExists(name)
  }
  host.readFile = (name) => {
    const normalized = resolve(name)
    if (normalized === PRELUDE_NAME) return LOADER_PRELUDE
    if (normalized === internalName) return source
    return originalReadFile(name)
  }
  host.realpath = (name) => resolve(name)
  // Only the compiler-owned module resolves. A loader file may not reach any
  // other module anyway: the sandbox forbids imports outright.
  host.resolveModuleNames = (moduleNames) => moduleNames.map((moduleName) =>
    moduleName === COMPTIME_MODULE_SPECIFIER
      ? { resolvedFileName: PRELUDE_NAME, extension: ts.Extension.Dts, isExternalLibraryImport: true }
      : undefined)
  const program = ts.createProgram({ rootNames: [internalName, PRELUDE_NAME], options, host })
  const checker = program.getTypeChecker()
  const checkedLoader = program.getSourceFile(internalName) ?? loaderFile
  const checkedPrelude = program.getSourceFile(PRELUDE_NAME)
  const comptimeDeclaration = checkedPrelude?.statements
    .find((statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === "comptime")
  const comptimeSymbol = comptimeDeclaration?.name
    ? aliasTarget(checker, checker.getSymbolAtLocation(comptimeDeclaration.name))
    : undefined
  let loaderSymbol: ts.Symbol | undefined
  for (const statement of checkedPrelude?.statements ?? []) {
    if (!ts.isModuleDeclaration(statement) || !ts.isIdentifier(statement.name) || statement.name.text !== "comptime") {
      continue
    }
    if (statement.body === undefined || !ts.isModuleBlock(statement.body)) continue
    const declaration = statement.body.statements.find((member): member is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(member) && member.name?.text === "loader")
    if (declaration?.name === undefined) continue
    loaderSymbol = aliasTarget(checker, checker.getSymbolAtLocation(declaration.name))
  }
  return {
    checker,
    file: checkedLoader,
    syntactic: program.getSyntacticDiagnostics(checkedLoader),
    comptimeSymbol,
    loaderSymbol,
  }
}

export interface RecognizeLoaderRegistrationOptions {
  /** Reported verbatim in diagnostics; also selects the script kind. */
  readonly fileName: string
  readonly source: string
}

/**
 * Recognize one provisional `comptime.loader(type, fn)` registration file.
 * Every shape outside the bounded subset fails closed with a located
 * `VCT13xx` diagnostic; nothing about the file is executed.
 */
export const recognizeLoaderRegistration = (
  options: RecognizeLoaderRegistrationOptions
): LoaderRegistrationAnalysis => {
  const fileName = options.fileName
  const source = options.source
  if (typeof fileName !== "string" || typeof source !== "string") {
    throw new TypeError("loader registration recognition requires fileName and source strings")
  }
  const diagnostics: LoaderRegistrationDiagnostic[] = []
  const done = (registration?: LoaderRegistration): LoaderRegistrationAnalysis => {
    diagnostics.sort((left, right) => left.line - right.line || left.column - right.column ||
      (left.code < right.code ? -1 : left.code > right.code ? 1 : 0))
    const ok = !diagnostics.some((entry) => entry.severity === "error")
    return Object.freeze({
      ok,
      registration: ok ? registration : undefined,
      diagnostics: Object.freeze(diagnostics),
    })
  }
  const at = (line: number, column: number, code: LoaderRegistrationDiagnosticCodeValue, message: string): void => {
    diagnostics.push({ code, severity: "error", message, fileName, line, column })
  }
  if (Buffer.byteLength(source, "utf8") > MAX_LOADER_SOURCE_BYTES) {
    at(1, 1, LoaderRegistrationDiagnosticCode.ModuleShape, `a comptime loader file exceeds ${MAX_LOADER_SOURCE_BYTES} bytes`)
    return done()
  }
  if (!LOADER_EXTENSIONS.has(extname(fileName).toLowerCase())) {
    at(
      1,
      1,
      LoaderRegistrationDiagnosticCode.ModuleShape,
      `a comptime loader file must be one of ${[...LOADER_EXTENSIONS].join(", ")}`
    )
    return done()
  }

  const checked = checkLoaderFile(fileName, source)
  const file = checked.file
  const located = (node: ts.Node, code: LoaderRegistrationDiagnosticCodeValue, message: string): void => {
    const position = file.getLineAndCharacterOfPosition(node.getStart(file))
    at(position.line + 1, position.character + 1, code, message)
  }
  for (const parsed of checked.syntactic) {
    const position = file.getLineAndCharacterOfPosition(parsed.start ?? 0)
    at(
      position.line + 1,
      position.character + 1,
      LoaderRegistrationDiagnosticCode.Syntax,
      `comptime loader file contains syntax the compiler cannot parse: ${ts.flattenDiagnosticMessageText(parsed.messageText, "\n")}`
    )
  }
  if (diagnostics.length > 0) return done()
  if (checked.comptimeSymbol === undefined || checked.loaderSymbol === undefined) {
    at(1, 1, LoaderRegistrationDiagnosticCode.InternalIdentity, "compiler-owned comptime module identities could not be established")
    return done()
  }

  // 1. Module shape. Exactly the compiler-owned import may exist, because the
  //    sandbox admits no module edges of any kind.
  let comptimeImport: ts.ImportDeclaration | undefined
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== COMPTIME_MODULE_SPECIFIER) {
        located(
          statement,
          LoaderRegistrationDiagnosticCode.ModuleShape,
          `a comptime loader file may only import ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)}; the sandbox resolves no other module`
        )
        continue
      }
      if (comptimeImport !== undefined) {
        located(statement, LoaderRegistrationDiagnosticCode.ModuleShape, `duplicate ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)} import`)
        continue
      }
      if (statement.importClause?.isTypeOnly === true || statement.importClause === undefined) {
        located(
          statement,
          LoaderRegistrationDiagnosticCode.ModuleShape,
          "the compiler-owned comptime module must be imported as a value binding named comptime"
        )
        continue
      }
      comptimeImport = statement
      continue
    }
    if (ts.isImportEqualsDeclaration(statement)) {
      located(statement, LoaderRegistrationDiagnosticCode.ModuleShape, "a comptime loader file cannot use an import-equals declaration")
      continue
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined) {
      located(
        statement,
        LoaderRegistrationDiagnosticCode.ModuleShape,
        "a comptime loader file cannot re-export another module; the registration must be authored in this file"
      )
    }
  }
  visit(file, (node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      located(node, LoaderRegistrationDiagnosticCode.ModuleShape, "a comptime loader file cannot use a dynamic import")
    }
  })

  // 2. Exactly one default export, and it must be the registration call.
  const exportAssignments = file.statements.filter(ts.isExportAssignment)
  if (exportAssignments.length !== 1) {
    at(
      1,
      1,
      LoaderRegistrationDiagnosticCode.RegistrationShape,
      "a comptime loader file must default-export exactly one comptime.loader(...) registration"
    )
    return done()
  }
  const exportAssignment = exportAssignments[0]!
  if (exportAssignment.isExportEquals === true) {
    located(
      exportAssignment,
      LoaderRegistrationDiagnosticCode.RegistrationShape,
      "a comptime loader registration uses `export default`, not `export =`"
    )
    return done()
  }
  const exported = unwrap(exportAssignment.expression)
  if (!ts.isCallExpression(exported)) {
    located(
      exportAssignment.expression,
      LoaderRegistrationDiagnosticCode.RegistrationShape,
      "a comptime loader file must default-export a comptime.loader(...) call"
    )
    return done()
  }

  // 3. Checker identity, never spelling.
  const callee = exported.expression
  const calleeName = ts.isPropertyAccessExpression(callee)
    ? callee.name
    : ts.isIdentifier(callee)
      ? callee
      : undefined
  const calleeSymbol = calleeName === undefined
    ? undefined
    : aliasTarget(checked.checker, checked.checker.getSymbolAtLocation(calleeName))
  if (calleeSymbol !== checked.loaderSymbol) {
    located(
      callee,
      calleeSymbol === undefined
        ? LoaderRegistrationDiagnosticCode.MissingIdentity
        : LoaderRegistrationDiagnosticCode.UnrelatedIdentity,
      calleeSymbol === undefined
        ? `loader registration has no imported compiler identity from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)}`
        : `loader registration does not resolve to comptime.loader imported from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)}`
    )
    return done()
  }
  if (comptimeImport === undefined) {
    located(
      callee,
      LoaderRegistrationDiagnosticCode.MissingIdentity,
      `loader registration requires a value import of ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)}`
    )
    return done()
  }
  if (exported.questionDotToken !== undefined || (exported.typeArguments?.length ?? 0) > 0) {
    located(
      exported,
      LoaderRegistrationDiagnosticCode.CallShape,
      "comptime.loader is called directly, without optional chaining or explicit type arguments"
    )
    return done()
  }
  if (exported.arguments.length !== 2) {
    located(
      exported,
      LoaderRegistrationDiagnosticCode.CallShape,
      "comptime.loader takes exactly two arguments: an import-attribute type literal and a loader function"
    )
    return done()
  }

  // 4. The registered type must be a plain string literal naming one attribute
  //    type. Globs stay unimplemented rather than silently half-supported.
  const typeArgument = exported.arguments[0]!
  if (!ts.isStringLiteral(typeArgument)) {
    located(
      typeArgument,
      LoaderRegistrationDiagnosticCode.LoaderType,
      "the registered loader type must be a plain string literal the compiler can read without evaluation"
    )
    return done()
  }
  const type = typeArgument.text
  if (GLOB_CHARACTER.test(type) || type.includes("/") || type.includes(".")) {
    located(
      typeArgument,
      LoaderRegistrationDiagnosticCode.LoaderType,
      `this provisional registration takes a plain import-attribute type name such as "yaml"; glob and extension patterns like ${JSON.stringify(type)} are not supported yet`
    )
    return done()
  }
  if (!LOADER_TYPE.test(type)) {
    located(
      typeArgument,
      LoaderRegistrationDiagnosticCode.LoaderType,
      `an import-attribute type must be a lowercase identifier matching ${String(LOADER_TYPE)}`
    )
    return done()
  }

  // 5. The loader function must be inline or a same-file declaration, so the
  //    lowered sandbox module is a byte-for-byte slice of authored source.
  const functionArgument = exported.arguments[1]!
  const resolvedFunction = resolveLoaderFunction(functionArgument, file, checked.checker)
  if (resolvedFunction.ok === false) {
    located(functionArgument, LoaderRegistrationDiagnosticCode.LoaderFunction, resolvedFunction.message)
    return done()
  }

  // 6. No other compiler-owned use may escape: one file, one registration.
  const allowed = new Set<ts.Node>()
  markTree(comptimeImport, allowed)
  markTree(callee, allowed)
  visit(file, (node) => {
    if (!ts.isIdentifier(node) || allowed.has(node)) return
    const resolved = aliasTarget(checked.checker, checked.checker.getSymbolAtLocation(node))
    if (resolved === checked.loaderSymbol || resolved === checked.comptimeSymbol) {
      located(
        node,
        LoaderRegistrationDiagnosticCode.EscapingRegistration,
        "a comptime loader file registers exactly one loader; compiler-owned comptime values cannot be used anywhere else in it"
      )
    }
  })
  if (diagnostics.some((entry) => entry.severity === "error")) return done()

  const sandboxSource = applyReplacements(source, [
    { start: comptimeImport.getStart(file), end: comptimeImport.getEnd(), text: "" },
    {
      start: exportAssignment.getStart(file),
      end: exportAssignment.getEnd(),
      text: `export default ${resolvedFunction.text};`,
    },
  ])
  const sandboxFile = ts.createSourceFile("loader.sandbox.ts", sandboxSource, ts.ScriptTarget.Latest, true, scriptKindFor(fileName))
  const sandboxDiagnostics =
    (sandboxFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? []
  if (sandboxDiagnostics.length > 0) {
    located(
      exportAssignment,
      LoaderRegistrationDiagnosticCode.RegistrationShape,
      `the compiler could not lower this registration into a sandbox module: ${ts.flattenDiagnosticMessageText(sandboxDiagnostics[0]!.messageText, "\n")}`
    )
    return done()
  }
  const position = file.getLineAndCharacterOfPosition(exported.getStart(file))
  return done(Object.freeze({
    fileName,
    type,
    sandboxSource,
    authoredDigest: digest(source),
    sandboxDigest: digest(sandboxSource),
    line: position.line + 1,
    column: position.character + 1,
  }))
}

const topLevelStatement = (node: ts.Node, file: ts.SourceFile): boolean =>
  node.parent === file && file.statements.includes(node as ts.Statement)

/**
 * Admit an inline function expression, or an identifier bound by exactly one
 * same-file `const` or `function` declaration. Anything else — an imported
 * binding, a property access, a call result, a class member, a generator —
 * fails closed, because the sandbox module must be able to name it.
 */
const resolveLoaderFunction = (
  argument: ts.Expression,
  file: ts.SourceFile,
  checker: ts.TypeChecker
): { readonly ok: true; readonly text: string } | { readonly ok: false; readonly message: string } => {
  const expression = unwrap(argument)
  const rejectGenerator = (node: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration): boolean =>
    ts.isArrowFunction(node) ? false : node.asteriskToken !== undefined
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    if (rejectGenerator(expression)) return { ok: false, message: "a comptime loader cannot be a generator function" }
    return { ok: true, text: expression.getText(file) }
  }
  if (!ts.isIdentifier(expression)) {
    return {
      ok: false,
      message: "the loader function must be written inline or reference one same-file const or function declaration",
    }
  }
  const symbol = checker.getSymbolAtLocation(expression)
  const declarations = symbol?.declarations ?? []
  if (declarations.length !== 1) {
    return { ok: false, message: `${expression.text} does not resolve to exactly one same-file loader declaration` }
  }
  const declaration = declarations[0]!
  if (declaration.getSourceFile() !== file) {
    return { ok: false, message: `${expression.text} is not declared in this loader file` }
  }
  if (ts.isFunctionDeclaration(declaration)) {
    if (!topLevelStatement(declaration, file)) {
      return { ok: false, message: `${expression.text} must be declared at the top level of the loader file` }
    }
    if (rejectGenerator(declaration)) return { ok: false, message: "a comptime loader cannot be a generator function" }
    return { ok: true, text: expression.text }
  }
  if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name)) {
    return { ok: false, message: `${expression.text} is not a const-bound loader function` }
  }
  const list = declaration.parent
  if (
    !ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Const) === 0 || list.declarations.length !== 1 ||
    !ts.isVariableStatement(list.parent) || !topLevelStatement(list.parent, file)
  ) {
    return {
      ok: false,
      message: `${expression.text} must be one top-level single-declaration const in this loader file`,
    }
  }
  const initializer = declaration.initializer === undefined ? undefined : unwrap(declaration.initializer)
  if (initializer === undefined || !(ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
    return { ok: false, message: `${expression.text} must be initialized with a function expression` }
  }
  if (rejectGenerator(initializer)) return { ok: false, message: "a comptime loader cannot be a generator function" }
  return { ok: true, text: expression.text }
}
