// D272: tests remain the oracle. A source graph a test bundles without
// native tool wiring stays TypeScript instead of rewriting that test.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, posix, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { nativeBundleProof } from "./native-bundle-proof.mjs"
import { loadTypeScript } from "./declarations.mjs"
import { parseImports, resolveAlias, resolveFile } from "./imports.mjs"
import { ownedPaths } from "./wire.mjs"
import { packageScripts, testOnlyScripts } from "./test-files.mjs"

const script = /\.(?:[cm]?[jt]sx?|vibex?)$/
const skip = name => name.startsWith(".") || ["node_modules", "dist", "build", "coverage"].includes(name)
const apis = new Map([
  ["rolldown", new Set(["rolldown", "watch", "default"])],
  ["esbuild", new Set(["build", "buildSync", "context"])],
  ["vite", new Set(["build"])],
  ["node:child_process", new Set(["spawn", "spawnSync", "execFile", "execFileSync"])],
  ["child_process", new Set(["spawn", "spawnSync", "execFile", "execFileSync"])]
])

function repository(root) {
  const own = ownedPaths(root), files = [], manifests = new Map()
  const walk = dir => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const file = posix.join(dir, entry.name).replace(/^\.\//, "")
      if (entry.isDirectory()) {
        if (!skip(entry.name) && own(file + "/_probe.ts")) walk(file)
      } else if (own(file)) {
        if (entry.name === "package.json") manifests.set(dir, JSON.parse(readFileSync(join(root, file), "utf8")))
        if (script.test(file) && !/\.d\.(?:vibe\.)?[cm]?ts$/.test(file)) files.push(file)
      }
    }
  }
  walk(".")
  const owner = file => [...manifests.keys()].sort((a,b) => b.length-a.length)
    .find(dir => dir === "." || file.startsWith(dir + "/")) ?? "."
  return { files, manifests, owner }
}

function entriesOf(text, file, ts, native) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.getScriptKindFromFileName(file))
  const options = { noLib: true, noResolve: true, allowJs: true }
  const host = { ...ts.createCompilerHost(options), getSourceFile: name => name === file ? source : undefined }
  const checker = ts.createProgram({ rootNames: [file], options, host }).getTypeChecker()
  const sym = node => ts.isIdentifier(node) && ts.isShorthandPropertyAssignment(node.parent)
    ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node)
  const functions = new Map(), namespaces = new Map()
  const bound = (node, map) => sym(node)?.declarations?.map(d => map.get(d)).find(Boolean)
  const unwrap = node => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node) || ts.isYieldExpression(node) ||
        ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node))) node = node.expression
    return node
  }
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteralLike(node.moduleSpecifier) || node.importClause?.isTypeOnly) continue
    const name = node.moduleSpecifier.text, methods = apis.get(name), clause = node.importClause
    if (!methods || !clause) continue
    if (clause.name) { namespaces.set(clause, name); if (name === "rolldown") functions.set(clause, name) }
    const bindings = clause.namedBindings
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.set(bindings, name)
    if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
      if (!item.isTypeOnly && methods.has((item.propertyName ?? item.name).text)) functions.set(item, name)
    }
  }
  const modulesOf = (node, seen = new Set()) => {
    node = unwrap(node)
    if (!node || seen.has(node)) return null
    seen.add(node)
    if (ts.isCallExpression(node)) {
      if ((node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require") &&
          node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && apis.has(node.arguments[0].text)) return node.arguments[0].text
      if (ts.isIdentifier(node.expression)) for (const d of sym(node.expression)?.declarations ?? []) {
        const fn = ts.isVariableDeclaration(d) ? unwrap(d.initializer) : d
        if (fn && ts.isFunctionLike(fn)) {
          const result = modulesOf(fn.body, seen)
          if (result) return result
        }
      }
    }
    let found = null
    ts.forEachChild(node, child => { found ||= modulesOf(child, seen) })
    return found
  }
  const bind = node => {
    if (ts.isVariableDeclaration(node) && unwrap(node.initializer) && !ts.isFunctionLike(unwrap(node.initializer))) {
      const name = modulesOf(node.initializer)
      if (name) {
        if (ts.isIdentifier(node.name)) namespaces.set(node, name)
        else if (ts.isObjectBindingPattern(node.name)) for (const item of node.name.elements) {
          if (ts.isIdentifier(item.name) && apis.get(name).has((item.propertyName ?? item.name).text)) functions.set(item, name)
        }
      }
    }
    ts.forEachChild(node, bind)
  }
  bind(source)
  const values = (node, seen = new Set()) => {
    node = unwrap(node)
    if (!node || seen.has(node)) return []
    seen.add(node)
    if (ts.isStringLiteralLike(node)) return [{ value: node.text, url: false }]
    if (ts.isIdentifier(node)) {
      return (sym(node)?.declarations ?? []).flatMap(d => ts.isVariableDeclaration(d) ? values(d.initializer, seen) : [])
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL" &&
        node.arguments?.[0] && ts.isStringLiteralLike(node.arguments[0]) && node.arguments[1]?.getText(source).replace(/\s+/g,"") === "import.meta.url") {
      return [{ value: node.arguments[0].text, url: true }]
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(e => values(e, new Set(seen)))
    if (ts.isObjectLiteralExpression(node)) return node.properties.flatMap(p => ts.isPropertyAssignment(p) ? values(p.initializer, new Set(seen)) : [])
    if (ts.isCallExpression(node)) return node.arguments.flatMap(arg => values(arg, new Set(seen)))
    if (ts.isPropertyAccessExpression(node)) return values(node.expression, seen)
    return []
  }
  const objectOf = (node, seen = new Set()) => {
    node = unwrap(node)
    if (!node || seen.has(node)) return null
    seen.add(node)
    if (node && ts.isIdentifier(node)) {
      const d = sym(node)?.declarations?.find(ts.isVariableDeclaration)
      return d && objectOf(d.initializer, seen)
    }
    return node && ts.isObjectLiteralExpression(node) ? node : null
  }
  const bundles = []
  const visit = node => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression)
      let name = ts.isIdentifier(callee) && bound(callee, functions)
      if (ts.isPropertyAccessExpression(callee)) {
        const owner = ts.isIdentifier(callee.expression) && bound(callee.expression, namespaces) || modulesOf(callee.expression)
        if (owner && apis.get(owner).has(callee.name.text)) name = owner
        if (ts.isIdentifier(callee.expression) && callee.expression.text === "Bun" && !sym(callee.expression)?.declarations?.length && callee.name.text === "build") name = "Bun.build"
      }
      if (name) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
        if (name.includes("child_process")) {
          const command = unwrap(node.arguments[0]), argv = unwrap(node.arguments[1])
          if (command && ts.isStringLiteralLike(command) && /(?:^|\/)bun(?:\.exe)?$/.test(command.text) &&
              argv && ts.isArrayLiteralExpression(argv) && argv.elements.length && ts.isStringLiteralLike(argv.elements[0]) && argv.elements[0].text === "build") {
            bundles.push({ line, bundler: "bun build", values: argv.elements.slice(1).flatMap(e => values(e)) })
          }
        } else {
          const object = objectOf(node.arguments[0])
          const inputs = []
          let plugins
          const scan = obj => {
            for (const property of obj?.properties ?? []) {
              const key = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) ? property.name.text : null
              if (key === "plugins") plugins = ts.isPropertyAssignment(property) ? property.initializer : property.name
              if (["input", "entryPoints", "entrypoints"].includes(key)) {
                inputs.push(...values(ts.isPropertyAssignment(property) ? property.initializer : property.name))
              } else if (ts.isPropertyAssignment(property) && ts.isObjectLiteralExpression(property.initializer)) scan(property.initializer)
            }
          }
          scan(object)
          if (!plugins || !native?.(plugins, checker, file, name)) bundles.push({ line, bundler: name, values: inputs })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return bundles
}

