// Keep connected runtime modules on one graph; preserve unrelated native entry paths.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, posix } from "node:path"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "./declarations.mjs"
import { pathAliases } from "./codemod.mjs"
import { resolveRelative, resolveFile, resolveAliased } from "./imports.mjs"

const native = /(?<!\.d)\.(?:[cm]?tsx?|[cm]?jsx?)$/
const metadata = new Set(["types", "typings", "vibelang-source"])
const skipped = (name) => name.startsWith(".") || ["node_modules", "dist", "coverage", "test", "tests", "__tests__", "fixtures"].includes(name)

/** An untouched TypeScript runtime export can be an entry into a private .vibe module. */
export function hasNativeRuntimeExport(value, condition) {
  if (metadata.has(condition)) return false
  if (typeof value === "string") return /(?<!\.d)\.[cm]?tsx?$/.test(value)
  if (Array.isArray(value)) return value.some(item => hasNativeRuntimeExport(item, condition))
  return !!value && typeof value === "object" && Object.entries(value).some(([key, item]) => hasNativeRuntimeExport(item, key))
}

export function hasVibeSource(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (item.isDirectory()) {
      if (!skipped(item.name) && !existsSync(join(directory, item.name, "package.json")) && hasVibeSource(join(directory, item.name))) return true
    } else if (item.name.endsWith(".vibe") && !/\.(?:test|spec)\.vibe$/.test(item.name)) return true
  }
  return false
}

