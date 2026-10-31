// Narrow style-gate exception required by foldkit's accepted 18:45Z ruling.
// The compiler identifies a global Error; its ESTree ties the advisory to the
// nearest function that writes a failure contract, and the module's original
// source (or, for runs that kept none, its retained declaration) proves the
// channel that function declared before migration. A private producer, an
// inline catch callback and a union channel that includes Error all count
// (drive-foldkit-examples and drive-foldkit-node, 2026-10-31T23:15Z).
import { readFileSync } from "node:fs"
import { join, posix } from "node:path"
import { listDeclarations } from "./declarations.mjs"
import { quote, run } from "./util.mjs"

// Mapper identity includes its executable tree; a return annotation alone is no proof.
const executable = node => JSON.stringify(node, (key, value) =>
  ["range", "loc", "raw", "tokens", "comments", "parent"].includes(key) ? undefined : value)
const functionTypes = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "TSDeclareFunction", "TSEmptyBodyFunctionExpression", "TSFunctionType"])
const children = node => Object.entries(node).filter(([key]) => !["tokens", "comments", "loc", "range", "parent"].includes(key)).flatMap(([, value]) => Array.isArray(value) ? value : [value]).filter(value => value && typeof value === "object" && typeof value.type === "string")
const nameOf = node => node?.type === "TSParenthesizedType" ? nameOf(node.typeAnnotation) : node?.type === "TSTypeReference" ? nameOf(node.typeName) : node?.type === "Identifier" ? node.name : node?.type === "TSQualifiedName" ? nameOf(node.left) + "." + nameOf(node.right) : node?.type === "TSUnionType" ? unionOf(node.types) : null
// A union channel is the sorted set of its member names; any unnamed member makes the channel unknown.
const unionOf = types => { const names = types.map(nameOf); return names.every(Boolean) ? [...new Set(names.flatMap(name => name.split(" | ")))].sort().join(" | ") : null }
/** Whether a written channel is, or includes, the global Error. */
export const includesError = channel => typeof channel === "string" && channel.split(" | ").includes("Error")

