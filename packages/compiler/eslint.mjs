// vibelang/eslint: an ESLint parser for .vibe files.
//
//   import vibelang from "vibelang/eslint"
//   export default [{ files: ["**/*.vibe"], languageOptions: { parser: vibelang } }]
//
// The compiler parses the file and converts its tree to ESTree
// (`vibelang --estree`, typescript/tsc/internal/vibelangestree): TypeScript
// forms take typescript-estree's shapes, so typescript-eslint's rules and
// every plugin that reads TypeScript work unchanged, and VibeLang's own forms
// take the node types in vibeVisitorKeys. A module declaration's body (D283)
// is TypeScript and converts as a .ts file's statements do. Scope analysis is
// @typescript-eslint/scope-manager's, resolved from the typescript-eslint the
// project installs. There is no TypeScript program, so rules that need type
// information do not run on .vibe files; `vibelang -p` type-checks them.
// typedProgram gives typed lint of a project's .ts files the types of the
// .vibe modules they import.
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { basename, dirname, join, parse as parsePath, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { nearestProject, workspaceProject } from "./project.mjs"

const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"))

export const meta = { name: "vibelang/eslint", version: manifest.version }

/** Child keys of the ESTree node types VibeLang adds. */
export const vibeVisitorKeys = Object.freeze({
  TopicReference: [],
  VibeCatchExpression: ["expression", "handler"],
  VibeEffectType: ["success", "failure", "requirements"],
  VibeInferType: [],
  VibeMaskStatement: ["body"],
  VibeModuleDeclaration: ["id", "body"],
  VibePipeExpression: ["left", "right"],
  VibeProvideStatement: ["providers", "body"],
  VibeServiceProvider: ["key", "value"]
})

const executable = process.platform === "win32" ? "vibelang.exe" : "vibelang"

// nativeCompiler finds the compiler as bin/vibelang does, without starting
// Node for each file: VIBELANG_BINARY, then native/vibelang beside this
// package (a checkout build), then the installed platform package.
function nativeCompiler() {
  if (process.env.VIBELANG_BINARY) return resolve(process.env.VIBELANG_BINARY)
  const local = fileURLToPath(new URL(`./native/${executable}`, import.meta.url))
  if (existsSync(local)) return local
  const target = `${process.platform}-${process.arch}`
  const name = process.platform === "win32" ? `@vibelang/cli-${target}` : `vibelang-${target}`
  try {
    const platform = createRequire(import.meta.url).resolve(`${name}/package.json`)
    return join(dirname(platform), "bin", executable)
  } catch {
    throw new Error(`vibelang/eslint: no native compiler is installed for ${target}. Reinstall vibelang without omitting optional dependencies, or set VIBELANG_BINARY.`)
  }
}

// typescriptEslint loads scope analysis and visitor keys: beside this package
// when they are installed with it, else through the typescript-eslint the
// linted project installs, which depends on both.
const loaded = new Map()
function typescriptEslint(filePath) {
  const bases = [fileURLToPath(import.meta.url)]
  if (filePath) bases.push(resolve(filePath))
  bases.push(join(process.cwd(), "package.json"))
  for (const base of bases) {
    if (loaded.has(base)) return loaded.get(base)
    const found = tryLoad(createRequire(base))
    if (found) {
      loaded.set(base, found)
      return found
    }
  }
  throw new Error("vibelang/eslint needs typescript-eslint 8: install it beside eslint, as for TypeScript files.")
}

function tryLoad(require) {
  const attempt = (from) => {
    try {
      const scope = from.resolve("@typescript-eslint/scope-manager")
      const keys = from.resolve("@typescript-eslint/visitor-keys")
      const { analyze, Visitor } = from(scope)
      return { analyze, Visitor, visitorKeys: from(keys).visitorKeys }
    } catch {
      return undefined
    }
  }
  const direct = attempt(require)
  if (direct) return direct
  for (const chain of [["@typescript-eslint/parser"], ["typescript-eslint", "@typescript-eslint/parser"]]) {
    let from = require
    try {
      for (const name of chain) from = createRequire(from.resolve(`${name}/package.json`))
    } catch {
      continue
    }
    const found = attempt(from)
    if (found) return found
  }
  return undefined
}

/**
 * The compiler's ESTree Program for a .vibe file (`vibelang --estree`), each
 * node with its range and without loc: what vibelang/eslint and vibelang/knip
 * read. A syntax error throws a SyntaxError at its position.
 *
 * @param {string} code The file's text.
 * @param {string} filePath Its path, for the compiler's messages.
 */
export function parseESTree(code, filePath) {
  const result = spawnSync(nativeCompiler(), ["--estree", filePath], {
    input: code, encoding: "utf8", maxBuffer: 1024 * 1024 * 1024
  })
  if (result.error) throw new Error(`vibelang: cannot run the compiler: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`vibelang: the compiler failed on ${filePath}: ${result.stderr.trim()}`)
  const { ast, error } = JSON.parse(result.stdout)
  if (error) {
    const failure = new SyntaxError(error.message)
    Object.assign(failure, { index: error.index, lineNumber: error.lineNumber, column: error.column })
    throw failure
  }
  return ast
}

/**
 * Parses a .vibe file for ESLint.
 *
 * @param {string} code The file's text.
 * @param {{ filePath?: string, sourceType?: "module" | "script", lib?: string[] }} [options]
 */
export function parseForESLint(code, options = {}) {
  const ast = parseESTree(code, options.filePath ?? "file.vibe")
  finish(ast, code)
  ast.sourceType = options.sourceType ?? "module"
  const { analyze, Visitor, visitorKeys: typescriptKeys } = typescriptEslint(options.filePath)
  const visitorKeys = { ...typescriptKeys, ...vibeVisitorKeys }
  const scopeManager = withModuleScopes(Visitor, () => analyze(ast, {
    childVisitorKeys: visitorKeys,
    globalReturn: false,
    jsxPragma: null,
    lib: options.lib ?? ["esnext"],
    sourceType: ast.sourceType
  }))
  hideSynthesized(scopeManager)
  // As @typescript-eslint/parser reports for a file outside any TypeScript
  // program: a rule that needs type information says so instead of crashing.
  const services = {
    emitDecoratorMetadata: undefined,
    experimentalDecorators: undefined,
    isolatedDeclarations: undefined,
    program: null,
    esTreeNodeToTSNodeMap: new WeakMap(),
    tsNodeToESTreeNodeMap: new WeakMap()
  }
  return { ast, scopeManager, services, visitorKeys }
}

// withModuleScopes runs analyze so that each module declaration's body is a
// module scope of its own, a child of the global scope beside the file's: the
// body's names are not the file's, a name it reads from the file is
// undefined, and its imports are its own. analyze's Referencer finds the
// method for a node type on Visitor, which scope-manager exports and the
// Referencer extends; for as long as analyze runs, Visitor has one for
// VibeModuleDeclaration. A nested Program cannot do it: the Referencer opens
// a second global scope for it and asserts there is none, and ESLint runs
// every Program listener on it.
function withModuleScopes(Visitor, analyze) {
  Visitor.prototype.VibeModuleDeclaration = moduleDeclaration
  try {
    return analyze()
  } finally {
    delete Visitor.prototype.VibeModuleDeclaration
  }
}

// moduleDeclaration is the Referencer's method for module text { body }: it
// analyzes the body in a module scope whose upper scope is the global scope,
// then returns to the file's scope.
function moduleDeclaration(node) {
  const manager = this.scopeManager
  if (!manager) return this.visitChildren(node)
  const enclosing = manager.currentScope
  manager.currentScope = manager.globalScope
  manager.nestModuleScope(node.body)
  for (const statement of node.body.body) this.visit(statement)
  this.close(node.body)
  manager.currentScope = enclosing
}

// hideSynthesized removes the variables of names the parser wrote, such as a
// match's $match1 or a catch clause's $caught, so no rule reports a name the
// author never wrote. A reference to one resolves to nothing.
function hideSynthesized(scopeManager) {
  for (const scope of scopeManager.scopes) {
    const kept = []
    for (const variable of scope.variables) {
      if (variable.identifiers.length !== 0 && variable.identifiers.every((identifier) => identifier.synthesized === true)) {
        scope.set.delete(variable.name)
        for (const reference of variable.references) reference.resolved = null
      } else {
        kept.push(variable)
      }
    }
    scope.variables.splice(0, scope.variables.length, ...kept)
  }
}

/** Parses a .vibe file to its ESTree Program. */
export function parse(code, options) {
  return parseForESLint(code, options).ast
}

// finish adds what JSON cannot carry: each node's loc, and the values of
// bigint, regular expression, and non-finite number literals.
function finish(ast, code) {
  const starts = [0]
  for (const match of code.matchAll(/\r\n|[\r\n\u2028\u2029]/gu)) starts.push(match.index + match[0].length)
  const position = (offset) => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if (starts[middle] <= offset) low = middle
      else high = middle - 1
    }
    return { line: low + 1, column: offset - starts[low] }
  }
  const locate = (item) => {
    item.loc = { start: position(item.range[0]), end: position(item.range[1]) }
  }
  const visit = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) if (item !== null && typeof item === "object") visit(item)
      return
    }
    if (typeof node.type !== "string") {
      for (const value of Object.values(node)) if (value !== null && typeof value === "object") visit(value)
      return
    }
    locate(node)
    if (node.type === "Literal") literal(node)
    for (const [key, value] of Object.entries(node)) {
      if (key === "range" || key === "loc" || value === null || typeof value !== "object") continue
      visit(value)
    }
  }
  visit(ast)
  for (const token of ast.tokens) locate(token)
  for (const comment of ast.comments) locate(comment)
}

function literal(node) {
  if (node.regex) {
    try {
      node.value = new RegExp(node.regex.pattern, node.regex.flags)
    } catch {
      node.value = null
    }
  } else if (typeof node.bigint === "string") {
    node.value = BigInt(node.bigint)
    node.bigint = String(node.value)
  } else if (node.value === null && node.raw !== "null") {
    node.value = Number(node.raw.replaceAll("_", ""))
  }
}

/**
 * Builds the TypeScript program typed lint reads a project's `.ts` files
 * with, for typescript-eslint's `parserOptions.programs`. typescript-eslint
 * builds its program with the `typescript` it installs, which cannot read a
 * `.vibe` file: a type a `.ts` file imports from one, directly or through a
 * `.ts` barrel, is unresolved, so type-aware rules judge the code against
 * error types. This program reads each `.vibe` module's declaration instead,
 * as `vibelang` writes it, so a `.ts` file sees the types `vibelang -p` sees.
 *
 *     import { typedProgram } from "vibelang/eslint"
 *     parserOptions: { programs: [typedProgram({ project: "tsconfig.json", tsconfigRootDir: import.meta.dirname })] }
 *
 * The program is the project's own, from the `typescript` the project
 * resolves, as typescript-eslint's would be; only its `.vibe` imports differ.
 * A `.vibe` module's declaration stands at `x.d.vibe.ts` beside `x.vibe`,
 * where TypeScript looks for an arbitrary extension's declarations, and a
 * declaration's `./x.js` import of another `.vibe` module resolves to the
 * same file, so each module has one identity. As the loaders compile it
 * (project.mjs), a module compiles with its own package's project: the
 * linted project for its own files, the nearest tsconfig.json above it for
 * another workspace package's. Each project compiles once, when the program
 * first reads one of its modules.
 *
 * @param {{ project?: string, tsconfigRootDir?: string, compiler?: string }} [options]
 *   `project` is the tsconfig, relative to `tsconfigRootDir` (default: the
 *   working directory). Without it, discover the nearest `vibe.config.json`,
 *   `tsconfig.json` or `jsconfig.json`, in that order per directory. `compiler` is as for
 *   the loaders: a vibelang command, else VIBELANG_BINARY, else the installed
 *   compiler.
 */
export function typedProgram(options = {}) {
  const root = resolve(options.tsconfigRootDir ?? process.cwd())
  const project = options.project === undefined
    ? nearestProject(join(root, "tsconfig.json")) ?? join(root, "tsconfig.json")
    : resolve(root, options.project)
  const ts = projectTypeScript(project)
  const parsed = ts.getParsedCommandLineOfConfigFile(project, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(`vibelang/eslint: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`)
    }
  })
  const compiler = options.compiler ? resolve(root, options.compiler) : nativeCompiler()
  const projectRoot = dirname(project)
  const compiled = new Map() // tsconfig -> Map(declaration path -> text)
  // The declaration of the .vibe module or module declaration at path, from
  // its own project's compile, or undefined.
  // A workspace package's file is asked for by its path through
  // node_modules; the compile names it by its real path.
  const virtual = (fileName) => {
    const path = resolve(fileName)
    const listed = vibeSourceOf(path)
    if (listed === undefined || !existsSync(listed)) return undefined
    const source = realpathSync(listed)
    const owner = workspaceProject(source, projectRoot, project)
    if (owner === undefined) return undefined
    if (!compiled.has(owner)) compiled.set(owner, vibeDeclarations(compiler, owner, owner === project ? projectRoot : dirname(owner)))
    return compiled.get(owner).get(join(dirname(source), basename(path)))
  }
  const compilerOptions = { ...parsed.options, allowArbitraryExtensions: true, noEmit: true }
  const host = ts.createCompilerHost(compilerOptions, true)
  const { fileExists, readFile, getSourceFile } = host
  host.fileExists = (fileName) => virtual(fileName) !== undefined || fileExists.call(host, fileName)
  host.readFile = (fileName) => virtual(fileName) ?? readFile.call(host, fileName)
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const text = virtual(fileName)
    return text === undefined
      ? getSourceFile.call(host, fileName, languageVersion, onError, shouldCreate)
      : ts.createSourceFile(fileName, text, languageVersion, true)
  }
  const cache = ts.createModuleResolutionCache(host.getCurrentDirectory(), host.getCanonicalFileName, compilerOptions)
  host.resolveModuleNameLiterals = (literals, containingFile, redirected, resolutionOptions, containingSourceFile) =>
    literals.map((literal) => {
      const mode = ts.getModeForUsageLocation(containingSourceFile, literal, resolutionOptions)
      const resolved = ts.resolveModuleName(literal.text, containingFile, resolutionOptions, host, cache, redirected, mode)
      if (resolved.resolvedModule !== undefined) return resolved
      // A declaration names another .vibe module by its JavaScript, ./x.js.
      const declaration = vibeDeclarationFor(literal.text, containingFile)
      return declaration !== undefined && host.fileExists(declaration)
        ? { ...resolved, resolvedModule: { resolvedFileName: declaration, extension: ts.Extension.Dts, isExternalLibraryImport: false } }
        : resolved
    })
  return ts.createProgram({ rootNames: parsed.fileNames, options: compilerOptions, host, projectReferences: parsed.projectReferences })
}

// projectTypeScript loads the typescript the project resolves, which is the
// one typescript-eslint loads for it.
function projectTypeScript(project) {
  for (const base of [project, join(process.cwd(), "package.json"), fileURLToPath(import.meta.url)]) {
    try {
      return createRequire(base)("typescript")
    } catch {
      continue
    }
  }
  throw new Error("vibelang/eslint: typedProgram needs typescript: install it beside typescript-eslint.")
}

// vibeSourceOf returns the .vibe file whose declaration the program reads at
// path: x.vibe for x.d.vibe.ts, and x.vibe for a module declaration's
// x.vibe.text.d.ts (D403). Anything else is undefined.
function vibeSourceOf(path) {
  if (path.endsWith(".d.vibe.ts")) return path.slice(0, -".d.vibe.ts".length) + ".vibe"
  return /^(.+\.vibe)\.[^./\\]+\.d\.ts$/.exec(path)?.[1]
}

// vibeDeclarations compiles project once and returns the declaration of each
// of its .vibe modules by the path the program reads it at: x.d.vibe.ts
// beside x.vibe, and a module declaration's file, such as x.vibe.text.d.ts,
// at its own name. As a loader's compile does, --loader-root checks and emits
// only the files under root; another package's modules compile with their
// own project.
function vibeDeclarations(compiler, project, root) {
  const out = mkdtempSync(join(tmpdir(), "vibelang-eslint-"))
  try {
    const result = spawnSync(compiler, [
      "--project", project, "--loader-root", root, "--pretty", "false",
      "--noEmit", "false", "--declaration", "--emitDeclarationOnly", "--declarationMap", "false",
      "--composite", "false", "--incremental", "false", "--noEmitOnError", "false",
      "--outDir", out, "--rootDir", parsePath(root).root, "--listEmittedFiles"
    ], { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 })
    if (result.error) throw new Error(`vibelang/eslint: cannot run the compiler: ${result.error.message}`)
    const declarations = new Map()
    for (const line of result.stdout.split("\n")) {
      if (!line.startsWith("TSFILE: ")) continue
      const emitted = line.slice("TSFILE: ".length).trim()
      if (!emitted.endsWith(".d.ts")) continue
      const base = resolve(parsePath(root).root, relative(out, emitted)).slice(0, -".d.ts".length)
      const path = existsSync(base + ".vibe") ? base + ".d.vibe.ts" : base + ".d.ts"
      if (vibeSourceOf(path) !== undefined) declarations.set(path, readFileSync(emitted, "utf8"))
    }
    if (result.status !== 0 && declarations.size === 0) {
      throw new Error(`vibelang/eslint: ${project} did not compile, so typed lint has no types for its .vibe modules:\n${(result.stdout + result.stderr).trim().slice(0, 4000)}`)
    }
    return declarations
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

// vibeDeclarationFor returns the declaration path of the .vibe module that a
// relative specifier names by its JavaScript (./x.js) or without an
// extension, or undefined.
function vibeDeclarationFor(specifier, containingFile) {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined
  const target = resolve(dirname(containingFile), specifier)
  const base = target.endsWith(".js") ? target.slice(0, -".js".length) : target
  return existsSync(base + ".vibe") ? base + ".d.vibe.ts" : undefined
}

export default { meta, parse, parseForESLint }
