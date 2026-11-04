// Paths held as data that name a module the migration renamed. Renaming X.ts to
// X.vibe updates imports, but a string, a URL or a built path still says X.ts:
// compile, declarations and tests pass, and the program fails only when it runs
// that line. The codemod rewrites a static reference; verify refuses what is left.
import { posix } from "node:path"
import { isFixtureFile, isTestFile } from "./inventory.mjs"
import { Minimatch } from "./vendor/minimatch.mjs"

export const REFUSAL = "path-to-converted-file"

const code = /\.(?:[cm]?[jt]sx?|vibe)$/
const declaration = /\.d\.(?:vibe\.)?[cm]?ts$/
const textData = /\.(?:ya?ml|toml|sh)$/
const jsonData = /\.jsonc?$/
const toolJson = /(?:^|\/)(?:package-lock|tsconfig[^/]*|jsconfig[^/]*|vibe\.config|turbo|biome|\.oxlintrc|\.eslintrc)\.jsonc?$/
const sourceName = /\.m?ts$/
const scheme = /^[a-z][a-z0-9+.-]*:/i
const extensionName = /(?:^|[^a-z])ext(?:ension)?$|Ext(?:ension)?$/
// Configuration properties whose string value a bundler or runner opens as a file.
const entryKeys = new Set(["main", "entry", "entries", "entryPoint", "entryPoints", "entrypoint", "entrypoints", "input", "script", "worker"])
const manifestKeys = new Set(["main", "module", "bin", "sideEffects"])
// Configuration properties that choose source files by a pattern, and calls that list them.
const selectorKeys = new Set(["include", "exclude", "test", "filter", "entry", "entries", "input", "inputs"])
const selectorCalls = new Set(["glob", "globSync", "globby", "globbySync"])
const toolConfig = /(?:^|\/)[^/]*\.config\.(?:[cm]?[jt]sx?|vibe)$/
// A lint glob stays as written: the repository's parsers do not read .vibe, and setup adds its own pass.
const lintConfig = /(?:^|\/)\.?(?:eslint|oxlint|oxfmt|prettier|biome|dprint)[^/]*$/
const pathCalls = new Set(["join", "resolve"])
const unwrapCalls = new Set(["fileURLToPath", "pathToFileURL", "String", "toFileUrl", "fromFileUrl", "normalize"])
// A child process does not inherit a loader the way fork and Worker inherit
// execArgv, so naming x.vibe there is not a safe rewrite: refuse it.
const processCalls = new Set(["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "execa", "execaSync", "execaCommand", "execaCommandSync"])
const processObjects = new Set(["Command", "ChildProcess", "Bun"])
const childProcessModules = /^(?:cp|childProcess|child_process|ChildProcess|NodeChildProcess|proc)$/
const interpreters = new Set(["node", "bun", "deno", "tsx", "ts-node", "npx", "pnpm"])
const pathModules = /^(?:path|pathe|paths|posix|win32|nodePath|NodePath|Path)$/

const isString = (ts, node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
const calleeName = (ts, callee) => ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null
const objectName = (ts, callee) => ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) ? callee.expression.text : null
const isImportMeta = (ts, node) => ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword
const metaName = (ts, node) => ts.isPropertyAccessExpression(node) && isImportMeta(ts, node.expression) ? node.name.text : null
const unwrap = (ts, node) => {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression?.(node)) node = node.expression
  return node
}

/** A literal the file states as an expected value rather than uses: a type, an assertion or a test's name. */
export function expectationLiteral(ts, source, node) {
  const literal = isString(ts, node)
  if (ts.isLiteralTypeNode(node.parent) && !ts.isImportTypeNode(node.parent.parent)) return true
  if (ts.isVariableDeclaration(node.parent) && node.parent.type && ts.isLiteralTypeNode(node.parent.type)) return true
  if (ts.isCallExpression(node.parent)) {
    const call = node.parent, name = call.expression.getText(source)
    const at = call.arguments.indexOf(node)
    if (/^(?:it|test|describe|bench)(?:[.(]|$)/.test(name) && at === 0) return true
    if (/^(?:assert|expect)(?:\.|$)/.test(name) && literal) return true
    if (/\.to[A-Z][A-Za-z]+$/.test(name)) return true
  }
  for (let n = node.parent; n && !ts.isStatement(n); n = n.parent) {
    if (ts.isCallExpression(n)) {
      const name = n.expression.getText(source)
      if (/\.to[A-Z][A-Za-z]+$/.test(name) && n.arguments.some(arg => node.pos >= arg.pos && node.end <= arg.end)) return true
      if (/^assert(?:\.|$)/.test(name) && n.arguments.slice(1).some(arg => node.pos >= arg.pos && node.end <= arg.end)) return true
    }
  }
  return false
}

// join and resolve from a path module, or imported bare: not array.join or Promise.resolve.
const isPathCall = (ts, call) => pathCalls.has(calleeName(ts, call.expression)) && (ts.isIdentifier(call.expression) || pathModules.test(objectName(ts, call.expression) ?? ""))

const isProcessCall = (ts, node) => {
  if (ts.isTaggedTemplateExpression(node)) return ts.isIdentifier(node.tag) && node.tag.text === "$"
  if (!ts.isCallExpression(node)) return false
  const name = calleeName(ts, node.expression), owner = objectName(ts, node.expression)
  // A local wrapper: startHost("node", ["scripts/serve.ts"], port), as in foldkit's check-host-parity.
  const [first, second] = node.arguments
  if (first && second && isString(ts, first) && interpreters.has(first.text) && ts.isArrayLiteralExpression(second)) return true
  // regex.exec and db.exec are not processes.
  if (name === "exec" || name === "execSync") return ts.isIdentifier(node.expression) || childProcessModules.test(owner ?? "")
  return processCalls.has(name) || (name === "make" && processObjects.has(owner))
}

/** A literal that is an argument of a child process: spawn("bun", ["src/x.ts"]). */
export function processArgument(ts, node) {
  let child = node
  for (let p = node.parent; p && !ts.isStatement(p); child = p, p = p.parent) {
    if (ts.isArrayLiteralExpression(p) || ts.isParenthesizedExpression(p)) continue
    return ts.isCallExpression(p) && p.arguments.includes(child) && isProcessCall(ts, p)
  }
  return false
}

/** A list that already names both spellings keeps working whichever file exists. */
export function twinListed(ts, node) {
  const list = node.parent
  if (!ts.isArrayLiteralExpression(list) || !sourceName.test(node.text)) return false
  const twin = node.text.replace(sourceName, ".vibe")
  return list.elements.some(element => isString(ts, element) && element.text === twin)
}

/** The first argument of new URL(x, "https://…"): it names a remote file, whatever it spells. */
export function remoteUrlPart(ts, node) {
  const p = node.parent
  return ts.isNewExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === "URL" && p.arguments?.[0] === node &&
    !!p.arguments[1] && isString(ts, p.arguments[1]) && scheme.test(p.arguments[1].text)
}

// The file's own names, so a built path can read a const or a local helper's argument.
function bindingsOf(ts, source) {
  const declarations = new Map(), uses = new Map(), calls = new Map()
  const declare = (name, node) => declarations.set(name, [...(declarations.get(name) ?? []), node])
  const walk = node => {
    if (ts.isIdentifier(node)) {
      uses.set(node.text, (uses.get(node.text) ?? 0) + 1)
      if (ts.isCallExpression(node.parent) && node.parent.expression === node) calls.set(node.text, [...(calls.get(node.text) ?? []), node.parent])
    }
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node)) && node.name && ts.isIdentifier(node.name)) declare(node.name.text, node)
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) declare(node.name.text, node)
    ts.forEachChild(node, walk)
  }
  walk(source)
  return { declarations, uses, calls }
}

