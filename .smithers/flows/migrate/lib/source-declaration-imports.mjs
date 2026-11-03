// A foreign native checker does not inherit a source package's rootDirs.
// Keep source and physical compatibility declarations on one private route.
import {existsSync,readFileSync,writeFileSync} from "node:fs"
import {join,posix,relative,resolve} from "node:path"
import {packageDirOf} from "./codemod.mjs"
import {listSources,isTestFile,isFixtureFile} from "./inventory.mjs"
import {sourceTypeEdges} from "./emitted-imports.mjs"
import {applyEdits,resolveRelative} from "./imports.mjs"
import {sidecarConfigIn,sidecarSettings,sidecarPath} from "./sidecar-config.mjs"
import {projectsOf} from "./wire.mjs"

export const sourceDeclarationPrefix="#vibelang/source/"
const native=file=>/(?<!\.d)\.(?:[cm]?ts|tsx)$/.test(file)
const protectedFile=file=>isTestFile(file)||isFixtureFile(file)
const targetIn=(dir,file)=>"./"+posix.relative(dir,file)
const contained=path=>typeof path==="string"&&path.startsWith("./")&&!path.slice(2).split("/").includes("..")
const generated=value=>value&&typeof value==="object"&&!Array.isArray(value)&&
 Object.keys(value).sort().join(",")==="default,types,vibelang-source"&&
 typeof value.types==="string"&&typeof value["vibelang-source"]==="string"&&
 typeof value.default==="string"&&contained(value.types)&&contained(value["vibelang-source"])&&contained(value.default)&&
 (value.default===value["vibelang-source"]||value.default.startsWith("./.vibelang/js/"))

