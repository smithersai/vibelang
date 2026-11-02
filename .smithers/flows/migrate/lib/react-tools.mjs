// Setup's wiring for the tools that read a module's source themselves: Metro,
// Babel, and the React Compiler's Oxc transform (oxc-transform-react). Each
// reads a .vibe module's source, which none can parse; the wiring hands each
// the module's JavaScript through the vibelang package's adapters:
// vibelang/metro in metro.config, vibelang/babel in the Babel config, and a
// patch of oxc-transform-react that calls vibelang/emit's toolArguments.
// plugin-react, which receives the JavaScript from vibelang-vite, gets .vibe
// modules in its filter. The
// patch is a pnpm or Bun `patchedDependencies` entry the repository keeps, as
// it keeps its other patches, since a test calls oxc-transform-react directly
// on the text it reads (t3code's reactCompilerCoverage.test.ts).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, posix } from "node:path"
import { setYamlMap } from "./upgrade.mjs"
import { packageManager, packagesReaching, viteAppConfigs } from "./wire.mjs"

export const metroConfigs = ["metro.config.js", "metro.config.cjs", "metro.config.mjs", "metro.config.ts"]
export const babelConfigs = ["babel.config.js", "babel.config.cjs", "babel.config.mjs", "babel.config.json", ".babelrc", ".babelrc.json", ".babelrc.js", ".babelrc.cjs"]

const scriptKind = (ts, file) => /\.ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS
const quoteOf = (text) => /\brequire\('|from\s+'/.test(text) && !/\brequire\("|from\s+"/.test(text) ? "'" : '"'

/** text with the edits applied, the last first, so each position holds. */
function applyEdits(text, edits) {
  let out = text
  for (const edit of [...edits].sort((a, b) => b.at - a.at)) out = out.slice(0, edit.at) + edit.text + out.slice(edit.at)
  return out
}

/**
 * A Metro config's text with the config it exports wrapped in withVibeLang
 * from vibelang/metro: `module.exports = X` becomes
 * `module.exports = require("vibelang/metro").withVibeLang(X)`, and
 * `export default X` imports withVibeLang and exports `withVibeLang(X)`. X may
 * be a config, a promise of one, or a function, which withVibeLang accepts.
 * Returns the text unchanged when it already names vibelang/metro; throws when
 * it exports its config another way, so a person wires it.
 */
export function addMetroWrapper(text, ts, file = "metro.config.js") {
  if (text.includes("vibelang/metro")) return text
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(ts, file))
  const q = quoteOf(text)
  const isModuleExports = (node) => ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "module" && node.name.text === "exports"
  const assignment = source.statements
    .filter((s) => ts.isExpressionStatement(s) && ts.isBinaryExpression(s.expression) && s.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken && isModuleExports(s.expression.left))
    .at(-1)
  const wrap = (node, call) => [{ at: node.getStart(source), text: `${call}(` }, { at: node.end, text: ")" }]
  if (assignment) return applyEdits(text, wrap(assignment.expression.right, `require(${q}vibelang/metro${q}).withVibeLang`))
  const exported = source.statements.find((s) => ts.isExportAssignment(s) && !s.isExportEquals)
  if (!exported) throw new Error("the config sets neither module.exports nor export default; wrap the config it exports in withVibeLang from vibelang/metro by hand")
  const lastImport = source.statements.filter((s) => ts.isImportDeclaration(s)).at(-1)
  const semicolon = lastImport && text.slice(lastImport.getStart(source), lastImport.end).trimEnd().endsWith(";") ? ";" : ""
  const lineEnd = lastImport ? text.indexOf("\n", lastImport.end) : -1
  const at = lastImport ? (lineEnd < 0 ? text.length : lineEnd + 1) : 0
  return applyEdits(text, [
    { at, text: `${lastImport && lineEnd < 0 ? "\n" : ""}import { withVibeLang } from ${q}vibelang/metro${q}${semicolon}\n` },
    ...wrap(exported.expression, "withVibeLang")
  ])
}

/**
 * A Babel config's text with "vibelang/babel" last in its presets: in a JSON
 * config (.babelrc, babel.config.json), the `presets` array, made when there
 * is none; in a JavaScript one, each `presets: [...]` array literal. Returns
 * the text unchanged when it already names vibelang/babel; throws when a
 * JavaScript config has no presets array literal, so a person adds it.
 * Babel takes a preset as a name or a [name, options] pair; in a list whose
 * presets are all pairs, vibelang/babel is the pair ["vibelang/babel", {}],
 * so code that reads the list as pairs (t3code's compileLikeMetro test) still
 * can.
 */
export function addBabelPreset(text, ts, file = "babel.config.js") {
  if (text.includes("vibelang/babel")) return text
  if (/\.json$|^\.babelrc$/.test(posix.basename(file))) {
    const config = JSON.parse(text)
    const presets = config.presets ?? []
    config.presets = [...presets, presets.length && presets.every(Array.isArray) ? ["vibelang/babel", {}] : "vibelang/babel"]
    return JSON.stringify(config, null, /\n(\s+)"/.exec(text)?.[1] ?? 2) + (text.endsWith("\n") ? "\n" : "")
  }
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(ts, file))
  const q = quoteOf(text)
  const edits = []
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === "presets" && ts.isArrayLiteralExpression(node.initializer)) {
      const list = node.initializer
      const last = list.elements.at(-1)
      const preset = last && list.elements.every(ts.isArrayLiteralExpression) ? `[${q}vibelang/babel${q}, {}]` : `${q}vibelang/babel${q}`
      edits.push(last ? { at: last.end, text: `, ${preset}` } : { at: list.getStart(source) + 1, text: preset })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!edits.length) throw new Error("the config has no presets array literal; add \"vibelang/babel\" to its presets by hand")
  return applyEdits(text, edits)
}

