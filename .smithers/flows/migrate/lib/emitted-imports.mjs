// Package-private import conditions let an unchanged bundler consume the JS
// a package's ordinary compiler build already produces. Types keep the source.
import { readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { join, posix } from "node:path"
import { listSources, isTestFile } from "./inventory.mjs"
import { packageDirOf } from "./codemod.mjs"
import { parseImports, resolveRelative, applyEdits } from "./imports.mjs"
import { addCompilerOptions, projectsOf } from "./wire.mjs"

const inside = (dir, file) => dir === "." || file.startsWith(dir + "/")
const relativeTarget = (dir, file) => "./" + posix.relative(dir, file)
// Fixtures need protection even when a repository stores them outside test/.
// Keep this stricter role guard local to the emitted-output wiring.
const protectedFile = file => isTestFile(file) ||
  /(?:^|\/)(?:fixtures?|__fixtures__|__snapshots__|__mocks__)\//.test(file) ||
  /\.(?:test|spec)\.(?:cts|mts|tsx|vibex)$/.test(file)

// Read actual module edges from syntax trees: quoted examples, comments
// and regular expressions are never imports. Dynamic import options and
// whitespace do not change the edge.
function runtimeEdges(text, file, ts, compiler, root) {
  if (!/\bimport\b|\bexport\b[\s\S]*?\bfrom\b/.test(text)) return []
  const edges = []
  if (file.endsWith(".vibe")) {
    if (!compiler) throw new Error(file + ": the native compiler is required to read VibeLang imports")
    const parsed = spawnSync(compiler, ["--estree", join(root, file)], { input: text, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    if (parsed.status !== 0 || parsed.error) throw new Error(file + ": cannot read native imports: " + (parsed.error?.message ?? parsed.stderr))
    const { ast, error } = JSON.parse(parsed.stdout)
    if (error) throw new Error(file + ": " + error.message)
    const typeOnly = new Set(parseImports(text).filter(edge => edge.typeOnly).map(edge => edge.start + ":" + edge.end))
    const visit = node => {
      if (!node || typeof node !== "object") return
      const literal = ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration", "ImportExpression"].includes(node.type)
        ? node.source : node.type === "CallExpression" && node.callee?.type === "Import" ? node.arguments?.[0] : null
      if (literal?.range && typeof literal.value === "string" && node.importKind !== "type" && node.exportKind !== "type") {
        const start = literal.range[0] + 1, end = literal.range[1] - 1
        if (!typeOnly.has(start + ":" + end)) edges.push({ specifier: literal.value, start, end })
      }
      for (const child of Object.values(node)) if (Array.isArray(child)) child.forEach(visit); else if (child && typeof child === "object") visit(child)
    }
    visit(ast)
  } else {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const visit = node => {
      let literal
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause
        const bindings = clause?.namedBindings
        const onlyTypes = clause?.isTypeOnly || (!clause?.name && bindings && ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 && bindings.elements.every(element => element.isTypeOnly))
        if (!onlyTypes) literal = node.moduleSpecifier
      } else if (ts.isExportDeclaration(node)) {
        const bindings = node.exportClause
        const onlyTypes = node.isTypeOnly || (bindings && ts.isNamedExports(bindings) &&
          bindings.elements.length > 0 && bindings.elements.every(element => element.isTypeOnly))
        if (!onlyTypes) literal = node.moduleSpecifier
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) literal = node.arguments[0]
      if (literal && ts.isStringLiteral(literal)) edges.push({ specifier: literal.text, start: literal.getStart(source) + 1, end: literal.end - 1 })
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return edges
}

/**
 * Plan exact aliases for the selected packages' own source modules in named
 * emitting projects. No tests, fixtures, scripts or public exports are edited.
 * A project must already run in the package's ordinary build/prepare scripts.
 */
export function planEmittedImports({ root, packages, projects = [], ts, compiler }) {
  const edits = new Map(), modules = []
  const read = file => edits.get(file)?.after ?? readFileSync(join(root, file), "utf8")
  const write = (file, after) => {
    const before = edits.get(file)?.before ?? readFileSync(join(root, file), "utf8")
    if (before !== after) edits.set(file, { before, after })
  }
  if (!projects.length) return { edits, modules, changed: [] }
  const all = new Set(listSources(root, "."))
  for (const project of projects) {
    if (posix.isAbsolute(project) || posix.normalize(project).startsWith("../")) throw new Error("emitted project must be repository-relative: " + project)
    const dir = packageDirOf(root, project)
    if (!packages.some(p => p.dir === dir)) throw new Error(project + ": emitted project is not in a selected package")
    const manifest = posix.join(dir, "package.json")
    const pkg = JSON.parse(read(manifest))
    const filename = join(root, project)
    const config = ts.readConfigFile(filename, ts.sys.readFile)
    if (config.error) throw new Error(project + ": cannot read emitting project")
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, posix.dirname(filename), undefined, filename, undefined,
      [{ extension: ".vibe", isMixedContent: false, scriptKind: ts.ScriptKind.Deferred }])
    if (parsed.errors.length || parsed.options.noEmit || parsed.options.emitDeclarationOnly || !parsed.options.outDir || parsed.options.outFile)
      throw new Error(project + ": needs an error-free project that emits individual JavaScript files into outDir")
    const projectName = posix.relative(dir, project)
    // The project is explicit in a compiler command, in a script reachable
    // from build or prepare. Never add a build step or change a test command.
    const seen = new Set()
    const buildsProject = name => {
      if (seen.has(name)) return false
      seen.add(name)
      const script = pkg.scripts?.[name] ?? ""
      const words = script.match(/"[^"]*"|'[^']*'|[;&|()]|[^\s;&|()]+/g)?.map(word => word.replace(/^["']|["']$/g, "")) ?? []
      // Only recognize an actual compiler command, never a compiler name
      // printed by echo or passed to an unrelated tool. Conditional fallbacks
      // and shell substitutions cannot establish that the normal build emits.
      if (words.some(word => /^[|()]$/.test(word) || word.includes("$"))) return false
      for (let start = 0; start < words.length;) {
        let end = start
        while (end < words.length && !/^[;&]$/.test(words[end])) end++
        const command = words.slice(start, end)
        start = end + 1
        while (command[0] === "exec") command.shift()
        if (["pnpm", "npm", "bun"].includes(command[0]) && command[1] === "run") {
          if (command.length === 3 && buildsProject(command[2])) return true
          continue
        }
        if (["pnpm", "npm"].includes(command[0]) && command[1] === "exec") {
          command.splice(0, 2)
          if (command[0] === "--") command.shift()
        } else if (["npx", "bunx"].includes(command[0])) command.shift()
        if (!/^(?:tsc|vibelang)$/.test(command[0] ?? "")) continue
        // Layout overrides would make getOutputFileNames describe a different
        // output from the existing build, even though it names this project.
        if (command.some(word => /^--(?:noEmit|emitDeclarationOnly|outDir|rootDir|outFile|clean|dry)(?:=|$)/i.test(word))) continue
        const named = []
        let build = false
        for (let i = 1; i < command.length; i++) {
          if (["-p", "--project", "-b", "--build"].includes(command[i])) {
            build ||= command[i] === "-b" || command[i] === "--build"
            named.push(posix.normalize(command[++i] ?? ""))
          } else if (command[i].startsWith("--project=")) named.push(posix.normalize(command[i].slice(10)))
        }
        if (build ? named.includes(projectName) : named.at(-1) === projectName) return true
      }
      return false
    }
    if (!buildsProject("build") && !buildsProject("prepare")) throw new Error(project + ": the package's existing build or prepare must already compile this project")
    const selected = new Map()
    for (const file of parsed.fileNames) {
      const source = posix.relative(root, file)
      if (!/\.(?:ts|mts|cts|vibe)$/.test(source) || /\.d\.(?:ts|mts|cts)$/.test(source) || protectedFile(source) || packageDirOf(root, source) !== dir) continue
      if (!packages.some(p => inside(p.dir, source) && (p.sources ?? ["src"]).some(s => inside(posix.join(p.dir, s), source)))) continue
      // Stock TypeScript preserves unknown extensions; VibeLang's emitter
      // treats .vibe exactly as .ts for its JavaScript output name.
      const emitPath = path => path.replace(/\.vibe$/, ".ts")
      const emitted = ts.getOutputFileNames({ ...parsed, fileNames: parsed.fileNames.map(emitPath) }, emitPath(file), false).filter(f => /\.(?:js|mjs|cjs)$/.test(f))
      if (emitted.length !== 1) throw new Error(source + ": needs exactly one emitted JavaScript module")
      const output = posix.relative(root, emitted[0])
      if (output.startsWith("../") || !inside(dir, output) || all.has(output)) throw new Error(source + ": emitted JavaScript must be private output within its package")
      if (/[?#%*\\]/.test(source) || /[?#%*\\]/.test(output))
        throw new Error(source + ": cannot represent this filename with exact package import targets")
      selected.set(source, output)
    }
    const used = new Set()
    for (const file of all) {
      if (protectedFile(file) || packageDirOf(root, file) !== dir) continue
      const text = read(file)
      const changes = []
      for (const edge of runtimeEdges(text, file, ts, compiler, root)) {
        const source = resolveRelative(file, edge.specifier, all)
        if (!selected.has(source)) continue
        const key = "#vibelang/emitted/" + posix.relative(dir, source).replace(/\.(?:ts|mts|cts|vibe)$/, "")
        const target = { "vibelang-source": relativeTarget(dir, source), types: relativeTarget(dir, source).replace(/\.vibe$/, ".d.vibe.ts"), default: relativeTarget(dir, selected.get(source)) }
        const previous = pkg.imports?.[key]
        if (previous && JSON.stringify(previous) !== JSON.stringify(target)) throw new Error(manifest + ": conflicting emitted import " + key)
        pkg.imports = { ...pkg.imports, [key]: target }
        // JSON's escapes are valid in either quote style after also escaping
        // apostrophes. The cooked string must remain the exact manifest key.
        const escaped = JSON.stringify(key).slice(1, -1).replace(/'/g, "\\'")
        changes.push({ start: edge.start, end: edge.end, text: escaped })
        if (!used.has(source)) modules.push({ project, source, output: selected.get(source), key })
        used.add(source)
      }
      if (changes.length) write(file, applyEdits(text, changes))
    }
    if (used.size) {
      write(manifest, JSON.stringify(pkg, null, 2) + "\n")
      const owner = packages.find(p => p.dir === dir)
      const configs = [project, ...[owner?.tsconfig, owner?.dtsTsconfig].filter(Boolean).flatMap(f =>
        [f, ...projectsOf(ts, join(root, dir), f)].map(file => posix.join(dir, file)))]
      for (const configFile of new Set(configs)) {
        const configText = read(configFile)
        const json = ts.parseConfigFileTextToJson(configFile, configText)
        if (json.error) throw new Error(configFile + ": cannot configure the source import condition")
        const options = ts.parseJsonConfigFileContent(json.config, ts.sys, posix.dirname(join(root, configFile))).options
        const conditions = [...new Set([...(options.customConditions ?? []), "vibelang-source"])]
        write(configFile, addCompilerOptions(configText, { customConditions: conditions }))
      }
    }
  }
  return { edits, modules, changed: [...edits.keys()] }
}

export function applyEmittedImports(plan, { root, restore = false }) {
  for (const [file, edit] of plan.edits) writeFileSync(join(root, file), restore ? edit.before : edit.after)
}