function contracts(ast, source = "") {
  const imports = new Set()
  const bindings = new Map(), mappers = new Map(), assigned = new Set(), handlers = new WeakSet(), catches = [], throws = []
  const bind = name => { if (name) bindings.set(name, (bindings.get(name) ?? 0) + 1) }
  let shadowed = false
  const inspect = (node, parent = null) => {
    if (node.type === "ImportDeclaration" && ["effect", "effect/Effect"].includes(node.source.value)) {
      for (const spec of node.specifiers) if (spec.type === "ImportNamespaceSpecifier" || spec.imported?.name === "Effect") imports.add(spec.local.name)
    }
    const binding = node.type === "VariableDeclarator" || /(?:Class|Function|Interface|TypeAlias)Declaration$/.test(node.type) ? node.id : /Import.*Specifier/.test(node.type) ? node.local : null
    bind(binding?.name)
    for (const parameter of node.params ?? []) bind(parameter.name)
    if (node.type === "VariableDeclarator" && parent?.kind === "const" && functionTypes.has(node.init?.type)) mappers.set(node.id?.name, node.init)
    if (node.type === "FunctionDeclaration") mappers.set(node.id?.name, node)
    if (node.type === "AssignmentExpression") assigned.add(node.left?.name)
    if (node.type === "UpdateExpression") assigned.add(node.argument?.name)
    if (node.type === "VibeCatchExpression" && node.handler) { handlers.add(node.handler); catches.push(node) }
    if (node.type === "ThrowStatement") throws.push(node)
    if (binding?.name === "Error" || (node.type === "TSTypeParameter" && node.name?.name === "Error")) shadowed = true
    for (const parameter of node.params ?? []) if (parameter.name === "Error") shadowed = true
    for (const child of children(node)) inspect(child, node)
  }
  inspect(ast)
  // A plain function's written return type: an inline catch callback returns the Error its producer fails with.
  const returns = type => type?.type === "TSTypeAnnotation" ? returns(type.typeAnnotation) : type?.type === "VibeEffectType" ? null : nameOf(type)
  const failure = type => {
    if (type?.type === "TSTypeAnnotation") return failure(type.typeAnnotation)
    if (type?.type === "VibeEffectType") return nameOf(type.failure)
    if (type?.type === "TSTypeReference") {
      const name = nameOf(type.typeName)
      if ([...imports].some(alias => name === alias + ".Effect" || name === alias)) return nameOf((type.typeArguments ?? type.typeParameters)?.params?.[1])
    }
    if (type?.type === "TSImportType") {
      const module = type.source?.value ?? type.argument?.value ?? type.argument?.literal?.value
      const qualifier = nameOf(type.qualifier)
      if ((module === "effect/Effect" && qualifier === "Effect") || (module === "effect" && qualifier === "Effect.Effect")) return nameOf((type.typeArguments ?? type.typeParameters)?.params?.[1])
    }
    return null
  }
  const functions = [], sites = [], counts = new Map()
  const api = callee => callee?.type === "MemberExpression" && !callee.computed &&
    ((imports.has(callee.object?.name) && bindings.get(callee.object?.name) === 1) || (callee.object?.name === "Effect" && !bindings.has("Effect"))) ? callee.property?.name : null
  const site = (node, path) => {
    const method = api(node.callee)
    if (!["try", "callback"].includes(method)) return
    // Keep all occurrences, including unproved ones, in the ordinal. A changed
    // call count cannot shift an old proof onto another producer.
    const owner = path.filter(part => part !== "<local>").join(".")
    const group = owner + ":" + method
    const index = counts.get(group) ?? 0
    counts.set(group, index + 1)
    let channel = null, range = null, mapper = null
    if (method === "callback") {
      channel = nameOf((node.typeArguments ?? node.typeParameters)?.params?.[1])
      range = node.arguments?.[0]?.range
    } else {
      const catcher = node.arguments?.[0]?.properties?.find(prop => !prop.computed && (prop.key?.name ?? prop.key?.value) === "catch")?.value
      channel = nameOf((node.typeArguments ?? node.typeParameters)?.params?.[1])
      if (channel) range = catcher?.range
      if (catcher?.type === "Identifier" && bindings.get(catcher.name) === 1 && !assigned.has(catcher.name)) {
        const mapped = returns(mappers.get(catcher.name)?.returnType)
        if (channel && mapped && channel !== mapped) channel = null
        else channel ??= mapped
        range = catcher.range
        if (mapped) mapper = { name: catcher.name, body: executable(mappers.get(catcher.name)?.body) }
      }
    }
    sites.push({ key: group + ":" + index, group, channel, range, mapper })
  }
  // A returned acquisition inherits exactly its acquire failure channel. This
  // establishes the original private function's channel when platform splitting
  // turns one mapped acquire into several native acquire steps.
  const returnedMapper = node => {
    if (node?.type !== "CallExpression") return null
    const method = api(node.callee)
    if (method === "acquireRelease") return returnedMapper(node.arguments?.[0])
    if (method !== "try") return null
    const catcher = node.arguments?.[0]?.properties?.find(prop => !prop.computed &&
      (prop.key?.name ?? prop.key?.value) === "catch")?.value
    if (catcher?.type !== "Identifier" || bindings.get(catcher.name) !== 1 || assigned.has(catcher.name)) return null
    const fn = mappers.get(catcher.name), channel = returns(fn?.returnType)
    return channel ? { name: catcher.name, channel, body: executable(fn.body) } : null
  }
  const visit = (node, path = [], scope = []) => {
    if (node.type === "CallExpression") site(node, scope)
    if (node.type === "VariableDeclarator") {
      const key = node.id?.name
      const next = key ? [...path, key] : []
      const signature = node.id?.typeAnnotation?.typeAnnotation
      if (signature?.type === "TSFunctionType") functions.push({ key: next.join("."), range: node.range, failure: failure(signature.returnType), returns: returns(signature.returnType) })
      if (signature && signature.type !== "TSFunctionType") visit(signature, next, scope)
      if (node.init) visit(node.init, next, key && functionTypes.has(node.init.type) ? next.filter(part => part !== "<local>") : scope)
      return
    }
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      for (const child of children(node)) visit(child, node.id?.name ? [...path, node.id.name] : [], node.id?.name ? [...scope, node.id.name] : scope)
      return
    }
    if (node.type === "MethodDefinition" || node.type === "Property" || node.type === "TSPropertySignature" || node.type === "TSMethodSignature") {
      const key = node.computed ? null : node.key?.name ?? node.key?.value
      const next = key ? [...path, key] : []
      if (node.type === "TSMethodSignature") functions.push({ key: next.join("."), range: node.range, failure: failure(node.returnType), returns: returns(node.returnType) })
      else if (node.typeAnnotation) visit(node.typeAnnotation, next, scope)
      if (node.value) visit(node.value, next, functionTypes.has(node.value.type) ? next.filter(part => part !== "<local>") : scope)
      return
    }
    if (functionTypes.has(node.type)) {
      const named = node.id?.name ? [...path, node.id.name] : path
      functions.push({ key: named.join("."), range: node.range, failure: failure(node.returnType), returns: returns(node.returnType), handler: handlers.has(node), returnedMapper: !node.returnType && api(node.body?.callee) === "acquireRelease" ? returnedMapper(node.body) : null,
        // ESTree projects an eager effect block as an anonymous arrow. Its
        // source prefix distinguishes it from a nested function boundary.
        block: !node.id && /^effect(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*$/.test(source.slice(node.range[0], node.body?.range?.[0])) })
      // A local function must not borrow an unrelated published contract.
      for (const child of children(node)) visit(child, [...named, "<local>"], node.id?.name ? [...scope, node.id.name] : scope)
      return
    }
    for (const child of children(node)) visit(child, path, scope)
  }
  visit(ast)
  return { shadowed, functions, sites, counts, catches, throws, assigned }
}