/** The module filter plugin-react takes for .vibe modules beside its default, /\.[tj]sx?$/. */
export const reactInclude = "/\\.(?:[tj]sx?|vibe)$/"

/**
 * A Vite config's text with `include` for .vibe modules in each call of
 * @vitejs/plugin-react's default export that turns the React Compiler on
 * (`react({ compiler: ... })`): plugin-react filters modules by id with
 * /\.[tj]sx?$/, so without it the React Compiler never sees a .vibe module's
 * JavaScript, which vibelang-vite, enforced first, hands the plugins after
 * it. Returns the text unchanged when no call needs it; throws when a call
 * sets its own include, so a person adds .vibe to it.
 */
export function addReactCompilerInclude(text, ts, file = "vite.config.ts") {
  const imported = /import\s+([\w$]+)\s+from\s+['"]@vitejs\/plugin-react['"]/.exec(text)
  if (!imported) return text
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const named = (p, name) => p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name
  const edits = []
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === imported[1]) {
      const [options] = node.arguments
      if (options && ts.isObjectLiteralExpression(options) && options.properties.some((p) => named(p, "compiler"))) {
        const include = options.properties.find((p) => named(p, "include"))
        if (include) {
          if (!include.getText(source).includes("vibe")) throw new Error(`${imported[1]}() sets its own include; add .vibe modules to it by hand`)
        } else {
          edits.push({ at: options.properties.at(-1).end, text: `, include: ${reactInclude}` })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return applyEdits(text, edits)
}

// The packages whose transform(filename, text, options) a test may call on a
// module's source, as t3code's React Compiler coverage test calls
// oxc-transform-react's, with the napi-rs entry their index.js has.
export const patchedTransforms = ["oxc-transform-react"]

/**
 * The index.js of an oxc-transform-react release, napi-rs's ES module entry,
 * with transform and transformSync handing a .vibe module's source to
 * vibelang/emit's toolArguments, which replaces it with the module's
 * JavaScript; vibelang is resolved from the module's own directory. Other
 * files, and JavaScript a bundler plugin already compiled from a .vibe module,
 * reach the transform as before. Throws when index.js does not export
 * transform and transformSync as napi-rs writes them.
 */
export function patchTransformEntry(text) {
  const exports = ["export { transform }\n", "export { transformSync }\n"]
  if (!exports.every((line) => text.split(line).length === 2) || !text.includes("createRequire")) {
    throw new Error("its index.js does not export transform and transformSync as napi-rs writes them")
  }
  return text
    .replace(exports[0], `// VibeLang: a .vibe module reaches the transform as its JavaScript (vibelang/emit's toolArguments).
const vibelangArguments = (args) => typeof args[0] === 'string' && args[0].endsWith('.vibe')
  ? createRequire(require('path').resolve(args[0]))('vibelang/emit').toolArguments(...args)
  : args
const vibelangTransform = async (...args) => transform(...vibelangArguments(args))
const vibelangTransformSync = (...args) => transformSync(...vibelangArguments(args))
export { vibelangTransform as transform }
`)
    .replace(exports[1], "export { vibelangTransformSync as transformSync }\n")
}

/**
 * A unified diff of one file, as `git diff` writes it and pnpm and Bun apply
 * it: one hunk around the changed lines with three lines of context.
 */
export function unifiedDiff(path, before, after) {
  // Lines keep their newline, so a last line without one differs from the same text with one.
  const linesOf = (text) => text.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const a = linesOf(before), b = linesOf(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length, endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
  const from = Math.max(0, start - 3), after3 = Math.min(a.length - endA, 3)
  const line = (mark) => (text) => mark + (text.endsWith("\n") ? text : `${text}\n\\ No newline at end of file\n`)
  const range = (first, count) => `${count ? first + 1 : first},${count}`
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n` +
    `@@ -${range(from, endA + after3 - from)} +${range(from, endB + after3 - from)} @@\n` +
    [...a.slice(from, start).map(line(" ")), ...a.slice(start, endA).map(line("-")), ...b.slice(start, endB).map(line("+")),
      ...a.slice(endA, endA + after3).map(line(" "))].join("")
}

const patchName = (name, version) => `${name.replace("/", "__")}@${version}`

// The installed package `name` a package directory resolves: { dir, version }, or undefined.
function installed(root, dir, name) {
  try {
    const entry = createRequire(join(root, dir, "package.json")).resolve(name)
    let pkg = dirname(entry)
    while (!existsSync(join(pkg, "package.json")) && dirname(pkg) !== pkg) pkg = dirname(pkg)
    const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"))
    return manifest.name === name ? { dir: pkg, version: manifest.version } : undefined
  } catch {
    return undefined
  }
}

/**
 * Wires Metro, Babel, plugin-react and oxc-transform-react in each package
 * that reaches migrated sources (packagesReaching): its metro.config gets withVibeLang
 * (addMetroWrapper), its Babel config the vibelang/babel preset
 * (addBabelPreset), and its manifest the compiler, which both load. Each
 * Vite config that bundles migrated sources and turns plugin-react's React
 * Compiler on gets .vibe in its include (addReactCompilerInclude). Each
 * oxc-transform-react release a package resolves gets a patch in patches/
 * (patchTransformEntry) and its pnpm or Bun patchedDependencies entry.
 * Returns the files changed and a warning for each config or package it
 * leaves as it is.
 */
export function wireReactTools({ root, packages, ts, specsFor }) {
  const changed = []
  const warnings = []
  const write = (path, before, after) => {
    if (before === after) return
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), after)
    if (!changed.includes(path)) changed.push(path)
  }
  const reaching = packagesReaching(root, packages.map((pkg) => pkg.dir))
  const patches = new Map() // name@version to { name, version, dir }
  for (const pkg of reaching) {
    let wired = false
    const edit = (names, change) => {
      for (const name of names.filter((name) => existsSync(join(root, pkg.dir, name)))) {
        const path = posix.join(pkg.dir, name)
        const text = readFileSync(join(root, path), "utf8")
        try {
          write(path, text, change(text, ts, name))
          wired = true
        } catch (error) {
          warnings.push(`${path}: ${error.message}`)
        }
      }
    }
    edit(metroConfigs, addMetroWrapper)
    edit(babelConfigs, addBabelPreset)
    if (wired) {
      const manifest = posix.join(pkg.dir, "package.json")
      const before = readFileSync(join(root, manifest), "utf8")
      const next = JSON.parse(before)
      if (!next.dependencies?.vibelang && !next.devDependencies?.vibelang) {
        next.devDependencies = { ...next.devDependencies, vibelang: specsFor(pkg.dir).vibelang }
        write(manifest, before, JSON.stringify(next, null, 2) + "\n")
      }
    }
    for (const name of patchedTransforms) {
      const found = installed(root, pkg.dir, name)
      if (found) patches.set(`${name}@${found.version}`, { name, ...found })
    }
  }
  for (const path of viteAppConfigs(root, packages.map((pkg) => pkg.dir))) {
    const text = readFileSync(join(root, path), "utf8")
    try {
      write(path, text, addReactCompilerInclude(text, ts, path))
    } catch (error) {
      warnings.push(`${path}: ${error.message}`)
    }
  }
  if (!patches.size) return { changed, warnings }
  const manager = packageManager(readdirSync(root))
  if (manager !== "pnpm" && manager !== "bun") {
    for (const key of patches.keys()) warnings.push(`${key}: patch its transform with vibelang/emit's toolArguments by hand; setup writes patchedDependencies for pnpm and Bun only`)
    return { changed, warnings }
  }
  const rootManifest = join(root, "package.json")
  const workspace = join(root, "pnpm-workspace.yaml")
  for (const [key, { name, version, dir }] of patches) {
    const path = `patches/${patchName(name, version)}.patch`
    const existing = existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : undefined
    if (existing !== undefined && !existing.includes("vibelang/emit")) {
      warnings.push(`${path}: the repository already patches ${key}; add vibelang/emit's toolArguments to its transform by hand`)
      continue
    }
    // A rerun keeps the patch an earlier one wrote: the installed entry is patched by now.
    if (existing === undefined) {
      try {
        const entry = readFileSync(join(dir, "index.js"), "utf8")
        write(path, "", unifiedDiff("index.js", entry, patchTransformEntry(entry)))
      } catch (error) {
        warnings.push(`${key}: ${error.message}; patch its transform with vibelang/emit's toolArguments by hand`)
        continue
      }
    }
    if (manager === "pnpm" && existsSync(workspace) && !JSON.parse(readFileSync(rootManifest, "utf8")).pnpm?.patchedDependencies) {
      const text = readFileSync(workspace, "utf8")
      write("pnpm-workspace.yaml", text, setYamlMap(text, "patchedDependencies", { [key]: path }))
    } else {
      const before = readFileSync(rootManifest, "utf8")
      const next = JSON.parse(before)
      const holder = manager === "pnpm" ? (next.pnpm ??= {}) : next
      holder.patchedDependencies = { ...holder.patchedDependencies, [key]: path }
      write("package.json", before, JSON.stringify(next, null, 2) + "\n")
    }
  }
  return { changed, warnings }
}
