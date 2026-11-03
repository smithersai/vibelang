// The edits that set up VibeLang in an existing project, as text-in,
// text-out functions: the package's dependencies, tsc replaced by vibelang
// in scripts, the vibelang-vite plugin in the Vitest or Vite config, the
// vibelang-unplugin plugin in each Bun.build (esbuild's calls are
// esbuild-builds.mjs), the
// compiler option that lets .vibe files import local modules by their source
// names, and the settings that let every TypeScript checker read a .vibe
// module through its declaration sidecar. Each keeps the file's own
// formatting outside the lines it changes.
// wireVite applies the plugin edit to the config files the tests load. The
// Effect upgrade before setup is upgrade.mjs. initAgents sets the target's
// coding agents up with the vibelang it installed.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join, posix } from "node:path"
import { wireNativeViteConfigs } from "./vite-config.mjs"
import { workspaceGlobs, workspaceManifests } from "./upgrade.mjs"
import { must, quote } from "./util.mjs"
import { packageScripts, testLeftAsIs, testOnlyScripts } from "./test-files.mjs"

/**
 * The repository's own files: a predicate on repository-relative paths that
 * holds where the nearest package.json is the root's or a workspace
 * member's (the root package.json's `workspaces`, pnpm-workspace.yaml's
 * `packages`). A directory with a package.json no workspace names, such as a
 * vendored repository, holds someone else's project, and setup leaves it as
 * it is, as the Effect upgrade does.
 */
export function ownedPaths(root) {
  const submodules = submodulePaths(root)
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
  return (path) => !inSubmodule(submodules, path) && ownerOwned(posix.dirname(path))
}

/**
 * The directories of the repository's Git submodules, from its .gitmodules:
 * each is another repository at the revision its gitlink records, so a
 * commit of this one cannot hold edits to it. Setup and the Effect upgrade
 * leave them as they are, even where a workspace or the run names packages
 * inside them, as alchemy's pnpm-workspace.yaml names
 * submodules/distilled/packages/* (alchemy-31).
 */
export function submodulePaths(root) {
  const file = join(root, ".gitmodules")
  if (!existsSync(file)) return []
  return [...readFileSync(file, "utf8").matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)].map((m) => posix.normalize(m[1]).replace(/\/$/, ""))
}

/** Whether a repository-relative path is a submodule's directory or inside one. */
export function inSubmodule(submodules, path) {
  const normal = posix.normalize(path)
  return submodules.some((dir) => normal === dir || normal.startsWith(dir + "/"))
}

/**
 * The commands of the TypeScript compilers a script may run: TypeScript's
 * `tsc`, the native preview's `tsgo`, and `tsrs`, a TypeScript 7.1 build
 * alchemy runs as `tsrs -b`. vibelang takes each one's flags.
 */
export const typeScriptCompilers = ["tsc", "tsgo", "tsrs"]

/**
 * Replaces a TypeScript compiler with vibelang in package scripts: `tsc -b x`
 * becomes `vibelang -b x`, as do `tsgo -b x` and `tsrs -b x`, and so does a
 * compiler a shell separator ends, as in `tsc; node x`.
 */
export function replaceTsc(scripts = {}) {
  const command = new RegExp(`(^|[\\s;&|(])(?:${typeScriptCompilers.join("|")})(?=[\\s;&|)]|$)`, "g")
  const next = {}
  for (const [name, script] of Object.entries(scripts)) next[name] = script.replace(command, "$1vibelang")
  return next
}