/** Pure decision over compiler-parsed trees; callers retain a small audit trail. */
export function preservedGlobalErrors(before, after, source, diagnostics) {
  const original = contracts(before)
  const current = contracts(after, source)
  const decisions = []
  const accepted = new Set()
  for (const d of diagnostics.filter(d => d.code === "EK4804")) {
    const offset = source.split("\n").slice(0, d.line - 1).reduce((n, line) => n + line.length + 1, 0) + d.column - 1
    // The innermost enclosing function that writes a failure contract. A plain
    // callback written to return the Error, such as Effect.try's catch, hands
    // the advisory to its producer; a nested function with a channel of its
    // own, written or not, keeps it.
    let fn = null
    for (const candidate of current.functions.filter(fn => fn.range[0] <= offset && offset < fn.range[1]).sort((a, b) => (a.range[1] - a.range[0]) - (b.range[1] - b.range[0]))) {
      if (candidate.failure !== null) { fn = candidate; break }
      if (!candidate.handler && !candidate.block && !includesError(candidate.returns)) break
    }
    const originals = original.functions.filter(old => fn?.key && old.key === fn.key)
    const functionProof = fn && includesError(fn.failure) && originals.length === 1 && originals[0].failure === fn.failure
    const changedContract = fn && (!includesError(fn.failure) || originals.some(old => old.failure !== null && old.failure !== fn.failure))
    const siteProof = !changedContract && current.sites.find(site => site.range && site.range[0] <= offset && offset < site.range[1] &&
      includesError(site.channel) && original.counts.get(site.group) === current.counts.get(site.group) &&
      original.sites.some(old => old.key === site.key && old.channel === site.channel &&
        (!site.mapper && !old.mapper || site.mapper?.name === old.mapper?.name && site.mapper?.body === old.mapper?.body)))
    // Require the same private function, its original returned acquire, and
    // the unchanged immutable mapper. Never borrow a mapper from another scope.
    let splitProof = null
    for (const candidate of current.functions.filter(fn => fn.range[0] <= offset && offset < fn.range[1])) {
      if (current.functions.some(inner => inner !== candidate &&
        candidate.range[0] <= inner.range[0] && inner.range[1] <= candidate.range[1] &&
        inner.range[0] <= offset && offset < inner.range[1] && !inner.block && !inner.handler && !includesError(inner.returns))) continue
      const originals = original.functions.filter(old => old.key && old.key === candidate.key)
      if (originals.length !== 1 || !includesError(originals[0].returnedMapper?.channel)) continue
      const contract = originals[0].returnedMapper
      const sameMapper = site => site.mapper?.name === contract.name && site.mapper.body === contract.body && site.channel === contract.channel
      const direct = current.sites.find(site => site.range && site.range[0] <= offset && offset < site.range[1] && sameMapper(site))
      const rethrow = current.catches.find(caught => {
        const handler = caught.handler, parameter = handler.params?.[0]?.name
        if (!parameter || current.assigned.has(parameter)) return false
        if (!current.throws.some(node => node.range[0] <= offset && offset < node.range[1] &&
          handler.range[0] <= node.range[0] && node.range[1] <= handler.range[1] && node.argument?.type === "Identifier" && node.argument.name === parameter)) return false
        const producers = current.sites.filter(site => site.range && caught.expression.range[0] <= site.range[0] && site.range[1] <= caught.expression.range[1])
        return producers.length > 0 && producers.every(sameMapper)
      })
      if (direct || rethrow) { splitProof = { function: candidate.key, mapper: contract.name, channel: contract.channel, rethrow: Boolean(rethrow) }; break }
    }
    const keep = d.category !== "error" && /This failure is a global Error,/.test(d.message) &&
      !original.shadowed && !current.shadowed && (functionProof || siteProof || (!changedContract && splitProof))
    if (keep) accepted.add(d)
    decisions.push({ file: d.file, line: d.line, column: d.column, code: d.code, exempt: Boolean(keep), ...(fn ? { function: fn.key, channel: fn.failure } : {}),
      ...(siteProof ? { producer: siteProof.key, producerChannel: siteProof.channel } : {}),
      ...(splitProof ? { acquisition: splitProof } : {}),
      reason: keep ? (functionProof ? "written global Error channel matches the original contract" : splitProof ? "unchanged mapper preserves the original returned acquire channel" : "written Error producer matches the original call contract") : "no matching explicit global Error channel" })
  }
  return { accepted, decisions }
}