const exported = (ts, node) => {
  for (let n = node; n && !ts.isSourceFile(n); n = n.parent) {
    if (ts.canHaveModifiers?.(n) && ts.getModifiers(n)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) return true
  }
  return false
}

// The nearest parameter of that name, else the file's only declaration of it.
function bindingOf(ts, id, env) {
  for (let p = id.parent; p; p = p.parent) {
    if (!ts.isFunctionLike(p)) continue
    const param = p.parameters?.find(q => ts.isIdentifier(q.name) && q.name.text === id.text)
    if (param) return param
  }
  const found = env.bindings.declarations.get(id.text) ?? []
  return found.length === 1 ? found[0] : null
}

const hole = (text, extra = {}) => ({ hole: true, text, ...extra })
const DIR = { dir: true }
const product = (lists, limit = 32) => lists.reduce((out, list) => {
  const next = []
  for (const a of out) for (const b of list) if (next.length < limit) next.push([...a, ...b])
  return next
}, [[]])

// What a local function's parameter can hold: every call in this file passes it, or it is unknown.
function parameterValues(ts, param, env, depth) {
  const fn = param.parent
  const owner = ts.isFunctionDeclaration(fn) ? fn : ts.isVariableDeclaration(fn.parent) ? fn.parent : null
  if (!owner?.name || !ts.isIdentifier(owner.name) || exported(ts, owner)) return null
  const name = owner.name.text, calls = env.bindings.calls.get(name) ?? []
  if (!calls.length || (env.bindings.declarations.get(name) ?? []).length !== 1) return null
  // Passing the helper as a value hands the parameter to code this file does not show.
  if (env.bindings.uses.get(name) !== calls.length + 1) return null
  const at = fn.parameters.indexOf(param)
  const out = []
  for (const call of calls) {
    const arg = call.arguments[at]
    if (!arg) return null
    const values = evaluate(ts, arg, env, depth + 1)
    if (values.some(parts => parts.some(part => part.hole))) return null
    out.push(...values)
  }
  return out
}

