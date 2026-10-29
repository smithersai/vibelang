// The edits that set up VibeLang in an existing project, as text-in,
// text-out functions: the package's dependencies, tsc replaced by vibelang
// in scripts, the vibelang-vite plugin in the Vitest or Vite config, the
// compiler option that lets .vibe files import local modules by their source
// names, and the settings that let every TypeScript checker read a .vibe
// module through its declaration sidecar. Each keeps the file's own
// formatting outside the lines it changes.
// wireVite applies the plugin edit to the config files the tests load. The
// Effect upgrade before setup is upgrade.mjs. initAgents sets the target's
// coding agents up with the vibelang it installed.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, posix } from "node:path"
import { must, quote } from "./util.mjs"

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
 * rules, adds error TS6231: Could not resolve the path 'lint' with the extensions: '.ts', '.tsx', '.d.ts', '.vibe', '.cts', '.d.cts', '.mts', '.d.mts'.
  The file is in the program because:
    Root file specified for compilation with the same configuration, --deny-warnings and
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

/** Adds the VibeLang packages: the runtime as a dependency, the compiler and plugin as dev dependencies. */
export function addVibeLang(pkg, specs) {
  const next = addVibeLangPlugin(pkg, specs)
  next.dependencies = { ...next.dependencies, "vibelang-runtime": specs["vibelang-runtime"] }
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
 * defineConfig with an object literal, first in that object's own plugins,
 * never in a nested option's (a `lint: { plugins: [...] }`). ts is
 * TypeScript's compiler API. Returns the text unchanged when the plugin is
 * already there; throws when the config has a shape this edit does not know,
 * so a person wires it instead.
 */
export function addVitePlugin(text, ts) {
  if (/from\s+['"]vibelang-vite['"]/.test(text)) return text
  const source = ts.createSourceFile("vite.config.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let config
  const find = (node) => {
    if (config) return
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "defineConfig" && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) config = node.arguments[0]
    else ts.forEachChild(node, find)
  }
  find(source)
  if (!config) throw new Error("the config does not call defineConfig({ ... }); add vibelang() from vibelang-vite to its plugins by hand")
  const plugins = config.properties.find((p) => p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === "plugins")
  let plugin
  if (plugins) {
    if (!ts.isPropertyAssignment(plugins) || !ts.isArrayLiteralExpression(plugins.initializer)) throw new Error("the config's plugins is not an array literal; add vibelang() from vibelang-vite to it by hand")
    const list = plugins.initializer
    plugin = list.elements.length ? { at: list.elements[0].getStart(source), text: "vibelang(), " } : { at: list.getStart(source) + 1, text: "vibelang()" }
  } else {
    const at = config.getStart(source) + 1
    const indent = /\n([ \t]+)\S/.exec(text.slice(at))?.[1] ?? "  "
    plugin = { at, text: `\n${indent}plugins: [vibelang()],` }
  }
  // The import goes on the line after the last import, in the file's quote and semicolon style.
  const lastImport = source.statements.filter((s) => ts.isImportDeclaration(s)).at(-1)
  const quote = /from\s+'/.test(text) ? "'" : '"'
  const semicolon = lastImport && text.slice(lastImport.getStart(source), lastImport.end).trimEnd().endsWith(";") ? ";" : ""
  const lineEnd = lastImport ? text.indexOf("\n", lastImport.end) : -1
  const importAt = lastImport ? (lineEnd < 0 ? text.length : lineEnd + 1) : 0
  const line = `${lastImport && lineEnd < 0 ? "\n" : ""}import vibelang from ${quote}vibelang-vite${quote}${semicolon}\n`
  let out = text
  for (const edit of [{ at: importAt, text: line }, plugin].sort((a, b) => b.at - a.at)) out = out.slice(0, edit.at) + edit.text + out.slice(edit.at)
  return out
}

const viteConfigNames = ["vitest.config.ts", "vitest.config.mts", "vitest.config.js", "vitest.config.mjs", "vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"]

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
  const write = (file, before, after) => {
    if (before === after) return
    writeFileSync(join(root, file), after)
    changed.push(file)
  }
  const wire = (file) => {
    const text = readFileSync(join(root, file), "utf8")
    write(file, text, addVitePlugin(text, ts))
    let owner = posix.dirname(file)
    while (owner !== "." && !existsSync(join(root, owner, "package.json"))) owner = posix.dirname(owner)
    const manifest = posix.join(owner, "package.json")
    const before = readFileSync(join(root, manifest), "utf8")
    write(manifest, before, JSON.stringify(addVibeLangPlugin(JSON.parse(before), specsFor(owner)), null, 2) + "\n")
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
    if (!name) {
      warnings.push(`${pkg.dir}: no Vite or Vitest config, so the tests load no .vibe module unless their runner is set up for VibeLang`)
      continue
    }
    configs.push(posix.join(pkg.dir, name))
    wire(posix.join(pkg.dir, name))
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
 * The repository's tsconfig files (tsconfig*.json, outside node_modules and
 * hidden directories) that extend none of the others, as repository-relative
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
 * The dependency specifiers of a package at packageDir (relative to the
 * repository root) for tarballs in the root's toolchain directory:
 * file:../../.vibelang-toolchain/vibelang-0.0.11.tgz from packages/x.
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
