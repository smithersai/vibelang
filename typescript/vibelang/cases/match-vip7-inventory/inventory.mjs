import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import {createRequire} from "node:module"
import {fileURLToPath,pathToFileURL} from "node:url"
const here=path.dirname(fileURLToPath(import.meta.url))
const effectRoot=process.env.VIP7_PINNED_NODE_MODULES?path.join(process.env.VIP7_PINNED_NODE_MODULES,"effect"):path.resolve(here,"../../../.cache/match-vip7-reference/node_modules/effect")
assert.equal(JSON.parse(fs.readFileSync(effectRoot+"/package.json")).version,"4.1.0")
const ts=createRequire(path.join(effectRoot,"package.json"))("typescript")
assert.equal(ts.version,"5.9.3")
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()&&e.name!=="internal"?walk(path.join(dir,e.name)):e.isFile()&&e.name.endsWith(".d.ts")?[path.join(dir,e.name)]:[])
const candidates=walk(effectRoot+"/dist").filter(file=>/export declare (?:const|function) is[A-Z]\w*Error\b/.test(fs.readFileSync(file,"utf8")))
const program=ts.createProgram(candidates,{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,skipLibCheck:true})
const checker=program.getTypeChecker()
const found=[]
for(const file of candidates){
 const sf=program.getSourceFile(file)
 const exports=new Map(checker.getExportsOfModule(checker.getSymbolAtLocation(sf)).map(s=>[s.name,s]))
 const guards=[...sf.text.matchAll(/export declare (?:const|function) (is[A-Z]\w*Error)\b/g)].map(m=>m[1])
 for(const guard of guards){
  const ctor=guard.slice(2),symbol=exports.get(ctor)
  if(!symbol)continue
  const signatures=checker.getTypeOfSymbolAtLocation(symbol,sf).getConstructSignatures()
  if(!signatures.length)continue
  const instance=checker.getReturnTypeOfSignature(signatures[0])
  const property=checker.getPropertyOfType(instance,"_tag")
  if(!property)continue
  const tag=checker.getTypeOfSymbolAtLocation(property,sf)
  if(!(tag.flags&ts.TypeFlags.StringLiteral))continue
  const module=path.relative(effectRoot+"/dist",file).replace(/\.d\.ts$/,"").replaceAll(path.sep,"/")
  found.push({key:module+":"+ctor,file,guard,tag:tag.value})
 }
}
assert.deepEqual(found.map(x=>x.key).sort(),JSON.parse(fs.readFileSync(path.join(here,"expected-inventory.json"))))
const brands=JSON.parse(fs.readFileSync(path.join(here,"expected-brands.json")))
for(const item of found){
 const mod=await import(pathToFileURL(item.file.replace(/\.d\.ts$/,".js")))
 const ctor=item.guard.slice(2)
 assert.equal(typeof mod[ctor],"function",item.key+" must have a runtime constructor export")
 assert.equal(mod[item.guard]({_tag:item.tag}),false,item.key+" must check its brand")
 assert.equal(mod[item.guard]({_tag:item.tag,[brands[item.key]]:brands[item.key]}),true,item.key+" accepts its brand-carrying package copy")
}
assert.equal(found.length+6,39)
console.log("inventory: 33 guarded errors plus 6 Option/Exit/Result cases")