/** Each value an expression can take, as parts: text, DIR for the file's directory, or a hole. */
function evaluate(ts, input, env, depth = 0) {
  const node = unwrap(ts, input)
  const text = () => node.getText(env.source).slice(0, 80)
  if (depth > 8) return [[hole(text())]]
  if (isString(ts, node)) return [[node.text]]
  if (ts.isTemplateExpression(node)) {
    const lists = [[[node.head.text]]]
    for (const span of node.templateSpans) lists.push(evaluate(ts, span.expression, env, depth + 1), [[span.literal.text]])
    return product(lists)
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind
    if (op === ts.SyntaxKind.PlusToken) return product([evaluate(ts, node.left, env, depth + 1), evaluate(ts, node.right, env, depth + 1)])
    if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) return [...evaluate(ts, node.left, env, depth + 1), ...evaluate(ts, node.right, env, depth + 1)]
  }
  if (ts.isConditionalExpression(node)) return [...evaluate(ts, node.whenTrue, env, depth + 1), ...evaluate(ts, node.whenFalse, env, depth + 1)]
  if (ts.isIdentifier(node)) {
    if (node.text === "__dirname") return [[DIR]]
    const d = bindingOf(ts, node, env)
    if (d) {
      if (ts.isVariableDeclaration(d) && d.initializer && (ts.getCombinedNodeFlags(d) & ts.NodeFlags.Const)) return evaluate(ts, d.initializer, env, depth + 1)
      if (ts.isParameter(d)) {
        const values = parameterValues(ts, d, env, depth)
        if (values) return values
      }
    }
    return [[hole(node.text, extensionName.test(node.text) ? { ext: true } : {})]]
  }
  const meta = metaName(ts, node)
  if (meta === "dirname" || meta === "dir") return [[DIR]]
  if (ts.isPropertyAccessExpression(node) && ["href", "pathname"].includes(node.name.text)) return evaluate(ts, node.expression, env, depth + 1)
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL" && node.arguments?.length) return urlValues(ts, node, env, depth)
  if (ts.isCallExpression(node)) {
    const name = calleeName(ts, node.expression)
    if (ts.isPropertyAccessExpression(node.expression) && name === "toString") return evaluate(ts, node.expression.expression, env, depth + 1)
    if (name === "resolve" && (metaName(ts, node.expression) === "resolve" || objectName(ts, node.expression) === "require") && node.arguments.length) return evaluate(ts, node.arguments[0], env, depth + 1)
    if (name === "dirname" && node.arguments.length) {
      const arg = unwrap(ts, node.arguments[0])
      if (selfUrl(ts, arg) || (ts.isCallExpression(arg) && calleeName(ts, arg.expression) === "fileURLToPath" && arg.arguments[0] && selfUrl(ts, unwrap(ts, arg.arguments[0])))) return [[DIR]]
    }
    if (isPathCall(ts, node) && node.arguments.length) {
      const lists = []
      for (const [at, arg] of node.arguments.entries()) {
        if (at) lists.push([["/"]])
        lists.push(evaluate(ts, arg, env, depth + 1))
      }
      return product(lists)
    }
    if (unwrapCalls.has(name) && node.arguments.length) return evaluate(ts, node.arguments[0], env, depth + 1)
    if (name && (name === "extname" || extensionName.test(name))) return [[hole(text(), { ext: true })]]
  }
  return [[hole(text())]]
}

const selfUrl = (ts, node) => metaName(ts, node) === "url" || (ts.isIdentifier(node) && node.text === "__filename") || metaName(ts, node) === "filename"

function urlValues(ts, node, env, depth) {
  const [first, base] = node.arguments
  if (base && isString(ts, base) && scheme.test(base.text)) return [[hole(node.getText(env.source).slice(0, 80), { remote: true })]]
  const values = evaluate(ts, first, env, depth + 1)
  if (!base || !selfUrl(ts, unwrap(ts, base))) return values
  return values.map(parts => typeof parts[0] === "string" && (scheme.test(parts[0]) || parts[0].startsWith("/")) ? parts : [DIR, "/", ...parts])
}

const isExtensionLiteral = /^\.[cm]?tsx?$/
function regexOf(text) {
  const match = /^\/(.*)\/([a-z]*)$/s.exec(text)
  if (!match) return null
  try { return new RegExp(match[1], match[2].replace(/[gy]/g, "")) } catch { return null }
}

