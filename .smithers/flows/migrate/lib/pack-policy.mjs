// Export routing and packing must describe the same public runtime tree.
// Keep receipts outside js/: only js/ (including its loader records) is public.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"

const receiptPath=".vibelang/pack-policy.json"
const publicDir=".vibelang/js"
const start="# BEGIN VibeLang emitted runtime packing"
const end="# END VibeLang emitted runtime packing"
const digest=text=>createHash("sha256").update(text).digest("hex")
const textAt=file=>existsSync(file)?readFileSync(file,"utf8"):undefined
const routed=value=>typeof value==="string"?value.startsWith("./.vibelang/js/"):Array.isArray(value)?value.some(routed):!!value&&typeof value==="object"&&Object.entries(value).some(([key,item])=>!["types","typings","vibelang-source"].includes(key)&&routed(item))

export function syncPackPolicy(root,pkg) {
  const path=join(root,receiptPath)
  const receipt=existsSync(path)?JSON.parse(readFileSync(path,"utf8")):{version:1,files:[],ignores:[]}
  let changed=false
  const files=()=>["package.json",receiptPath,...receipt.ignores.map(item=>item.path)]
  if(!routed(pkg.exports)&&!routed(pkg.imports)){
    if(!existsSync(path))return {changed:false,files:[]}
    if(Array.isArray(pkg.files))pkg.files=pkg.files.filter(file=>!receipt.files.includes(file))
    for(const item of receipt.ignores){
      const file=join(root,item.path),text=textAt(file)
      if(text===undefined)continue
      if(item.created&&digest(text)===item.hash)unlinkSync(file)
      else if(text.includes(item.block))writeFileSync(file,text.replace(item.block,""))
    }
    unlinkSync(path)
    return {changed:true,files:files()}
  }
  if(Array.isArray(pkg.files)&&!pkg.files.includes(publicDir)){
    pkg.files.push(publicDir)
    if(!receipt.files.includes(publicDir))receipt.files.push(publicDir)
    changed=true
  }
  const allow=(directory,rules,required=false)=>{
    const file=join(directory,".npmignore")
    const current=textAt(file)
    const git=textAt(join(directory,".gitignore"))
    if(!required&&current===undefined&&git===undefined)return
    const block="\n"+start+"\n"+rules+"\n"+end+"\n"
    if(current?.includes(block))return
    // npm uses .gitignore only while .npmignore is absent. Preserve those
    // exclusions when creating the latter; never replace them with an empty file.
    const next=(current??git??"")+block
    mkdirSync(directory,{recursive:true})
    writeFileSync(file,next)
    receipt.ignores.push({path:relative(root,file).split(sep).join("/"),block,created:current===undefined,hash:digest(next)})
    changed=true
  }
  // A files allowlist overrides the root ignore file, but not nested ignores.
  // Without one, reopen only js/ and keep sibling private caches excluded.
  if(!Array.isArray(pkg.files))allow(root,"!/.vibelang/\n/.vibelang/*\n!/.vibelang/js/\n!/.vibelang/js/**",true)
  allow(join(root,".vibelang"),"!/js/\n!/js/**")
  const walk=directory=>{
    if(!existsSync(directory))return
    allow(directory,"!/**")
    for(const item of readdirSync(directory,{withFileTypes:true}))if(item.isDirectory())walk(join(directory,item.name))
  }
  walk(join(root,publicDir))
  if(changed){
    mkdirSync(dirname(path),{recursive:true})
    writeFileSync(path,JSON.stringify(receipt,null,2)+"\n")
  }
  return {changed,files:existsSync(path)?files():[]}
}
