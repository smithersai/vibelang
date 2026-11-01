// A test may already receive the native adapter from a source plugin set.
// Prove an unconditional plugin, following only present ESM exports and const
// bindings; a package name or a plugin-looking identifier is not proof.
import { readFileSync } from "node:fs"
import { join } from "node:path"

export function nativeBundleProof(root, ts, resolveModule) {
  const parsed = new Map()
  const parse = file => {
    if (!parsed.has(file)) {
      const source = ts.createSourceFile(file, readFileSync(join(root,file),"utf8"), ts.ScriptTarget.Latest, true, ts.getScriptKindFromFileName(file))
      const options = {noLib:true,noResolve:true,allowJs:true}
      const host = {...ts.createCompilerHost(options), getSourceFile:name=>name===file?source:undefined}
      parsed.set(file,{source,checker:ts.createProgram({rootNames:[file],options,host}).getTypeChecker()})
    }
    return parsed.get(file)
  }
  const unwrap = node => {
    while(node && (ts.isParenthesizedExpression(node)||ts.isAsExpression(node)||ts.isSatisfiesExpression(node)||ts.isNonNullExpression(node)))node=node.expression
    return node
  }
  const imported = declaration => {
    let node=declaration
    while(node && !ts.isImportDeclaration(node))node=node.parent
    return node && ts.isStringLiteralLike(node.moduleSpecifier)?node.moduleSpecifier.text:null
  }
  const fromExport = (file,name,adapter,seen) => {
    const key=file+"#"+name+"#"+adapter
    if(seen.has(key))return false
    seen=new Set(seen).add(key)
    const {source,checker}=parse(file)
    for(const node of source.statements){
      if(name==="default" && ts.isExportAssignment(node))return value(node.expression,checker,file,adapter,seen)
      if(node.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)){
        if(ts.isFunctionDeclaration(node) && node.name?.text===name)return value(node,checker,file,adapter,seen)
        if(ts.isVariableStatement(node))for(const d of node.declarationList.declarations){
          if(ts.isIdentifier(d.name)&&d.name.text===name)return value(d.initializer,checker,file,adapter,seen)
        }
      }
      if(ts.isExportDeclaration(node)){
        const target=node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)?node.moduleSpecifier.text:null
        if(node.exportClause && ts.isNamedExports(node.exportClause))for(const item of node.exportClause.elements){
          if(item.name.text!==name || item.isTypeOnly || node.isTypeOnly)continue
          const original=(item.propertyName??item.name).text
          if(target){
            const paths=resolveModule(file,target)
            return paths.length>0 && paths.every(path=>fromExport(path,original,adapter,seen))
          }
          const symbol=checker.getExportSpecifierLocalTargetSymbol?.(item)??checker.getSymbolAtLocation(item.propertyName??item.name)
          return symbol?.declarations?.some(d=>value(d,checker,file,adapter,seen))??false
        }
        if(!node.exportClause && target && name!=="default"){
          if(resolveModule(file,target).some(path=>fromExport(path,name,adapter,seen)))return true
        }
      }
    }
    return false
  }
  const value = (node,checker,file,adapter,seen=new Set()) => {
    node=unwrap(node)
    if(!node || seen.has(node))return false
    seen=new Set(seen).add(node)
    if(ts.isArrayLiteralExpression(node))return node.elements.some(e=>value(ts.isSpreadElement(e)?e.expression:e,checker,file,adapter,seen))
    if(ts.isConditionalExpression(node))return value(node.whenTrue,checker,file,adapter,seen)&&value(node.whenFalse,checker,file,adapter,seen)
    if(ts.isVariableDeclaration(node)){
      return Boolean(node.parent.flags&ts.NodeFlags.Const)&&value(node.initializer,checker,file,adapter,seen)
    }
    if(ts.isFunctionLike(node)){
      if(!node.body)return false
      if(!ts.isBlock(node.body))return value(node.body,checker,file,adapter,seen)
      if(!node.body.statements.length || !ts.isReturnStatement(node.body.statements.at(-1)))return false
      const returns=[]
      const visit=child=>{
        if(child!==node.body && ts.isFunctionLike(child))return
        if(ts.isReturnStatement(child))returns.push(child.expression)
        else ts.forEachChild(child,visit)
      }
      visit(node.body)
      return returns.length>0 && returns.every(result=>value(result,checker,file,adapter,seen))
    }
    if(ts.isIdentifier(node)){
      const symbol=ts.isShorthandPropertyAssignment(node.parent)?checker.getShorthandAssignmentValueSymbol(node.parent):checker.getSymbolAtLocation(node)
      return symbol?.declarations?.some(d=>value(d,checker,file,adapter,seen))??false
    }
    if(!ts.isCallExpression(node))return false
    const callee=unwrap(node.expression)
    const identifier=ts.isIdentifier(callee)?callee:ts.isPropertyAccessExpression(callee)&&ts.isIdentifier(callee.expression)?callee.expression:null
    if(!identifier)return false
    const declarations=checker.getSymbolAtLocation(identifier)?.declarations??[]
    for(const d of declarations){
      const specifier=imported(d)
      if(specifier){
        const exportName=ts.isImportClause(d)?"default":ts.isImportSpecifier(d)?(d.propertyName??d.name).text
          :ts.isNamespaceImport(d)&&ts.isPropertyAccessExpression(callee)?callee.name.text:null
        if(!exportName)continue
        if((specifier==="vibelang-unplugin/"+adapter || adapter==="vite" && specifier==="vibelang-vite") && exportName==="default")return true
        const targets=resolveModule(file,specifier)
        if(targets.length && targets.every(target=>fromExport(target,exportName,adapter,seen)))return true
      }else if(value(d,checker,file,adapter,seen))return true
    }
    return false
  }
  return (node,checker,file,bundler)=>value(node,checker,file,bundler==="Bun.build"?"bun":bundler)
}