// A glob ending in a wildcard file name with a TypeScript extension; a fixed file name selects itself.
function globMatcher(glob, file, index, anyGlob = false) {
  if (glob.startsWith("!") || glob.length > 200 || !/[*?{]/.test(glob)) return null
  const last = glob.slice(glob.lastIndexOf("/") + 1)
  if (!anyGlob && (!/[*?]/.test(last) || !/\bts\b|\.[cm]ts\b/.test(last))) return null
  const cached = index.globs.get(glob + "\0" + file)
  if (cached !== undefined) return cached
  let matcher = null
  try {
    const compiled = new Minimatch(glob, { nonegate: true, nocomment: true, dot: true })
    const bases = [...new Set([posix.dirname(file), packageOf(file, index.packages), "."])]
    matcher = { test: path => bases.some(base => {
      const relative = posix.relative(base, path)
      return !relative.startsWith("..") && compiled.match(relative)
    }) }
  } catch { matcher = null }
  index.globs.set(glob + "\0" + file, matcher)
  return matcher
}

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const merge = parts => parts.reduce((out, part) => {
  if (typeof part === "string" && typeof out.at(-1) === "string") out[out.length - 1] += part
  else if (part !== "") out.push(part)
  return out
}, [])

const packageOf = (file, packages) => {
  for (let dir = posix.dirname(file); ; dir = posix.dirname(dir)) {
    if (packages.dirs.has(dir)) return dir
    if (dir === "." || posix.dirname(dir) === dir) return "."
  }
}

/** The workspace's package directories and names, from a tracked file list and a manifest reader. */
export function packageContext(tracked, readManifest) {
  const dirs = new Set(["."]), names = new Map()
  for (const file of tracked ?? []) {
    if (posix.basename(file) !== "package.json" || file.split("/").includes("node_modules")) continue
    dirs.add(posix.dirname(file))
    if (!readManifest) continue
    try {
      const name = JSON.parse(readManifest(file)).name
      if (typeof name === "string" && name) names.set(name, posix.dirname(file))
    } catch { /* A broken manifest names no package. */ }
  }
  return { dirs, names }
}

// SSR entry strings in a Vite config are project-root URLs, not filesystem
// absolute paths. Keep this context shared by the rewrite and verification.
export function viteEntryRoot(ts, node, file, source, packages) {
  const config = /^vite(?:\.[\w-]+)?\.config(?:\.(?!(?:d|test|spec)\.)[\w-]+)?\.(?:m?[jt]s|vibe)$/
  if (!config.test(posix.basename(file)) || isTestFile(file) || isFixtureFile(file) || !isString(ts, node)) return undefined
  const property = node.parent
  if (!ts.isPropertyAssignment(property) || property.initializer !== node ||
      !["serverEntry", "clientEntry"].includes(property.name.text)) return undefined
  const object = property.parent, ssr = object.parent
  if (!ts.isObjectLiteralExpression(object) || !ts.isPropertyAssignment(ssr) || ssr.name.text !== "ssr") return undefined
  // A configured/spread root needs the Vite invocation's own resolution proof.
  // Never guess that it uses the default package root.
  let customRoot = false
  const visit = n => {
    const key = n.name, computed = key && ts.isComputedPropertyName(key)
    const name = computed ? (isString(ts, key.expression) ? key.expression.text : null) : key?.text
    if (ts.isSpreadAssignment(n) || (n.parent && ts.isObjectLiteralExpression(n.parent) &&
        (name === "root" || (computed && name === null)))) customRoot = true
    ts.forEachChild(n, visit)
  }
  visit(source)
  return customRoot || !packages ? null : packageOf(file, packages)
}

/** The renamed module a static path names, tried from the file, the repository and the file's package. */
export function resolveRenamed(value, file, byFrom, { packages, live, urlRoot } = {}) {
  // A build label: //apps/site/x.ts is rooted at the repository, from any file.
  if (value?.startsWith("//")) {
    if (urlRoot !== undefined) return {}
    const move = byFrom.get(posix.normalize(value.slice(2)))
    return move ? { move } : {}
  }
  if (!value || scheme.test(value)) return {}
  if (value.startsWith("/")) {
    if (typeof urlRoot !== "string") return {}
    const relative = posix.normalize(value.slice(1))
    if (relative === ".." || relative.startsWith("../")) return {}
    const move = byFrom.get(posix.join(urlRoot, relative))
    return move ? { move } : {}
  }
  const direct = byFrom.get(posix.normalize(value))
  const relative = byFrom.get(posix.normalize(posix.join(posix.dirname(file), value)))
  if (direct && relative && direct !== relative) return { ambiguous: [direct, relative] }
  if (direct || relative) return { move: direct ?? relative }
  if (value.startsWith("../") || !packages || !value.includes("/")) return {}
  if (live?.has(posix.normalize(posix.join(posix.dirname(file), value)))) return {}
  const own = byFrom.get(posix.normalize(posix.join(packageOf(file, packages), value)))
  if (own) return { move: own }
  for (const [name, dir] of packages.names ?? []) {
    if (!value.startsWith(name + "/")) continue
    const move = byFrom.get(posix.normalize(posix.join(dir, value.slice(name.length + 1))))
    if (move) return { move }
  }
  return {}
}

// The repository paths a value with holes can spell, as one regular expression per base.
function matchersOf(parts, file, packages) {
  const first = parts[0]
  const bases = []
  if (first === DIR) bases.push({ base: posix.dirname(file), parts: parts.slice(1), anchored: true })
  else if (typeof first === "string" && /^\.\.?\//.test(first)) bases.push({ base: posix.dirname(file), parts, anchored: true })
  else if (typeof first === "string" && !scheme.test(first) && !first.startsWith("/")) {
    if (first.includes("/")) {
      bases.push({ base: ".", parts, anchored: true }, { base: packageOf(file, packages), parts, anchored: true })
      for (const [name, dir] of packages.names ?? []) if (first.startsWith(name + "/")) bases.push({ base: dir, parts: [first.slice(name.length + 1), ...parts.slice(1)], anchored: true })
    }
    bases.push({ base: posix.dirname(file), parts, anchored: true })
  }
  return bases.map(({ base, parts: rest }) => {
    const merged = merge(rest)
    const head = typeof merged[0] === "string" ? merged[0] : ""
    const tail = typeof merged[0] === "string" ? merged.slice(1) : merged
    const joined = posix.join(base, head)
    if (joined.startsWith("..")) return null
    const prefix = joined === "." ? "" : head.endsWith("/") && !joined.endsWith("/") ? joined + "/" : joined
    return new RegExp("^" + escape(prefix) + tail.map(part => typeof part === "string" ? escape(part) : part.ext ? "\\.[cm]?[jt]sx?" : ".*").join("") + "$")
  }).filter(Boolean)
}

/** A static value's repository path when it is built from the file's own directory. */
function staticPath(parts, file) {
  if (parts[0] !== DIR || parts.some(part => part.hole)) return null
  return posix.normalize(posix.join(posix.dirname(file), parts.slice(1).join("")))
}

/** The repository path of a literal that ends path.join(__dirname, …), for the codemod. */
export function joinedLiteralPath(ts, source, node, file) {
  const call = node.parent
  if (!ts.isCallExpression(call) || call.arguments.at(-1) !== node || !isPathCall(ts, call)) return null
  const values = evaluate(ts, call, { source, file, bindings: bindingsOf(ts, source) })
  return values.length === 1 ? staticPath(values[0], file) : null
}

function sinksOf(ts, node, keys = entryKeys) {
  const one = (expr, kind) => expr ? [{ expr, kind }] : []
  if (ts.isCallExpression(node)) {
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return one(node.arguments[0], "import")
    const name = calleeName(ts, node.expression)
    if (metaName(ts, node.expression) === "resolve") return one(node.arguments[0], "import.meta.resolve")
    if (ts.isIdentifier(node.expression) && name === "require") return one(node.arguments[0], "require")
    if (name === "resolve" && objectName(ts, node.expression) === "require") return one(node.arguments[0], "require.resolve")
    if (name === "fork") return one(node.arguments[0], "fork")
    if (isProcessCall(ts, node)) return node.arguments.flatMap(arg => {
      const inner = unwrap(ts, arg)
      return ts.isArrayLiteralExpression(inner) ? inner.elements.map(expr => ({ expr, kind: "process" })) : [{ expr: arg, kind: "process" }]
    })
    if (isPathCall(ts, node) && node.arguments.length > 1) return [{ expr: node, kind: "path" }]
  }
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
    if (node.expression.text === "URL" && node.arguments?.length) return [{ expr: node, kind: "url" }]
    if (["Worker", "SharedWorker"].includes(node.expression.text)) return one(node.arguments?.[0], "worker")
  }
  if (ts.isPropertyAssignment(node) && keys.has(node.name.text ?? "")) {
    const value = unwrap(ts, node.initializer)
    if (ts.isArrayLiteralExpression(value)) return value.elements.map(expr => ({ expr, kind: "config" }))
    if (ts.isObjectLiteralExpression(value)) return value.properties.flatMap(p => ts.isPropertyAssignment(p) ? [{ expr: p.initializer, kind: "config" }] : [])
    return [{ expr: value, kind: "config" }]
  }
  return []
}

const REMEDY = "keep the module TypeScript with `revert`, or change the caller in its own commit first"

/** Every non-import reference in one source file that can reach a converted module. */
export function scanSource(ts, text, file, index) {
  const json = jsonData.test(file)
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, json ? ts.ScriptKind.JSON : ts.ScriptKind.TS)
  const env = { source, file, bindings: bindingsOf(ts, source) }
  const refusals = [], reports = [], consumed = new Set(), found = new Set()
  let opaque = 0
  const test = isTestFile(file)
  const lineOf = node => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
  const shown = node => node.getText(source).replace(/\s+/g, " ").slice(0, 160)
  const refuse = (node, move, kind, reason) => {
    const line = lineOf(node), key = [move.from, line, kind].join("\0")
    if (found.has(key)) return
    found.add(key)
    refusals.push({ refusal: REFUSAL, module: move.from, to: move.to, file, line, kind, expression: shown(node), reason: reason + "; " + REMEDY })
  }
  const report = (node, kind, reason, modules = []) => {
    const line = lineOf(node), key = ["report", kind, line].join("\0")
    if (found.has(key)) return
    found.add(key)
    reports.push({ file, line, kind, expression: shown(node), reason, modules: modules.slice(0, 20).map(m => m.from) })
  }
  const consume = node => {
    if (isString(ts, node) || ts.isTemplateExpression(node)) consumed.add(node)
    ts.forEachChild(node, consume)
  }
  const stripped = value => {
    const at = value.search(/[?#]/)
    return at > 0 ? value.slice(0, at) : value
  }
  const staticValue = (node, value, parts, sink) => {
    const options = { packages: index.packages, live: index.live, urlRoot: viteEntryRoot(ts, node, file, source, index.packages) }
    const clean = stripped(value)
    const whole = staticPath(parts, file)
    const fromDir = whole && stripped(whole)
    const hit = fromDir ? { move: index.byFrom.get(fromDir) } : resolveRenamed(clean, file, index.byFrom, options)
    if (hit.ambiguous) {
      for (const move of hit.ambiguous) refuse(node, move, "ambiguous", "the path resolves to two converted modules from different bases")
      return
    }
    if (hit.move && isString(ts, node) && twinListed(ts, node)) return
    if (hit.move) {
      if (sink === "process") refuse(node, hit.move, "process-entry", "a child process is started on the module's old path, and it does not inherit a loader for .vibe")
      else if (fromDir ? fromDir !== whole : clean !== value) refuse(node, hit.move, "static-suffix", "the path carries a query or hash the codemod does not rewrite")
      else if (!sink && !clean.includes("/")) report(node, "bare-name", "a string equal to a converted sibling's file name outside any path call", [hit.move])
      else refuse(node, hit.move, "static", "the path still names the module's old file")
      return
    }
    // A child process runs from a directory this file may set: match the path's end, and say so.
    if (sink === "process" && sourceName.test(clean) && clean.includes("/")) {
      const tail = posix.normalize(clean).replace(/^(?:\.\.\/)+/, "")
      const modules = index.modules.filter(r => r.from === tail || r.from.endsWith("/" + tail))
      if (modules.length) report(node, "unanchored-path", "a child process argument that ends like a converted module; its working directory decides", modules)
      return
    }
    // ./x.js may be built output or the source's runtime spelling: say so, never fail on it.
    if (sink && /\.[cm]?js$/.test(clean)) {
      const sourceSpelling = (fromDir ?? clean).replace(/\.mjs$/, ".mts").replace(/\.js$/, ".ts")
      const sibling = fromDir ? index.byFrom.get(sourceSpelling) : resolveRenamed(sourceSpelling, file, index.byFrom, options).move
      const js = fromDir ?? posix.normalize(posix.join(posix.dirname(file), clean))
      if (sibling && !index.live.has(js)) report(node, "javascript-output", "names the JavaScript beside a converted module; correct only where a build writes it", [sibling])
    }
  }
  const checkExpression = (node, kind) => {
    consume(node)
    const variants = evaluate(ts, node, env).map(merge)
    // An expression that can spell both names has already been told about .vibe.
    const spellings = new Set(variants.filter(parts => !parts.some(part => part.hole)).map(parts => parts.filter(part => typeof part === "string").join("")))
    for (const parts of variants) {
      if (parts.some(part => part.remote)) continue
      if (!parts.some(part => part.hole)) {
        const value = parts.filter(part => typeof part === "string").join("")
        if (sourceName.test(value) && spellings.has(value.replace(sourceName, ".vibe"))) continue
        // A fragment with no base, join("src", "x.ts"): whatever it is joined to later decides.
        if (kind === "path" && parts[0] !== DIR) {
          const hit = resolveRenamed(value, file, index.byFrom, { packages: index.packages, live: index.live })
          if (hit.move) report(node, "unanchored-path", "a path fragment with no base that spells a converted module's path", [hit.move])
          continue
        }
        if (kind === "process" && /\s/.test(value)) {
          for (const token of value.split(/\s+/)) if (token.includes("/")) staticValue(node, token, [token], "process")
        } else if (value.length < 400 || parts[0] === DIR) staticValue(node, value, parts, kind)
        continue
      }
      if (kind === "process") {
        for (const part of parts) if (typeof part === "string") for (const token of part.split(/\s+/)) if (token.includes("/") && sourceName.test(token)) staticValue(node, token, [token], "process")
        continue
      }
      const last = parts.at(-1)
      if (typeof last === "string" && last.endsWith("/")) continue
      const anchoredFirst = parts[0] === DIR || (typeof parts[0] === "string" && !/\s/.test(parts[0]) && !scheme.test(parts[0]) && !parts[0].startsWith("/"))
      const spaces = parts.some(part => typeof part === "string" && /\s/.test(part))
      if (spaces) continue
      const extHole = parts.some(part => part.ext), tsTail = typeof last === "string" && sourceName.test(last)
      const exactStem = parts.every(part => !part.hole || part.ext)
      if (!anchoredFirst) {
        const tail = typeof last === "string" ? last.replace(/^\/+/, "") : ""
        if (kind && tsTail && tail.includes("/")) {
          const modules = index.modules.filter(r => r.from === tail || r.from.endsWith("/" + tail))
          if (modules.length) report(node, "unanchored-path", "an unknown base joined to a path that ends like a converted module", modules)
        } else if (kind && kind !== "path" && kind !== "url" && kind !== "config") opaque++
        continue
      }
      if (!kind && !extHole && !tsTail) continue
      const matchers = matchersOf(parts, file, index.packages)
      const modules = index.modules.filter(r => matchers.some(re => re.test(r.from)))
      if (!modules.length) continue
      if ((kind && (extHole || tsTail)) || (extHole && exactStem)) {
        for (const move of modules) refuse(node, move, "run-time", "a path built at run time can resolve to this module's old file")
      } else report(node, "open-path", "a built path can reach converted modules, and nothing here proves it does", modules)
    }
  }
  // Does this expression hold this module's own path? Follows consts, not calls.
  const selfDerived = (input, depth = 0) => {
    const node = unwrap(ts, input)
    if (depth > 4) return false
    if (/\bimport\.meta\.(?:url|filename|path)\b|\b__filename\b/.test(node.getText(source))) return true
    if (!ts.isIdentifier(node)) return false
    const d = bindingOf(ts, node, env)
    return !!d && ts.isVariableDeclaration(d) && !!d.initializer && selfDerived(d.initializer, depth + 1)
  }
  const namesSource = value => isExtensionLiteral.test(value)
  const regexNamesSource = text => /\\\.[^/]*(?:ts|\[[a-z]*t[a-z]*\]s)/.test(text)
  const regexSelectsSource = node => {
    const compiled = regexOf(node.text)
    return !!compiled && regexNamesSource(node.text) && ["a.ts", "a.tsx", "a.mts"].some(name => compiled.test(name)) && !compiled.test("a.vibe")
  }
  // The expression and the value an extension test reads, or null.
  const extensionTest = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text, arg = node.arguments[0]
      if (name === "endsWith" && arg && isString(ts, arg) && namesSource(arg.text)) return node.expression.expression
      const receiver = unwrap(ts, node.expression.expression)
      if (name === "test" && arg && receiver.kind === ts.SyntaxKind.RegularExpressionLiteral && regexSelectsSource(receiver)) return arg
    }
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(node.operatorToken.kind)) {
      for (const [a, b] of [[node.left, node.right], [node.right, node.left]]) {
        const call = unwrap(ts, a)
        if (isString(ts, b) && namesSource(b.text) && ts.isCallExpression(call) && calleeName(ts, call.expression) === "extname" && call.arguments[0]) return call.arguments[0]
      }
    }
    return null
  }
  const mentionsVibe = node => {
    for (let n = node; n && !ts.isSourceFile(n); n = n.parent) if (ts.isStatement(n)) return /\.vibe\b/.test(n.getText(source))
    return false
  }
  const selfProbe = node => {
    if (!ts.isCallExpression(node)) return false
    const name = calleeName(ts, node.expression)
    return !!name && extensionName.test(name) && name !== "extname" && node.arguments.some(arg => selfUrl(ts, unwrap(ts, arg)))
  }
  // A regex spelling a directory and a TypeScript extension names files: t3code's CI list.
  const pathRegex = node => {
    if (node.kind !== ts.SyntaxKind.RegularExpressionLiteral || test || !node.text.includes("\\/") || !regexNamesSource(node.text)) return
    const compiled = regexOf(node.text)
    if (!compiled) return
    const dropped = index.modules.filter(r => compiled.test(r.from) && !compiled.test(r.to))
    if (dropped.length && dropped.length <= 50) selector(node, compiled, "a regex naming these paths", [], index.modules)
    else if (dropped.length) report(node, "extension-test", "a broad path regex that stops matching converted modules", dropped)
  }
  const probes = node => {
    pathRegex(node)
    const tested = extensionTest(node)
    if (tested && !test && !mentionsVibe(node)) {
      if (selfDerived(tested) && index.converted.has(file)) refuse(node, index.moveOfVibe.get(file), "caller-extension", "this module tests its own file extension, and the test changes its answer when the module becomes .vibe")
      else if (selfDerived(tested)) { /* True for a module that stays TypeScript: a path it picks is checked where it is used. */ }
      else if (toolConfig.test(file) && !lintConfig.test(file) && !index.converted.has(file)) selector(node, regexOfNode(node), "a transform filter in a tool configuration")
      else report(node, "extension-test", "an extension test that answers differently for .vibe; nothing here shows what it reads")
    } else if (selfProbe(node) && index.converted.has(file)) refuse(node, index.moveOfVibe.get(file), "caller-extension", "this module reads its own file extension, which stops being .ts when it becomes .vibe")
  }
  const regexOfNode = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const receiver = unwrap(ts, node.expression.expression)
      if (receiver.kind === ts.SyntaxKind.RegularExpressionLiteral) return regexOf(receiver.text)
      if (node.expression.name.text === "endsWith" && node.arguments[0]) { const end = node.arguments[0].text; return { test: value => value.endsWith(end) } }
    }
    const literalSide = [node.left, node.right].find(side => side && isString(ts, side))
    return literalSide ? { test: value => value.endsWith(literalSide.text) } : null
  }
  // A filter or glob that selected a module as x.ts and does not select x.vibe drops it in silence.
  const selector = (node, matcher, what, siblings = [], candidates) => {
    if (!matcher) return
    const scope = packageOf(file, index.packages), inScope = candidates ?? (scope === "." ? index.modules : index.modules.filter(r => r.from.startsWith(scope + "/")))
    const dropped = inScope.filter(r => matcher.test(r.from) && !matcher.test(r.to) && !siblings.some(other => other.test(r.to)))
    if (!dropped.length) return
    const key = ["selector", lineOf(node)].join("\0")
    if (found.has(key)) return
    found.add(key)
    refusals.push({ refusal: REFUSAL, module: dropped[0].from, to: dropped[0].to, modules: dropped.slice(0, 50).map(r => r.from), moduleCount: dropped.length, file, line: lineOf(node), kind: "selector", expression: shown(node),
      reason: what + " selects these modules as .ts and not as .vibe; add .vibe to it and exclude .d.vibe.ts in its own commit, or keep the modules TypeScript" })
  }
  const selectorOf = element => {
    const value = unwrap(ts, element)
    if (value.kind === ts.SyntaxKind.RegularExpressionLiteral) return regexSelectsSource(value) ? regexOf(value.text) : null
    if (isString(ts, value)) return globMatcher(value.text, file, index)
    return null
  }
  const coverSelector = element => {
    const value = unwrap(ts, element)
    if (value.kind === ts.SyntaxKind.RegularExpressionLiteral) return regexOf(value.text)
    if (isString(ts, value)) return globMatcher(value.text, file, index, true)
    return null
  }
  const selectors = node => {
    if (test || lintConfig.test(file)) return
    let list = null, what = ""
    if (ts.isPropertyAssignment(node) && selectorKeys.has(node.name.text ?? "")) {
      const value = unwrap(ts, node.initializer)
      list = ts.isArrayLiteralExpression(value) ? [...value.elements] : [value]
      what = "the `" + node.name.text + "` selector"
    } else if (ts.isCallExpression(node) && selectorCalls.has(calleeName(ts, node.expression)) && node.arguments[0]) {
      const value = unwrap(ts, node.arguments[0])
      list = ts.isArrayLiteralExpression(value) ? [...value.elements] : [value]
      what = "the `" + calleeName(ts, node.expression) + "` call"
    }
    if (!list) return
    const covers = list.map(coverSelector).filter(Boolean)
    for (const element of list) {
      const matcher = selectorOf(element)
      if (matcher) selector(element, matcher, what, covers.filter(other => other !== matcher))
    }
  }
  const visit = node => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isImportTypeNode(node) || ts.isLiteralTypeNode(node) || (ts.isModuleDeclaration(node) && isString(ts, node.name))) return
    if (!json) {
      probes(node)
      selectors(node)
    }
    const sinks = json ? (ts.isPropertyAssignment(node) ? sinksOf(ts, node, posix.basename(file) === "package.json" ? manifestKeys : entryKeys) : []) : ts.isTaggedTemplateExpression(node) && isProcessCall(ts, node) ? [{ expr: node.template, kind: "process" }] : sinksOf(ts, node)
    for (const { expr, kind } of sinks) if (!consumed.has(expr)) checkExpression(expr, kind)
    if (!json) {
      if (isString(ts, node) && !consumed.has(node)) {
        const key = ts.isPropertyAssignment(node.parent) && node.parent.name === node
        if (!key && !test && !expectationLiteral(ts, source, node) && !remoteUrlPart(ts, node)) {
          const value = node.text
          if (value.length < 400 && !/\s/.test(value) && sourceName.test(stripped(value))) staticValue(node, value, [value], null)
        }
      }
      if (ts.isTemplateExpression(node) && !consumed.has(node)) checkExpression(node, null)
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken && !(ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.PlusToken) && !consumed.has(node)) {
        const before = consumed.size
        consume(node)
        if (consumed.size > before) checkExpression(node, null)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { refusals, reports, opaque }
}