function matchPattern(pattern, value) {
  const at = pattern.indexOf("*")
  if (at < 0) return pattern === value ? "" : undefined
  if (pattern.indexOf("*", at+1) >= 0) return undefined
  const head=pattern.slice(0,at),tail=pattern.slice(at+1)
  return value.startsWith(head) && value.endsWith(tail) && value.length>=head.length+tail.length ? value.slice(head.length,tail ? -tail.length : undefined) : undefined
}
const plainPath = value => posix.normalize(value.replace(/^\.\//,""))
function targets(value) {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(targets)
  return value && typeof value === "object" ? Object.entries(value).filter(([key])=>!["types","typings"].includes(key)).flatMap(([,item])=>targets(item)) : []
}
function mappedTargets(map, key) {
  if (!map || typeof map !== "object" || Array.isArray(map)) return []
  if (Object.hasOwn(map,key)) return targets(map[key])
  return Object.entries(map).flatMap(([pattern,value])=>{
    const star=matchPattern(pattern,key)
    return star===undefined || !pattern.includes("*") ? [] : targets(value).map(target=>target.replaceAll("*",star))
  })
}

// Components, rather than outgoing reachability alone, keep a native singleton
// shared by a Vibe module and a public native export on one emitted instance.
// An opaque runtime edge keeps the previous conservative package-wide routing.
function runtimeComponentOutputs(root, outputs, pkg, typescript) {
  const entries=Object.entries(outputs),roots=entries.filter(([source])=>source.endsWith(".vibe")).map(([source])=>plainPath(source))
  const fallback=reason=>({outputs,summary:{mode:"package",reason,modules:entries.length,selected:entries.length}})
  if (!roots.length) return fallback("no Vibe output map")
  if (entries.some(([,output])=>!existsSync(join(root,output)))) return fallback("missing emitted module")
  let ts=typescript
  try { ts??=loadTypeScript([root,fileURLToPath(new URL("../../../../packages/runtime/",import.meta.url))]) } catch { return fallback("compiler API unavailable") }
  const sources=new Set(entries.map(([source])=>plainPath(source))),emitted=new Set(entries.map(([,output])=>plainPath(output)))
  const byOutput=new Map(entries.map(([source,output])=>[plainPath(output),plainPath(source)]))
  if (byOutput.size!==entries.length) return fallback("ambiguous emitted module")
  const graph=new Map([...sources].map(source=>[source,new Set()]))
  let aliases
  try { aliases=pathAliases(ts,root) } catch { return fallback("unreadable path aliases") }
  const findTarget=(from,output,specifier)=>{
    let name
    try { name=specifier.startsWith("#") ? specifier : decodeURIComponent(specifier.split(/[?#]/,1)[0]) } catch { return {opaque:true} }
    if (name.startsWith(".")) {
      const out=resolveRelative(plainPath(output),name,emitted),source=out&&byOutput.get(out)
      const target=source??resolveRelative(from,name,sources)
      return target ? {targets:[target]} : {opaque:/\.(?:[cm]?[jt]sx?|vibe)$/.test(name)||!posix.extname(name)}
    }
    const aliased=resolveAliased(from,name,sources,aliases)
    if (aliased) return {targets:[aliased.target]}
    let mapped=[]
    if (name.startsWith("#")) mapped=mappedTargets(pkg.imports,name)
    else if (pkg.name && (name===pkg.name||name.startsWith(pkg.name+"/"))) {
      const subpath=name===pkg.name?".":"."+name.slice(pkg.name.length)
      mapped=typeof pkg.exports==="string"||Array.isArray(pkg.exports)||Object.keys(pkg.exports??{}).every(key=>!key.startsWith(".")) ? subpath==="."?targets(pkg.exports):[] : mappedTargets(pkg.exports,subpath)
    } else {
      const matches=(aliases?.(from)??[]).some(({pattern})=>matchPattern(pattern,name)!==undefined)
      return {opaque:matches}
    }
    const resolved=mapped.filter(target=>target.startsWith("./")).map(target=>resolveFile(plainPath(target),sources)??byOutput.get(plainPath(target))).filter(Boolean)
    return resolved.length ? {targets:resolved} : {opaque:!mapped.length||mapped.some(target=>target.startsWith("./"))||name.startsWith("#")}
  }
  for (const [input,output] of entries) {
    const from=plainPath(input),file=ts.createSourceFile(output,readFileSync(join(root,output),"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX)
    if (file.parseDiagnostics.length) return fallback("unparseable emitted module")
    let opaque=false
    const visit=node=>{
      let literal
      if (ts.isImportDeclaration(node)||ts.isExportDeclaration(node)) literal=node.moduleSpecifier
      else if (ts.isCallExpression(node) && (node.expression.kind===ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression)&&node.expression.text==="require")) {
        literal=node.arguments[0]
        if (!literal || !ts.isStringLiteralLike(literal)) opaque=true
      }
      if (literal && ts.isStringLiteralLike(literal)) {
        const edge=findTarget(from,output,literal.text)
        opaque ||= !!edge.opaque
        for (const target of edge.targets??[]) {graph.get(from).add(target);graph.get(target).add(from)}
      }
      ts.forEachChild(node,visit)
    }
    visit(file)
    if (opaque) return fallback("opaque runtime module edge")
  }
  const selected=new Set(roots),pending=[...roots]
  while(pending.length) for(const next of graph.get(pending.pop())??[]) if(!selected.has(next)){selected.add(next);pending.push(next)}
  return {outputs:Object.fromEntries(entries.filter(([source])=>selected.has(plainPath(source)))),summary:{mode:"component",modules:entries.length,selected:selected.size,vibeRoots:roots.length}}
}
function generatedPatternRoute(value) {
  if (!value || typeof value!=="object") return false
  if (original(value)!==undefined && value.types && typeof value.types==="object" && value.types.default===value["vibelang-source"]) return true
  return Object.entries(value).some(([key,item])=>!metadata.has(key)&&generatedPatternRoute(item))
}
function markPatternRoute(value) {
  if (!value || typeof value!=="object") return value
  // A standard nested types/default target marks an exact entry generated
  // from a wildcard. TypeScript resolves the same source; restore can remove
  // this entry without deleting an authored redundant exact export.
  if (original(value)!==undefined) return {...value,types:{default:value["vibelang-source"]}}
  if(Array.isArray(value))return value.map(markPatternRoute)
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,metadata.has(key)?item:markPatternRoute(item)]))
}
function instantiate(value,star) {
  const source=original(value)
  if(source!==undefined)return source.replaceAll("*",star)
  if(typeof value==="string")return value.replaceAll("*",star)
  if(Array.isArray(value))return value.map(item=>instantiate(item,star))
  return value&&typeof value==="object"?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,instantiate(item,star)])):value
}

// A wrapper this pass owns can be recovered without a side receipt: its types
// and source both name the original native module, and default is in our emit.
function original(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const source = value["vibelang-source"]
  if (Object.keys(value).sort().join(",") !== "default,types,vibelang-source" ||
      typeof source !== "string" || !native.test(source) || !(value.types === source || value.types && typeof value.types === "object" && Object.keys(value.types).join(",")==="default" && value.types.default===source) ||
      typeof value.default !== "string" || !value.default.startsWith("./.vibelang/js/")) return undefined
  return source
}

function emittedTarget(source, outputs) {
  if (!source.startsWith("./") || !native.test(source)) return undefined
  source = "./" + posix.normalize(source.slice(2))
  if (source.startsWith("./../")) return undefined
  if (!source.includes("*")) return outputs[source]
  if (source.split("*").length !== 2) return undefined
  const [head, tail] = source.split("*")
  const prefix = "./.vibelang/js/" + head.slice(2)
  let suffix
  let matched = false
  for (const [input, output] of Object.entries(outputs)) {
    if (!input.startsWith(head) || !input.endsWith(tail)) continue
    const star = input.slice(head.length, tail ? -tail.length : undefined)
    if (!star || !output.startsWith(prefix + star)) return undefined
    const end = output.slice((prefix + star).length)
    if (suffix !== undefined && suffix !== end) return undefined
    suffix = end
    matched = true
  }
  return matched ? prefix + "*" + suffix : undefined
}

/** Route native entries only to files the package's actual compile produced. */
export function routeEmittedExports(packageDir, outputs, { restore = false, onGraph, typescript } = {}) {
  const path = join(packageDir, "package.json")
  if (!existsSync(path)) return false
  const before = readFileSync(path, "utf8")
  const pkg = JSON.parse(before)
  const graph=restore?{outputs,summary:{mode:"restore"}}:runtimeComponentOutputs(packageDir,outputs,pkg,typescript)
  onGraph?.(graph.summary)
  const active=graph.outputs,component=graph.summary.mode==="component"
  const walk = (value, condition) => {
    const prior = original(value)
    if (prior !== undefined) value = prior
    if (typeof value === "string") {
      if (restore || metadata.has(condition)) return value
      const target = component && value.includes("*") ? undefined : emittedTarget(value, active)
      return target === undefined ? value : { types: value, "vibelang-source": value, default: target }
    }
    if (Array.isArray(value)) return value.map(item => walk(item, condition))
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, metadata.has(key) ? item : walk(item, key)]))
    return value
  }
  for (const field of ["exports", "imports"]) if (field in pkg) {
    const value=pkg[field]
    if (!value || typeof value!=="object" || Array.isArray(value) || original(value)!==undefined) {pkg[field]=walk(value);continue}
    const next={}
    for(const [key,item] of Object.entries(value)) {
      if(generatedPatternRoute(item) && (restore || !targets(item).some(target=>Object.hasOwn(active,target)))) continue
      const routed=metadata.has(key)?item:walk(item,key)
      next[key]=generatedPatternRoute(item)?markPatternRoute(routed):routed
    }
    if(component) for(const [key,item] of Object.entries(value)) if(key.includes("*") && (field==="imports"?key.startsWith("#"):key.startsWith("./"))) {
      const leaves=targets(instantiate(item,"*")).filter(target=>target.includes("*")&&native.test(target))
      for(const source of Object.keys(active)) for(const leaf of leaves) {
        const star=matchPattern(leaf,source)
        if(star===undefined||!star)continue
        const exact=key.replaceAll("*",star)
        if(Object.hasOwn(value,exact)||Object.hasOwn(next,exact))continue
        next[exact]=markPatternRoute(walk(instantiate(item,star)))
      }
    }
    pkg[field]=next
  }
  if (JSON.stringify(JSON.parse(before)) === JSON.stringify(pkg)) return false
  writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n")
  return true
}
