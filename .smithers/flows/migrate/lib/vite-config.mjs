// Vite loads its config before creating plugins. Native config loading lets
// Node and the existing source hook load native dependencies at that boundary.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, posix } from "node:path"
import { listSources, isTestFile } from "./inventory.mjs"
import { resolveRelative } from "./imports.mjs"

const preload = 'NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import=vibelang/register" '
const configNames = ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"]

// Type-only imports, import types and commented examples are not runtime edges.
function runtimeImports(text, file, ts) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const imports = []
  const namedTypes = clause => clause && ts.isNamedImports(clause) && clause.elements.length > 0 && clause.elements.every(e => e.isTypeOnly)
  const add = node => { if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) imports.push(node.text) }
  const visit = node => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause
      if (!clause?.isTypeOnly && !(clause && !clause.name && namedTypes(clause.namedBindings))) add(node.moduleSpecifier)
    } else if (ts.isExportDeclaration(node)) {
      const types = node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every(e => e.isTypeOnly)
      if (!node.isTypeOnly && !types) add(node.moduleSpecifier)
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return imports
}

/** Runtime import reachability, including sources setup will migrate later. */
export function nativeConfigDependency({ root, file, packages, ts }) {
  const sources = new Set(listSources(root, "."))
  const planned = path => !isTestFile(path) && /\.(?:ts|mts|cts|tsx)$/.test(path) && packages.some(pkg =>
    (pkg.sources ?? ["src"]).some(dir => {
      const base = posix.join(pkg.dir, dir)
      return base === "." || path.startsWith(base + "/")
    }))
  const seen = new Set()
  const visit = path => {
    if (seen.has(path)) return false
    seen.add(path)
    if (path.endsWith(".vibe") || planned(path)) return true
    if (!existsSync(join(root, path))) return false
    const text = readFileSync(join(root, path), "utf8")
    // Resolve package exports and tsconfig paths with the project's own options.
    const config = ts.findConfigFile(posix.dirname(join(root, path)), ts.sys.fileExists)
    const json = config && ts.readConfigFile(config, ts.sys.readFile).config
    const options = json ? ts.parseJsonConfigFileContent(json, ts.sys, posix.dirname(config)).options : { moduleResolution: ts.ModuleResolutionKind.Bundler }
    return runtimeImports(text, path, ts).some(specifier => {
      let target = resolveRelative(path, specifier, sources)
      if (!target) {
        const resolved = ts.resolveModuleName(specifier, join(root, path), options, ts.sys).resolvedModule?.resolvedFileName
        if (resolved && !resolved.includes("/node_modules/")) target = posix.relative(root, resolved).replace(/\.d\.vibe\.ts$/, ".vibe")
      }
      return target !== undefined && !target.startsWith("../") && visit(target)
    })
  }
  return visit(file)
}

/** Wire actual Vite invocations, retaining shell chaining and inherited options. */
export function nativeViteScripts(scripts = {}, { root, dir, configs }) {
  const wired = new Set()
  const next = Object.fromEntries(Object.entries(scripts).map(([name, command]) => {
    let cwd = dir
    const text = command.split(/(&&|\|\||;)/).map(part => {
      const cd = /^\s*cd\s+([\w./-]+)\s*$/.exec(part)
      if (cd) { cwd = posix.normalize(posix.join(cwd, cd[1])); return part }
      // The assignment belongs before the package-manager launcher.
      const call = /^(\s*\(?\s*(?:[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)*)(?:(?:pnpm|npm)\s+exec\s+|npx\s+|bunx\s+|bun\s+x\s+)?vite(?=\s|[)]|$)/.exec(part)
      if (!call) return part
      const args = part.slice(call.index + call[0].length)
      const named = /(?:^|\s)(?:--config|-c)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s)]+))/.exec(args)
      const file = named ? posix.normalize(posix.join(cwd, named[1] ?? named[2] ?? named[3])) :
        configNames.map(f => posix.join(cwd, f)).find(f => existsSync(join(root, f)))
      if (!configs.includes(file)) return part
      wired.add(file)
      const at = call.index + call[1].length
      let after = part.slice(at)
      if (/--configLoader(?:=|\s+)\S+/.test(after)) after = after.replace(/--configLoader(?:=|\s+)\S+/, "--configLoader native")
      else after = after.replace(/\bvite\b/, "vite --configLoader native")
      const before = part.slice(0, at)
      if (/--import(?:=|\s+)vibelang\/register(?=["'\s]|$)/.test(before)) return before + after
      const assigned = /\bNODE_OPTIONS=(?:"([^"]*)"|'([^']*)'|([^\s]+))(?=\s|$)/.exec(before)
      if (assigned) {
        const value = (assigned[1] ?? assigned[2] ?? assigned[3]) + " --import=vibelang/register"
        const q = assigned[2] === undefined ? '"' : "'"
        return before.slice(0, assigned.index) + "NODE_OPTIONS=" + q + value + q + before.slice(assigned.index + assigned[0].length) + after
      }
      return before + preload + after
    }).join("")
    return [name, text]
  }))
  return { scripts: next, wired: [...wired] }
}

export function wireNativeViteConfigs({ root, packages, configs, manifests, ts, specsFor }) {
  const needed = configs.filter(file => nativeConfigDependency({ root, file, packages, ts }))
  const changed = [], warnings = [], wired = new Set()
  for (const { dir } of manifests) {
    const file = posix.join(dir, "package.json")
    const before = readFileSync(join(root, file), "utf8")
    const pkg = JSON.parse(before)
    const result = nativeViteScripts(pkg.scripts, { root, dir, configs: needed })
    result.wired.forEach(file => wired.add(file))
    if (JSON.stringify(result.scripts) === JSON.stringify(pkg.scripts ?? {})) continue
    pkg.scripts = result.scripts
    if (!pkg.dependencies?.vibelang) pkg.devDependencies = { ...pkg.devDependencies, vibelang: specsFor(dir).vibelang }
    writeFileSync(join(root, file), JSON.stringify(pkg, null, 2) + "\n")
    changed.push(file)
  }
  for (const file of needed) if (!wired.has(file)) warnings.push(`${file}: config imports migrated sources before plugins exist; run Vite with ${preload.trim()} and --configLoader native (Node ESM resolution applies)`)
  return { changed, warnings, configs: needed }
}