export async function parseStyleTree(compiler, filename, source, cwd) {
  const result = await run(quote(compiler) + " --estree " + quote(filename), { cwd, input: source })
  if (result.code !== 0) throw new Error("style contract parsing failed for " + filename + " (exit " + result.code + ")")
  let tree
  try { tree = JSON.parse(result.stdout) } catch { throw new Error("invalid style contract tree for " + filename) }
  if (!tree?.ast) throw new Error("no style contract tree for " + filename + ": " + (result.stderr || result.stdout).slice(0, 300))
  return tree.ast
}

/** Match an emitted declaration by module path, refusing ambiguous outputs. */
export function declarationFor(dir, source) {
  const stem = source.replace(/\.(?:vibe|mts|ts)$/, "")
  const score = file => {
    const a = file.replace(/\.d\.[cm]?ts$/, "").split("/").reverse()
    const b = stem.split("/").reverse()
    let n = 0
    while (n < a.length && n < b.length && a[n] === b[n]) n++
    return n === Math.min(a.length, b.length) ? n : 0
  }
  const files = listDeclarations(dir).map(file => ({ file, score: score(file) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score)
  return files.length && files[0].score > (files[1]?.score ?? 0) ? files[0].file : null
}

/**
 * original(file) returns the module's TypeScript source as the codemod found it
 * ({ path, text }), or null: the original source declares every contract,
 * including a private producer's that no published declaration shows. Without
 * it, the retained declaration is the oracle, as for runs that kept no state.
 */
export async function preservedErrorAdvisories({ compiler, target, packages, baseline, files, diagnostics, original = () => null }) {
  const accepted = new Set()
  const decisions = []
  for (const file of files.filter(file => diagnostics.some(d => d.file === file && d.code === "EK4804"))) {
    const pkg = packages.find(pkg => pkg.dir === "." || file.startsWith(pkg.dir + "/"))
    const source = readFileSync(join(target, file), "utf8")
    const retained = original(file)
    let before, oracle
    if (retained) {
      before = await parseStyleTree(compiler, retained.path, retained.text, target)
      oracle = { oracle: "source", original: retained.path }
    } else {
      const dir = baseline(pkg)
      const declaration = declarationFor(dir, posix.relative(pkg.dir, file))
      if (!declaration) {
        decisions.push({ file, exempt: false, reason: "no unambiguous original declaration" })
        continue
      }
      before = await parseStyleTree(compiler, declaration, readFileSync(join(dir, declaration), "utf8"), target)
      oracle = { oracle: "declaration", declaration }
    }
    const after = await parseStyleTree(compiler, file, source, target)
    const result = preservedGlobalErrors(before, after, source, diagnostics.filter(d => d.file === file))
    for (const d of result.accepted) accepted.add(d)
    decisions.push(...result.decisions.map(d => ({ ...d, ...oracle })))
  }
  return { accepted, decisions }
}
