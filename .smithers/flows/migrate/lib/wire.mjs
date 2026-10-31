// The edits that set up VibeLang in an existing project, as text-in,
// text-out functions: the package's dependencies, tsc replaced by vibelang
// in scripts, the vibelang-vite plugin in the Vitest or Vite config, the
// vibelang-unplugin plugin in each Bun.build, the
// compiler option that lets .vibe files import local modules by their source
// names, and the settings that let every TypeScript checker read a .vibe
// module through its declaration sidecar. Each keeps the file's own
// formatting outside the lines it changes.
// wireVite applies the plugin edit to the config files the tests load. The
// Effect upgrade before setup is upgrade.mjs. initAgents sets the target's
// coding agents up with the vibelang it installed.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, posix } from "node:path"
import { workspaceGlobs, workspaceManifests } from "./upgrade.mjs"
import { must, quote } from "./util.mjs"

/**
 * The repository's own files: a predicate on repository-relative paths that
 * holds where the nearest package.json is the root's or a workspace
 * member's (the root package.json's `workspaces`, pnpm-workspace.yaml's
 * `packages`). A directory with a package.json no workspace names, such as a
 * vendored repository, holds someone else's project, and setup leaves it as
 * it is, as the Effect upgrade does.
 */
export function ownedPaths(root) {
  const read = (file) => (existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8") : "")
  const manifest = read("package.json")
  const globs = manifest ? workspaceGlobs(manifest, read("pnpm-workspace.yaml")) : []
  const owned = new Map([[".", true]])
  const ownerOwned = (dir) => {
    if (!owned.has(dir)) {
      owned.set(dir, existsSync(join(root, dir, "package.json"))
        ? workspaceManifests([posix.join(dir, "package.json")], globs).length > 0
        : ownerOwned(posix.dirname(dir)))
    }
    return owned.get(dir)
  }
  return (path) => ownerOwned(posix.dirname(path))
}

/** Replaces tsc with vibelang in package scripts: `tsc -b x` becomes `vibelang -b x`. */
export function replaceTsc(scripts = {}) {
  const next = {}
  for (const [name, command] of Object.entries(scripts)) next[name] = command.replace(/(^|[\s;&|(])tsc(?=\s|$)/g, "$1vibelang")
  return next
}

// Oxlint options that take a value, so a path after one is not a lint target.
const oxlintValueOptions = new Set(["-c", "--config", "--tsconfig", "-A", "--allow", "-W", "--warn", "-D", "--deny", "--ignore-path", "--ignore-pattern", "-f", "--format", "--max-warnings", "--threads", "--import-plugin"])

/**
 * Runs Effect's lint rules on .vibe files where a script runs them on .ts files
 * (VIP-38): after each oxlint command whose configuration enables effecttsgo/*
 * rules, adds `vibelang lint` with the same configuration, --deny-warnings and
 * paths. readConfig(path) returns a configuration file's text, or undefined.
 */
export function addEffectLint(scripts = {}, readConfig) {
  const next = {}
  for (const [name, command] of Object.entries(scripts)) {
    if (/\bvibelang lint\b/.test(command)) { next[name] = command; continue }
    next[name] = command.split(/(&&|\|\||;)/).map((part) => {
      const words = part.trim().split(/\s+/)
      if (words[0] !== "oxlint") return part
      let config = ".oxlintrc.json"
      let deny = false
      const paths = []
      for (let i = 1; i < words.length; i++) {
        const word = words[i]
        if (word === "-c" || word === "--config") config = words[++i]
        else if (word.startsWith("--config=")) config = word.slice("--config=".length)
        else if (word === "--deny-warnings") deny = true
        else if (oxlintValueOptions.has(word)) i++
        else if (!word.startsWith("-")) paths.push(word)
      }
      if (!readConfig(config)?.includes("effecttsgo/")) return part
      const lint = ["vibelang lint -c", config, ...(deny ? ["--deny-warnings"] : []), ...paths].join(" ")
      return part.replace(/\s*$/, (end) => ` && ${lint}${end}`)
    }).join("")
  }
  return next
}

/** Adds what a migrated package needs: the runtime as a dependency and the compiler as a dev dependency. The package that owns a Vite config also gets the plugin (addVibeLangPlugin). */
export function addVibeLang(pkg, specs) {
  const next = structuredClone(pkg)
  next.dependencies = { ...next.dependencies, "vibelang-runtime": specs["vibelang-runtime"] }
  next.devDependencies = { ...next.devDependencies, vibelang: specs.vibelang }
  return next
}

/** Adds the compiler and the Vite plugin, which needs it, as dev dependencies: what a package that owns a Vite config needs. */
export function addVibeLangPlugin(pkg, specs) {
  const next = structuredClone(pkg)
  next.devDependencies = { ...next.devDependencies, vibelang: specs.vibelang, "vibelang-vite": specs["vibelang-vite"] }
  return next
}

/**
 * Adds `vibelang()` from vibelang-vite to a Vite or Vitest config that calls
 * defineConfig with an object literal, or with a function that returns one
 * (`defineConfig(() => ({ ... }))`, or a body whose last top-level return
 * is one), first in that object's own plugins,
 * never in a nested option's (a `lint: { plugins: [...] }`). ts is
 * TypeScript's compiler API. Returns the text unchanged when the plugin is
 * already there; throws when the config has a shape this edit does not know,
 * so a person wires it instead.
 */
export function addVitePlugin(text, ts) {
  if (/from\s+['"]vibelang-vite['"]/.test(text)) return text
  const source = ts.createSourceFile("vite.config.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let config
  // The object a defineConfig argument gives: the literal, or what its function returns.
  const objectOf = (node) => {
    while (node && ts.isParenthesizedExpression(node)) node = node.expression
    if (!node) return undefined
    if (ts.isObjectLiteralExpression(node)) return node
    if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return undefined
    if (!ts.isBlock(node.body)) return objectOf(node.body)
    const returned = node.body.statements.filter((s) => ts.isReturnStatement(s)).at(-1)
    return returned && objectOf(returned.expression)
  }
  const find = (node) => {
    if (config) return
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "defineConfig" && objectOf(node.arguments[0])) config = objectOf(node.arguments[0])
    else ts.forEachChild(node, find)
  }
  find(source)
  if (!config) throw new Error("the config does not call defineConfig({ ... }) or defineConfig(() => ({ ... })); add vibelang() from vibelang-vite to its plugins by hand")
  return applyPluginEdits(text, [importEdit(text, source, ts, "vibelang-vite"), pluginEdit(text, source, config, ts, "the config's plugins is not an array literal; add vibelang() to it by hand")])
}

/** The edit that puts vibelang() first in config's own plugins, or gives it plugins; throws `refusal` when they are not an array literal. */
function pluginEdit(text, source, config, ts, refusal) {
  const plugins = config.properties.find((p) => p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === "plugins")
  if (plugins) {
    if (!ts.isPropertyAssignment(plugins) || !ts.isArrayLiteralExpression(plugins.initializer)) throw new Error(refusal)
    const list = plugins.initializer
    return list.elements.length ? { at: list.elements[0].getStart(source), text: "vibelang(), " } : { at: list.getStart(source) + 1, text: "vibelang()" }
  }
  const at = config.getStart(source) + 1
  const indent = /\n([ \t]+)\S/.exec(text.slice(at))?.[1]
  return indent ? { at, text: `\n${indent}plugins: [vibelang()],` } : { at, text: " plugins: [vibelang()]," }
}

/** The edit that imports vibelang from module on the line after the last import, in the file's quote and semicolon style. */
function importEdit(text, source, ts, module) {
  const lastImport = source.statements.filter((s) => ts.isImportDeclaration(s)).at(-1)
  const quote = /from\s+'/.test(text) ? "'" : '"'
  const semicolon = lastImport && text.slice(lastImport.getStart(source), lastImport.end).trimEnd().endsWith(";") ? ";" : ""
  const lineEnd = lastImport ? text.indexOf("\n", lastImport.end) : -1
  const at = lastImport ? (lineEnd < 0 ? text.length : lineEnd + 1) : 0
  return { at, text: `${lastImport && lineEnd < 0 ? "\n" : ""}import vibelang from ${quote}${module}${quote}${semicolon}\n` }
}

/** text with the edits applied, the last first, so each position holds. */
function applyPluginEdits(text, edits) {
  let out = text
  for (const edit of [...edits].sort((a, b) => b.at - a.at)) out = out.slice(0, edit.at) + edit.text + out.slice(edit.at)
  return out
}

/**
 * Adds `vibelang()` from vibelang-unplugin/bun first in the plugins of each
 * `Bun.build({ ... })` in a script: `vibelang/bun` registers a runtime plugin,
 * which a bundle does not use. ts is TypeScript's compiler API. Returns the
 * text unchanged when the plugin is already there or nothing calls Bun.build;
 * throws when a call has a shape this edit does not know, so a person wires it.
 */
export function addBunBuildPlugin(text, ts) {
  if (/from\s+['"]vibelang-unplugin\/bun['"]/.test(text)) return text
  const source = ts.createSourceFile("build.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const refusal = "Bun.build does not take an object literal with an array of plugins; add vibelang() from vibelang-unplugin/bun to it by hand"
  const edits = []
  const find = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Bun" && node.expression.name.text === "build") {
      const options = node.arguments[0]
      if (!options || !ts.isObjectLiteralExpression(options)) throw new Error(refusal)
      edits.push(pluginEdit(text, source, options, ts, refusal))
    }
    ts.forEachChild(node, find)
  }
  find(source)
  return edits.length ? applyPluginEdits(text, [importEdit(text, source, ts, "vibelang-unplugin/bun"), ...edits]) : text
}

const viteConfigNames = ["vitest.config.ts", "vitest.config.mts", "vitest.config.js", "vitest.config.mjs", "vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"]

const astroConfigNames = ["astro.config.mjs", "astro.config.ts", "astro.config.mts", "astro.config.js"]

/**
 * The config file a test command names with --config or -c, as written, or
 * null. A package-manager command that runs a script (`pnpm test`, `npm run
 * test:unit`, `bun run test`) is read through that script of scripts.
 */
export function testConfigArgument(command, scripts = {}) {
  const script = /^\s*(?:(?:pnpm|npm|yarn)(?:\s+run)?|bun\s+run)\s+([\w:.-]+)\s*$/.exec(command)
  const text = script && scripts[script[1]] ? scripts[script[1]] : command
  const m = /(?:^|\s)(?:--config|-c)(?:=|\s+)(?:'([^']+)'|"([^"]+)"|([^\s'"]+))/.exec(text)
  return m ? (m[1] ?? m[2] ?? m[3]) : null
}

/**
 * Adds the vibelang-vite plugin to the Vite or Vitest config the tests load:
 * the one the test command names with --config, such as a monorepo's shared
 * root config, else each package's own. root is the repository; packages are
 * { dir } with repository-relative dirs; test is { command, cwd }; ts is
 * TypeScript's compiler API; specsFor(dir) gives a package's VibeLang
 * specifiers. The package that owns the config, the nearest one above it,
 * gets the compiler and the plugin as dev dependencies, so the config's
 * import resolves. Returns the repository-relative files changed and the
 * warnings for packages whose tests load no config.
 */
export function wireVite({ root, packages, test, ts, specsFor }) {
  const changed = []
  const warnings = []
  const wire = (file) => wireViteConfig({ root, file, ts, specsFor, changed })
  const testCwd = join(root, test.cwd)
  const scripts = existsSync(join(testCwd, "package.json")) ? JSON.parse(readFileSync(join(testCwd, "package.json"), "utf8")).scripts : undefined
  const named = testConfigArgument(test.command, scripts)
  if (named) {
    const file = posix.normalize(posix.isAbsolute(named) ? posix.relative(root, named) : posix.join(test.cwd, named))
    if (file.startsWith("../") || !existsSync(join(root, file))) throw new Error(`the test command's config ${named} (from ${test.cwd}) is not a file of the target`)
    wire(file)
    return { changed, warnings, configs: [file] }
  }
  const configs = []
  for (const pkg of packages) {
    const name = viteConfigNames.find((f) => existsSync(join(root, pkg.dir, f)))
    // A package without its own config may name a shared one in its test script: --config ../../vite.config.ts.
    const manifest = join(root, pkg.dir, "package.json")
    const shared = name ? null : testConfigArgument("pnpm test", existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")).scripts : undefined)
    const file = posix.normalize(posix.join(pkg.dir, name ?? shared ?? ""))
    if ((!name && !shared) || !existsSync(join(root, file))) {
      warnings.push(`${pkg.dir}: no Vite or Vitest config, so the tests load no .vibe module unless their runner is set up for VibeLang`)
      continue
    }
    if (configs.includes(file)) continue
    configs.push(file)
    wire(file)
  }
  return { changed, warnings, configs }
}

// Adds the plugin to one config, and the compiler and the plugin to the
// package that owns it, the nearest one above it; records the files changed.
function wireViteConfig({ root, file, ts, specsFor, changed }) {
  const write = (path, before, after) => {
    if (before === after) return
    writeFileSync(join(root, path), after)
    if (!changed.includes(path)) changed.push(path)
  }
  const text = readFileSync(join(root, file), "utf8")
  write(file, text, addVitePlugin(text, ts))
  let owner = posix.dirname(file)
  while (owner !== "." && !existsSync(join(root, owner, "package.json"))) owner = posix.dirname(owner)
  const manifest = posix.join(owner, "package.json")
  const before = readFileSync(join(root, manifest), "utf8")
  write(manifest, before, JSON.stringify(addVibeLangPlugin(JSON.parse(before), specsFor(owner)), null, 2) + "\n")
}

// Directories a repository walk skips: dependencies, hidden directories, and
// the fixtures and templates a package ships rather than builds, whatever the
// fixture's name (fixtures, __fixtures__, vite-do-fixture).
const skippedDirectory = (name) => name === "node_modules" || name.startsWith(".") || /fixture/i.test(name) || name === "templates"

// A package's tests: a config under them is a test's input, and setup never edits a test.
const testDirectory = (name) => name === "test" || name === "tests" || name === "__tests__"

/** The repository's workspace packages: { dir, manifest } for each package.json outside skipped directories. */
export function repositoryPackages(root) {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = dir ? posix.join(dir, entry.name) : entry.name
      if (entry.isDirectory()) {
        if (!skippedDirectory(entry.name)) walk(path)
      } else if (entry.name === "package.json") {
        try {
          found.push({ dir: dir || ".", manifest: JSON.parse(readFileSync(join(root, path), "utf8")) })
        } catch {
          // Not a manifest this walk can read.
        }
      }
    }
  }
  walk("")
  return found
}

// A config a build can load: vite.config.ts, or a named one such as vite.node.config.ts.
const viteConfigFile = /^vite(?:st)?(?:\.[\w-]+)?\.config\.m?[jt]s$/

// A dependency on a workspace package by its source: workspace:, file:, link: or *.
const localSpec = /^(?:workspace:|file:|link:|\*$)/

/**
 * The repository's packages that load migrated sources: each migrated package
 * and each that depends on one through workspace packages
 * (`"foldkit": "workspace:*"`). migrated holds the migrated packages' directories.
 */
export function packagesReaching(root, migrated) {
  const all = repositoryPackages(root)
  const byName = new Map(all.filter((pkg) => pkg.manifest.name).map((pkg) => [pkg.manifest.name, pkg]))
  const local = (pkg) => Object.entries({ ...pkg.manifest.dependencies, ...pkg.manifest.devDependencies, ...pkg.manifest.peerDependencies })
    .filter(([name, spec]) => typeof spec === "string" && localSpec.test(spec) && byName.has(name)).map(([name]) => byName.get(name))
  const reaches = new Map()
  const reachesMigrated = (pkg) => {
    if (reaches.has(pkg.dir)) return reaches.get(pkg.dir)
    reaches.set(pkg.dir, migrated.includes(pkg.dir))
    const result = migrated.includes(pkg.dir) || local(pkg).some(reachesMigrated)
    reaches.set(pkg.dir, result)
    return result
  }
  return all.filter(reachesMigrated)
}

/**
 * The Vite and Vitest configs that bundle migrated sources, as
 * repository-relative paths: each config in a package that reaches them
 * (packagesReaching), outside fixtures, templates and tests.
 */
export function viteAppConfigs(root, migrated) {
  const reaching = packagesReaching(root, migrated)
  const all = repositoryPackages(root)
  const configs = []
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = dir ? posix.join(dir, entry.name) : entry.name
      if (entry.isDirectory()) {
        if (!skippedDirectory(entry.name) && !testDirectory(entry.name)) walk(path)
      } else if (viteConfigFile.test(entry.name)) configs.push(path)
    }
  }
  walk("")
  const ownerOf = (file) => {
    let owner = posix.dirname(file)
    while (owner !== "." && !all.some((pkg) => pkg.dir === owner)) owner = posix.dirname(owner)
    return all.find((pkg) => pkg.dir === owner)
  }
  return configs.filter((file) => {
    const owner = ownerOf(file)
    return owner !== undefined && reaching.some((pkg) => pkg.dir === owner.dir)
  })
}

/**
 * Adds the vibelang-vite plugin to every Vite and Vitest config that bundles
 * migrated sources (viteAppConfigs): an app's, an example's or a website's
 * build and dev server, not only the tests'. wired holds the configs already
 * wired. A config whose shape addVitePlugin does not know is left as it is,
 * with a warning. Returns the files changed, the warnings and the configs.
 */
export function wireViteApps({ root, packages, ts, specsFor, wired = [] }) {
  const changed = []
  const warnings = []
  const configs = []
  for (const file of viteAppConfigs(root, packages.map((pkg) => pkg.dir))) {
    if (wired.includes(file)) continue
    const astro = astroConfigNames.find((name) => existsSync(join(root, posix.dirname(file), name)))
    if (astro) {
      warnings.push(`${file}: Astro builds this app from ${astro}, and the plugin breaks \`astro check\` here; add vibelang() to its vite.plugins by hand`)
      continue
    }
    try {
      wireViteConfig({ root, file, ts, specsFor, changed })
      configs.push(file)
    } catch (error) {
      warnings.push(`${file}: ${error.message}`)
    }
  }
  return { changed, warnings, configs }
}

/**
 * Adds compiler options to a tsconfig's text (JSON with comments): into its
 * compilerOptions when it has them, else as a new compilerOptions object.
 * Options already set are left as they are.
 */
export function addCompilerOptions(text, options) {
  const entries = Object.entries(options).filter(([k]) => !new RegExp(`"${k}"\\s*:`).test(text))
  if (!entries.length) return text
  const body = (indent) => entries.map(([k, v]) => `${indent}"${k}": ${JSON.stringify(v)}`).join(",\n")
  const existing = /"compilerOptions"\s*:\s*\{/.exec(text)
  if (existing) {
    const after = existing.index + existing[0].length
    const rest = text.slice(after)
    const indent = /\n([ \t]+)\S/.exec(rest)?.[1] ?? "    "
    const empty = /^\s*\}/.test(rest)
    return text.slice(0, after) + `\n${body(indent)}${empty ? "\n" : ","}` + rest
  }
  const open = text.indexOf("{")
  if (open < 0) throw new Error("not a tsconfig object")
  const rest = text.slice(open + 1)
  const indent = /\n([ \t]+)\S/.exec(rest)?.[1] ?? "  "
  const empty = /^\s*\}/.test(rest)
  return text.slice(0, open + 1) + `\n${indent}"compilerOptions": {\n${body(indent + indent)}\n${indent}}${empty ? "\n" : ","}` + rest
}

