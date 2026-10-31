// Developer tools must include .vibe in their existing commands.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, posix } from "node:path"
import { ownedPaths } from "./wire.mjs"

function vibeSelectors(text) {
  let selectors = false
  const extension = value => value
    .replace(/\.\{([^}]+)\}/g, (whole, list) => {
      const parts = list.split(",").map(part => part.trim())
      if (!parts.some(part => /^(?:[cm]?ts|tsx)$/i.test(part))) return whole
      const mapped = [...new Set(parts.map(part => /^(?:[cm]?ts|tsx)$/i.test(part) ? "vibe" : part))]
      return mapped.length === 1 ? "." + mapped[0] : ".{" + mapped.join(",") + "}"
    })
    .replace(/\.(?:[cm]?ts|tsx)\b/gi, ".vibe")
  return text.split("\n").map(line => {
    if (/^[^\s#]/.test(line)) selectors = /^(?:files|ignores):/.test(line)
    return selectors ? extension(line) : line
  }).join("\n")
}

// oxlintPasses reads each oxlint invocation in a script: the configuration it
// names with -c or --config (null for the default, .oxlintrc.json) and the
// paths it lints (none for the working directory). vp lint reads the default.
//
//   oxlint --config .oxlintrc.app.json --disable-nested-config examples src
//   -> [{ config: ".oxlintrc.app.json", paths: ["examples", "src"] }]
const oxlintValueFlags = new Set(["-c", "--config", "--tsconfig", "-A", "--allow", "-W", "--warn", "-D", "--deny", "--ignore-path", "--ignore-pattern", "-f", "--format", "--max-warnings", "--threads", "--report-unused-disable-directives-severity"])
export function oxlintPasses(command) {
  const passes = []
  for (const match of command.matchAll(/(?:^|[\s;&|(])(oxlint|vp\s+lint)\b((?:[ \t]+(?!&&|\|\||;)[^\s;&|()]+)*)/g)) {
    let config = null
    const paths = []
    const words = match[1] === "oxlint" ? match[2].trim().split(/\s+/).filter(Boolean) : []
    for (let i = 0; i < words.length; i++) {
      const word = words[i]
      if (word === "-c" || word === "--config") config = words[++i] ?? null
      else if (word.startsWith("--config=")) config = word.slice("--config=".length)
      else if (oxlintValueFlags.has(word)) i++
      else if (!word.startsWith("-")) paths.push(word)
    }
    passes.push({ config, paths })
  }
  return passes
}

// eslintConfigName is the .vibelang file of the ESLint configuration that
// carries the Oxlint configuration at path: .oxlintrc.app.json is
// eslint.app.config.mjs.
export function eslintConfigName(path) {
  const name = path.replace(/(^|\/)\.?oxlintrc\.?/, "$1").replace(/\.jsonc?$/, "")
  return "eslint." + (name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "default") + ".config.mjs"
}

const skipped = new Set(["node_modules", ".git", ".jj", "dist", "build", ".vibelang-toolchain", ".vibelang", ".repos", ".cache", ".turbo"])
function files(root, dir = "") {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const path = posix.join(dir, entry.name)
    return entry.isDirectory() ? skipped.has(entry.name) ? [] : files(root, path) : [path]
  })
}
export function wireDeveloperTools({ root, specsFor }) {
  const changed = [], builds = []
  const write = (file, text) => {
    if (existsSync(join(root, file)) && readFileSync(join(root, file), "utf8") === text) return
    mkdirSync(posix.dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text); changed.push(file)
  }
  // Only the repository's own packages: a vendored tree keeps its scripts and configs.
  const all = files(root).filter(ownedPaths(root))
  const manifests = all.filter(file => posix.basename(file) === "package.json")
  let needsCompiler = false, needsLint = false
  const lintConfigs = new Map() // .vibelang file -> the Oxlint configuration a script names with -c
  for (const file of manifests) {
    const before = readFileSync(join(root, file), "utf8")
    const pkg = JSON.parse(before)
    const original = JSON.stringify(pkg)
    const dir = posix.dirname(file)
    const up = dir === "." ? "" : "../".repeat(dir.split("/").length)
    for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
      let next = command
      if (/(^|[\s;&|])(?:oxfmt\b|vp\s+fmt\b)/.test(command) && !command.includes("vibelang-format")) {
        next = `(${command}) && vibelang-format ${/--check\b|--list-different\b/.test(command) ? "--check" : "--write"}`
        needsCompiler = true
      }
      if (/(^|[\s;&|])prettier\b/.test(command) && !command.includes("vibelang/prettier")) {
        next = next.replace(/\bprettier\b/, "prettier --plugin vibelang/prettier")
        needsCompiler = true
      }
      if (/(^|[\s;&|])(?:oxlint\b|vp\s+lint\b)/.test(command)) {
        // The config is the output of this flow, so a run on a new toolchain writes it again.
        needsCompiler = true; needsLint = true
        const passes = oxlintPasses(command).map(({ config, paths }) => {
          const rooted = config === null ? null : posix.normalize(posix.join(dir, config))
          const file = rooted === null || rooted === ".oxlintrc.json" ? "eslint.config.mjs" : eslintConfigName(rooted)
          if (file !== "eslint.config.mjs") lintConfigs.set(file, rooted)
          return `eslint --config ${up}.vibelang/${file} ${paths.length ? paths.join(" ") : '"**/*.vibe"'} --no-error-on-unmatched-pattern`
        })
        if (!command.includes("eslint.config.mjs")) next = `(${next}) && ${[...new Set(passes)].join(" && ")}`
      }
      if (next !== command) pkg.scripts[name] = next
    }
    if (pkg.prettier && typeof pkg.prettier === "object") {
      pkg.prettier.plugins = [...new Set([...(pkg.prettier.plugins ?? []), "vibelang/prettier"])]
      needsCompiler = true
    }
    // A script that loads the root ESLint config needs nothing of its own: the
    // config resolves vibelang/eslint from the root, which gets vibelang below.
    if (needsCompiler && pkg.scripts && Object.values(pkg.scripts).some(c => /vibelang-format|vibelang\/prettier/.test(c))) {
      pkg.devDependencies = { ...pkg.devDependencies, vibelang: specsFor(dir).vibelang }
    }
    if (JSON.stringify(pkg) !== original) write(file, JSON.stringify(pkg, null, 2) + "\n")
  }
  // JSON Prettier configurations cover editor invocations too.
  for (const file of all.filter(f => /(^|\/)(?:\.prettierrc(?:\.json)?|prettier\.config\.json)$/.test(f))) {
    const config = JSON.parse(readFileSync(join(root, file), "utf8"))
    config.plugins = [...new Set([...(config.plugins ?? []), "vibelang/prettier"])]
    write(file, JSON.stringify(config, null, 2) + "\n")
    needsCompiler = true
  }
  for (const file of all.filter(f => /(^|\/)dprint\.json$/.test(f))) {
    const config = JSON.parse(readFileSync(join(root, file), "utf8"))
    const plugins = config.plugins ?? []
    config.plugins = [...new Set([...plugins, ...plugins.some(p => /typescript.*\.wasm/.test(p)) ? [] : ["https://plugins.dprint.dev/typescript-0.93.4.wasm@cdbf74066391bdb11ddaef9ea95299636a97d637f5a9bf7f121d584875647c7a"], "npm:vibelang/dprint-plugin.json"])]
    config.includes = [...new Set([...(config.includes ?? ["**/*"]), "**/*.vibe"])]
    write(file, JSON.stringify(config, null, 2) + "\n")
    needsCompiler = true
  }
  for (const file of all.filter(f => /(?:^|\/)(?:\.vite-hooks|\.husky)\/pre-commit$/.test(f))) {
    const text = readFileSync(join(root, file), "utf8")
    if (/\bvp staged\b/.test(text) && !text.includes("vibelang-format")) {
      write(file, text.replace(/\bvp staged\b/, 'vp staged && node node_modules/vibelang/bin/vibelang-format --check'))
      needsCompiler = true
    }
  }
  const eslintConfig = (oxlintrc) => `import { existsSync, readFileSync } from "node:fs"
import parser from "vibelang/eslint"
// ${oxlintrc ? "The Oxlint configuration " + oxlintrc + ", which a lint script names with -c," : "The repository's Oxlint configuration,"} read on each run: its rules and its
// overrides (a *.ts glob read as *.vibe) apply to .vibe files wherever ESLint,
// typescript-eslint or one of the configuration's JS plugins has the rule.
// typescript-eslint's recommended rules stand in for Oxlint's default
// correctness rules unless the configuration turns that category off. Rules of
// Oxlint's other built-in plugins, such as unicorn, are not carried.
const read = (name) => {
  const url = new URL("../" + name, import.meta.url)
  return existsSync(url) ? readFileSync(url, "utf8") : null
}
const text = ${oxlintrc ? "read(" + JSON.stringify(oxlintrc) + ")" : 'read(".oxlintrc.json") ?? read(".oxlintrc.jsonc")'}
const base = new URL("../" + ${JSON.stringify(oxlintrc && posix.dirname(oxlintrc) !== "." ? posix.dirname(oxlintrc) + "/" : "")}, import.meta.url)
const oxlint = text ? JSON.parse(text.replace(/("(?:\\\\.|[^"\\\\])*")|\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*/g, (all, string) => string ?? "").replace(/,(\\s*[}\\]])/g, "$1")) : {}
// An Oxlint JS plugin is an ESLint plugin. Each loads as Oxlint loads it: a
// path from the configuration's directory, else a package, named by its alias,
// else by its meta.name or package name less an eslint-plugin or oxlint-plugin
// prefix. Its rules read a .vibe file's source tree as they read a .ts file's.
const pluginName = (name, specifier) => {
  if (typeof name !== "string") throw new Error(specifier + ": Oxlint names a JS plugin by its alias, its meta.name or its package name, and this one has none")
  const slash = name.indexOf("/")
  const scope = slash === -1 ? "" : name.slice(0, slash + 1)
  const rest = name.slice(scope.length)
  for (const prefix of ["eslint-plugin", "oxlint-plugin"]) {
    if (scope && rest === prefix) return scope.slice(0, -1)
    if (rest.startsWith(prefix + "-")) return scope + rest.slice(prefix.length + 1)
  }
  return name
}
// A rule written for Oxlint's createOnce API runs as Oxlint's
// eslintCompatPlugin runs it under ESLint: once per file.
const eslintRule = (rule) => rule.create || !rule.createOnce ? rule : {
  ...rule,
  create(context) {
    const { before, after, ...visitor } = rule.createOnce(context)
    if (before && before() === false) return {}
    if (!after) return visitor
    const exit = visitor["Program:exit"]
    return { ...visitor, "Program:exit"(node) { if (exit) exit(node); after() } }
  }
}
const jsPlugins = new Map(await Promise.all((oxlint.jsPlugins ?? []).map(async (entry) => {
  const { name, specifier } = typeof entry === "string" ? { specifier: entry } : entry
  const local = /^(?:\\.\\.?)?\\//.test(specifier)
  const module = await import(local ? new URL(specifier, base).href : specifier)
  const plugin = module.default ?? module
  const packageName = local ? undefined : specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/")
  const rules = Object.fromEntries(Object.entries(plugin.rules ?? {}).map(([rule, definition]) => [rule, eslintRule(definition)]))
  return [name ?? pluginName(plugin.meta?.name ?? packageName, specifier), { ...plugin, rules }]
})))
// typescript-eslint refuses TypeScript 7, so its rules join only where it loads.
const tseslint = await import("typescript-eslint").then(({ default: loaded }) => loaded, () => null)
const core = await import("eslint/use-at-your-own-risk").then(({ builtinRules }) => builtinRules, () => null)
const typed = new Set(Object.keys(tseslint?.plugin?.rules ?? {}))
const levels = { allow: "off", deny: "error", off: "off", warn: "warn", error: "error", 0: "off", 1: "warn", 2: "error" }
const rules = (settings = {}) => Object.fromEntries(Object.entries(settings).flatMap(([name, setting]) => {
  const [level, ...options] = [setting].flat()
  const value = [levels[level] ?? level, ...options]
  const plugin = name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : ""
  const rule = name.slice(name.lastIndexOf("/") + 1)
  // A core rule typescript-eslint extends for TypeScript, as Oxlint's does, is typescript-eslint's.
  if (plugin === "typescript" || plugin === "@typescript-eslint" || ((plugin === "" || plugin === "eslint") && typed.has(rule))) return typed.has(rule) ? [["@typescript-eslint/" + rule, value]] : []
  if (plugin === "" || plugin === "eslint") return !core || core.has(rule) ? [[rule, value]] : []
  return jsPlugins.get(plugin)?.rules[rule] ? [[name, value]] : []
}))
const vibe = (glob) => glob.replace(/\\.\\{([^}]*)\\}$/, (all, list) => list.split(",").some((e) => /^[cm]?tsx?$/.test(e.trim())) ? ".vibe" : all).replace(/\\.[cm]?tsx?$/, ".vibe")
const overrides = (oxlint.overrides ?? [])
  .map((override) => ({ files: [override.files].flat().filter((glob) => vibe(glob) !== glob).map(vibe), rules: rules(override.rules) }))
  .filter((override) => override.files.length && Object.keys(override.rules).length)
const correctness = levels[oxlint.categories?.correctness] !== "off"
export default [
  { ignores: ["**/node_modules/**", "**/dist/**", "**/build/**"] },
  ...(correctness && tseslint ? tseslint.configs.recommended.map((config) => ({ ...config, files: ["**/*.vibe"] })) : []),
  { files: ["**/*.vibe"], languageOptions: { parser }, plugins: { ...(tseslint ? { "@typescript-eslint": tseslint.plugin } : {}), ...Object.fromEntries(jsPlugins) }, rules: { "no-debugger": "error", ...rules(oxlint.rules) } },
  ...overrides
]
`
  if (needsLint) write(".vibelang/eslint.config.mjs", eslintConfig(null))
  for (const [file, oxlintrc] of lintConfigs) write(".vibelang/" + file, eslintConfig(oxlintrc))
  for (const file of all.filter(f => /(^|\/)sgconfig\.ya?ml$/.test(f))) {
    let config = readFileSync(join(root, file), "utf8")
    const dir = posix.dirname(file)
    const library = ".vibelang/vibelang-parser"
    if (!/^  VibeLang:/m.test(config)) {
      const entry = `  VibeLang:\n    libraryPath: ${library}\n    languageSymbol: tree_sitter_vibe\n    extensions: [vibe]\n    expandoChar: µ\n`
      config = /^customLanguages:\s*$/m.test(config) ? config.replace(/^customLanguages:\s*$/m, "customLanguages:\n" + entry.trimEnd()) : config.trimEnd() + "\ncustomLanguages:\n" + entry
      write(file, config)
    }
    // Rules are selected by language. Registering the extension alone does
    // not apply the repo's existing TS rules, so clone those beside them.
    for (const rule of all.filter(f => f.startsWith(dir === "." ? "" : dir + "/") && /\.ya?ml$/.test(f) && f !== file && !f.endsWith(".vibelang.yml"))) {
      let text = readFileSync(join(root, rule), "utf8")
      const language = /^language:[ \t]*(["']?)(?:typescript|tsx|ts)\1[ \t]*(?:#.*)?$/im
      if (!language.test(text)) continue
      text = vibeSelectors(text.replace(language, "language: VibeLang"))
        .replace(/^id:\s*(.+)$/m, "id: $1-vibelang")
      write(rule.replace(/\.ya?ml$/, ".vibelang.yml"), text)
    }
    builds.push({ cwd: dir, command: `node ${posix.relative(dir, ".") ? posix.relative(dir, ".") + "/" : ""}node_modules/vibelang/bin/vibelang-ast-grep ${library}` })
    needsCompiler = true
  }
  if (builds.length) {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    const commands = builds.map(b => `(cd ${b.cwd} && ${b.command})`).join(" && ")
    const previous = pkg.scripts?.postinstall ?? ""
    if (!previous.includes("vibelang-ast-grep")) {
      pkg.scripts = { ...pkg.scripts, postinstall: previous ? `(${previous}) && ${commands}` : commands }
      write("package.json", JSON.stringify(pkg, null, 2) + "\n")
    }
    const ignore = existsSync(join(root, ".gitignore")) ? readFileSync(join(root, ".gitignore"), "utf8") : ""
    if (!ignore.includes("**/.vibelang/vibelang-parser")) write(".gitignore", ignore.trimEnd() + "\n**/.vibelang/vibelang-parser\n")
  }
  if (needsCompiler) {
    const path = "package.json"
    const pkg = JSON.parse(readFileSync(join(root, path), "utf8"))
    pkg.devDependencies = { ...pkg.devDependencies, vibelang: specsFor(".").vibelang }
    if (needsLint) Object.assign(pkg.devDependencies, { eslint: "^9.39.5", "typescript-eslint": "^8.69.0" })
    write(path, JSON.stringify(pkg, null, 2) + "\n")
  }
  return { changed: [...new Set(changed)], builds }
}
