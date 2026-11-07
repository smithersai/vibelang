// Generated from scripts/api-identity-diagnostics-cache.mjs; run node scripts/sync-api-identity.mjs --write.
// Optional, bounded reuse for a single pinned TypeScript API worker. Cache only
// dependency diagnostics whose full checked environment is identical. Export
// probes, owned declaration checks, options and global diagnostics always run.
import { createHash } from "node:crypto"
import { dirname, resolve } from "node:path"

export function dependencyDiagnosticsPlan(ts, program, compilerOptions, snapshots, resolutions, files) {
  const own = file => snapshots.some(base => file.startsWith(base + "/") && !file.includes("/node_modules/"))
  const sources = program.getSourceFiles()
  const unsafe = source => {
    if (!ts.isExternalModule(source)) return true
    let found = false
    const visit = node => {
      if (node.flags & ts.NodeFlags.GlobalAugmentation ||
          ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name) ||
          node.kind === ts.SyntaxKind.NamespaceExportDeclaration) found = true
      if (!found) ts.forEachChild(node, visit)
    }
    visit(source)
    return found
  }
  if (sources.some(source => own(source.fileName) && unsafe(source))) return undefined
  const external = sources.filter(source => !own(source.fileName))
  const edges = []
  for (const [key, target] of resolutions) {
    if (own(key.split("\0")[0])) continue
    if (target && own(resolve(target.resolvedFileName))) return undefined
    edges.push([key, target?.resolvedFileName ?? null, target?.extension ?? null])
  }
  for (const source of external) for (const reference of source.referencedFiles ?? []) {
    if (own(resolve(dirname(source.fileName), reference.fileName))) return undefined
  }
  edges.sort(([a], [b]) => a.localeCompare(b))
  const names = new Set(external.map(source => source.fileName))
  const checked = files.filter(file => names.has(file))
  const hash = createHash("sha256")
  const add = value => hash.update(JSON.stringify(value)).update("\0")
  add({ ...compilerOptions, configFile: undefined })
  add(edges)
  add(checked)
  // Order matters for ambient overload merging. Include text and module format,
  // even when the external path is unchanged between successive comparisons.
  for (const source of external) add([source.fileName, source.impliedNodeFormat, source.text])
  return { key: hash.digest("hex"), files: new Set(checked) }
}

// What a source file's own diagnostics depend on, in one program: the compiler
// options, every file that changes the global scope or declares a module, and
// the module graph the file reaches. Two entry groups usually share all three,
// so a file is checked once for all of them. A key that cannot prove the whole
// reachable graph is left out, and its file is checked as before.
const environmentSource = (ts, source) => !ts.isJsonSourceFile(source) && (!ts.isExternalModule(source) ||
  source.statements.some(statement => ts.isNamespaceExportDeclaration(statement) || ts.isModuleDeclaration(statement) &&
    (statement.flags & ts.NodeFlags.GlobalAugmentation || ts.isStringLiteral(statement.name))))
const sha = (...values) => {
  const hash = createHash("sha256")
  for (const value of values) hash.update(value).update("\0")
  return hash.digest("hex")
}