/**
 * Sets key to value in a tsconfig's VibeLang settings (JSON with comments):
 * its top-level `vibelang` object, or `compilerOptions.vibelang` where the
 * file keeps them there, or a new top-level object. ts is TypeScript's
 * compiler API. A setting already there is left as it is.
 */
export function addVibeLangSetting(text, ts, key, value) {
  const file = ts.parseJsonText("tsconfig.json", text)
  const root = file.statements[0]?.expression
  if (!root || !ts.isObjectLiteralExpression(root)) throw new Error("not a tsconfig object")
  const property = (object, name) => object.properties.find((p) => ts.isPropertyAssignment(p) && p.name && (ts.isStringLiteral(p.name) || ts.isIdentifier(p.name)) && p.name.text === name)
  const options = property(root, "compilerOptions")
  const settings = property(root, "vibelang") ?? (options && ts.isObjectLiteralExpression(options.initializer) ? property(options.initializer, "vibelang") : undefined)
  const entry = `"${key}": ${JSON.stringify(value)}`
  if (settings) {
    const object = settings.initializer
    if (!ts.isObjectLiteralExpression(object)) throw new Error("the tsconfig's vibelang setting is not an object")
    if (property(object, key)) return text
    const at = object.getStart(file) + 1
    return text.slice(0, at) + (object.properties.length ? ` ${entry},` : ` ${entry} `) + text.slice(at)
  }
  const indent = /\n([ \t]+)\S/.exec(text.slice(root.getStart(file) + 1))?.[1] ?? "  "
  const last = root.properties.at(-1)
  if (!last) {
    const at = root.getStart(file) + 1
    return text.slice(0, at) + `\n${indent}"vibelang": { ${entry} }\n` + text.slice(at)
  }
  return text.slice(0, last.end) + `,\n${indent}"vibelang": { ${entry} }` + text.slice(last.end)
}