// A shell line, a workflow step or a TOML setting: paths that name a converted module.
function scanText(text, file, index) {
  const refusals = [], options = { packages: index.packages, live: index.live }
  const token = /(?<![\w@/.$-])((?:\.{1,2}\/)*[\w@][\w@.\/-]*?\.m?ts)(?![\w.\/-])/g
  text.split("\n").forEach((raw, at) => {
    const line = raw.replace(/(^|\s)#.*$/, "$1")
    for (const match of line.matchAll(token)) {
      if (!match[1].includes("/")) continue
      const move = resolveRenamed(match[1], file, index.byFrom, options).move
      // A workflow's path filter listing both spellings keeps working: foldkit's deploy-website.yml.
      if (move && !text.includes(match[1].replace(sourceName, ".vibe"))) refusals.push({ refusal: REFUSAL, module: move.from, to: move.to, file, line: at + 1, kind: "static", expression: raw.trim().slice(0, 160), reason: "the line still names the module's old file; " + REMEDY })
    }
  })
  return { refusals, reports: [], opaque: 0 }
}

/** The modules a tracked tree has converted: x.vibe with no x.ts or x.mts beside it. */
export function convertedModules(tracked) {
  const live = new Set(tracked)
  return tracked.filter(file => file.endsWith(".vibe") && !live.has(file.replace(/\.vibe$/, ".ts")) && !live.has(file.replace(/\.vibe$/, ".mts")))
    .flatMap(to => [{ from: to.replace(/\.vibe$/, ".ts"), to }, { from: to.replace(/\.vibe$/, ".mts"), to }])
}

/** Tracked files whose text can hold a path to a module. Fixtures keep their own trees. */
export function scannedFiles(tracked, { owned = () => true, generated = /(?:^|\/)(?:node_modules|dist)(?:\/|$)/ } = {}) {
  return tracked.filter(file => !generated.test(file) && !isFixtureFile(file) && !declaration.test(file) && owned(file) &&
    (code.test(file) || textData.test(file) || (jsonData.test(file) && !toolJson.test(file))))
}

/** The tree's check: a refusal per module a remaining path can reach, and a report for what stays unsure. */
export function checkConvertedPaths({ ts, tracked, read, owned, generated }) {
  const started = performance.now()
  const renames = convertedModules(tracked)
  const index = {
    renames,
    modules: renames.filter(r => r.from.endsWith(".ts")),
    byFrom: new Map(renames.map(r => [r.from, r])),
    live: new Set(tracked),
    converted: new Set(renames.map(r => r.to)),
    moveOfVibe: new Map(renames.filter(r => r.from.endsWith(".ts")).map(r => [r.to, r])),
    packages: packageContext(tracked, read),
    globs: new Map()
  }
  const files = scannedFiles(tracked, { owned, ...(generated ? { generated } : {}) })
  const refusals = [], reports = [], unreadable = []
  let opaque = 0
  if (renames.length) for (const file of files) {
    let text
    try { text = read(file) } catch { unreadable.push(file); continue }
    if (text === null || text === undefined || text.includes("\0")) continue
    const result = textData.test(file) ? scanText(text, file, index) : scanSource(ts, text, file, index)
    refusals.push(...result.refusals)
    reports.push(...result.reports)
    opaque += result.opaque
  }
  const order = (a, b) => a.file.localeCompare(b.file) || a.line - b.line
  return { refusal: REFUSAL, ok: refusals.length === 0, modules: index.converted.size, files: files.length, refusals: refusals.sort(order), reports: reports.sort(order), unreadable, opaque, durationMs: Math.round(performance.now() - started) }
}
