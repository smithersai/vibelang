import { basename, dirname, isAbsolute, join, normalize, resolve } from "node:path"
import * as ts from "typescript-js"
import type {
  AgentDiagnostic,
  CompilationResult,
  TypeScriptCompiler,
} from "./types.ts"

const VIRTUAL_ROOT = normalize("/__vibelang_agent__")
const SANDBOX_POLICY_CODE = 91001

/**
 * This is an explicit POC execution policy, not a claim that source filtering is
 * a security boundary. It prevents the concrete Deno node:vm/worker escape from
 * reintroducing fresh realms with ambient clock and random globals.
 */
function sandboxPolicyDiagnostics(source: string): AgentDiagnostic[] {
  const file = ts.createSourceFile("turn.ts", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const diagnostics: AgentDiagnostic[] = []
  const forbiddenRuntimeNames = new Set([
    "eval",
    "Function",
    "AsyncFunction",
    "GeneratorFunction",
    "AsyncGeneratorFunction",
    "require",
    "Worker",
    "SharedWorker",
    "ShadowRealm",
  ])

  const report = (node: ts.Node, message: string): void => {
    const position = file.getLineAndCharacterOfPosition(node.getStart(file))
    diagnostics.push({
      category: "error",
      code: SANDBOX_POLICY_CODE,
      message: `Generated-turn sandbox policy: ${message}`,
      file: "turn.ts",
      line: position.line + 1,
      column: position.character + 1,
    })
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      report(node, "module imports are unavailable; use only the supplied Functions table")
      return
    }
    if (ts.isImportEqualsDeclaration(node)) {
      report(node, "import-equals is unavailable; use only the supplied Functions table")
      return
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      report(node, "module re-exports are unavailable; use only the supplied Functions table")
      return
    }
    if (ts.isImportTypeNode(node)) {
      report(node, "import types are unavailable in generated turns")
      return
    }
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      report(node, "import.meta is unavailable in generated turns")
      return
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      report(node, "dynamic import is unavailable; use only the supplied Functions table")
      return
    }
    if (ts.isIdentifier(node) && forbiddenRuntimeNames.has(node.text)) {
      report(node, `${node.text} is unavailable because generated turns may not create or enter another realm`)
      return
    }
    ts.forEachChild(node, visit)
  }

  visit(file)
  return diagnostics
}

function virtualPath(name: string): string {
  return normalize(join(VIRTUAL_ROOT, name))
}

function diagnosticFromTypeScript(diagnostic: ts.Diagnostic): AgentDiagnostic {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
  const category =
    diagnostic.category === ts.DiagnosticCategory.Warning
      ? "warning"
      : diagnostic.category === ts.DiagnosticCategory.Message ||
          diagnostic.category === ts.DiagnosticCategory.Suggestion
        ? "message"
        : "error"
  if (!diagnostic.file || diagnostic.start === undefined) {
    return { category, code: diagnostic.code, message }
  }
  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
  return {
    category,
    code: diagnostic.code,
    message,
    file: basename(diagnostic.file.fileName),
    line: position.line + 1,
    column: position.character + 1,
  }
}

/**
 * In-memory fallback on TypeScript 5.9's JS API. The installed TypeScript 7
 * native preview intentionally exposes its CLI and version only; VibeLang's
 * compiler needs to grow the equivalent virtual-file API directly.
 */
export class InMemoryTypeScriptCompiler implements TypeScriptCompiler {
  async compile(source: string, callableSurface: string): Promise<CompilationResult> {
    const policyDiagnostics = sandboxPolicyDiagnostics(source)
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ["lib.es2022.d.ts"],
      types: [],
      strict: true,
      skipLibCheck: true,
      noEmitOnError: true,
      sourceMap: true,
    }
    const files = new Map<string, string>([
      [virtualPath("turn.ts"), source],
      [virtualPath("surface.d.ts"), callableSurface],
      [
        virtualPath("__check.ts"),
        [
          'import turn from "./turn.js"',
          "type AgentTurn = (functions: Functions) => unknown | Promise<unknown>",
          "const checkedTurn: AgentTurn = turn",
          "void checkedTurn",
          "",
        ].join("\n"),
      ],
    ])

    const defaultHost = ts.createCompilerHost(options, true)
    const compilerLibDirectory = dirname(ts.getDefaultLibFilePath(options))
    const outputs = new Map<string, string>()
    const normalizeRequest = (fileName: string): string =>
      normalize(isAbsolute(fileName) ? fileName : resolve(VIRTUAL_ROOT, fileName))
    const isCompilerLib = (fileName: string): boolean => {
      const requested = normalizeRequest(fileName)
      return requested.startsWith(`${normalize(compilerLibDirectory)}/`)
    }

    const host: ts.CompilerHost = {
      ...defaultHost,
      getCurrentDirectory: () => VIRTUAL_ROOT,
      directoryExists: (directoryName) => {
        const requested = normalizeRequest(directoryName)
        return requested === VIRTUAL_ROOT ||
          (requested.startsWith(normalize(compilerLibDirectory)) &&
            (defaultHost.directoryExists?.(requested) ?? true))
      },
      realpath: (fileName) => normalizeRequest(fileName),
      fileExists: (fileName) => {
        const requested = normalizeRequest(fileName)
        return files.has(requested) || (isCompilerLib(requested) && defaultHost.fileExists(requested))
      },
      readFile: (fileName) => {
        const requested = normalizeRequest(fileName)
        return files.get(requested) ??
          (isCompilerLib(requested) ? defaultHost.readFile(requested) : undefined)
      },
      getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
        const requested = normalizeRequest(fileName)
        const text = files.get(requested)
        if (text !== undefined) {
          return ts.createSourceFile(requested, text, languageVersion, true)
        }
        if (!isCompilerLib(requested)) return undefined
        return defaultHost.getSourceFile(
          requested,
          languageVersion,
          onError,
          shouldCreateNewSourceFile,
        )
      },
      writeFile: (fileName, text) => outputs.set(normalizeRequest(fileName), text),
    }

    const program = ts.createProgram({
      rootNames: [...files.keys()],
      options,
      host,
    })
    const preEmit = ts.getPreEmitDiagnostics(program)
    const hasError = policyDiagnostics.length > 0 || preEmit.some(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    )
    const emit = hasError ? undefined : program.emit()
    const allDiagnostics = [...preEmit, ...(emit?.diagnostics ?? [])]
    const diagnostics = [
      ...policyDiagnostics,
      ...allDiagnostics.map(diagnosticFromTypeScript),
    ]
    const compiler = `TypeScript ${ts.version} JS API fallback`
    if (hasError || emit?.emitSkipped) return { ok: false, diagnostics, compiler }

    const javascript = [...outputs.entries()].find(
      ([fileName]) => basename(fileName) === "turn.js",
    )?.[1]
    if (javascript === undefined) {
      return {
        ok: false,
        compiler,
        diagnostics: [
          ...diagnostics,
          { category: "error", message: "TypeScript emitted no generated turn module" },
        ],
      }
    }
    return { ok: true, diagnostics, javascript, compiler }
  }
}

// Kept as a source-compatible POC alias for the first CLI-backed implementation.
export const CliTypeScriptCompiler = InMemoryTypeScriptCompiler