/**
 * Adds to a tsconfig's include (JSON with comments) the .vibe pattern of each
 * pattern that names .ts or .tsx files, src/**\/*.vibe beside src/**\/*.ts: a
 * composite project must list every file it compiles (TS6307), and a migrated
 * module is a .vibe file. Patterns such as src/**\/* and src already match
 * .vibe files. ts is TypeScript's compiler API.
 */
export function addVibeIncludes(text, ts) {
  const file = ts.parseJsonText("tsconfig.json", text)
  const root = file.statements[0]?.expression
  if (!root || !ts.isObjectLiteralExpression(root)) throw new Error("not a tsconfig object")
  const include = root.properties.find((p) => ts.isPropertyAssignment(p) && p.name && (ts.isStringLiteral(p.name) || ts.isIdentifier(p.name)) && p.name.text === "include")
  if (!include || !ts.isArrayLiteralExpression(include.initializer) || !include.initializer.elements.length) return text
  const elements = include.initializer.elements
  const patterns = elements.filter((e) => ts.isStringLiteral(e)).map((e) => e.text)
  const added = [...new Set(patterns.filter((p) => /\.tsx?$/.test(p) && !/\.d\.tsx?$/.test(p)).map((p) => p.replace(/\.tsx?$/, ".vibe")))].filter((p) => !patterns.includes(p))
  if (!added.length) return text
  const last = elements.at(-1)
  const start = last.getStart(file)
  const multiline = text.slice(include.initializer.getStart(file), start).includes("\n")
  const indent = /^[ \t]*/.exec(text.slice(text.lastIndexOf("\n", start) + 1))[0]
  return text.slice(0, last.getEnd()) + added.map((p) => (multiline ? `,\n${indent}` : ", ") + JSON.stringify(p)).join("") + text.slice(last.getEnd())
}

