// Developer tools must include .vibe in their existing commands.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, posix } from "node:path"

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
  const all = files(root)
  const manifests = all.filter(file => posix.basename(file) === "package.json")
  let needsCompiler = false, needsLint = false
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
      if (/(^|[\s;&|])(?:oxlint\b|vp\s+lint\b)/.test(command) && !command.includes("eslint.config.mjs")) {
        next = `(${next}) && eslint --config ${up}.vibelang/eslint.config.mjs "**/*.vibe" --no-error-on-unmatched-pattern`
        needsCompiler = true; needsLint = true
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
  if (needsLint) write(".vibelang/eslint.config.mjs", `import { existsSync, readFileSync } from "node:fs"
import parser from "vibelang/eslint"
// The repository's Oxlint configuration, read on each run: its rules and its
// overrides (a *.ts glob read as *.vibe) apply to .vibe files wherever ESLint
// or typescript-eslint has the rule. typescript-eslint's recommended rules
// stand in for Oxlint's default correctness rules unless the configuration
// turns that category off. Rules of other Oxlint plugins are not carried.
const read = (name) => {
  const url = new URL("../" + name, import.meta.url)
  return existsSync(url) ? readFileSync(url, "utf8") : null
}
const text = read(".oxlintrc.json") ?? read(".oxlintrc.jsonc")
const oxlint = text ? JSON.parse(text.replace(/("(?:\\\\.|[^"\\\\])*")|\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*/g, (all, string) => string ?? "").replace(/,(\\s*[}\\]])/g, "$1")) : {}
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
  return []
}))
const vibe = (glob) => glob.replace(/\\.\\{([^}]*)\\}$/, (all, list) => list.split(",").some((e) => /^[cm]?tsx?$/.test(e.trim())) ? ".vibe" : all).replace(/\\.[cm]?tsx?$/, ".vibe")
const overrides = (oxlint.overrides ?? [])
  .map((override) => ({ files: [override.files].flat().filter((glob) => vibe(glob) !== glob).map(vibe), rules: rules(override.rules) }))
  .filter((override) => override.files.length && Object.keys(override.rules).length)
const correctness = levels[oxlint.categories?.correctness] !== "off"
export default [
  { ignores: ["**/node_modules/**", "**/dist/**", "**/build/**"] },
  ...(correctness && tseslint ? tseslint.configs.recommended.map((config) => ({ ...config, files: ["**/*.vibe"] })) : []),
  { files: ["**/*.vibe"], languageOptions: { parser }, ...(tseslint ? { plugins: { "@typescript-eslint": tseslint.plugin } } : {}), rules: { "no-debugger": "error", ...rules(oxlint.rules) } },
  ...overrides
]
`)
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
