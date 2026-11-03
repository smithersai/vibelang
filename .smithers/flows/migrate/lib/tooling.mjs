// Developer tools must include .vibe in their existing commands.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, posix } from "node:path"
import { wireSourceChildren } from "./source-children.mjs"
import { wireRolldownSources } from "./rolldown-builds.mjs"
import { wireOxlint } from "./oxlint.mjs"
import { addEslintIgnore, addEslintImportParsers, emittedIgnore, ownedPaths, sidecarIgnore } from "./wire.mjs"
import { wireNodeSourceHooks } from "./node-hooks.mjs"
import { wireTsdownConfigs } from "./tsdown.mjs"

// An ast-grep rule's ignores gain the declaration sidecars, x.d.vibe.ts, which
// a TypeScript rule otherwise scans as TypeScript, reporting each finding of a
// .vibe module twice (opencode's lint:effect-patterns). sidecarIgnoreOf
// writes the entry once; withoutSidecarIgnore takes back exactly what it wrote.
const sidecarPattern = `"**/${sidecarIgnore}"`
export function sidecarIgnoreOf(text) {
  if (text.includes(sidecarPattern)) return text
  const flow = /^ignores:[ \t]*\[/m.exec(text)
  if (flow) return text.slice(0, flow.index + flow[0].length) + sidecarPattern + (/^ignores:[ \t]*\[[ \t]*\]/m.test(text) ? "" : ", ") + text.slice(flow.index + flow[0].length)
  const block = /^ignores:[ \t]*(?:#.*)?\n([ \t]*)- /m.exec(text)
  if (block) {
    const at = block.index + block[0].length - block[1].length - 2
    return text.slice(0, at) + `${block[1]}- ${sidecarPattern}\n` + text.slice(at)
  }
  // Appended in the file's own ending: a final newline only where it had one.
  return text === "" || text.endsWith("\n") ? `${text}ignores:\n  - ${sidecarPattern}\n` : `${text}\nignores:\n  - ${sidecarPattern}`
}
const escaped = sidecarPattern.replace(/[.*]/g, "\\$&")
export function withoutSidecarIgnore(text) {
  return text
    .replace(new RegExp(`(^|\\n)ignores:\\n  - ${escaped}\\n$`), "$1")
    .replace(new RegExp(`\\nignores:\\n  - ${escaped}$`), "")
    .replace(new RegExp(`^[ \\t]*- ${escaped}\\n`, "m"), "")
    .replace(`${sidecarPattern}, `, "")
    .replace(`[${sidecarPattern}]`, "[]")
}

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
    const invocationWords = match[2].trim().split(/\s+/).filter(Boolean)
    const separator = invocationWords.indexOf("--")
    const optionWords = invocationWords.slice(0, separator < 0 ? undefined : separator)
    const denyWarnings = optionWords.some((word, i) => word === "--deny-warnings" || word === "--max-warnings=0" || word === "--max-warnings" && optionWords[i + 1] === "0")
    const words = match[1] === "oxlint" ? invocationWords : []
    for (let i = 0; i < words.length; i++) {
      const word = words[i]
      if (word === "-c" || word === "--config") config = words[++i] ?? null
      else if (word.startsWith("--config=")) config = word.slice("--config=".length)
      else if (oxlintValueFlags.has(word)) i++
      else if (!word.startsWith("-")) paths.push(word)
    }
    passes.push({ config, paths, ...(denyWarnings ? { denyWarnings: true } : {}) })
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
/** String extension allowlists need native sources too; report their literal's location without guessing a rewrite. */
export function extensionAllowlistWarnings(ts, text, file) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.getScriptKindFromFileName(file))
  const warnings = []
  const visit = node => {
    if (ts.isArrayLiteralExpression(node) && node.elements.length &&
        node.elements.every(e => ts.isStringLiteralLike(e) && /^\.[a-zA-Z][a-zA-Z0-9.]*$/.test(e.text))) {
      const literal = node.elements.find(e => e.text === ".ts")
      if (literal && !node.elements.some(e => e.text === ".vibe")) {
        const line = source.getLineAndCharacterOfPosition(literal.getStart(source)).line + 1
        warnings.push(`${file}:${line}: source-extension allowlist includes ".ts" but omits ".vibe"; include ".vibe" and exclude generated ".d.vibe.ts" sidecars`)
      }
    }
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      const literal = node.getText(source)
      const slash = literal.lastIndexOf("/")
      const pattern = literal.slice(1, slash)
      // Probe only literal extension patterns. Remove stateful flags so one test
      // cannot influence the next. This never evaluates repository JavaScript.
      if (pattern.includes("\\.") || pattern.includes("[.]")) {
        try {
          const re = new RegExp(pattern, literal.slice(slash + 1).replace(/[gy]/g, ""))
          const extensions = ["ts", "tsx", "mts", "cts", "mtsx", "ctsx"]
          if (extensions.some(ext => re.test("x." + ext)) && !re.test("x.vibe")) {
            const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
            warnings.push(file + ":" + line + ': source-extension regex accepts TypeScript but omits ".vibe"; include ".vibe" and exclude generated ".d.vibe.ts" sidecars')
          }
        } catch { /* Malformed regexes belong to the source parser's diagnostics. */ }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return warnings
}

// Keep Oxlint's ordered patterns and each migrated source counterpart.
// Oxlint supports brace globs and permits negations below ignored directories;
// ESLint needs descendant patterns and explicit traversal to do the same.
function nativeIgnorePatterns(patterns) {
  const convert = value => {
    const negative = value.startsWith("!")
    let pattern = negative ? value.slice(1) : value
    const slash = pattern.indexOf("/")
    if (slash < 0 || slash === pattern.length - 1) pattern = "**/" + pattern
    else if (slash === 0) pattern = pattern.slice(1)
    // Parentheses are literal in Oxlint, not minimatch extglobs.
    let escaped = ""
    for (let i = 0; i < pattern.length; i++) {
      const char = pattern[i]
      if (char === "\\" && i + 1 < pattern.length) escaped += char + pattern[++i]
      else escaped += char === "(" ? "\\(" : char
    }
    if (escaped.endsWith("/")) escaped += "**/*"
    else if (escaped.endsWith("/**")) escaped += "/*"
    const prefix = negative ? "!" : ""
    return [prefix + escaped, prefix + escaped + "/**/*"]
  }
  return patterns.flatMap(pattern => {
    if (pattern === "") return []
    const native = pattern
      .replace(/\.\{([^{}]+)\}$/, (whole, list) => {
        const parts = list.split(",")
        if (!parts.some(part => /^(?:[cm]?ts|tsx)$/.test(part))) return whole
        const mapped = [...new Set(parts.map(part => /^(?:[cm]?ts|tsx)$/.test(part) ? "vibe" : part))]
        return mapped.length === 1 ? "." + mapped[0] : ".{" + mapped.join(",") + "}"
      })
      .replace(/\.(?:[cm]?ts|tsx)$/, ".vibe")
    const mapped = [...new Set([pattern, native])].flatMap(convert)
    if (!pattern.startsWith("!")) return mapped
    // Reopen only ancestors the negated glob can reach. A fixed prefix
    // must not force traversal through every unrelated ignored directory.
    const ancestors = []
    for (const value of mapped) {
      const parts = value.slice(1).split("/")
      for (let i = 1; i < parts.length; i++) ancestors.push("!" + parts.slice(0, i).join("/") + "/")
    }
    return [...new Set(ancestors), ...mapped]
  })
}

// commandAt matches a script that runs one of words: at its start, after a
// separator, or opening a subshell, (oxlint --fix).
const commandAt = (words) => new RegExp(String.raw`(?:^|[\s;&|(])(?:${words})\b`)
// group parenthesizes a script once: (oxlint) stays (oxlint), but (a) && (b)
// becomes ((a) && (b)).
function group(script) {
  if (script.startsWith("(") && script.endsWith(")")) {
    let depth = 0
    for (let i = 0; i < script.length; i++) {
      depth += script[i] === "(" ? 1 : script[i] === ")" ? -1 : 0
      if (depth === 0) { if (i === script.length - 1) return script; break }
    }
  }
  return `(${script})`
}
// generatedPasses matches a lint script with the ESLint passes this function
// appends, (script) && eslint --config .vibelang/eslint.config.mjs paths
// --no-error-on-unmatched-pattern ...: a run on a new toolchain writes them
// again from the scripts oxlint invocations, so an older runs passes follow
// the configurations the script names with -c.
const generatedPasses = /^\((.*)\)((?: && eslint --config \S*\.vibelang\/eslint\.(?:[\w-]+\.)?config\.mjs(?: (?!--no-error)[^\s;&|]+)* --no-error-on-unmatched-pattern(?: --max-warnings(?:=| )0)?)+)$/
export function wireDeveloperTools({ root, specsFor, ts }) {
  const changed = [], builds = [], warnings = []
  const write = (file, text) => {
    if (existsSync(join(root, file)) && readFileSync(join(root, file), "utf8") === text) return
    mkdirSync(posix.dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text); changed.push(file)
  }
  // Only the repository's own packages: a vendored tree keeps its scripts and configs.
  const all = files(root).filter(ownedPaths(root))

  const manifests = all.filter(file => posix.basename(file) === "package.json")
  warnings.push(...wireNodeSourceHooks({ root, all, manifests, ts, specsFor, write }).warnings)
  warnings.push(...wireSourceChildren({ root, all, manifests, ts, specsFor, write }).warnings)
  warnings.push(...wireTsdownConfigs({ root, all, ts, specsFor, write }).warnings)
  warnings.push(...wireRolldownSources({ root, all, manifests, ts, specsFor, write }).warnings)
  const oxlint = wireOxlint({ root, all, manifests, ts, write })
  warnings.push(...oxlint.warnings)
  if (ts) for (const file of all.filter(f => /\.(?:[cm]?[jt]sx?|vibe|json)$/.test(f) && !/\.d\.(?:vibe\.)?[cm]?ts$/.test(f))) {
    warnings.push(...extensionAllowlistWarnings(ts, readFileSync(join(root, file), "utf8"), file))
  }
  // VibeLang's dprint plugin is an npm: specifier, which carries no checksum.
  // A dprint configuration that pins every plugin by checksum (Smithers'
  // DprintPlugins test requires it) keeps its plugin list, and the dprint
  // scripts it governs run vibelang-format after dprint instead.
  const dprintConfigs = all.filter(f => /(^|\/)dprint\.json$/.test(f))
  const pinned = new Set(dprintConfigs.filter(f => {
    const plugins = JSON.parse(readFileSync(join(root, f), "utf8")).plugins ?? []
    return plugins.length > 0 && plugins.every(p => /@[0-9a-f]{64}$/.test(p))
  }))
  const dprintConfigOf = dir => {
    for (let d = dir; ; d = posix.dirname(d)) {
      if (dprintConfigs.includes(posix.join(d, "dprint.json"))) return posix.join(d, "dprint.json")
      if (d === ".") return null
    }
  }
  let needsCompiler = oxlint.packages.length > 0, needsLint = oxlint.packages.length > 0, vpLint = false
  const lintConfigs = new Map() // .vibelang file -> the Oxlint configuration a script names with -c
  for (const file of manifests) {
    const before = readFileSync(join(root, file), "utf8")
    const pkg = JSON.parse(before)
    const original = JSON.stringify(pkg)
    const dir = posix.dirname(file)
    const up = dir === "." ? "" : "../".repeat(dir.split("/").length)
    for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
      // Every layer of passes a run wrote, (((oxlint) && pass) && pass) && pass
      // after reruns of the old setup, comes off; a pass after a command that
      // runs no oxlint is the repository's own and stays.
      let next = command
      for (let own; (own = generatedPasses.exec(next)) && commandAt(String.raw`oxlint|vp\s+lint`).test(own[1]); ) next = own[1]
      if (commandAt(String.raw`oxfmt|vp\s+fmt`).test(next) && !next.includes("vibelang-format")) {
        next = `${group(next)} && vibelang-format ${/--check\b|--list-different\b/.test(command) ? "--check" : "--write"}`
        needsCompiler = true
      }
      if (commandAt("prettier").test(next) && !next.includes("vibelang/prettier")) {
        next = next.replace(/\bprettier\b/, "prettier --plugin vibelang/prettier")
        needsCompiler = true
      }
      if (commandAt(String.raw`oxlint|vp\s+lint`).test(next)) {
        // The config is the output of this flow, so a run on a new toolchain writes it again.
        needsCompiler = true; needsLint = true
        if (commandAt(String.raw`vp\s+lint`).test(next)) vpLint = true
        const passes = oxlintPasses(next).map(({ config, paths, denyWarnings }) => {
          const rooted = config === null ? null : posix.normalize(posix.join(dir, config))
          const file = rooted === null || rooted === ".oxlintrc.json" ? "eslint.config.mjs" : eslintConfigName(rooted)
          if (file !== "eslint.config.mjs") lintConfigs.set(file, rooted)
          return `eslint --config ${up}.vibelang/${file} ${paths.length ? paths.map(path => path.replace(/[.]\{([^}]+)\}/g, (all, extensions) => extensions.split(",").some(ext => /^[cm]?tsx?$/.test(ext)) ? ".vibe" : all).replace(/[.][cm]?tsx?(?=["']?$)/g, ".vibe")).join(" ") : '"**/*.vibe"'} --no-error-on-unmatched-pattern${denyWarnings ? " --max-warnings 0" : ""}`
        })
        // A script that runs its own ESLint pass over .vibe keeps it.
        if (!/\.vibelang\/eslint\./.test(next)) next = `${group(next)} && ${[...new Set(passes)].join(" && ")}`
      }
      const dprint = /(?:^|[\s;&|(])dprint\s+(fmt|check)\b/.exec(next)
      if (dprint && pinned.has(dprintConfigOf(dir)) && !next.includes("vibelang-format")) {
        next = `${group(next)} && vibelang-format ${dprint[1] === "check" ? "--check" : "--write"}`
        needsCompiler = true
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
  for (const file of dprintConfigs) {
    const config = JSON.parse(readFileSync(join(root, file), "utf8"))
    if (!pinned.has(file)) {
      const plugins = config.plugins ?? []
      config.plugins = [...new Set([...plugins, ...plugins.some(p => /typescript.*\.wasm/.test(p)) ? [] : ["https://plugins.dprint.dev/typescript-0.93.4.wasm@cdbf74066391bdb11ddaef9ea95299636a97d637f5a9bf7f121d584875647c7a"], "npm:vibelang/dprint-plugin.json"])]
      config.includes = [...new Set([...(config.includes ?? ["**/*"]), "**/*.vibe"])]
      needsCompiler = true
    }
    // The declaration sidecars are vibelang's output, in its format.
    config.excludes = [...new Set([...(config.excludes ?? []), `**/${sidecarIgnore}`, emittedIgnore])]
    write(file, JSON.stringify(config, null, 2) + "\n")
  }
  if (pinned.size) warnings.push(`${pinned.size} dprint configuration${pinned.size === 1 ? " pins" : "s pin"} every plugin by checksum (${[...pinned].slice(0, 3).join(", ")}${pinned.size > 3 ? ", …" : ""}), and VibeLang's dprint plugin, npm:vibelang/dprint-plugin.json, has none: dprint leaves .vibe files there to vibelang-format, which their dprint scripts now run`)
  // ESLint lints x.d.vibe.ts as TypeScript wherever a files glob takes *.ts.
  for (const file of all.filter(f => /(^|\/)eslint\.config\.[cm]?[jt]s$/.test(f))) {
    const text = readFileSync(join(root, file), "utf8")
    const sidecars = addEslintIgnore(text)
    const ignored = sidecars === null ? null : addEslintIgnore(sidecars, emittedIgnore)
    if (ignored === null) warnings.push(`${file}: add { ignores: ["**/${sidecarIgnore}", "${emittedIgnore}"] } as its first configurations by hand`)
    // eslint-plugin-import reads a .vibe module's exports through vibelang/eslint.
    const next = addEslintImportParsers(ignored ?? text)
    if (next === null) {
      if (/["'`]eslint-plugin-import(-x)?["'`]/.test(text)) warnings.push(`${file}: add { settings: { "import/parsers": { "vibelang/eslint": [".vibe"] } } } as its first configuration by hand`)
    } else if (next !== text) write(file, next)
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
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import oxc from "./oxlint-rules.mjs"
import { withOxlintComments } from "./oxlint-comments.mjs"
const aliases = new Map()
export const oxlintRuleName = name => aliases.get(name) ?? (name.includes("/") ? name : "eslint/" + name)
export async function configFor(configPath, strict = false) {
aliases.clear()
// ${oxlintrc ? "The Oxlint configuration " + oxlintrc + ", which a lint script names with -c," : "The repository's Oxlint configuration,"} read on each run: its rules and its
// overrides (a *.ts glob read as *.vibe) apply to .vibe files wherever ESLint,
// typescript-eslint or one of the configuration's JS plugins has the rule.
// typescript-eslint's recommended rules stand in for Oxlint's default
// correctness rules unless the configuration turns that category off. Rules of
// Oxlint's other built-in plugins, such as unicorn, are not carried: each run
// names the rules that do not run.
const read = (name) => {
  const url = new URL("../" + name, import.meta.url)
  return existsSync(url) ? readFileSync(url, "utf8") : null
}
// vp lint reads the lint section of the Vite config before any .oxlintrc. A
// config that fails to load fails this pass: a silent fallback lints .vibe
// files with no rules.
const viteLint = async () => {
  for (const name of ["vite.config.ts", "vite.config.mts", "vite.config.vibe", "vite.config.js", "vite.config.mjs"]) {
    const url = new URL("../" + name, import.meta.url)
    if (!existsSync(url)) continue
    const { default: loaded } = await import(url.href)
    const config = await (typeof loaded === "function" ? loaded({ command: "build", mode: "production" }) : loaded)
    return config?.lint ?? null
  }
  return null
}
const fromVite = ${vpLint && !oxlintrc ? "configPath ? null : await viteLint()" : "null"}
const text = fromVite ? null : configPath ? readFileSync(configPath, "utf8") : ${oxlintrc ? "read(" + JSON.stringify(oxlintrc) + ")" : 'read(".oxlintrc.json") ?? read(".oxlintrc.jsonc")'}
const base = configPath ? new URL("./", pathToFileURL(configPath)) : new URL("../" + ${JSON.stringify(oxlintrc && posix.dirname(oxlintrc) !== "." ? posix.dirname(oxlintrc) + "/" : "")}, import.meta.url)
const written = fromVite ?? text ? fromVite ?? JSON.parse(text.replace(/("(?:\\\\.|[^"\\\\])*")|\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*/g, (all, string) => string ?? "").replace(/,(\\s*[}\\]])/g, "$1")) : {}
// Categories and plugin defaults decide most of a .ts file's rules, so the
// rules come from the tool's own resolution, with the written rules over them
// (it leaves JS plugin rules out of its base rules). Without the tool installed
// the written rules are all there is.
const tool = new URL("../node_modules/.bin/" + (fromVite ? "vp" : "oxlint"), import.meta.url)
const resolvedRules = () => {
  if (!existsSync(tool) || (!fromVite && !text)) return {}
  const named = configPath ?? ${oxlintrc ? JSON.stringify(oxlintrc) : `(read(".oxlintrc.json") ? ".oxlintrc.json" : ".oxlintrc.jsonc")`}
  const args = fromVite ? ["lint", "--print-config"] : ["-c", named, "--print-config"]
  const printed = spawnSync(fileURLToPath(tool), args, { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (printed.status !== 0) throw new Error(tool.pathname + " " + args.join(" ") + " failed: " + printed.stdout + printed.stderr)
  return JSON.parse(printed.stdout).rules ?? {}
}
const oxlint = { ...written, rules: { ...resolvedRules(), ...written.rules } }
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
const tseslint = await import("typescript-eslint").then(({ default: loaded }) => {
  const unused = loaded.plugin.rules["no-unused-vars"]
  if (!unused?.create) return loaded
  // Oxlint counts a typeof query as a read. typescript-eslint instead emits
  // usedOnlyAsType, including for erased declare const unique-symbol brands.
  // Adapt only that diagnostic; unused declarations and configured options
  // still run through the original rule. The standalone parser is unchanged.
  const rule = { ...unused, create(context) {
    const adapted = Object.create(context)
    Object.defineProperty(adapted, "report", { value(descriptor) {
      if (descriptor.messageId !== "usedOnlyAsType") context.report(descriptor)
    } })
    return unused.create(adapted)
  } }
  return { ...loaded, plugin: { ...loaded.plugin, rules: { ...loaded.plugin.rules, "no-unused-vars": rule } } }
}, () => null)
const core = await import("eslint/use-at-your-own-risk").then(({ builtinRules }) => builtinRules, () => null)
const typed = new Set(Object.keys(tseslint?.plugin?.rules ?? {}))
// Without typescript-eslint, ESLint's core no-unused-vars reads TypeScript as
// JavaScript. Three reports are wrong on a .vibe file: a parameter of a type
// signature names no binding; a name in a declare block merges with a type
// elsewhere; and an effect import no code names stays because the declaration
// file prints it (D501). Every other report and all options pass through.
const coreUnused = core?.get("no-unused-vars")
const signatures = new Set(["TSFunctionType", "TSConstructorType", "TSMethodSignature", "TSCallSignatureDeclaration", "TSConstructSignatureDeclaration", "TSDeclareFunction", "TSEmptyBodyFunctionExpression"])
const patterns = new Set(["RestElement", "AssignmentPattern", "ArrayPattern", "ObjectPattern", "Property", "TSParameterProperty"])
const namesNothing = (node) => {
  let owner = node?.parent
  while (owner && patterns.has(owner.type)) owner = owner.parent
  if (owner && signatures.has(owner.type)) return true
  if (owner?.type === "ImportDeclaration" || owner?.type === "ImportNamespaceSpecifier" || owner?.type === "ImportSpecifier" || owner?.type === "ImportDefaultSpecifier") {
    const declaration = owner.type === "ImportDeclaration" ? owner : owner.parent
    return /^effect(?:\\/|$)/.test(declaration?.source?.value ?? "")
  }
  for (let up = node?.parent; up; up = up.parent) if (up.type === "TSModuleDeclaration" && (up.declare || up.kind === "global")) return true
  return false
}
const adaptedUnused = coreUnused && { ...coreUnused, create(context) {
  const adapted = Object.create(context)
  Object.defineProperty(adapted, "report", { value(descriptor) { if (!namesNothing(descriptor.node)) context.report(descriptor) } })
  return coreUnused.create(adapted)
} }
const levels = { allow: "off", deny: "error", off: "off", warn: "warn", error: "error", 0: "off", 1: "warn", 2: "error" }
const missing = new Set()
const rules = (settings = {}) => Object.fromEntries(Object.entries(settings).flatMap(([name, setting]) => {
  const [level, ...options] = [setting].flat()
  const value = [levels[level] ?? level, ...options]
  const plugin = name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : ""
  const rule = name.slice(name.lastIndexOf("/") + 1)
  const typedName = "@typescript-eslint/" + rule
  // A core rule typescript-eslint extends for TypeScript, as Oxlint's does, is typescript-eslint's.
  if (plugin === "typescript" || plugin === "@typescript-eslint" || ((plugin === "" || plugin === "eslint") && typed.has(rule))) {
    if (!typed.has(rule)) { if (levels[level] !== "off") missing.add(name); return [] }
    aliases.set(typedName, (plugin === "" || plugin === "eslint") ? "eslint/" + rule : "typescript/" + rule)
    return [[typedName, value]]
  }
  if ((plugin === "" || plugin === "eslint") && rule === "no-unused-vars" && adaptedUnused) {
    aliases.set("vibelang/no-unused-vars", "eslint/no-unused-vars")
    return [["vibelang/no-unused-vars", value]]
  }
  if (plugin === "" || plugin === "eslint") return !core || core.has(rule) ? [[rule, value]] : (levels[level] === "off" || missing.add(name), [])
  if (plugin === "oxc" && oxc.rules[rule]) return [[name, value]]
  if (jsPlugins.get(plugin)?.rules[rule]) return [[name, value]]
  if (levels[level] !== "off") missing.add(name)
  return []
}))
const vibe = (glob) => glob.replace(/\\.\\{([^}]*)\\}$/, (all, list) => list.split(",").some((e) => /^[cm]?tsx?$/.test(e.trim())) ? ".vibe" : all).replace(/\\.[cm]?tsx?$/, ".vibe")
const overrides = (oxlint.overrides ?? [])
  .map((override) => ({ files: [override.files].flat().filter((glob) => vibe(glob) !== glob || glob.endsWith(".vibe") || !/[.][a-z0-9]+$/i.test(glob)).map((glob) => vibe(glob) === glob ? [glob, "**/*.vibe"] : vibe(glob)), rules: rules(override.rules) }))
  .filter((override) => override.files.length && Object.keys(override.rules).length)
// Like Oxlint, ignorePatterns are relative to the lint invocation's cwd.
const ignores = (${nativeIgnorePatterns.toString()})(oxlint.ignorePatterns ?? [])
const correctness = levels[oxlint.categories?.correctness] !== "off"
const configs = [
  { ignores: [...ignores, "**/node_modules/**", "**/dist/**", "**/build/**", "**/*.d.vibe.ts"] },
  ...(correctness && tseslint ? tseslint.configs.recommended.map((config) => ({ ...config, ...(config.plugins ? { plugins: { ...config.plugins, "@typescript-eslint": tseslint.plugin } } : {}), files: ["**/*.vibe"] })) : []),
  { files: ["**/*.vibe"], linterOptions: { reportUnusedDisableDirectives: "off" }, languageOptions: { parser: withOxlintComments(parser, aliases) }, plugins: { oxc, ...(adaptedUnused ? { vibelang: { rules: { "no-unused-vars": adaptedUnused } } } : {}), ...(tseslint ? { "@typescript-eslint": tseslint.plugin } : {}), ...Object.fromEntries(jsPlugins) }, rules: { ...(correctness ? { "no-debugger": "error" } : {}), ...rules(oxlint.rules) } },
  ...overrides
]
if (strict && missing.size) throw new Error("Oxlint rules unavailable under ESLint: " + [...missing].join(", "))
if (missing.size) console.error("vibelang: " + missing.size + " Oxlint rules do not run on .vibe files: " + [...missing].sort().join(", "))
return configs
}
export default await configFor()
`
  if (oxlint.packages.length) {
    write(".vibelang/oxlint.mjs", readFileSync(new URL("../templates/oxlint.mjs", import.meta.url), "utf8"))
    chmodSync(join(root, ".vibelang/oxlint.mjs"), 0o755)
  }
  if (needsLint) {
    write(".vibelang/oxlint-comments.mjs", readFileSync(new URL("../templates/oxlint-comments.mjs", import.meta.url), "utf8"))
    write(".vibelang/oxlint-rules.mjs", readFileSync(new URL("../templates/oxlint-rules.mjs", import.meta.url), "utf8"))
    write(".vibelang/eslint.config.mjs", eslintConfig(null))
  }
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
      const original = readFileSync(join(root, rule), "utf8")
      const language = /^language:[ \t]*(["']?)(?:typescript|tsx|ts)\1[ \t]*(?:#.*)?$/im
      if (!language.test(original)) continue
      const text = vibeSelectors(withoutSidecarIgnore(original).replace(language, "language: VibeLang"))
        .replace(/^id:\s*(.+)$/m, "id: $1-vibelang")
      write(rule.replace(/\.ya?ml$/, ".vibelang.yml"), text)
      write(rule, sidecarIgnoreOf(original))
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
  return { changed: [...new Set(changed)], builds, warnings }
}