/**
 * The repository's tsconfig files (tsconfig*.json, outside node_modules,
 * hidden directories and trees it does not own) that extend none of the
 * others, as repository-relative
 * paths: a compiler option set in each is set in every project. ts is
 * TypeScript's compiler API.
 */
export function rootTsconfigs(root, ts) {
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
      const path = dir ? posix.join(dir, entry.name) : entry.name
      if (entry.isDirectory()) walk(path)
      else if (/^tsconfig.*\.json$/.test(entry.name)) files.push(path)
    }
  }
  walk("")
  const own = ownedPaths(root)
  files.splice(0, files.length, ...files.filter(own))
  const all = new Set(files)
  const local = (file, extended) => {
    const path = posix.normalize(posix.join(posix.dirname(file), extended))
    return all.has(path) || all.has(`${path}.json`)
  }
  return files.filter((file) => {
    const { config } = ts.parseConfigFileTextToJson(file, readFileSync(join(root, file), "utf8"))
    return ![config?.extends ?? []].flat().some((extended) => typeof extended === "string" && extended.startsWith(".") && local(file, extended))
  })
}

/** The ignore line that keeps formatters reading .prettierignore (Prettier, Oxfmt, Vite+) off vibelang's declaration sidecars. */
export const sidecarIgnore = "*.d.vibe.ts"

