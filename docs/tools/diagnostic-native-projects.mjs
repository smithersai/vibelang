// Reproduce the native harness's dependency host without modifying its cases.
import {cpSync,existsSync,mkdirSync,readFileSync,readdirSync,rmSync,symlinkSync} from "node:fs"
import {basename,join,relative,resolve,sep} from "node:path"

export function nativeProjectHost(root,base) {
 const original=resolve(root,"typescript/vibelang/cases"),isolated=join(base,"typescript/vibelang/cases")
 mkdirSync(join(base,"typescript/vibelang"),{recursive:true})
 for(const [source,destination,branch] of [[root,base,"typescript"],[join(root,"typescript"),join(base,"typescript"),"vibelang"],[join(root,"typescript/vibelang"),join(base,"typescript/vibelang"),"cases"]]) {
  for(const entry of readdirSync(source,{withFileTypes:true})) {
   if(entry.name===branch||entry.name.startsWith(".")||entry.name==="node_modules")continue
   const at=join(destination,entry.name)
   if(!existsSync(at))symlinkSync(resolve(source,entry.name),at)
  }
 }
 // Thousands of cases stay links, so sibling imports resolve at no cost, and
 // prepare copies a project before its compiler can write sidecars there.
 const notModules=path=>basename(path)!=="node_modules"
 mkdirSync(isolated,{recursive:true})
 for(const entry of readdirSync(original,{withFileTypes:true})) {
  if(entry.name==="node_modules")continue
  if(entry.isDirectory())symlinkSync(join(original,entry.name),join(isolated,entry.name))
  else cpSync(join(original,entry.name),join(isolated,entry.name))
 }
 const modules=resolve(process.env.EFFECT_NODE_MODULES??join(root,"experiments/node_modules"))
 const runtime=resolve(process.env.VIBELANG_RUNTIME??join(root,"packages/runtime"))
 const prepared=new Set(),copied=new Set()
 const project=path=>{
  path=resolve(root,path)
  if(!path.startsWith(original+sep))throw Error("diagnostic project is outside native cases")
  return join(isolated,relative(original,path))
 }
 const prepare=path=>{
  const dir=project(path)
  if(prepared.has(dir))return dir
  const caseName=relative(isolated,dir).split(sep)[0]
  if(!copied.has(caseName)) {
   rmSync(join(isolated,caseName),{recursive:true,force:true})
   cpSync(join(original,caseName),join(isolated,caseName),{recursive:true,filter:notModules})
   copied.add(caseName)
  }
  const target=join(dir,"node_modules")
  rmSync(target,{recursive:true,force:true})
  mkdirSync(target,{recursive:true})
  const link=(source,name)=>{
   const at=join(target,name);mkdirSync(resolve(at,".."),{recursive:true})
   rmSync(at,{recursive:true,force:true});symlinkSync(source,at)
  }
  link(join(modules,"effect"),"effect")
  const destination=join(target,"vibelang-runtime"),manifest=JSON.parse(readFileSync(join(runtime,"package.json"),"utf8"))
  mkdirSync(destination)
  for(const file of ["package.json",...manifest.files]) {
   if(existsSync(join(runtime,file)))cpSync(join(runtime,file),join(destination,file),{recursive:true,dereference:true})
  }
  installFixturePeers(dir,modules,runtime)
  prepared.add(dir)
  return dir
 }
 return {project,prepare}
}

// Archives also carry native stubs and explicit peers; writing their files
// happens before any default links, so an owned peer cannot overwrite a pin.
export function installFixturePeers(dir,modules,runtime) {
 const target=join(dir,"node_modules")
 const link=(source,name)=>{
  const at=join(target,name);mkdirSync(resolve(at,".."),{recursive:true})
  rmSync(at,{recursive:true,force:true});symlinkSync(source,at)
 }
  const stubs=join(dir,"stubs")
  for(const name of existsSync(stubs)?readdirSync(stubs):[]) {
   const manifest=join(stubs,name,"package.json")
   if(existsSync(manifest))link(join(stubs,name),JSON.parse(readFileSync(manifest,"utf8")).name)
  }
  const declared=join(dir,"package.json")
  const dependencies=existsSync(declared)?JSON.parse(readFileSync(declared,"utf8")).dependencies??{}:{}
  for(const name of Object.keys(dependencies)) {
   if(existsSync(join(target,name)))continue
   const source=[join(modules,name),join(runtime,"node_modules",name)].find(existsSync)
   if(!source)throw Error("case dependency "+name+" is not installed in the pinned diagnostic host")
   link(source,name)
  }
 }