// tsc in command position: at the start, or after a separator, alone or run
// through a package runner (bunx, npx, pnpm exec, bun x, yarn).
const tscCommand = /(^|[\s;&|(`}])((?:bunx|npx|pnpm\s+exec|bun\s+x|yarn)\s+)?tsc(?=\s|$|`)/g

/**
 * A build script's text with each `tsc` its Bun shell runs (`$\`bunx tsc
 * --emitDeclarationOnly\``) replaced by `vibelang`, which compiles the
 * package's .vibe modules too: stock tsc reads no .vibe file, so opencode's
 * http-recorder build found no dist/index.d.ts once src/index.ts became .vibe
 * (opencode-42). Only the literal text of a `$` template changes; an
 * interpolation, another string or a comment stays. ts is TypeScript's API.
 */
export function replaceTscInScript(text, ts) {
  const source = ts.createSourceFile("script.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const edits = []
  const literal = (node) => {
    const start = node.getStart(source)
    const raw = text.slice(start, node.end)
    const next = raw.replace(tscCommand, "$1$2vibelang")
    if (next !== raw) edits.push({ at: start, end: node.end, text: next })
  }
  const visit = (node) => {
    if (ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag) && node.tag.text === "$") {
      const template = node.template
      if (ts.isNoSubstitutionTemplateLiteral(template)) literal(template)
      else {
        literal(template.head)
        for (const span of template.templateSpans) literal(span.literal)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  let out = text
  for (const edit of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, edit.at) + edit.text + out.slice(edit.end)
  return out
}

/**
 * The root owns solution builds even when only leaf packages are migrated.
 * Replace the checker in place: a shared base config is not an extra project.
 */
export function addCompilerScripts(pkg, compiler) {
  const scripts = replaceTsc(pkg.scripts)
  const changed = JSON.stringify(scripts) !== JSON.stringify(pkg.scripts ?? {})
  return { ...pkg, ...(pkg.scripts ? { scripts } : {}), ...(changed ? { devDependencies: { ...pkg.devDependencies, vibelang: compiler } } : {}) }
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

/** Whether a package.json already depends on the VibeLang runtime: an earlier setup wired it. */
export function hasVibeLang(pkg) {
  return Boolean(pkg.dependencies?.["vibelang-runtime"] ?? pkg.devDependencies?.["vibelang-runtime"])
}

/**
 * The VibeLang specifiers (vibelang-runtime, vibelang, vibelang-vite,
 * vibelang-unplugin) the package.json pkg at fromDir names, for a package at
 * toDir, both repository-relative: a relative file: specifier is rebased so
 * it names the same file from toDir (file:../.vibelang-toolchain/x.tgz from
 * tools for file:../../.vibelang-toolchain/x.tgz from packages/a); any other
 * is kept.
 */
export function specsFrom(pkg, fromDir, toDir) {
  const names = ["vibelang-runtime", "vibelang", "vibelang-vite", "vibelang-unplugin"]
  const all = { ...pkg.devDependencies, ...pkg.dependencies }
  return Object.fromEntries(names.filter((name) => all[name] !== undefined).map((name) => {
    const spec = all[name]
    const relative = /^file:(?!\/)(.*)$/.exec(spec)
    if (!relative) return [name, spec]
    const path = posix.relative(posix.normalize(toDir || "."), posix.join(fromDir || ".", relative[1]))
    return [name, `file:${path.startsWith(".") ? path : `./${path}`}`]
  }))
}

/** Adds the compiler and the Vite plugin, which needs it, as dev dependencies: what a package that owns a Vite config needs. */
export function addVibeLangPlugin(pkg, specs) {
  const next = structuredClone(pkg)
  next.devDependencies = { ...next.devDependencies, vibelang: specs.vibelang, "vibelang-vite": specs["vibelang-vite"] }
  return next
}

/**
 * The expression under the parentheses, `as` and `<T>` assertions,
 * `satisfies` clauses and `!` that wrap node, none of which changes the value
 * a config or Bun.build reads: opencode's packages/app writes
 * `plugins: [desktopPlugin, ...] as any`.
 */
function unwrapped(node, ts) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node))) node = node.expression
  return node
}

/**
 * Adds `vibelang()` from vibelang-vite to a Vite or Vitest config that calls
 * defineConfig with an object literal, or with a function that returns one
 * (`defineConfig(() => ({ ... }))`, or a body whose last top-level return
 * is one), first in that object's own plugins,
 * never in a nested option's (a `lint: { plugins: [...] }`). ts is
 * TypeScript's compiler API. With register, for the config the tests load,
 * the plugin is vibelang({ register: true }), so a node or bun process a
 * test starts on the sources loads .vibe modules too, and a config that
 * already has the plugin gains the option (addRegister). Returns the text
 * unchanged when the plugin is already there; throws when the config has a
 * shape this edit does not know, so a person wires it instead.
 */
export function addVitePlugin(text, ts, { register = false, worker = false } = {}) {
  const imported = /import\s+([\w$]+)\s+from\s+['"]vibelang-vite['"]/.exec(text)
  if (imported) {
    const registered = register ? addRegister(text, ts, imported[1]) : text
    return worker ? addWorkerPlugin(registered, ts, `${imported[1]}()`) : registered
  }
  if (/from\s+['"]vibelang-vite['"]/.test(text)) return text
  const source = ts.createSourceFile("vite.config.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const config = defineConfigObject(source, ts)
  if (!config) throw new Error("the config does not call defineConfig({ ... }) or defineConfig(() => ({ ... })); add vibelang() from vibelang-vite to its plugins by hand")
  const call = register ? "vibelang({ register: true })" : "vibelang()"
  const edits = [importEdit(text, source, ts, "vibelang-vite"), pluginEdit(text, source, config, ts, "the config's plugins is not an array literal; add vibelang() to it by hand", call)]
  if (worker) edits.push(workerEdit(text, source, config, ts, "vibelang()"))
  return applyPluginEdits(text, edits)
}

/**
 * The object a config's `defineConfig(...)` gives: its argument, or what an
 * arrow or function argument returns (the last top-level return of a body),
 * through parentheses and type assertions; undefined when there is none.
 */
function defineConfigObject(source, ts) {
  let config
  // The object a defineConfig argument gives: the literal, or what its function returns.
  const objectOf = (node) => {
    node = unwrapped(node, ts)
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
  return config
}

// A property of object by name, through an identifier or a string key.
const propertyOf = (object, name, ts) => object.properties.find((p) => p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name)

/**
 * The edit that puts call first in the plugins Vite builds a worker with
 * (opencode's `new Worker(new URL("./x", import.meta.url))`, whose build
 * applies `worker.plugins`, not the config's plugins): `worker: { plugins: ()
 * => [...] }` as Vite 5 and later write it, or an array as earlier Vite does;
 * a config with neither gains `worker: { plugins: () => [call] }`.
 */
function workerEdit(text, source, config, ts, call) {
  const refusal = "the config's worker.plugins is neither an array nor a function returning one; add vibelang() to it by hand"
  const worker = propertyOf(config, "worker", ts)
  if (!worker) {
    const at = config.getStart(source) + 1
    const indent = /\n([ \t]+)\S/.exec(text.slice(at))?.[1]
    return indent ? { at, text: `\n${indent}worker: { plugins: () => [${call}] },` } : { at, text: ` worker: { plugins: () => [${call}] },` }
  }
  const object = ts.isPropertyAssignment(worker) ? unwrapped(worker.initializer, ts) : undefined
  if (!object || !ts.isObjectLiteralExpression(object)) throw new Error(refusal)
  const plugins = propertyOf(object, "plugins", ts)
  if (!plugins) return { at: object.getStart(source) + 1, text: ` plugins: () => [${call}],` }
  let list = ts.isPropertyAssignment(plugins) ? unwrapped(plugins.initializer, ts) : undefined
  if (list && (ts.isArrowFunction(list) || ts.isFunctionExpression(list))) {
    const body = ts.isBlock(list.body) ? list.body.statements.filter((s) => ts.isReturnStatement(s)).at(-1)?.expression : list.body
    list = unwrapped(body, ts)
  }
  if (!list || !ts.isArrayLiteralExpression(list)) throw new Error(refusal)
  return list.elements.length ? { at: list.elements[0].getStart(source), text: `${call}, ` } : { at: list.getStart(source) + 1, text: call }
}

/** text with call in its config's worker.plugins (workerEdit), unless a call of the same plugin is there. */
function addWorkerPlugin(text, ts, call) {
  const source = ts.createSourceFile("vite.config.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const config = defineConfigObject(source, ts)
  if (!config) return text
  const worker = propertyOf(config, "worker", ts)
  const name = call.slice(0, call.indexOf("("))
  if (worker && new RegExp(`\\b${name}\\(`).test(text.slice(worker.getStart(source), worker.end))) return text
  return applyPluginEdits(text, [workerEdit(text, source, config, ts, call)])
}

/**
 * Adds `vibelang()` from vibelang-vite to an electron-vite config
 * (`defineConfig` from electron-vite), first in the plugins of each of its
 * `main`, `preload` and `renderer` builds, each a Vite build of its own
 * (opencode's packages/desktop: the main and preload builds loaded `.vibe`
 * modules with no plugin). Returns the text unchanged when the plugin is
 * already imported; throws for a shape this edit does not know.
 */
export function addElectronVitePlugin(text, ts) {
  if (/from\s+['"]vibelang-vite['"]/.test(text)) return text
  const source = ts.createSourceFile("electron.vite.config.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const config = defineConfigObject(source, ts)
  if (!config) throw new Error("the electron-vite config does not call defineConfig({ ... }) or defineConfig(() => ({ ... })); add vibelang() from vibelang-vite to its main, preload and renderer plugins by hand")
  const sections = ["main", "preload", "renderer"].map((name) => propertyOf(config, name, ts)).filter(Boolean)
  if (!sections.length) throw new Error("the electron-vite config has no main, preload or renderer build; add vibelang() from vibelang-vite to its builds by hand")
  const edits = [importEdit(text, source, ts, "vibelang-vite")]
  for (const section of sections) {
    const object = ts.isPropertyAssignment(section) ? unwrapped(section.initializer, ts) : undefined
    if (!object || !ts.isObjectLiteralExpression(object)) throw new Error(`the electron-vite config's ${section.name.text} build is not an object literal; add vibelang() to its plugins by hand`)
    edits.push(pluginEdit(text, source, object, ts, `the electron-vite config's ${section.name.text}.plugins is not an array literal; add vibelang() to it by hand`))
  }
  return applyPluginEdits(text, edits)
}

// Whether a package or one of its local workspace dependencies starts a Vite
// worker build. Worker plugins belong to the consuming app, even when the
// constructor lives in a dependency (opencode's Office preview).
export function startsWorkers(root, dir) {
  const walk = (path) => {
    let entries = []
    try { entries = readdirSync(join(root, path), { withFileTypes: true }) } catch { return false }
    for (const entry of entries) {
      const child = path ? posix.join(path, entry.name) : entry.name
      if (entry.isDirectory()) {
        if (!skippedDirectory(entry.name) && !testDirectory(entry.name) && !existsSync(join(root, child, "package.json")) && walk(child)) return true
      } else if (/\.(?:[cm]?[jt]sx?|vibe)$/.test(entry.name)) {
        const text = readFileSync(join(root, child), "utf8")
        if (/new\s+(?:Shared)?Worker\s*\(\s*new\s+URL\s*\(/.test(text) || /['"][^'"]+\?worker(?:&[^'"]*)?['"]/.test(text)) return true
      }
    }
    return false
  }
  const all = repositoryPackages(root)
  const owns = ownedPaths(root)
  const byName = new Map(all.filter(pkg => pkg.manifest.name && owns(posix.join(pkg.dir, "package.json"))).map(pkg => [pkg.manifest.name, pkg]))
  const byDir = new Map(all.map(pkg => [pkg.dir, pkg]))
  const pending = [dir], seen = new Set()
  for (let i = 0; i < pending.length; i++) {
    const current = pending[i]
    if (seen.has(current)) continue
    seen.add(current)
    if (walk(current === "." ? "" : current)) return true
    const pkg = byDir.get(current)
    if (pkg) pending.push(...localPackageDependencies(pkg, byName).map(dependency => dependency.dir))
  }
  return false
}

/**
 * text, a config that imports vibelang-vite as name, with register: true in
 * each name(...) call that does not set register: name() gains
 * { register: true }, and an object literal argument gains the property
 * first. A call whose argument is not an object literal is left as it is.
 */
export function addRegister(text, ts, name) {
  const source = ts.createSourceFile("vite.config.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const edits = []
  const find = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
      const [options] = node.arguments
      if (!options) edits.push({ at: node.arguments.pos, text: "{ register: true }" })
      else if (ts.isObjectLiteralExpression(options) && !options.properties.some((p) => p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === "register")) {
        edits.push(options.properties.length
          ? { at: options.properties[0].getStart(source), text: "register: true, " }
          : { at: options.getStart(source) + 1, text: " register: true " })
      }
    }
    ts.forEachChild(node, find)
  }
  find(source)
  return applyPluginEdits(text, edits)
}

/** The edit that puts call, vibelang() by default, first in config's own plugins, or gives it plugins; throws `refusal` when they are not an array literal. */
function pluginEdit(text, source, config, ts, refusal, call = "vibelang()") {
  const plugins = config.properties.find((p) => p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === "plugins")
  if (plugins) {
    const list = ts.isPropertyAssignment(plugins) ? unwrapped(plugins.initializer, ts) : undefined
    if (!list || !ts.isArrayLiteralExpression(list)) throw new Error(refusal)
    return list.elements.length ? { at: list.elements[0].getStart(source), text: `${call}, ` } : { at: list.getStart(source) + 1, text: call }
  }
  const at = config.getStart(source) + 1
  const indent = /\n([ \t]+)\S/.exec(text.slice(at))?.[1]
  return indent ? { at, text: `\n${indent}plugins: [${call}],` } : { at, text: ` plugins: [${call}],` }
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
  const edits = []
  const find = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Bun" && node.expression.name.text === "build") {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
      const refusal = `line ${line}: Bun.build does not take an object literal with an array of plugins; add vibelang() from vibelang-unplugin/bun to it by hand`
      const options = unwrapped(node.arguments[0], ts)
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
 * warnings for packages whose tests load no config and for configs whose
 * shape addVitePlugin does not know, which it leaves as they are.
 */
export function wireVite({ root, packages, test, ts, specsFor }) {
  const changed = []
  const warnings = []
  // A config whose shape addVitePlugin does not know is named in a warning and left as it is.
  const wire = (file) => {
    try {
      wireViteConfig({ root, file, ts, specsFor, changed, register: true })
    } catch (error) {
      warnings.push(`${file}: ${error.message}`)
    }
  }
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
// register is for a config the tests load (addVitePlugin).
function wireViteConfig({ root, file, ts, specsFor, changed, register = false }) {
  const write = (path, before, after) => {
    if (before === after) return
    writeFileSync(join(root, path), after)
    if (!changed.includes(path)) changed.push(path)
  }
  const text = readFileSync(join(root, file), "utf8")
  let owner = posix.dirname(file)
  while (owner !== "." && !existsSync(join(root, owner, "package.json"))) owner = posix.dirname(owner)
  // electron-vite builds main, preload and renderer with a plugin list each; a Vite app's workers build with worker.plugins.
  write(file, text, electronViteConfigFile.test(posix.basename(file)) ? addElectronVitePlugin(text, ts) : addVitePlugin(text, ts, { register, worker: startsWorkers(root, owner) }))
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
const viteConfigFile = /^(?:vite(?:st)?(?:\.[\w-]+)?|electron\.vite)\.config\.m?[jt]s$/
const electronViteConfigFile = /^electron\.vite\.config\.m?[jt]s$/

// A dependency on a workspace package by its source: workspace:, file:, link: or *.
const localSpec = /^(?:workspace:|file:|link:|\*$)/

const localPackageDependencies = (pkg, byName) => Object.entries({
  ...pkg.manifest.dependencies, ...pkg.manifest.devDependencies,
  ...pkg.manifest.peerDependencies, ...pkg.manifest.optionalDependencies
}).filter(([name, spec]) => typeof spec === "string" && localSpec.test(spec) && byName.has(name))
  .map(([name]) => byName.get(name))


/**
 * The repository's packages that load migrated sources: each migrated package
 * and each that depends on one through workspace packages
 * (`"foldkit": "workspace:*"`). migrated holds the migrated packages' directories.
 */
export function packagesReaching(root, migrated) {
  const all = repositoryPackages(root)
  const byName = new Map(all.filter((pkg) => pkg.manifest.name).map((pkg) => [pkg.manifest.name, pkg]))
  const local = (pkg) => localPackageDependencies(pkg, byName)
  // Propagate from the migrated packages through reverse dependency edges.
  // A recursive walk cannot memoize false while a dependency cycle is open:
  // another branch may still connect the whole cycle to a migrated package.
  const dependents = new Map()
  for (const pkg of all) {
    for (const dependency of local(pkg)) {
      const consumers = dependents.get(dependency.dir) ?? []
      consumers.push(pkg.dir)
      dependents.set(dependency.dir, consumers)
    }
  }
  const reached = new Set(migrated)
  const queue = [...reached]
  for (let i = 0; i < queue.length; i++) {
    for (const dir of dependents.get(queue[i]) ?? []) {
      if (reached.has(dir)) continue
      reached.add(dir)
      queue.push(dir)
    }
  }
  return all.filter((pkg) => reached.has(pkg.dir))
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
  const owns = ownedPaths(root)
  const selected = path => packages.some(pkg => pkg.dir === "." || path.startsWith(pkg.dir + "/"))
  const manifests = repositoryPackages(root).filter(pkg => owns(posix.join(pkg.dir, "package.json")) || selected(posix.join(pkg.dir, "package.json")))
  const candidates = [...new Set([...wired, ...viteAppConfigs(root, manifests.map(pkg => pkg.dir))])]
    .filter(file => owns(file) || selected(file))
  const native = wireNativeViteConfigs({ root, packages, configs: candidates, manifests, ts, specsFor })
  changed.push(...native.changed.filter(file => !changed.includes(file)))
  warnings.push(...native.warnings)
  return { changed, warnings, configs, nativeConfigs: native.wired }
}

/**
 * Adds compiler options to a tsconfig's text (JSON with comments): into its
 * compilerOptions when it has them, else as a new compilerOptions object.
 * Options already set are left as they are.
 */
// inlineJson writes value on one line as dprint and Prettier format JSON: a
// space after each comma and colon and inside an object's braces, so
// ["", ".d.vibe"] rather than JSON.stringify's ["",".d.vibe"], which a
// repository's format check reports (smithers: fmt in about 60 packages).
export function inlineJson(value) {
  if (Array.isArray(value)) return `[${value.map(inlineJson).join(", ")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
    return entries.length ? `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inlineJson(v)}`).join(", ")} }` : "{}"
  }
  return JSON.stringify(value)
}

export function addCompilerOptions(text, options) {
  const entries = Object.entries(options).filter(([k]) => !new RegExp(`"${k}"\\s*:`).test(text))
  if (!entries.length) return text
  const body = (indent) => entries.map(([k, v]) => `${indent}"${k}": ${inlineJson(v)}`).join(",\n")
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
 * How a package's sources spell a relative import of a module, from their
 * texts: ".js" for `./x.js`, ".ts" for `./x.ts`, "extensionless" for `./x`.
 * `style` is the one spelling every such import uses, the
 * `vibelang.declarationImportStyle` that keeps it in the declarations of
 * migrated modules (C′), or null when the sources use none or mix them.
 * `./x.vibe`, a module already migrated, and specifiers with any other
 * extension, `./styles.css` or `./data.json`, say nothing; nor does
 * moduleResolution, which opencode's packages write `.js` and `./x` under
 * alike.
 */
export function importSpelling(texts) {
  const counts = { ".js": 0, extensionless: 0, ".ts": 0 }
  const spellings = { ".js": ".js", ".mjs": ".js", ".cjs": ".js", ".jsx": ".js", ".ts": ".ts", ".mts": ".ts", ".cts": ".ts", ".tsx": ".ts", "": "extensionless" }
  const specifier = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*|\brequire\s*\(\s*)(["'])(\.\.?\/[^"'\n]*)\1/gm
  for (const text of texts) {
    for (const match of text.matchAll(specifier)) {
      const name = match[2].split("/").at(-1)
      if (name === "" || name === "." || name === ".." || /\.d\.[mc]?ts$/.test(name)) continue
      const dot = name.lastIndexOf(".")
      const spelling = spellings[dot > 0 ? name.slice(dot) : ""]
      if (spelling) counts[spelling]++
    }
  }
  const used = Object.keys(counts).filter((key) => counts[key] > 0)
  return { style: used.length === 1 ? used[0] : null, counts }
}

/**
 * Sets key to value in a tsconfig's VibeLang settings (JSON with comments):
 * in its top-level `vibelang` object, else its `compilerOptions.vibelang`,
 * else a new top-level `"vibelang": { … }`, which stock TypeScript ignores
 * (D275). A key already there takes the new value. Comments and the rest of
 * the file are left as they are. ts is TypeScript's compiler API.
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
    const existing = property(object, key)
    if (existing) return text.slice(0, existing.initializer.getStart(file)) + JSON.stringify(value) + text.slice(existing.initializer.end)
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
 * Removes a retired VibeLang setting from a tsconfig (JSON with comments):
 * key in its top-level `vibelang` or `vibe` object or in
 * `compilerOptions.vibelang` or `compilerOptions.vibe`, the places
 * `vibelang --fix` removes it from, and the object itself when key was all it
 * held. Earlier setups wrote `"vibelang": { "declarationSidecars": true }`,
 * which the compiler now rejects (TS5023). Comments and the rest of the file
 * are left as they are. ts is TypeScript's compiler API.
 */
export function removeVibeLangSetting(text, ts, key) {
  const file = ts.parseJsonText("tsconfig.json", text)
  const root = file.statements[0]?.expression
  if (!root || !ts.isObjectLiteralExpression(root)) return text
  const nameOf = (p) => ts.isPropertyAssignment(p) && p.name && (ts.isStringLiteral(p.name) || ts.isIdentifier(p.name)) ? p.name.text : undefined
  const objectOf = (p) => p && ts.isObjectLiteralExpression(p.initializer) ? p.initializer : undefined
  // The span that removes property from object: with the comma after it, or the one before the last.
  const removal = (object, property) => {
    const list = object.properties
    const index = list.indexOf(property)
    if (index < list.length - 1) return { from: property.getFullStart(), to: list[index + 1].getFullStart() }
    if (index > 0) return { from: list[index - 1].end, to: property.end }
    return { from: object.getStart(file) + 1, to: object.end - 1 }
  }
  const edits = []
  const sections = [root, objectOf(root.properties.find((p) => nameOf(p) === "compilerOptions"))].filter(Boolean)
  for (const section of sections) {
    for (const holder of section.properties.filter((p) => nameOf(p) === "vibelang" || nameOf(p) === "vibe")) {
      const settings = objectOf(holder)
      if (!settings) continue
      const retired = settings.properties.filter((p) => nameOf(p) === key)
      if (!retired.length) continue
      if (retired.length === settings.properties.length) edits.push(removal(section, holder))
      else for (const property of retired) edits.push(removal(settings, property))
    }
  }
  let out = text
  for (const { from, to } of edits.sort((a, b) => b.from - a.from)) out = out.slice(0, from) + out.slice(to)
  return out
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
  const added = [...new Set(patterns.filter((p) => /\.(?:m?ts|tsx)$/.test(p) && !/\.d\.(?:m?ts|tsx)$/.test(p)).map((p) => p.replace(/\.(?:m?ts|tsx)$/, ".vibe")))].filter((p) => !patterns.includes(p))
  if (!added.length) return text
  const last = elements.at(-1)
  const start = last.getStart(file)
  const multiline = text.slice(include.initializer.getStart(file), start).includes("\n")
  const indent = /^[ \t]*/.exec(text.slice(text.lastIndexOf("\n", start) + 1))[0]
  return text.slice(0, last.getEnd()) + added.map((p) => (multiline ? `,\n${indent}` : ", ") + JSON.stringify(p)).join("") + text.slice(last.getEnd())
}

/**
 * The repository's tsconfig files (tsconfig*.json, outside node_modules,
 * hidden directories, fixtures, templates, tests and trees it does not own),
 * as repository-relative paths. A tsconfig under a test or a fixture is a
 * test's input, which setup never edits (detail 272; smithers platform-node's
 * test/fixtures/lsp/ts/tsconfig.json, which an LSP test type-checks as data).
 */
export function ownedTsconfigs(root) {
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (entry.isDirectory() ? skippedDirectory(entry.name) || testDirectory(entry.name) : entry.name.startsWith(".")) continue
      const path = dir ? posix.join(dir, entry.name) : entry.name
      if (entry.isDirectory()) walk(path)
      else if (/^tsconfig.*\.json$/.test(entry.name)) files.push(path)
    }
  }
  walk("")
  const own = ownedPaths(root)
  return files.filter(own)
}

/**
 * The owned tsconfigs that extend none of the others: a compiler option set
 * in each is set in every project. ts is TypeScript's compiler API.
 */
export function rootTsconfigs(root, ts) {
  const files = ownedTsconfigs(root)
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
// A migrated package's emitted JavaScript (emitPackageJs), vibelang's output too.
export const emittedIgnore = "**/.vibelang/js/**"

/** The Oxlint configurations a repository may keep at its root, in Oxlint's order. */
export const oxlintConfigs = [".oxlintrc.json", ".oxlintrc.jsonc", "oxlint.config.ts", "oxlint.config.mts", "oxlint.config.js", "oxlint.config.mjs"]

/**
 * An Oxlint configuration's text, JSON or a defineConfig module, with
 * pattern first in its ignorePatterns, which gains the key when it has none:
 * Oxlint reads x.d.vibe.ts as TypeScript, not as a declaration file, and
 * would lint vibelang's generated sidecars. Returns null for a shape it does
 * not know.
 */
// hasString reports whether text writes pattern as a string literal, in any
// quotes: a formatter may have requoted what setup wrote (foldkit's oxfmt
// writes 'single'), and a rerun must not add it again (foldkit-17).
function hasString(text, pattern) {
  return [`"${pattern}"`, `'${pattern}'`, `\`${pattern}\``].some((literal) => text.includes(literal))
}

// stringIn writes value as a string literal in the quotes text's first string
// literal uses, so a module keeps its style.
function stringIn(text, value) {
  return /(['"])(?:(?!\1)[^\\\n])*\1/.exec(text)?.[1] === "'" ? `'${value.replace(/[\\']/g, "\\$&")}'` : JSON.stringify(value)
}

export function addOxlintIgnore(text, pattern = `**/${sidecarIgnore}`) {
  if (hasString(text, pattern)) return text
  const list = /(["']?)ignorePatterns\1\s*:\s*\[/.exec(text)
  if (list) {
    const at = list.index + list[0].length
    const indent = /^\r?\n([ \t]*)/.exec(text.slice(at))
    const literal = stringIn(text, pattern)
    return indent ? `${text.slice(0, at)}\n${indent[1]}${literal},${text.slice(at)}` : `${text.slice(0, at)}${literal}, ${text.slice(at)}`
  }
  const json = /^\s*\{/.exec(text)
  const module = /(?:defineConfig\(\s*|export\s+default\s+)\{/.exec(text)
  const open = json ?? module
  if (!open) return null
  const at = open.index + open[0].length
  const indent = /^\r?\n([ \t]*)\S/.exec(text.slice(at))?.[1] ?? "  "
  const key = json ? `"ignorePatterns"` : "ignorePatterns"
  return `${text.slice(0, at)}\n${indent}${key}: [${json ? JSON.stringify(pattern) : stringIn(text, pattern)}],${text.slice(at)}`
}

/**
 * An ESLint flat configuration's text with a global ignores entry for
 * pattern first in what it exports, `export default [`, or a call such as
 * `tseslint.config(` or `defineConfig([`: ESLint lints x.d.vibe.ts as
 * TypeScript wherever a files glob takes *.ts. Returns null for a shape it
 * does not know, such as a configuration bound to a name first.
 */
export function addEslintIgnore(text, pattern = `**/${sidecarIgnore}`) {
  if (hasString(text, pattern)) return text
  return firstConfiguration(text, `{ ignores: [${stringIn(text, pattern)}] },`)
}

/**
 * An ESLint flat configuration's text with eslint-plugin-import's (or
 * eslint-plugin-import-x's) parser setting for .vibe first in what it exports.
 * The plugin parses an imported module with the parser its extension maps to;
 * without one it finds no exports in a .vibe module, so import/namespace,
 * import/named and import/default report every name a .ts file imports from
 * one (smithers: kernel, platform-node, sandbox). The text is unchanged when
 * it loads neither plugin or already maps .vibe to vibelang/eslint; null for
 * a shape addEslintIgnore does not know.
 */
export function addEslintImportParsers(text) {
  const plugin = /["'`]eslint-plugin-import(-x)?["'`]/.exec(text)
  if (!plugin) return text
  const setting = plugin[1] ? "import-x/parsers" : "import/parsers"
  const mapped = new RegExp(`["'\`]${setting}["'\`]\\s*:\\s*\\{[^}]*["'\`]vibelang/eslint["'\`]`)
  if (mapped.test(text)) return text
  return firstConfiguration(text, `{ settings: { ${stringIn(text, setting)}: { ${stringIn(text, "vibelang/eslint")}: [${stringIn(text, ".vibe")}] } } },`)
}

// closingParen returns the index of the parenthesis that closes the one at
// open in text, a module, past strings, template literals and comments; -1
// when there is none.
function closingParen(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === "/" && text[i + 1] === "/") i = text.indexOf("\n", i) < 0 ? text.length : text.indexOf("\n", i)
    else if (c === "/" && text[i + 1] === "*") i = text.indexOf("*/", i + 2) < 0 ? text.length : text.indexOf("*/", i + 2) + 1
    else if (c === '"' || c === "'" || c === "`") {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++
    } else if (c === "(") depth++
    else if (c === ")" && --depth === 0) return i
  }
  return -1
}

// firstConfiguration writes entry first in what an ESLint flat configuration
// exports, `export default [`, or a call such as `tseslint.config(` or
// `defineConfig([`, on a line of its own when the entries are; null for a
// shape it does not know.
function firstConfiguration(text, entry) {
  const open = /(?:export\s+default|module\.exports\s*=)\s*(?:[\w$.]+\((?:\s*\[)?|\[)/.exec(text)
  if (!open) return null
  // An array method's result, such as config.flatMap(...), is the list:
  // the entry goes before its spread, not into the method's arguments
  // (smithers flows/database: "TypeError: object is not a function").
  const method = /^((?:export\s+default|module\.exports\s*=)\s*)([\w$.]+\.(?:flatMap|map|filter|concat|slice|flat|toSorted|toReversed)\()/.exec(text.slice(open.index))
  if (method) {
    const call = open.index + method[1].length
    const close = closingParen(text, call + method[2].length - 1)
    if (close < 0) return null
    return `${text.slice(0, call)}[${entry} ...${text.slice(call, close + 1)}]${text.slice(close + 1)}`
  }
  const at = open.index + open[0].length
  const indent = /^\r?\n([ \t]*)\S/.exec(text.slice(at))?.[1]
  return indent === undefined ? `${text.slice(0, at)}${entry} ${text.slice(at)}` : `${text.slice(0, at)}\n${indent}${entry}${text.slice(at)}`
}

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

// A script, source or test that calls Bun.build.
const bunBuild = /\bBun\.build\s*\(/
// A $ template that names tsc: a script whose Bun shell may run it
// (replaceTscInScript decides).
const shellTsc = /\$`[^`]*\btsc\b/
const scriptFile = /\.(?:ts|mts|js|mjs)$/

/** The files of a package that call Bun.build: its files outside nested packages, dependencies and output. */
function bunBuildFiles(root, dir) {
  const files = []
  const walk = (at) => {
    for (const entry of readdirSync(join(root, at), { withFileTypes: true })) {
      const path = at === "." ? entry.name : posix.join(at, entry.name)
      if (entry.isDirectory()) {
        if (!skippedDirectory(entry.name) && entry.name !== "dist" && !existsSync(join(root, path, "package.json"))) walk(path)
      } else if (scriptFile.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        const text = readFileSync(join(root, path), "utf8")
        if (bunBuild.test(text) || shellTsc.test(text)) files.push(path)
      }
    }
  }
  walk(dir)
  return files
}

/**
 * Adds vibelang-unplugin/bun to each Bun.build in a package that reaches
 * migrated sources (packagesReaching), in its scripts and sources, and gives
 * the package the plugin and the compiler it needs. A test, a fixture and a
 * file only tests import stay as they are, with a warning (decided detail
 * 272: setup never edits a test or the bundler configuration it embeds). A
 * file with a call whose shape addBunBuildPlugin does not know is left as it
 * is, with a warning that names the call's line. Returns the files changed,
 * the warnings and the scripts wired.
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
    const files = bunBuildFiles(root, pkg.dir)
    const testOnly = files.length ? testOnlyScripts(root, pkg.dir, packageScripts(root, pkg.dir), JSON.parse(readFileSync(join(root, pkg.dir, "package.json"), "utf8"))) : new Set()
    for (const file of files) {
      if (testOnly.has(file)) {
        warnings.push(`${file}: ${testLeftAsIs("Bun.build")}`)
        continue
      }
      // A build script that only runs tsc, such as codemode's
      // $`bun tsc -p tsconfig.build.json`, which wrote dist/index.js importing
      // ./codemode.vibe (opencode-47), needs vibelang alone.
      if (!bunBuild.test(readFileSync(join(root, file), "utf8"))) {
        const original = readFileSync(join(root, file), "utf8")
        const text = replaceTscInScript(original, ts)
        if (text === original) continue
        write(file, text)
        const manifest = posix.join(pkg.dir, "package.json")
        const current = JSON.parse(readFileSync(join(root, manifest), "utf8"))
        if (!current.dependencies?.vibelang && !current.devDependencies?.vibelang && specs.vibelang) {
          write(manifest, JSON.stringify({ ...current, devDependencies: { ...current.devDependencies, vibelang: specs.vibelang } }, null, 2) + "\n")
        }
        continue
      }
      if (!specs["vibelang-unplugin"]) {
        warnings.push(`${file}: this toolchain has no vibelang-unplugin; rebuild the toolchain to wire Bun.build`)
        continue
      }
      const original = readFileSync(join(root, file), "utf8")
      // The script's own tsc runs compile its .vibe modules too, whether or not its Bun.build is wired yet.
      const text = replaceTscInScript(original, ts)
      if (text !== original) write(file, text)
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

/**
 * The projects a package's tsconfig stands for, relative to the package: the
 * tsconfig itself, or, for a solution-style one that lists no files of its
 * own ("files": [] with references), each project it references, as tsc -b
 * builds them; a reference to a directory names its tsconfig.json. ts is
 * TypeScript's compiler API.
 */
export function projectsOf(ts, dir, tsconfig) {
  const { config } = ts.readConfigFile(join(dir, tsconfig), (path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined))
  if (!config || !Array.isArray(config.files) || config.files.length || !Array.isArray(config.references) || !config.references.length) return [tsconfig]
  return config.references.map((reference) => {
    const target = posix.normalize(posix.join(posix.dirname(tsconfig), reference.path))
    return existsSync(join(dir, target)) && statSync(join(dir, target)).isDirectory() ? posix.join(target, "tsconfig.json") : target
  })
}

const installs = {
  pnpm: "pnpm install --no-frozen-lockfile",
  bun: "bun install",
  yarn: "yarn install",
  npm: "npm install"
}

/** Each lockfile a repository may keep beside its package manager's, with the manager that owns it and the command that rewrites it without installing. */
const lockfileRefreshes = [
  ["bun.lock", "bun", "bun install --lockfile-only"],
  ["bun.lockb", "bun", "bun install --lockfile-only"],
  ["package-lock.json", "npm", "npm install --package-lock-only --ignore-scripts"]
]

/**
 * The command that installs after the edits, letting the lockfile change,
 * then rewrites each other lockfile among files, the repository root's
 * entries, which the install leaves stale: Smithers keeps bun.lock beside
 * pnpm-lock.yaml and gates their parity.
 */
export function installCommand(manager, files = []) {
  const refreshes = lockfileRefreshes.filter(([file, owner]) => owner !== manager && files.includes(file)).map(([, , command]) => command)
  return [installs[manager], ...new Set(refreshes)].join(" && ")
}

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