export function fileDiagnosticKeys(ts, program, compilerOptions, resolutions) {
  const sources = program.getSourceFiles()
  const text = source => sha(source.fileName, String(source.impliedNodeFormat), source.text)
  const options = JSON.stringify({ ...compilerOptions, configFile: undefined })
  const environment = sha(options, ...sources.filter(source => environmentSource(ts, source)).map(text))
  const edges = new Map(sources.map(source => [source, []]))
  const unknown = new Set()
  const named = new Map(sources.map(source => [resolve(source.fileName), source]))
  for (const [key, target] of resolutions) {
    const from = named.get(key.split("\0")[0])
    if (!from) continue
    const to = target ? program.getSourceFile(target.resolvedFileName) : undefined
    if (target && !to) unknown.add(from)
    edges.get(from).push({ key, to })
  }
  for (const source of sources) if (source.imports?.length && !edges.get(source).length) unknown.add(source)
  // Tarjan's algorithm, iterative because a dependency chain can outrun the
  // stack. It finishes each import cycle after the cycles it reaches, so one
  // pass hashes every cycle from its members and their reachable hashes.
  const order = new Map(), low = new Map(), hashes = new Map(), stack = [], active = new Set()
  let next = 0
  for (const root of sources) {
    if (order.has(root)) continue
    const work = [{ source: root, index: 0 }]
    while (work.length) {
      const frame = work[work.length - 1], { source } = frame
      if (frame.index === 0) {
        order.set(source, next); low.set(source, next++)
        stack.push(source); active.add(source)
      }
      const targets = edges.get(source)
      if (frame.index < targets.length) {
        const { to } = targets[frame.index++]
        if (!to) continue
        if (!order.has(to)) work.push({ source: to, index: 0 })
        else if (active.has(to)) low.set(source, Math.min(low.get(source), order.get(to)))
        continue
      }
      work.pop()
      const parent = work[work.length - 1]?.source
      if (parent) low.set(parent, Math.min(low.get(parent), low.get(source)))
      if (low.get(source) !== order.get(source)) continue
      const members = []
      for (let member; member !== source;) { member = stack.pop(); active.delete(member); members.push(member) }
      const inside = new Set(members)
      const reached = members.flatMap(member => edges.get(member).filter(edge => edge.to && !inside.has(edge.to)).map(edge => hashes.get(edge.to)))
      const open = members.some(member => unknown.has(member)) || reached.includes(undefined)
      const hash = open ? undefined : sha(...members.map(member => sha(text(member), ...edges.get(member)
        .map(edge => edge.key + "\0" + (edge.to?.fileName ?? "")).sort())).sort(), ...[...new Set(reached)].sort())
      for (const member of members) hashes.set(member, hash)
    }
  }
  return new Map(sources.flatMap(source => hashes.get(source) === undefined ? []
    : [[source.fileName, sha(environment, hashes.get(source), source.fileName)]]))
}

export function saveDependencyDiagnostics(cache, plan, records) {
  if (!plan) return
  if (!cache.has(plan.key) && cache.size >= 16) cache.delete(cache.keys().next().value)
  cache.set(plan.key, records.filter(record => plan.files.has(record.file)).map(record => ({ ...record })))
}

// TypeScript's document registry shares parsed library files across programs.
// Keep only pinned dependency declarations, retain one registry lease per
// entry, and reset on changed text instead of mutating a previous version.
export function createDependencyDocuments(ts,{maxFiles=1024,maxTextBytes=32*1024*1024}={}){
 let registry
 const entries=new Map(),versions=new Map()
 let textBytes=0,reads=0,hits=0,resets=0
 const make=()=>ts.createDocumentRegistry(ts.sys.useCaseSensitiveFileNames,ts.sys.getCurrentDirectory(),ts.JSDocParsingMode.ParseAll)
 registry=make()
 function remove(key,entry){
  registry.releaseDocument(entry.file,entry.options,ts.ScriptKind.TS,entry.mode)
  entries.delete(key);textBytes-=entry.bytes
  const version=versions.get(entry.versionKey)
  if(version&&--version.count===0)versions.delete(entry.versionKey)
 }
 function clear(){
  for(const [key,entry]of entries)remove(key,entry)
  registry=make();resets++
 }
 return {
  read(file,options,sourceOptions,text,host){
   reads++
   const bytes=text.length*2
   if(bytes>maxTextBytes)return undefined
   const bucket=registry.getKeyForCompilationSettings(options)
   const canonical=host.getCanonicalFileName(file)
   const versionKey=JSON.stringify([canonical,bucket])
   const version=createHash("sha256").update(text).digest("hex")
   if(versions.has(versionKey)&&versions.get(versionKey).version!==version)clear()
   const cacheHost={...host,getCompilationSettings:()=>options}
   const source=registry.acquireDocument(file,cacheHost,ts.ScriptSnapshot.fromString(text),version,ts.ScriptKind.TS,typeof sourceOptions==="object"?{...sourceOptions,jsDocParsingMode:ts.JSDocParsingMode.ParseAll}:sourceOptions)
   if(source.version!==version)throw Error("document registry returned a stale source version")
   const mode=source.impliedNodeFormat
   const key=JSON.stringify([canonical,bucket,mode])
   const entry=entries.get(key)
   if(entry){
    registry.releaseDocument(file,options,ts.ScriptKind.TS,mode)
    entries.delete(key);entries.set(key,entry);hits++
   }else{
    entries.set(key,{file,options,mode,versionKey,bytes})
    const saved=versions.get(versionKey)
    if(saved)saved.count++;else versions.set(versionKey,{version,count:1})
    textBytes+=bytes
   }
   while(entries.size>maxFiles||textBytes>maxTextBytes){
    const [oldKey,oldEntry]=entries.entries().next().value
    remove(oldKey,oldEntry)
   }
   return source
  },
  stats(){return{reads,hits,documents:entries.size,textBytes,resets}},
  clear,
 }
}
