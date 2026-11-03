// Child bun test processes read the bunfig in their own cwd. Test source stays
// the oracle; only the loader configuration is written (D272's approved repair).
import { existsSync, readFileSync } from "node:fs"
import { join, posix, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { listSources } from "./inventory.mjs"
import { nativeConfigDependency } from "./vite-config.mjs"
import { packageScripts, testOnlyScripts } from "./test-files.mjs"
import { minimatch } from "./vendor/minimatch.mjs"

const property = (object,name,ts) => object.properties.find(p =>
 p.name && (ts.isIdentifier(p.name)||ts.isStringLiteralLike(p.name)) && p.name.text===name)
const unwrap = (node,ts) => {
 while(node&&(ts.isParenthesizedExpression(node)||ts.isAsExpression(node)||ts.isSatisfiesExpression(node)||ts.isNonNullExpression(node)))node=node.expression
 return node
}
function launches(text,file,owner,root,ts) {
 const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.getScriptKindFromFileName(file))
 const options={noLib:true,noResolve:true,allowJs:true}
 const host={...ts.createCompilerHost(options),getSourceFile:name=>name===file?source:undefined}
 const checker=ts.createProgram({rootNames:[file],options,host}).getTypeChecker()
 const symbol=node=>node.parent&&ts.isShorthandPropertyAssignment(node.parent)
  ? checker.getShorthandAssignmentValueSymbol(node.parent):checker.getSymbolAtLocation(node)
 const imported=(node,module,name)=>{
  for(const d of symbol(node)?.declarations??[]){
   let declaration=d
   while(declaration&&!ts.isImportDeclaration(declaration))declaration=declaration.parent
   if(!declaration||!new Set([module,"node:"+module]).has(declaration.moduleSpecifier.text))continue
   if(name==="*"&&(ts.isNamespaceImport(d)||ts.isImportClause(d)))return true
   if(ts.isImportSpecifier(d)&&(d.propertyName??d.name).text===name&&!d.isTypeOnly)return true
  }
  return false
 }
 const meta=(node,name)=>ts.isPropertyAccessExpression(node)&&node.name.text===name&&
  ts.isMetaProperty(node.expression)&&node.expression.keywordToken===ts.SyntaxKind.ImportKeyword
 const value=(node,seen=new Set())=>{
  node=unwrap(node,ts)
  if(!node||seen.has(node))return undefined
  seen=new Set([...seen,node])
  const next=n=>value(n,seen)
  if(ts.isStringLiteralLike(node))return node.text
  if(ts.isIdentifier(node)){
   const d=symbol(node)?.declarations?.find(ts.isVariableDeclaration)
   return d&&d.parent.flags&ts.NodeFlags.Const?next(d.initializer):undefined
  }
  if(meta(node,"dirname"))return resolve(root,posix.dirname(file))
  if(ts.isArrayLiteralExpression(node)){
   const values=node.elements.map(next)
   return values.every(v=>typeof v==="string")?values:undefined
  }
  if(ts.isNewExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==="URL"&&
   !symbol(node.expression)&&node.arguments?.length===2&&meta(node.arguments[1],"url")){
   const part=next(node.arguments[0])
   if(typeof part!=="string"||/[?#]|%2f|%5c/i.test(part))return undefined
   const url=new URL(part,pathToFileURL(resolve(root,file)))
   return url.protocol==="file:"?url:undefined
  }
  if(!ts.isCallExpression(node))return undefined
  const callee=node.expression
  if(ts.isIdentifier(callee)&&imported(callee,"url","fileURLToPath")){
   const url=next(node.arguments[0])
   return url instanceof URL?fileURLToPath(url):undefined
  }
  let method
  if(ts.isPropertyAccessExpression(callee)&&ts.isIdentifier(callee.expression)&&imported(callee.expression,"path","*"))method=callee.name.text
  if(ts.isIdentifier(callee))for(const name of ["join","resolve"])if(imported(callee,"path",name))method=name
  if(!["join","resolve"].includes(method))return undefined
  const args=node.arguments.map(next)
  if(!args.every(v=>typeof v==="string"))return undefined
  return method==="join"?posix.join(...args):resolve(root,owner,...args)
 }
 const calls=[]
 const visit=node=>{
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&
   ts.isIdentifier(node.expression.expression)&&node.expression.expression.text==="Bun"&&
   !symbol(node.expression.expression)&&["spawn","spawnSync"].includes(node.expression.name.text)){
   let args=node.arguments[0],options=node.arguments[1]
   if(args&&ts.isObjectLiteralExpression(unwrap(args,ts))){
    options=unwrap(args,ts)
    args=property(options,"cmd",ts)?.initializer
   }
   const argv=value(args)
   if(Array.isArray(argv)&&posix.basename(argv[0]??"").replace(/\.exe$/i,"").toLowerCase()==="bun"&&argv[1]==="test"){
    options=unwrap(options,ts)
    const cwd=options&&ts.isObjectLiteralExpression(options)?property(options,"cwd",ts):undefined
    const expression=cwd&&(ts.isShorthandPropertyAssignment(cwd)?cwd.name:cwd.initializer)
    calls.push({argv,cwd:cwd?value(expression):resolve(root,owner),
     line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1})
   }
  }
  ts.forEachChild(node,visit)
 }
 visit(source)
 return calls
}

export function wireBunFixtureTests({root,packages,parents,ts,write,addPreload,foreign=()=>false}){
 const owners=new Set(),warnings=[]
 if(!ts)return {owners,warnings}
 const files=listSources(root,"."),reach=new Map()
 const reaches=file=>{
  if(!reach.has(file))reach.set(file,nativeConfigDependency({root,file,packages,ts}))
  return reach.get(file)
 }
 for(const pkg of parents){
  const scripts=packageScripts(root,pkg.dir)
  const tests=testOnlyScripts(root,pkg.dir,scripts,pkg.manifest)
  for(const file of tests){
   const text=readFileSync(join(root,file),"utf8")
   if(!/\bBun\s*\.\s*spawn(?:Sync)?\s*\(/.test(text))continue
   for(const call of launches(text,file,pkg.dir,root,ts)){
    const warning=reason=>warnings.push(file+":"+call.line+": Bun fixture "+reason+"; add its cwd-local test preload by hand")
    if(typeof call.cwd!=="string"){warning("cwd is not statically resolvable");continue}
    const absolute=resolve(root,pkg.dir,call.cwd),directory=posix.relative(root,absolute)
    if(directory===".."||directory.startsWith("../")){warning("cwd leaves the target");continue}
    if(foreign(posix.join(directory,"bunfig.toml"))){warning("cwd belongs to a foreign submodule");continue}
    const patterns=call.argv.slice(2).filter(a=>!a.startsWith("-")&&(/\.[cm]?[jt]sx?$/.test(a)||/[*?{]/.test(a)))
    const seeds=files.filter(f=>{
     const relative=posix.relative(directory,f)
     if(relative===".."||relative.startsWith("../"))return false
     return patterns.length?patterns.some(p=>minimatch(relative,p.replace(/^\.\//,""),{dot:true})):
      /[._](?:test|spec)\.[cm]?[jt]sx?$/.test(f)
    })
    if(!seeds.some(reaches))continue
    const config=posix.join(directory,"bunfig.toml")
    const before=existsSync(join(root,config))?readFileSync(join(root,config),"utf8"):""
    try{write(config,before,addPreload(before));owners.add(pkg.dir)}
    catch(error){warning(error.message)}
   }
  }
 }
 return {owners,warnings}
}