/** Plan all files before writing: a conflicting private route changes nothing. */
export function planSourceDeclarationImports({root,packages,ts,compiler,restore=false,emitted=new Map()}) {
 const started=performance.now(),edits=new Map(),modules=[],warnings=[]
 const files=listSources(root,"."),all=new Set(files),texts=new Map(files.map(file=>[file,readFileSync(join(root,file),"utf8")]))
 const owners=new Map(files.map(file=>[file,packageDirOf(root,file)]))
 const write=(file,after)=>{
  const before=readFileSync(join(root,file),"utf8")
  if(before!==after)edits.set(file,{before,after})
 }
 for(const pkg of packages) {
  const dir=posix.normalize(pkg.dir),manifest=posix.join(dir,"package.json")
  if(!existsSync(join(root,manifest)))continue
  const before=readFileSync(join(root,manifest),"utf8"),json=JSON.parse(before),imports={...json.imports}
  let settings
  const declarationPaths=source=>{
   if(!settings) {
    const primary=pkg.tsconfig??(sidecarConfigIn(join(root,dir))?posix.basename(sidecarConfigIn(join(root,dir))):undefined)
    const configs=primary?projectsOf(ts,join(root,dir),primary).map(file=>resolve(root,dir,file)):[]
    settings=configs.map(file=>sidecarSettings(file,ts))
    if(!settings.length)settings=[undefined]
   }
   return [...new Set(settings.map(setting=>posix.normalize(relative(root,sidecarPath(resolve(root,source),setting)).replaceAll("\\","/"))))]
  }
  const headers=source=>declarationPaths(source).filter(file=>existsSync(join(root,file)))
  const owned=files.filter(file=>owners.get(file)===dir&&!protectedFile(file))
  for(const file of owned) {
   if(!native(file)&&(!file.endsWith(".vibe")||!restore||!texts.get(file).includes(sourceDeclarationPrefix)))continue
   const text=texts.get(file),changes=[]
   const warning=(edge,reason,details={})=>warnings.push({file,line:text.slice(0,edge.start).split("\n").length,reason,...details})
   const edges=sourceTypeEdges(text,file,ts,compiler,root)
   const parsed=native(file)?ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true):undefined
   const leading=parsed?text.slice(0,parsed.statements[0]?.getStart(parsed)??text.length):""
   const generatedSource=/@generated|code generated|generated file|file is generated|do not edit/i.test(leading)||/(?:^|\/)generated\//.test(file)||/\.generated\.[cm]?tsx?$/.test(file)
   for(const edge of edges) {
    if(generatedSource) {
     if(edge.specifier.startsWith(sourceDeclarationPrefix)||resolveRelative(file,edge.specifier,all)?.endsWith(".vibe"))warning(edge,"generated native importer: update its source instead")
     continue
    }
    if(edge.specifier.startsWith(sourceDeclarationPrefix)) {
     const prior=imports[edge.specifier]
     if(!generated(prior))throw new Error(manifest+": conflicting import "+edge.specifier)
     if(restore) {
      let source=posix.normalize(posix.join(dir,prior["vibelang-source"]))
      if(!all.has(source)) {
       const stem=source.replace(/\.(?:vibe|[cm]?ts|tsx)$/,"")
       source=[".ts",".mts",".cts",".tsx"].map(ext=>stem+ext).find(file=>all.has(file))??source
      }
      const target=posix.relative(posix.dirname(file),source)
      changes.push({start:edge.start,end:edge.end,text:target.startsWith(".")?target:"./"+target})
     }
     continue
    }
    if(restore||!native(file))continue
    const source=resolveRelative(file,edge.specifier,all)
    if(!source?.endsWith(".vibe"))continue
    if(packageDirOf(root,source)!==dir) {
     warning(edge,"a private declaration route cannot cross a package boundary; retain this import for review")
     continue
    }
    const hidden=declarationPaths(source).filter(path=>path!==source.replace(/\.vibe$/,".d.vibe.ts"))
    if(!hidden.length)continue
    const candidates=hidden.filter(file=>existsSync(join(root,file)))
    if(candidates.length!==1) {
     warning(edge,candidates.length?"multiple physical compatibility declarations; retain this import for review":"compatibility declaration was not emitted; retain this import for review",{source,headers:hidden})
     continue
    }
    // Beside-source declarations already resolve for foreign native checkers.
    if(candidates[0]===source.replace(/\.vibe$/,".d.vibe.ts"))continue
    const header=targetIn(dir,candidates[0]),original=targetIn(dir,source)
    if(!contained(header)||!contained(original)) {
     warning(edge,"a private declaration route cannot target a file outside its package; retain this import for review")
     continue
    }
    const path=posix.relative(dir,source).replace(/\.vibe$/,"")
    const key=sourceDeclarationPrefix+path.split("/").map(encodeURIComponent).join("/")
    const prior=imports[key]
    if(prior&&!generated(prior))throw new Error(manifest+": conflicting import "+key)
    const runtime=emitted.get(dir)?.[original]??(generated(prior)&&prior["vibelang-source"]===original&&existsSync(join(root,dir,prior.default))?prior.default:original)
    if(!contained(runtime))throw new Error(manifest+": emitted source target leaves its package")
    imports[key]={types:header,"vibelang-source":original,default:runtime}
    changes.push({start:edge.start,end:edge.end,text:key})
    modules.push({file,source,header:candidates[0],key,runtime})
   }
   if(changes.length) {
    const after=applyEdits(text,changes)
    texts.set(file,after);write(file,after)
   }
  }
  // Keep observed routes, including those mentioned by protected files or
  // authored documentation. Restore drops only routes with no remaining use.
  for(const [key,value] of Object.entries(imports)) {
   if(!key.startsWith(sourceDeclarationPrefix)||!generated(value))continue
   const observed=files.some(file=>owners.get(file)===dir&&texts.get(file).includes(key))
   if(!observed)delete imports[key]
   else if(!restore) {
    let source=posix.normalize(posix.join(dir,value["vibelang-source"]))
    if(!all.has(source)) {
     const stem=source.replace(/\.(?:vibe|[cm]?ts|tsx)$/,"")
     source=[".vibe",".ts",".mts",".cts",".tsx"].map(ext=>stem+ext).find(file=>all.has(file))
     if(!source)throw new Error(manifest+": source declaration route has no source "+key)
    }
    const original=targetIn(dir,source)
    const candidates=source.endsWith(".vibe")?headers(source):[source]
    if(candidates.length!==1)throw new Error(manifest+": source declaration route has no unique physical declaration "+key)
    const runtime=emitted.get(dir)?.[original]??(original===value["vibelang-source"]?value.default:original)
    const target=targetIn(dir,candidates[0])
    if(!contained(target)||!contained(runtime))throw new Error(manifest+": source declaration route leaves its package "+key)
    imports[key]={types:target,"vibelang-source":original,default:runtime}
   }
  }
  if(JSON.stringify(imports)!==JSON.stringify(json.imports??{})) {
   if(Object.keys(imports).length)json.imports=imports
   else delete json.imports
   write(manifest,JSON.stringify(json,null,2)+"\n")
  }
 }
 return {edits,changed:[...edits.keys()].sort(),modules,warnings,scannedFiles:files.length,durationMs:Math.round(performance.now()-started)}
}
export function applySourceDeclarationImports(plan,{root,restore=false}) {
 for(const [file,edit] of plan.edits)writeFileSync(join(root,file),restore?edit.before:edit.after)
}
export function routeSourceDeclarationImports(options) {
 const plan=planSourceDeclarationImports(options)
 applySourceDeclarationImports(plan,{root:options.root})
 return {changed:plan.changed,modules:plan.modules,warnings:plan.warnings,scannedFiles:plan.scannedFiles,durationMs:plan.durationMs}
}