/** For selected source modules, the unchanged test bundle entries and their transitive runtime graphs. */
export function testBundleDeferrals(root, selected, { paths = {}, ts, onWarning = () => {} } = {}) {
  if (!selected.length) return []
  const { files, manifests, owner } = repository(root), known = new Set(files)
  const protectedFiles = new Set()
  for (const [dir, manifest] of manifests) for (const file of testOnlyScripts(root, dir, packageScripts(root, dir), manifest)) {
    if (known.has(file)) protectedFiles.add(file)
  }
  const texts = new Map()
  const text = file => {
    if (!texts.has(file)) texts.set(file, readFileSync(join(root, file), "utf8"))
    return texts.get(file)
  }
  const tests = [...protectedFiles].filter(file => /["'](?:rolldown|esbuild|vite|(?:node:)?child_process)["']|\bBun\.build\b/.test(text(file)))
  if (!tests.length) return []
  ts ??= loadTypeScript([root, fileURLToPath(new URL("../../../../packages/runtime", import.meta.url)), fileURLToPath(new URL("../../../../docs/tools", import.meta.url))])
  // Scope and rename checks can run without the setup's persisted paths.
  paths = { ...paths }
  for (const dir of manifests.keys()) {
    if (paths[dir]) continue
    const config = resolve(root, dir, "tsconfig.json")
    if (!existsSync(config)) continue
    const parsed = ts.getParsedCommandLineOfConfigFile(config, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} })
    const options = parsed?.options
    if (!options?.paths) continue
    const base = options.baseUrl ?? options.pathsBasePath ?? posix.dirname(config)
    paths[dir] = Object.fromEntries(Object.entries(options.paths).map(([key, targets]) =>
      [key, targets.map(target => relative(root, resolve(base, target)).replaceAll(String.fromCharCode(92), "/"))]))
  }
  const byName = new Map([...manifests].filter(([,p]) => p.name).map(([dir,p]) => [p.name,dir]))
  const runtimeTargets = value => typeof value === "string" ? [value]
    : Array.isArray(value) ? value.flatMap(runtimeTargets)
    : value && typeof value === "object" ? Object.entries(value).filter(([key]) => key !== "types").flatMap(([,v]) => runtimeTargets(v)) : []
  const runtimeFile = target => {
    target = posix.normalize(target)
    // An actual emitted .js entry is a supported boundary under D272.
    if (/\.[cm]?jsx?$/.test(target) && known.has(target)) return target
    return resolveFile(target, known) ?? [".js",".mjs",".cjs","/index.js"].map(ext => target+ext).find(f => known.has(f))
  }
  const bare = (from, specifier) => {
    const name = specifier.startsWith("@") ? specifier.split("/").slice(0,2).join("/") : specifier.split("/")[0]
    const dir = specifier.startsWith("#") ? owner(from) : byName.get(name)
    if (dir === undefined) return []
    const pkg = manifests.get(dir), key = specifier.startsWith("#") ? specifier : "." + specifier.slice(name.length)
    const map = specifier.startsWith("#") ? pkg.imports : pkg.exports
    let targets = []
    if (map === undefined && key === ".") targets = [pkg.module,pkg.main,"./index.ts"].filter(Boolean)
    else if (typeof map === "string" || Array.isArray(map) || map && !Object.keys(map).some(k => k.startsWith(".") || k.startsWith("#"))) {
      if (key === ".") targets = runtimeTargets(map)
    } else if (map && key in map) targets = runtimeTargets(map[key])
    else if (map) for (const pattern of Object.keys(map).filter(k => k.includes("*")).sort((a,b) => b.indexOf("*")-a.indexOf("*") || b.length-a.length)) {
      const [head,tail] = pattern.split("*")
      if (!key.startsWith(head) || !key.endsWith(tail) || key.length < head.length+tail.length) continue
      targets = runtimeTargets(map[pattern]).map(t => t.replaceAll("*",key.slice(head.length,key.length-tail.length)))
      break
    }
    return targets.filter(t => t.startsWith(".")).map(t => runtimeFile(posix.join(dir,t))).filter(Boolean)
  }
  const dependency = (from, specifier) => specifier.startsWith(".")
    ? [runtimeFile(posix.join(posix.dirname(from),specifier))].filter(Boolean)
    : [resolveAlias(specifier,paths[owner(from)],known),...bare(from,specifier)].filter(Boolean)
  const native = nativeBundleProof(root, ts, dependency)
  const graph = new Map()
  const deps = file => {
    if (!graph.has(file)) graph.set(file, parseImports(text(file)).filter(i => !i.typeOnly).flatMap(i => dependency(file,i.specifier)))
    return graph.get(file)
  }
  const wanted = new Set(selected), found = new Map()
  for (const test of tests) for (const bundle of entriesOf(text(test), test, ts, native)) {
    const roots = new Set()
    for (const item of bundle.values) {
      let value = item.value
      if (value.startsWith("file:")) {
        try { value = relative(root,fileURLToPath(value)).split("\\").join("/") } catch { continue }
        const file = runtimeFile(value); if (file) roots.add(file)
      } else if (item.url) {
        const plain = value.replace(/[?#].*$/,"")
        let decoded = plain
        try { decoded = decodeURIComponent(plain) } catch {}
        for (const path of new Set([plain, decoded])) {
          const file = runtimeFile(posix.join(posix.dirname(test), path)); if (file) roots.add(file)
        }
      } else {
        for (const dir of [owner(test),".",posix.dirname(test)]) {
          const file = runtimeFile(posix.join(dir,value)); if (file) roots.add(file)
        }
        for (const file of bare(test,value)) roots.add(file)
        if (posix.isAbsolute(value)) { const file = runtimeFile(relative(root,value)); if (file) roots.add(file) }
      }
    }
    if (!roots.size && (!bundle.values.length || !bundle.values.every(item => /\.[cm]?jsx?$/.test(item.value)))) {
      onWarning(test + ":" + bundle.line + ": cannot resolve this unchanged " + bundle.bundler + " test bundle to owned source entries; review its source graph before selecting modules")
    }
    for (const entry of roots) {
      const seen = new Set(), todo = [entry]
      while (todo.length) {
        const file = todo.pop()
        if (seen.has(file)) continue
        seen.add(file); todo.push(...deps(file))
        if (!wanted.has(file)) continue
        const receipt = { test, line: bundle.line, bundler: bundle.bundler, entry }
        const list = found.get(file) ?? []
        if (!list.some(item => JSON.stringify(item) === JSON.stringify(receipt))) list.push(receipt)
        found.set(file,list)
      }
    }
  }
  return [...found].sort(([a],[b]) => a.localeCompare(b)).map(([file,bundledBy]) => ({
    file, bundledBy, reason: "test-owned bundle graph stays TypeScript (decided detail 272): " +
      bundledBy.map(r => r.test + ":" + r.line + " bundles " + r.entry + " with " + r.bundler).join("; ")
  }))
}

export function assertNoTestBundleRename(root, files, options) {
  const deferred = testBundleDeferrals(root, files, options)
  if (deferred.length) throw new Error("cannot rename modules reached by unchanged test bundles:\n" + deferred.map(d => d.file + ": " + d.reason).join("\n"))
}