/**
 * Whether a test command runs `bun test`, itself or through the package
 * script it runs (`bun run test`, `pnpm test`).
 */
export function runsBunTest(command, scripts = {}) {
  const script = /^\s*(?:(?:pnpm|npm|yarn)(?:\s+run)?|bun\s+run)\s+([\w:.-]+)\s*$/.exec(command)
  const text = script && scripts[script[1]] ? scripts[script[1]] : command
  return /(?:^|[\s;&|(])bun\s+test\b/.test(text)
}

/**
 * A bunfig.toml's text with vibelang/bun in its `[test]` section's preload,
 * the one `bun test` applies; Bun reads a top-level preload only for `bun
 * run`. Other lines are kept.
 */
export function addBunTestPreload(text) {
  const lines = text.split("\n")
  const header = lines.findIndex((line) => /^\s*\[test\]\s*(#.*)?$/.test(line))
  if (header < 0) return `${text}${text && !text.endsWith("\n") ? "\n" : ""}${text ? "\n" : ""}[test]\npreload = ["vibelang/bun"]\n`
  const end = lines.findIndex((line, i) => i > header && /^\s*\[/.test(line))
  return preloadIn(text, lines, header + 1, end < 0 ? lines.length : end)
}

/**
 * A bunfig.toml's text with vibelang/bun in its top-level preload, the one
 * `bun <file>` applies; `bun test` reads only [test]'s. Other lines are kept.
 */
export function addBunPreload(text) {
  const lines = text.split("\n")
  const end = lines.findIndex((line) => /^\s*\[/.test(line))
  return preloadIn(text, lines, 0, end < 0 ? lines.length : end)
}

/** text, split into lines, with vibelang/bun first in the preload between lines start and end, or a new preload at start. */
function preloadIn(text, lines, start, end) {
  const entry = '"vibelang/bun"'
  const at = lines.findIndex((line, i) => i >= start && i < end && /^\s*preload\s*=/.test(line))
  if (at < 0) {
    lines.splice(start, 0, `preload = [${entry}]`)
    return lines.join("\n")
  }
  if (lines[at].includes(entry)) return text
  const single = /^(\s*preload\s*=\s*)(?:\[(.*)\]|("[^"]*"))\s*$/.exec(lines[at])
  if (!single) throw new Error("the bunfig.toml preload spans lines; add \"vibelang/bun\" to it by hand")
  const items = single[2] !== undefined ? single[2].trim().replace(/,\s*$/, "") : single[3]
  lines[at] = `${single[1]}[${entry}${items ? `, ${items}` : ""}]`
  return lines.join("\n")
}

// Bun's own commands. Anything else after `bun` in a script is a program, which
// reads the top-level preload.
const bunCommands = new Set(["test", "t", "install", "i", "add", "a", "remove", "rm", "update", "link", "unlink", "pm", "x", "create", "c", "init", "build", "upgrade", "outdated", "publish", "audit", "patch", "patch-commit", "info", "why", "repl", "exec", "feedback"])

/**
 * The directories, relative to the script's package, where script runs a
 * program under Bun: `bun file`, `bun run file` or a bin, `bun alchemy-test`,
 * following `cd dir`. A package script that `bun name` runs, one of what
 * scriptsIn(dir) gives for the directory it runs in, is not a program.
 */
export function bunProgramDirs(script, scriptsIn = () => ({})) {
  const dirs = []
  let dir = "."
  for (const part of script.split(/&&|\|\||;/)) {
    const words = part.replace(/[()]/g, " ").trim().split(/\s+/)
    if (words[0] === "cd" && words[1]) {
      dir = posix.normalize(posix.join(dir, words[1]))
      continue
    }
    if (words[0] !== "bun") continue
    const args = words.slice(1).filter((word) => !word.startsWith("-"))
    const program = args[0] === "run" ? args[1] : args[0]
    if (program === undefined || scriptsIn(dir)[program] || (args[0] !== "run" && bunCommands.has(program))) continue
    dirs.push(dir)
  }
  return dirs
}


/**
 * Adds vibelang/bun to the preload of every package that reaches migrated
 * sources (packagesReaching) and runs them under Bun, with the compiler the
 * preload needs: a workspace import reaches a .vibe module from any of them,
 * and Bun reads only the bunfig.toml of the directory it runs in. `bun test`
 * reads [test]'s preload, and a program, `bun file` or a bin, the top-level
 * one. A bunfig.toml this cannot edit is left as it is, with a warning.
 * Returns the files changed and the warnings.
 */
export function wireBunTests({ root, packages, specsFor }) {
  const changed = []
  const warnings = []
  const write = (file, before, after) => {
    if (before === after) return
    writeFileSync(join(root, file), after)
    changed.push(file)
  }
  const reaching = packagesReaching(root, packages.map((migrated) => migrated.dir))
  const scriptsOf = (pkg) => Object.values(pkg.manifest.scripts ?? {})
  // A script can run a program from another package's directory: `cd packages/e2e && bun run-all`.
  const all = repositoryPackages(root)
  const scriptsAt = (dir) => all.find((pkg) => pkg.dir === dir)?.manifest.scripts ?? {}
  const programs = new Set(all.flatMap((pkg) => {
    const at = (dir) => posix.normalize(posix.join(pkg.dir, dir))
    return scriptsOf(pkg).flatMap((script) => bunProgramDirs(script, (dir) => scriptsAt(at(dir))).map(at))
  }))
  for (const pkg of reaching) {
    const edits = [...(scriptsOf(pkg).some((script) => runsBunTest(script)) ? [addBunTestPreload] : []), ...(programs.has(pkg.dir) ? [addBunPreload] : [])]
    if (!edits.length) continue
    const bunfig = posix.join(pkg.dir, "bunfig.toml")
    const text = existsSync(join(root, bunfig)) ? readFileSync(join(root, bunfig), "utf8") : ""
    try {
      write(bunfig, text, edits.reduce((next, edit) => edit(next), text))
    } catch (error) {
      warnings.push(`${bunfig}: ${error.message}`)
      continue
    }
    const manifest = posix.join(pkg.dir, "package.json")
    const before = readFileSync(join(root, manifest), "utf8")
    const compiler = pkg.manifest.dependencies?.vibelang ?? pkg.manifest.devDependencies?.vibelang
    if (!compiler) write(manifest, before, JSON.stringify({ ...pkg.manifest, devDependencies: { ...pkg.manifest.devDependencies, vibelang: specsFor(pkg.dir).vibelang } }, null, 2) + "\n")
  }
  return { changed, warnings }
}

// A script that calls Bun.build, and a test, which this flow never edits.
const bunBuild = /\bBun\.build\s*\(/
const scriptFile = /\.(?:ts|mts|js|mjs)$/
const testFile = /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[^/]+$/

/** The scripts of a package that call Bun.build: its files outside nested packages, dependencies and output. */
function bunBuildFiles(root, dir) {
  const files = []
  const walk = (at) => {
    for (const entry of readdirSync(join(root, at), { withFileTypes: true })) {
      const path = at === "." ? entry.name : posix.join(at, entry.name)
      if (entry.isDirectory()) {
        if (!skippedDirectory(entry.name) && entry.name !== "dist" && !existsSync(join(root, path, "package.json"))) walk(path)
      } else if (scriptFile.test(entry.name) && !entry.name.endsWith(".d.ts") && bunBuild.test(readFileSync(join(root, path), "utf8"))) files.push(path)
    }
  }
  walk(dir)
  return files
}

/**
 * Adds vibelang-unplugin/bun to each Bun.build in a package that reaches
 * migrated sources (packagesReaching), and gives the package the plugin and
 * the compiler it needs. A test is left as it is, as a call whose shape
 * addBunBuildPlugin does not know is, with a warning. Returns the files
 * changed, the warnings and the scripts wired.
 */
export function wireBunBuilds({ root, packages, ts, specsFor }) {
  const changed = []
  const warnings = []
  const builds = []
  const write = (file, after) => {
    writeFileSync(join(root, file), after)
    changed.push(file)
  }
  for (const pkg of packagesReaching(root, packages.map((migrated) => migrated.dir))) {
    const specs = specsFor(pkg.dir)
    for (const file of bunBuildFiles(root, pkg.dir)) {
      if (testFile.test(file)) {
        warnings.push(`${file}: a test bundles with Bun.build, which needs vibelang() from vibelang-unplugin/bun to reach a .vibe module; add it by hand`)
        continue
      }
      if (!specs["vibelang-unplugin"]) {
        warnings.push(`${file}: this toolchain has no vibelang-unplugin; rebuild the toolchain to wire Bun.build`)
        continue
      }
      const text = readFileSync(join(root, file), "utf8")
      try {
        const next = addBunBuildPlugin(text, ts)
        if (next === text) continue
        write(file, next)
        builds.push(file)
      } catch (error) {
        warnings.push(`${file}: ${error.message}`)
        continue
      }
      const manifest = posix.join(pkg.dir, "package.json")
      const current = JSON.parse(readFileSync(join(root, manifest), "utf8"))
      const devDependencies = { ...current.devDependencies, "vibelang-unplugin": specs["vibelang-unplugin"] }
      if (!current.dependencies?.vibelang) devDependencies.vibelang ??= specs.vibelang
      if (JSON.stringify(devDependencies) !== JSON.stringify(current.devDependencies)) write(manifest, JSON.stringify({ ...current, devDependencies }, null, 2) + "\n")
    }
  }
  return { changed: [...new Set(changed)], warnings, builds: builds.sort() }
}

// Where Knip looks for its configuration, in its order (knip 6, KNIP_CONFIG_LOCATIONS).
const knipConfigs = ["knip.json", "knip.jsonc", ".knip.json", ".knip.jsonc", "knip.ts", "knip.js", "knip.config.ts", "knip.config.js"]

/** The TypeScript Knip configuration that gives `config`, a JSON text, VibeLang's compiler for .vibe files. */
export function knipConfigText(config) {
  return `import vibelang from "vibelang/knip"

// Knip reads .vibe files through VibeLang's compiler. The declaration
// sidecars vibelang writes beside them, x.d.vibe.ts, are its output.
const config: { ignore?: string | string[]; [setting: string]: unknown } = ${config.trim()}

export default {
  ...config,
  compilers: { vibe: vibelang },
  ignore: [...[config.ignore ?? []].flat(), "**/*.d.vibe.ts"],
}
`
}

/**
 * Gives the repository's Knip VibeLang's compiler for .vibe files
 * (vibelang/knip), and keeps it off the declaration sidecars. Knip takes a
 * compiler only from a JavaScript or TypeScript configuration, so a JSON one
 * (knip.json, knip.jsonc, or the `knip` key of package.json) becomes
 * knip.config.ts with the same settings. A repository that installs Knip
 * without a configuration gets one with only these settings; one whose
 * configuration is already code is named in the warnings. The root package
 * gets the compiler as a dev dependency, so the import resolves. Returns the
 * files changed, the warnings and the configuration written, or null.
 */
export function wireKnip({ root, specs }) {
  const changed = []
  const warnings = []
  const manifestPath = join(root, "package.json")
  if (!existsSync(manifestPath)) return { changed, warnings, config: null }
  const manifestText = readFileSync(manifestPath, "utf8")
  const manifest = JSON.parse(manifestText)
  const found = knipConfigs.find((file) => existsSync(join(root, file)))
  let config
  if (found && /\.jsonc?$/.test(found)) {
    config = readFileSync(join(root, found), "utf8")
    rmSync(join(root, found))
    changed.push(found)
  } else if (found) {
    if (!/vibelang\/knip/.test(readFileSync(join(root, found), "utf8"))) warnings.push(`${found}: add compilers: { vibe } from "vibelang/knip" and ignore "**/*.d.vibe.ts" by hand; this edit does not rewrite a Knip configuration that is code`)
    return { changed, warnings, config: null }
  } else if (manifest.knip !== undefined) {
    config = JSON.stringify(manifest.knip, null, 2)
    delete manifest.knip
  } else if (manifest.devDependencies?.knip || manifest.dependencies?.knip) {
    config = "{}"
  } else {
    return { changed, warnings, config: null }
  }
  writeFileSync(join(root, "knip.config.ts"), knipConfigText(config))
  changed.push("knip.config.ts")
  manifest.devDependencies = { ...manifest.devDependencies, vibelang: specs.vibelang }
  const next = JSON.stringify(manifest, null, 2) + "\n"
  if (next !== manifestText) {
    writeFileSync(manifestPath, next)
    changed.push("package.json")
  }
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    if (found && /\bknip\b/.test(command) && command.includes(found)) warnings.push(`package.json script ${name} names ${found}, which is now knip.config.ts`)
  }
  return { changed, warnings, config: "knip.config.ts" }
}

// The formatters the flow knows, by the name a script runs, each as the argv
// that formats the files given after it.
const formatters = [
  [/(?:^|[\s;&|(])vp\s+fmt\b/, ["vp", "fmt"]],
  [/(?:^|[\s;&|(/])oxfmt\b/, ["oxfmt"]],
  [/(?:^|[\s;&|(/])prettier\b/, ["prettier", "--write"]],
  [/(?:^|[\s;&|(/])biome\s+(?:format|check)\b/, ["biome", "format", "--write"]],
  [/(?:^|[\s;&|(/])dprint\s+(?:fmt|check)\b/, ["dprint", "fmt"]]
]

/**
 * The repository's own formatter, from its root package.json, as the argv
 * that writes the files given after it, or null: the one its format scripts
 * run (`format`, `fmt`, `format:check`, `lint:format`, ...), else Prettier,
 * Oxfmt, Biome or dprint when it installs one.
 */
export function formatterOf(manifest = {}) {
  const scripts = Object.entries(manifest.scripts ?? {}).filter(([name]) => /(?:^|:)(?:format|fmt|prettier)(?::|$)/.test(name)).map(([, command]) => command).join("\n")
  const run = formatters.find(([pattern]) => pattern.test(scripts))
  if (run) return run[1]
  const installed = { ...manifest.dependencies, ...manifest.devDependencies }
  for (const [name, argv] of [["prettier", ["prettier", "--write"]], ["oxfmt", ["oxfmt"]], ["@biomejs/biome", ["biome", "format", "--write"]], ["dprint", ["dprint", "fmt"]]]) {
    if (installed[name]) return argv
  }
  return null
}

/**
 * The files of `files` a formatter reads: JSON, YAML, Markdown and
 * JavaScript or TypeScript sources, without lockfiles, .vibe files (VibeLang's
 * formatter owns them) or the declaration sidecars vibelang writes.
 */
export function formattable(files) {
  return files.filter((file) => /\.(?:jsonc?|ya?ml|md|[cm]?[jt]sx?)$/.test(file) && !/\.d\.vibe\.ts$/.test(file) &&
    !["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lock"].includes(posix.basename(file)))
}

/** The package manager a repository uses, from its lockfile. */
export function packageManager(files) {
  if (files.includes("pnpm-lock.yaml")) return "pnpm"
  if (files.includes("bun.lock") || files.includes("bun.lockb")) return "bun"
  if (files.includes("yarn.lock")) return "yarn"
  return "npm"
}

/** The command that installs after the edits, letting the lockfile change. */
export const installCommand = (manager) => ({
  pnpm: "pnpm install --no-frozen-lockfile",
  bun: "bun install",
  yarn: "yarn install",
  npm: "npm install"
})[manager]

/** Where a staged toolchain's tarballs live in the target: at its root, ignored, so no commit names the machine's own paths. */
export const toolchainDirectory = ".vibelang-toolchain"

/**
 * Copies a staged toolchain's tarballs into dir, each named for its content:
 * vibelang-0.0.11.tgz becomes vibelang-0.0.11-<12 hex of its SHA-256>.tgz.
 * Every build of one version packs to the same name, and npm, Bun and pnpm
 * keep what an unchanged file: specifier installed before (its bin links,
 * its lockfile entry), so only a new name installs a rebuilt toolchain.
 * Returns each package's file name in dir.
 */
export function copyTarballs(toolchainDir, packages, dir) {
  mkdirSync(dir, { recursive: true })
  return Object.fromEntries(Object.entries(packages).map(([name, file]) => {
    const bytes = readFileSync(join(toolchainDir, file))
    const named = `${file.replace(/\.tgz$/, "")}-${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}.tgz`
    writeFileSync(join(dir, named), bytes)
    return [name, named]
  }))
}

/**
 * The dependency specifiers of a package at packageDir (relative to the
 * repository root) for tarballs in the root's toolchain directory:
 * file:../../.vibelang-toolchain/vibelang-0.0.11-<hash>.tgz from packages/x.
 */
export function toolchainSpecs(packageDir, tarballs) {
  const up = packageDir === "." || packageDir === "" ? "./" : "../".repeat(packageDir.split("/").filter(Boolean).length)
  return Object.fromEntries(Object.entries(tarballs).map(([name, file]) => [name, `file:${up}${toolchainDirectory}/${file}`]))
}

/** A .gitignore's text with line present (add) or absent (remove); other lines are kept. */
export function setIgnoreLine(text, line, present) {
  const lines = text.split("\n")
  const has = lines.some((l) => l.trim() === line)
  if (present) return has ? text : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`
  return has ? lines.filter((l) => l.trim() !== line).join("\n") : text
}

const wrote = "vibelang agents init: wrote "

/**
 * Runs `vibelang agents init` for the repository at root with the vibelang
 * that packageDir installed, so its coding agents get the VibeLang skill, the
 * language server and a check after each edit. Returns the files it wrote; a
 * vibelang without the command, before 0.0.11, writes none.
 */
export async function initAgents({ root, packageDir, log }) {
  const cwd = join(root, packageDir)
  if (!existsSync(join(cwd, "node_modules/vibelang/agents.mjs"))) return { files: [], skipped: "the installed vibelang has no `vibelang agents` command" }
  const { stdout } = await must(`node node_modules/vibelang/bin/vibelang agents init ${quote(root)}`, { cwd, log })
  return { files: stdout.split("\n").filter((line) => line.startsWith(wrote)).map((line) => line.slice(wrote.length)) }
}
