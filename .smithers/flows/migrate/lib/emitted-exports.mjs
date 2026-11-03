// Keep connected runtime modules on one graph; preserve unrelated native entry paths.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, posix } from "node:path"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "./declarations.mjs"
import { pathAliases } from "./codemod.mjs"
import { syncPackPolicy } from "./pack-policy.mjs"
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
  // An exported native module may also need its compiled graph: Node cannot
  // follow an authored ./x.js edge when only x.ts exists beside the source.
  // Keep bare native facades in source (their host may provide that module),
  // and root only public entries whose actual runtime edge needs emission.
  const publicMaps=[pkg.exports,pkg.imports].map(map=>instantiate(map,"*"))
  const nativeRoots=new Set(),needsEmission=new Set()
  const runtimeEdges=new Map([...sources].map(source=>[source,new Set()]))
  const isPublic=source=>publicMaps.some(map=>{
    if(!map||typeof map!=="object"||Array.isArray(map)||Object.keys(map).every(key=>!key.startsWith(".")&&!key.startsWith("#"))) {
      return targets(map).some(target=>target.startsWith("./")&&plainPath(target)===source)
    }
    for(const [key,item] of Object.entries(map)) for(const target of targets(item)) {
      if(!target.startsWith("./")||!native.test(target))continue
      const star=matchPattern(plainPath(target),source)
      if(star===undefined)continue
      if(!key.includes("*")) {if(!target.includes("*"))return true;continue}
      if(!target.includes("*"))return true
      const exact=key.replaceAll("*",star)
      let selected=exact,selectedStar=""
      if(!Object.hasOwn(map,exact)) {
        const patterns=Object.keys(map).filter(pattern=>pattern.includes("*")&&matchPattern(pattern,exact)!==undefined)
          .sort((a,b)=>b.indexOf("*")-a.indexOf("*")||b.length-a.length)
        selected=patterns[0]
        if(selected===undefined)continue
        selectedStar=matchPattern(selected,exact)
      }
      if(targets(map[selected]).some(path=>path.startsWith("./")&&plainPath(path.replaceAll("*",selectedStar))===source))return true
    }
    return false
  })
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
    let sourceSpecifiers
    if (native.test(from) && existsSync(join(root,from))) {
      sourceSpecifiers=new Set()
      const originalFile=ts.createSourceFile(from,readFileSync(join(root,from),"utf8"),ts.ScriptTarget.Latest,true,ts.getScriptKindFromFileName(from))
      const record=node=>{
        const literal=ts.isImportDeclaration(node)||ts.isExportDeclaration(node)?node.moduleSpecifier
          :ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==="require")?node.arguments[0]:undefined
        if(literal&&ts.isStringLiteralLike(literal))sourceSpecifiers.add(literal.text)
        ts.forEachChild(node,record)
      }
      record(originalFile)
    }
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
        if(sourceSpecifiers?.has(literal.text) && literal.text.startsWith(".")) {
          let path
          try {path=decodeURIComponent(literal.text.split(/[?#]/,1)[0])} catch {}
          if(path&&/\.[cm]?js$/.test(path)&&!existsSync(join(root,posix.dirname(from),path))&&edge.targets?.some(target=>native.test(target))) needsEmission.add(from)
        }
        for (const target of edge.targets??[]) {graph.get(from).add(target);graph.get(target).add(from);runtimeEdges.get(from).add(target)}
      }
      ts.forEachChild(node,visit)
    }
    visit(file)
    if (opaque) return fallback("opaque runtime module edge")
  }
  // Only a public importer's outgoing runtime graph can require this route.
  // An unused private importer must not pull a provided facade into emission.
  for(const source of sources) if(native.test(source)&&isPublic(source)) {
    const seen=new Set(),pending=[source]
    while(pending.length) {
      const next=pending.pop()
      if(seen.has(next))continue
      seen.add(next)
      if(needsEmission.has(next)){nativeRoots.add(source);break}
      pending.push(...runtimeEdges.get(next))
    }
  }
  const selected=new Set([...roots,...nativeRoots]),pending=[...selected]
  while(pending.length) for(const next of graph.get(pending.pop())??[]) if(!selected.has(next)){selected.add(next);pending.push(next)}
  return {outputs:Object.fromEntries(entries.filter(([source])=>selected.has(plainPath(source)))),summary:{mode:"component",modules:entries.length,selected:selected.size,vibeRoots:roots.length,nativeRuntimeRoots:nativeRoots.size}}
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
export function routeEmittedExports(packageDir, outputs, { restore = false, onGraph, onPacking, typescript } = {}) {
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
  const packing = syncPackPolicy(packageDir, pkg)
  onPacking?.(packing.files)
  if (JSON.stringify(JSON.parse(before)) === JSON.stringify(pkg)) return packing.changed
  writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n")
  return true
}
