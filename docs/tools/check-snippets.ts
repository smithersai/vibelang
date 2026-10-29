// Run from the repository root: bun docs/tools/check-snippets.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, posix, relative, resolve } from "node:path"
import { createRequire } from "node:module"

const repo = resolve(import.meta.dir, "../..")
export type Diagnostic = { code: string; message: string; line?: number; column?: number }
export type Block = { number: number; line: number; endLine?: number; language: "vibe" | "ts"; source: string; filename?: string; types?: string[]; firstLine: string; expected: string[]; fragment: boolean; comparison?: boolean; gap?: string; output?: string; run?: string; pending?: string[] }
export type Result = Block & { status: "ok" | "fragment" | "pending" | "compiler-gap" | "fail"; diagnostics: Diagnostic[]; reason?: string; execution?: Execution }
export type Execution = { phase: "compile" | "run"; status: "passed" | "failed"; expectedStdout: string; stdout: string; stderr: string; exitCode: number; timedOut: boolean }

export function extract(markdown: string, options: { hatchExamples?: boolean } = {}): Block[] {
  const lines = markdown.split(/\r?\n/)
  const blocks: Block[] = []
  let number = 0
  for (let i = 0; i < lines.length; i++) {
    const fence = /^\s{0,3}(`{3,}|~{3,})([^`]*)$/.exec(lines[i])
    if (!fence) continue
    const start = i + 1
    const body: string[] = []
    const close = new RegExp(`^\\s{0,3}${fence[1][0]}{${fence[1].length},}\\s*$`)
    while (++i < lines.length && !close.test(lines[i])) body.push(lines[i])
    // The fence decides the language: ```vibe is VibeLang and ```ts is
    // TypeScript. Effect comparisons are checked too; fragments opt out explicitly.
    const [lang, role] = fence[2].trim().split(/\s+/)
    if (lang !== "vibe" && lang !== "ts") continue
    const language = lang
    number++
    const filename = body.slice(0, 2).map(line => /^\s*\/\/\s+((?:[\w.-]+\/)*[\w.-]+\.(?:vibe|ts))\s*$/.exec(line)?.[1]).find(Boolean)
    if (filename?.split("/").some(part => part === "." || part === "..")) throw new Error(`Invalid snippet filename: ${filename}`)
    if (filename && !filename.endsWith(`.${language}`)) throw new Error(`${language === "ts" ? "A ts" : "A vibe"} fence names ${filename}; the fence decides the language`)
    // A TypeScript example without a filename, such as a framework's config, opts out.
    if (language === "ts" && /^\s*\/\/ TypeScript \(\.ts\)/.test(body[0] ?? "") && !filename) continue
    const headers: string[] = []
    for (const line of body) {
      if (!/^\s*\/\//.test(line)) break
      headers.push(line)
    }
    const header = headers.join("\n")
    const inline = body.flatMap(line => {
      const match = /^\s*\/\/ Output: ?(.*)$/.exec(line)
      return match ? [match[1]] : []
    })
    let next = i + 1
    while (next < lines.length && !lines[next].trim()) next++
    const outputFence = /^\s{0,3}(`{3,}|~{3,})output\s*$/.exec(lines[next] ?? "")
    let output = inline.length ? inline.join("\n") : undefined
    if (outputFence) {
      if (inline.length) throw new Error(`Block ${number} declares both inline and fenced output`)
      const end = new RegExp(`^\\s{0,3}${outputFence[1][0]}{${outputFence[1].length},}\\s*$`)
      const expected: string[] = []
      while (++next < lines.length && !end.test(lines[next])) expected.push(lines[next])
      if (next === lines.length) throw new Error(`Unclosed output fence for block ${number}`)
      output = expected.join("\n")
    }
    const run = header.match(/\/\/ run:\s*([^\n]+)/)?.[1]
    // A case the VIPs leave open names its topic in a pending-decision line.
    const decisions = header.match(/\/\/ pending-decision:\s*([^\n]+)/)?.[1].split(/[\s,]+/).filter(Boolean).map(topic => `decision:${topic}`)
    const vips = header.match(/\/\/ pending:\s*([^\n]+)/)?.[1].split(/[\s,]+/).filter(Boolean)
    const pending = vips || decisions ? [...vips ?? [], ...decisions ?? []] : undefined
    if (run && output === undefined) throw new Error(`Block ${number} has a run marker without expected output`)
    blocks.push({ number, line: start + 1, endLine: i + 1, language, source: body.join("\n"), filename, output, run,
      types: header.match(/\/\/ types:\s*([^\n]+)/)?.[1].split(/[\s,]+/).filter(Boolean),
      firstLine: body.find(l => l.trim() && !/^\s*\/\//.test(l)) ?? body[0] ?? "",
      expected: [...(header.match(/\/\/ expect-error:\s*([^\n]+)/)?.[1] ?? "").matchAll(/(?:EK|TS)\d+/g)].map(m => m[0]),
      comparison: lang === "ts" && role === "effect",
      // A block written in a form the compiler doesn't implement yet names the
      // VIPs it waits for; it stays out of the program, as a fragment does.
      fragment: /\/\/ fragment\s*(?:$|\n)/.test(header) || pending !== undefined,
      pending,
      gap: header.match(/\/\/ compiler-gap:\s*([^\n]+)/)?.[1] })
  }

  // These inline examples are copied into new apps. Give f an imported
  // TypeScript implementation and x a local binding, exactly as readers use them.
  if (options.hatchExamples) {
    const line = lines.findIndex(line => line.startsWith("- A plain TypeScript call needs "))
    if (line < 0) throw new Error("Missing onboarding hatch examples")
    const examples = [...lines[line].matchAll(/\x60((?:sync|try)\([^\x60]+)\x60/g)]
    if (examples.length !== 2) throw new Error("Expected sync and try onboarding examples")
    const add = (source: string, firstLine: string, filename?: string, language: "vibe" | "ts" = "vibe") =>
      blocks.push({ number: ++number, line: line + 1, language, source, firstLine, filename, expected: [], fragment: false })
    add("export function f(x: number): number { return x + 1 }", "TypeScript hatch input", "hatch-input.ts", "ts")
    for (const [, expression] of examples) add(
      'import { f } from "./hatch-input.ts"; error E; function hatchExample() { const x = 1; return ' + expression + ' }',
      expression)
  }
  // A block that imports a pending block's module can't compile or run without
  // it, so it waits for the same VIPs.
  const stem = (file: string) => file.replace(/\.(?:vibe|ts)$/, "")
  const waiting = new Map(blocks.filter(b => b.pending && b.filename).map(b => [stem(b.filename!), b.pending!]))
  for (let changed = waiting.size > 0; changed;) {
    changed = false
    for (const block of blocks.filter(b => !b.pending)) {
      const from = posix.dirname(block.filename ?? "block")
      const vips = [...block.source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*)["']\.\/([\w./-]+)\.(?:js|vibe|ts)["']/g)]
        .flatMap(m => waiting.get(posix.join(from, m[1])) ?? [])
      if (!vips.length) continue
      Object.assign(block, { pending: [...new Set(vips)], fragment: true })
      if (block.filename) waiting.set(stem(block.filename), block.pending!)
      changed = true
    }
  }
  return blocks
}

// Repeated captions describe independent examples, so keep their numbered files.
// Unique captions are real source files, including TypeScript companion modules.
export function blockFilenames(blocks: Block[]): Map<number, string> {
  const counts = new Map<string, number>()
  for (const block of blocks) if (block.filename) counts.set(block.filename, (counts.get(block.filename) ?? 0) + 1)
  const used = new Set([...counts].filter(([, count]) => count === 1).map(([name]) => name))
  return new Map(blocks.map(block => {
    if (block.filename && counts.get(block.filename) === 1) return [block.number, block.filename]
    let filename = `block-${block.number}.${block.language}`
    for (let suffix = 2; used.has(filename); suffix++) filename = `block-${block.number}-${suffix}.${block.language}`
    used.add(filename)
    return [block.number, filename]
  }))
}

function localImport(from: string, to: string): string {
  const path = relative(dirname(from), to).replaceAll("\\", "/")
  return path.startsWith(".") ? path : "./" + path
}

function missing(d: Diagnostic) {
  return d.code === "TS2304" || d.code === "TS2552" ||
    (d.code === "TS2307" && /module ['"]\.{1,2}\//.test(d.message))
}

export function classify(block: Block, diagnostics: Diagnostic[]): Result {
  const codes = new Set(diagnostics.map(d => d.code))
  const absent = block.expected.filter(c => !codes.has(c))
  const unexpected = diagnostics.filter(d => !block.expected.includes(d.code))
  if (block.pending) return { ...block, diagnostics, status: "pending", reason: `Waits for ${block.pending.join(", ")}` }
  if (block.fragment) return { ...block, diagnostics, status: "fragment", reason: "Explicit fragment" }
  if (block.gap) {
    if (!absent.length && !unexpected.some(d => !missing(d))) return { ...block, diagnostics, status: "fail", reason: "Stale compiler-gap marker; remove it" }
    return { ...block, diagnostics, status: "compiler-gap", reason: absent.length ? `${block.gap}; missing ${absent.join(", ")}` : block.gap }
  }
  if (absent.length) return { ...block, diagnostics, status: "fail", reason: `Expected ${absent.join(", ")} was not reported` }
  return { ...block, diagnostics, status: unexpected.length === 0 ? "ok" : !block.comparison && unexpected.every(missing) ? "fragment" : "fail" }
}

export function parseDiagnostics(output: string): { file?: string; diagnostic: Diagnostic }[] {
  const result: { file?: string; diagnostic: Diagnostic }[] = []
  for (const line of output.split(/\r?\n/)) {
    const m = /^(.*)\((\d+),(\d+)\): error ((?:TS|EK)\d+): (.*)$/.exec(line)
    if (m) result.push({ file: m[1], diagnostic: { code: m[4], message: m[5], line: +m[2], column: +m[3] } })
    else {
      const global = /^error ((?:TS|EK)\d+): (.*)$/.exec(line)
      if (global) result.push({ diagnostic: { code: global[1], message: global[2] } })
    }
  }
  return result
}

// The Markdown pages under root, except root/site: markdown.ts builds the
// site there, with a Markdown copy of every page and specification chapter.
export function markdownPages(root: string): string[] {
  const walk = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? (join(path, e.name) === join(root, "site") ? [] : walk(join(path, e.name))) : e.name.endsWith(".md") ? [join(path, e.name)] : [])
  const pages = walk(root)
  if (root === join(repo, "docs/user")) pages.push(join(repo, "templates/app/AGENTS.md"))
  return [...new Set(pages)].sort()
}

// The compiler that VIBELANG_BINARY names, else the local build, else vibelang on PATH.
export function defaultCompiler(): string {
  const local = join(repo, "typescript/built/local/tsc")
  return process.env.VIBELANG_BINARY || (existsSync(local) ? local : "vibelang")
}

// The experiments package pins this parser. It only discovers declarations;
// all language checking belongs to the native VibeLang compiler.
let parser: typeof import("../../experiments/node_modules/typescript") | undefined
const typescript = () => parser ??= createRequire(join(repo, "experiments/package.json"))("typescript") as NonNullable<typeof parser>

// The vibelang-runtime that page projects import. VIBELANG_RUNTIME_DIR checks
// against another one, such as a release tarball's package.
export function runtimeDir(): string {
  return process.env.VIBELANG_RUNTIME_DIR || join(repo, "packages/runtime")
}

// Links the packages that every page project imports into temp/node_modules.
export function linkModules(temp: string) {
  const modules = join(temp, "node_modules")
  mkdirSync(modules, { recursive: true })
  // Resolve as Node does from the selected runtime, including an installed
  // package whose Effect is hoisted into the parent node_modules.
  const runtime = realpathSync(runtimeDir())
  let effect: string
  try {
    effect = dirname(realpathSync(createRequire(join(runtime, "package.json")).resolve("effect/package.json")))
  } catch (cause) {
    throw new Error(`Cannot resolve effect/package.json from runtime ${runtime}; install its dependencies before checking snippets`, { cause })
  }
  const targetEffect = join(modules, "effect")
  if (existsSync(targetEffect)) {
    const existing = realpathSync(targetEffect)
    if (existing !== effect) throw new Error(`Conflicting Effect copies: project ${existing}; runtime ${effect}`)
  } else symlinkSync(effect, targetEffect)
  const dependencies = [join(repo, "experiments/node_modules"), join(repo, "docs/tools/node_modules")]
  for (const source of dependencies) {
    if (!existsSync(source)) continue
    for (const name of readdirSync(source).filter(n => !n.startsWith("."))) {
      if (name === "vibelang-runtime" || name === "vibelang-vite") continue
      const target = join(modules, name)
      if (!existsSync(target)) symlinkSync(join(source, name), target)
    }
  }
  if (!existsSync(join(modules, "vibelang"))) symlinkSync(join(repo, "packages/compiler"), join(modules, "vibelang"))
  symlinkSync(runtime, join(modules, "vibelang-runtime"))
  symlinkSync(join(repo, "packages/vite"), join(modules, "vibelang-vite"))
  if (!existsSync(join(modules, "effect/package.json")) || !existsSync(join(runtime, "dist/index.d.ts"))) {
    throw new Error("Install experiments dependencies and build packages/runtime before checking snippets (see docs/tools/README.md)")
  }
  // Verify both imports after linking, before any compiler or runner starts.
  const projectRequire = createRequire(join(temp, "package.json"))
  const projectEffect = dirname(realpathSync(projectRequire.resolve("effect/package.json")))
  const runtimeEffect = dirname(realpathSync(createRequire(join(realpathSync(join(modules, "vibelang-runtime")), "package.json")).resolve("effect/package.json")))
  if (projectEffect !== runtimeEffect) throw new Error(`Conflicting Effect copies: project ${projectEffect}; runtime ${runtimeEffect}`)
  return { runtime, effect }
}

// Writes one page's blocks to dir, inside a directory that linkModules
// prepared, as a project: one module per block, whose prefix imports the
// names that earlier blocks declare, and a tsconfig.json that lists them.
// offsets holds the number of prefix lines in each module.
export function writeProject(dir: string, blocks: Block[], options: { exportFunctions?: boolean; omitFragments?: boolean } = {}): { filenames: Map<number, string>; offsets: Map<string, number> } {
  const ts = typescript()
  mkdirSync(dir)
  writeFileSync(join(dir, "package.json"), '{"type":"module","name":"docs-snippets"}')
  const filenames = blockFilenames(blocks)
  const scope = new Map<string, { from: string; value: boolean }>()
  const offsets = new Map<string, number>()
  for (const block of blocks) {
    const filename = filenames.get(block.number)!
    mkdirSync(dirname(join(dir, filename)), { recursive: true })
    if (filename.endsWith(".ts")) {
      offsets.set(filename, 0)
      writeFileSync(join(dir, filename), block.source + "\nexport {}\n")
      continue
    }
    const ast = ts.createSourceFile(filename, block.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const exportStarts: number[] = []
    const explicitExports = new Set(ast.statements.flatMap(statement =>
      ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)
        ? statement.exportClause.elements.map(element => (element.propertyName ?? element.name).text) : []))
    const names = new Set<string>()
    const exported = new Set<string>()
    const typeOnly = new Set<string>()
    const localValues = new Set<string>()
    const bindings = (node: any) => {
      // Recovery from VibeLang forms, such as a block param, can yield a nameless declaration.
      if (ts.isIdentifier(node)) { if (node.text) names.add(node.text) }
      else if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) {
        for (const e of node.elements) if (ts.isBindingElement(e)) bindings(e.name)
      }
    }
    for (const statement of ast.statements) {
      // TypeScript's parser cannot read VibeLang's statement forms, such as
      // `fork { ... }` and `select { ... }`, and its recovery can lift
      // statements out of a function. Top-level code starts in column 0.
      if (ast.getLineAndCharacterOfPosition(statement.getStart(ast)).character !== 0) continue
      // The 0.0.1 compiler does not forward a pure function's direct variant
      // through an export list. For execution fixtures, export synthetic
      // function bindings on their declaration instead. Keep original export
      // lists unchanged so real code bugs still surface. Hover/check projects
      // preserve every source column by leaving this option off.
      if (options.exportFunctions && ts.isFunctionDeclaration(statement) && statement.name &&
          !explicitExports.has(statement.name.text) && !ts.getModifiers(statement)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        exportStarts.push(statement.getStart(ast))
        exported.add(statement.name.text)
      }
      const before = new Set(names)
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause
        if (clause?.name) bindings(clause.name)
        const named = clause?.namedBindings
        if (named && ts.isNamespaceImport(named)) bindings(named.name)
        else if (named) for (const element of named.elements) bindings(element.name)
      } else if (ts.isVariableStatement(statement)) {
        // Recovery from a block param, `const x = f(a) { ... }`, reads the
        // block as another declaration; real ones follow a comma.
        const declarations = statement.declarationList.declarations
        for (const [i, d] of declarations.entries()) {
          if (i > 0 && !block.source.slice(declarations[i - 1].end, d.getStart(ast)).includes(",")) continue
          bindings(d.name)
          if (ts.isIdentifier(d.name)) localValues.add(d.name.text)
        }
      } else if ("name" in statement && statement.name && ts.isIdentifier(statement.name)) bindings(statement.name)
      if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) typeOnly.add(statement.name.text)
      else for (const name of names) if (!before.has(name)) localValues.add(name)
      if (ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) && !ts.getModifiers(statement)?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) {
        for (const name of names) if (!before.has(name)) exported.add(name)
      }
    }
    // TypeScript's parser reads VibeLang's declaration forms, such as
    // `error NotFound { id: string }`, as expression statements, so their
    // names come from the source text. Each declares a value. `service`
    // and `control` may be followed by `class`, the older spelling (D223);
    // an error may be abstract, and `schema error` declares one (D278, D279).
    // `data` declares a type and its constructors under one name (D307).
    for (const m of block.source.matchAll(/^(export\s+)?(?:abstract\s+)?(?:schema\s+error|error|(?:service|control)(?:\s+class)?|layer|schema|data)\s+([A-Za-z_$][\w$]*)/gm)) {
      names.add(m[2])
      localValues.add(m[2])
      if (m[1]) exported.add(m[2])
    }
    for (const name of localValues) typeOnly.delete(name)
    const imports = new Map<string, string[]>()
    const values: string[] = []
    for (const [name, previous] of scope) {
      if (names.has(name) && !(typeOnly.has(name) && previous.value)) continue
      const list = imports.get(previous.from) ?? []
      if (typeOnly.has(name)) {
        list.push(`${name} as $doc_${name}`)
        values.push(`const ${name} = $doc_${name}`)
      } else list.push(name)
      imports.set(previous.from, list)
    }
    const prefix = [...[...imports].map(([from, ids]) => `import { ${ids.join(", ")} } from "${localImport(filename, from)}"`), ...values].join("\n") + "\n"
    offsets.set(filename, prefix.split("\n").length - 1)
    let source = block.source
    for (const start of exportStarts.reverse()) source = source.slice(0, start) + "export " + source.slice(start)
    writeFileSync(join(dir, filename), `${prefix}${source}\nexport { ${[...names].filter(n => !exported.has(n)).join(", ")} }\n`)
    // An example that deliberately fails or opts out cannot supply reliable
    // definitions to later examples. Other blocks share their latest names.
    if (!block.fragment && !block.gap && !block.expected.length) for (const name of names) scope.set(name, { from: filename, value: !typeOnly.has(name) || values.some(v => v.startsWith(`const ${name} =`)) })
  }
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    strict: true, target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext",
    skipLibCheck: true, noEmit: true, types: [...new Set(blocks.flatMap(block => block.types ?? []))], rewriteRelativeImportExtensions: true
  }, files: blocks.filter(block => !(options.omitFragments && block.fragment)).map(block => filenames.get(block.number)!) }))
  return { filenames, offsets }
}

// Keep compile and execution output separate so a failure identifies its stage.
export async function command(args: string[], cwd: string, timeout: number) {
  const child = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL") }, timeout)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited
    ])
    return { stdout, stderr, exitCode, timedOut }
  } finally { clearTimeout(timer) }
}

export const normalizeOutput = (text: string) => text.replaceAll("\r\n", "\n").replace(/\n$/, "")

// Test registrations need Vitest's context, including when a later excerpt
// imports an assertion helper from an earlier test block. Inspect only emitted
// dependencies, so unrelated tests on the page do not change the runner.
function importsVitest(dir: string): boolean {
  return readdirSync(dir, { withFileTypes: true }).some(file => {
    const path = join(dir, file.name)
    return file.isDirectory() ? importsVitest(path) :
      file.name.endsWith(".js") && new Bun.Transpiler({ loader: "js" })
        .scanImports(readFileSync(path, "utf8")).some(imported => imported.path === "@effect/vitest")
  })
}

async function runVitest(dir: string, emitted: string, helper: string | undefined, timeout: number) {
  const entry = "dist/$docs-entry.test.js"
  writeFileSync(join(dir, entry), helper
    ? `import { ${helper} } from ${JSON.stringify("./" + emitted)};\n` +
      `import { it } from "@effect/vitest";\nimport { Console, Effect } from "effect";\n` +
      `it.live("docs run header", () => Effect.provideService(Effect.suspend(() => { const value = ${helper}(); return Effect.isEffect(value) ? value : Effect.succeed(value); }), Console.Console, globalThis.console));\n`
    : `import ${JSON.stringify("./" + emitted)};\n`)
  // Keep stdout exclusively for the example. Report failures to stderr so an
  // empty output assertion still requires every registered test to pass.
  writeFileSync(join(dir, "$docs-reporter.mjs"), `export default class {
    onTestCaseResult(test) {
      for (const error of test.result().errors ?? []) console.error(error.stack ?? error.message);
    }
    onTestRunEnd(modules, errors) {
      for (const error of [...errors, ...modules.flatMap(module => module.errors())]) console.error(error.stack ?? error.message);
    }
  }\n`)
  writeFileSync(join(dir, "$docs-vitest.config.mjs"), `export default ${JSON.stringify({ test: {
    include: [entry], reporters: [join(dir, "$docs-reporter.mjs")],
    disableConsoleIntercept: true, fileParallelism: false, maxWorkers: 1,
    testTimeout: timeout, hookTimeout: timeout
  } })}\n`)
  const require = createRequire(join(repo, "docs/tools/package.json"))
  const vitest = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs")
  return command(["node", vitest, "run", "--config", "$docs-vitest.config.mjs"], dir, timeout)
}

export async function runBlock(dir: string, blocks: Block[], result: Result, compiler: string, timeout: number): Promise<Result> {
  if (result.status !== "ok" || result.expected.length || result.diagnostics.length) {
    return { ...result, status: "fail", reason: `Output assertion cannot run a ${result.status} block or a block with expected diagnostics` }
  }
  // Emit only this entry and its imports. Other examples on the page can
  // intentionally fail, have missing fixtures, or reuse an entry-point name.
  const { filenames } = writeProject(dir, blocks, { exportFunctions: true })
  const filename = filenames.get(result.number)!
  let helper = `$docsRun${result.number}`
  while (result.source.includes(helper)) helper += "$"
  if (result.run) {
    const file = join(dir, filename)
    writeFileSync(file, readFileSync(file, "utf8") + `\nexport function ${helper}() { ${result.run} }\n`)
  }
  const config = JSON.parse(readFileSync(join(dir, "tsconfig.json"), "utf8"))
  // The 0.0.1 release suppresses emit on warnings with noEmitOnError, yet
  // exits 0. Permit warning-only output; compiler errors still stop execution
  // below. Each run writes only to its own dist directory.
  Object.assign(config.compilerOptions, { noEmit: false, noEmitOnError: false, outDir: "dist", rootDir: "." })
  config.files = [filename]
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(config))
  const compiled = await command([compiler, "--pretty", "false", "-p", join(dir, "tsconfig.json")], dir, 60000)
  writeFileSync(join(dir, "compiler.log"), compiled.stdout + compiled.stderr)
  if (compiled.exitCode !== 0 || compiled.timedOut) return {
    ...result, status: "fail", reason: "Output assertion failed to compile its entry or dependencies",
    execution: { ...compiled, phase: "compile", status: "failed", expectedStdout: result.output! }
  }
  const emitted = filename.replace(/\.(?:vibe|ts)$/, ".js")
  let entry = join(dir, "dist", emitted)
  if (result.run) {
    // Importing suppresses the example's native main entry. TypeScript
    // helpers can return values or Promises; VibeLang helpers return Effects.
    entry = join(dir, "dist", "$docs-entry.js")
    writeFileSync(entry, `import { ${helper} } from ${JSON.stringify("./" + emitted)};\n` +
      `import { Effect } from "effect";\nconst result = ${helper}();\nif (Effect.isEffect(result)) await Effect.runPromise(result);\nelse await result;\n`)
  }
  const executed = importsVitest(join(dir, "dist"))
    ? await runVitest(dir, emitted, result.run ? helper : undefined, timeout)
    : await command(["node", entry], dir, timeout)
  const reason = executed.timedOut ? `Execution timed out after ${timeout}ms` :
    executed.exitCode !== 0 ? `Node exited with status ${executed.exitCode}` :
    normalizeOutput(executed.stdout) !== normalizeOutput(result.output!) ? "stdout mismatch" : undefined
  return { ...result, status: reason ? "fail" : "ok", reason,
    execution: { ...executed, phase: "run", status: reason ? "failed" : "passed", expectedStdout: result.output! } }
}

async function main() {
  const args = process.argv.slice(2)
  function option(name: string, fallback?: string) {
    const i = args.indexOf(name)
    if (i < 0) return fallback
    if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`${name} requires a value`)
    const value = args[i + 1]
    args.splice(i, 2)
    return value
  }
  if (args.includes("--help")) {
    console.log("bun docs/tools/check-snippets.ts [--compiler path] [--root docs/user] [--filter text] [--json path] [--pending-list path] [--keep] [--run] [--timeout milliseconds]")
    return
  }
  const selectedCompiler = option("--compiler", defaultCompiler())!
  const compiler = selectedCompiler.includes("/") ? resolve(selectedCompiler) : selectedCompiler
  const root = resolve(option("--root", join(repo, "docs/user"))!)
  const filter = option("--filter", "")!
  const json = option("--json")
  const pendingList = option("--pending-list")
  const keep = args.includes("--keep")
  const run = args.includes("--run")
  const timeout = Number(option("--timeout", "10000"))
  if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new Error("--timeout must be a positive integer in milliseconds")
  if (args.some(a => a !== "--keep" && a !== "--run")) throw new Error(`Unknown argument: ${args.join(" ")}`)
  const temp = mkdtempSync(join(tmpdir(), "vibelang-docs-"))
  const pages: { page: string; blocks: Result[] }[] = []
  try {
    const { runtime, effect } = linkModules(temp)
    console.log(`Compiler: ${Bun.which(compiler) ?? compiler}\nRuntime: ${runtime}\nEffect: ${effect}`)
    let index = 0
    for (const page of markdownPages(root).filter(p => relative(root, p).includes(filter))) {
      const blocks = extract(readFileSync(page, "utf8"), { hatchExamples: [join(repo, "docs/user/llms-essentials.md"), join(repo, "templates/app/AGENTS.md")].includes(page) })
      if (!blocks.length) continue
      const dir = join(temp, String(++index))
      // An explicit fragment opts out of the check, so it stays out of the
      // program: TypeScript reports no semantic error in a program with a
      // syntax error, and a fragments would hide every other blocks.
      const { filenames, offsets } = writeProject(dir, blocks, { omitFragments: true })
      const compiled = blocks.some(block => !block.fragment)
      const child = compiled ? Bun.spawn([compiler, "--noEmit", "--pretty", "false", "-p", join(dir, "tsconfig.json")], { cwd: dir, stdout: "pipe", stderr: "pipe" }) : undefined
      const [stdout, stderr, code] = child ? await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]) : ["", "", 0]
      const output = `${stdout}\n${stderr}`
      if (keep) writeFileSync(join(dir, "compiler.log"), output)
      const parsed = parseDiagnostics(output)
      const infrastructure = parsed.filter(d => !d.file || !offsets.has(relative(dir, resolve(dir, d.file)).replaceAll("\\", "/")))
      if (infrastructure.length || (code !== 0 && !parsed.length)) throw new Error(`Compiler failed for ${relative(repo, page)} (exit ${code}):\n${output}`)
      const results = blocks.map(block => {
        const filename = filenames.get(block.number)!
        const diagnostics = parsed.filter(d => d.file && relative(dir, resolve(dir, d.file)).replaceAll("\\", "/") === filename).map(({ diagnostic }) => ({
          ...diagnostic, line: block.line + diagnostic.line! - offsets.get(filename)! - 1
        }))
        return classify(block, diagnostics)
      })
      // Automatic fragments have been identified by the page check. Do not
      // import their missing fixtures into otherwise independent run examples.
      const runnableBlocks = results.filter(block => block.status === "ok" && !block.expected.length)
      if (run) for (let i = 0; i < results.length; i++) {
        if (results[i].output !== undefined && results[i].status !== "pending") results[i] = await runBlock(join(dir, `run-${results[i].number}`), runnableBlocks, results[i], compiler, timeout)
      }
      pages.push({ page: relative(repo, page), blocks: results })
      console.log(`\n${relative(repo, page)}\n| Block | Line | Status | Diagnostics | Execution |\n| --- | --- | --- | --- | --- |`)
      for (const result of results) {
        console.log(`| ${result.number} | ${result.line} | ${result.status} | ${[...new Set(result.diagnostics.map(d => d.code))].join(", ") || "-"} | ${result.execution?.status ?? (run && result.output !== undefined ? "blocked" : "-")} |`)
        if (result.status === "fail") {
          if (result.reason) console.log(`  ${result.reason}`)
          if (result.execution) {
            console.log(`  Expected stdout: ${JSON.stringify(result.output)}`)
            console.log(`  Actual stdout: ${JSON.stringify(result.execution.stdout.slice(0, 4000))}`)
            if (result.execution.stderr) console.log(`  stderr: ${result.execution.stderr.slice(0, 4000)}`)
          }
          for (const d of result.diagnostics) console.log(`  ${d.line}:${d.column} ${d.code}: ${d.message}`)
        }
      }
    }
    const totals = { pages: pages.length, blocks: 0, ok: 0, fragment: 0, pending: 0, "compiler-gap": 0, fail: 0 }
    for (const page of pages) for (const block of page.blocks) { totals.blocks++; totals[block.status]++ }
    const execution = { marked: 0, passed: 0, failed: 0 }
    if (run) for (const page of pages) for (const block of page.blocks) if (block.output !== undefined && block.status !== "pending") {
      execution.marked++
      execution[block.execution?.status === "passed" ? "passed" : "failed"]++
    }
    console.log(`\nTotals: ${JSON.stringify(totals)}`)
    if (run) console.log(`Execution: ${JSON.stringify(execution)}`)
    if (pendingList) writeFileSync(resolve(pendingList), pages.flatMap(({ page, blocks }) => blocks.filter(block => block.status === "pending")
      .map(block => `${page}:${block.line}\t${block.pending!.join(", ")}\t${block.firstLine.trim()}`)).join("\n") + "\n")
    if (json) writeFileSync(resolve(json), JSON.stringify({ compiler, totals, ...(run ? { execution } : {}), pages }, null, 2) + "\n")
    if (totals.fail) process.exitCode = 1
  } finally {
    if (keep) console.log(`Temporary projects: ${temp}`)
    else rmSync(temp, { recursive: true, force: true })
  }
}

if (import.meta.main) main().catch(error => { console.error(error.message); process.exitCode = 2 })
