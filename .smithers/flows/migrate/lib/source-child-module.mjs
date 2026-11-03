// A generated launcher can be private inside the migrated file (VIP-40).
// Its native imports must not become platform globals in Vibe code.
import { readFileSync } from "node:fs"
import { canonicalSourceChildImports, sourceChildImportRefusals } from "./source-child-imports.mjs"
const template = readFileSync(new URL("../templates/source-child.ts", import.meta.url), "utf8")
const marker = "// VibeLang source-child loader arguments."

export function sourceChildModule(text, file, ts) {
  const canonical = canonicalSourceChildImports(text, ts, file)
  const result = canonicalSourceChildModule(canonical, file, ts)
  if (!result.converted.length) return {...result,text,refused:sourceChildImportRefusals(text,canonical,result.refused,ts,file)}
  return result
}

function canonicalSourceChildModule(text, file, ts) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const unchanged = { text, converted: [], refused: [] }
  if (!text.includes(marker) || source.parseDiagnostics.length) return unchanged
  const helpers = source.statements.filter(node => ts.isFunctionDeclaration(node) && /^__vibelangSourceChild\d*$/.test(node.name?.text ?? ""))
  if (!helpers.length) return unchanged
  const options = { noLib: true, noResolve: true }
  const host = { ...ts.createCompilerHost(options), getSourceFile: name => name === file ? source : undefined }
  const checker = ts.createProgram({ rootNames: [file], options, host }).getTypeChecker()
  const symbol = node => checker.getSymbolAtLocation(node)
  const references = binding => {
    const nodes = []
    const visit = node => {
      let target = ts.isIdentifier(node) ? symbol(node) : undefined
      if (ts.isIdentifier(node) && ts.isShorthandPropertyAssignment(node.parent)) target = checker.getShorthandAssignmentValueSymbol(node.parent) ?? target
      if (ts.isIdentifier(node) && ts.isExportSpecifier(node.parent)) target = checker.getExportSpecifierLocalTargetSymbol(node.parent) ?? target
      if (target === binding) nodes.push(node)
      ts.forEachChild(node, visit)
    }
    visit(source)
    return nodes
  }
  const launchers = new Map()
  for (const declaration of source.statements) {
    if (!ts.isImportDeclaration(declaration) || declaration.importClause?.isTypeOnly) continue
    const specifier = declaration.moduleSpecifier.text
    const methods = specifier === "effect/process/ChildProcess" ? new Set(["make"])
      : ["node:child_process", "child_process"].includes(specifier) ? new Set(["spawn", "spawnSync"]) : null
    if (!methods) continue
    const clause = declaration.importClause, named = clause?.namedBindings
    if (clause?.name) launchers.set(symbol(clause.name), { namespace: true, methods })
    if (named && ts.isNamespaceImport(named)) launchers.set(symbol(named.name), { namespace: true, methods })
    if (named && ts.isNamedImports(named)) for (const binding of named.elements) {
      if (!binding.isTypeOnly && methods.has((binding.propertyName ?? binding.name).text)) launchers.set(symbol(binding.name), { namespace: false, methods })
    }
  }
  const ownedCall = node => {
    if (!ts.isCallExpression(node.parent) || node.parent.expression !== node ||
      !ts.isSpreadElement(node.parent.parent) || !ts.isCallExpression(node.parent.parent.parent) || node.parent.arguments.length !== 2) return false
    const callee = node.parent.parent.parent.expression
    if (ts.isIdentifier(callee)) return launchers.get(symbol(callee))?.namespace === false
    if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) return false
    const launcher = launchers.get(symbol(callee.expression))
    return launcher?.namespace === true && launcher.methods.has(callee.name.text)
  }
  const names = new Set()
  const collect = node => { if (ts.isIdentifier(node)) names.add(node.text); ts.forEachChild(node, collect) }
  collect(source)
  const fresh = base => { let name=base; for(let n=2;names.has(name);n++)name=base+n;names.add(name);return name }
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
  const print = (node, context=source) => printer.printNode(ts.EmitHint.Unspecified,node,context).trim()
  const edits=[], converted=[], refused=[]
  for (const helper of helpers) {
    const line=source.getLineAndCharacterOfPosition(helper.getStart(source)).line+1
    const refuse=reason=>refused.push({ file, line, reason })
    const inside=node=>helper.pos<=node.pos && node.end<=helper.end
    const imports = []
    for (const specifier of ["node:url","effect/Schema"]) {
      const declaration=source.statements.find(node=>ts.isImportDeclaration(node) &&
        node.moduleSpecifier.text===specifier && !node.importClause?.isTypeOnly &&
        node.importClause?.namedBindings && ts.isNamespaceImport(node.importClause.namedBindings) &&
        references(symbol(node.importClause.namedBindings.name)).some(inside))
      if(declaration)imports.push(declaration)
    }
    if(imports.length!==2){refuse("source-child helper has no dedicated canonical imports; retain it for review");continue}
    const [urlImport,schemaImport]=imports
    const url=urlImport.importClause.namedBindings.name.text
    const schema=schemaImport.importClause.namedBindings.name.text
    const canonical=template.replaceAll("__vibelangSourceChild",helper.name.text).replaceAll("__vibelangNodeURL",url).replaceAll("__vibelangSchema",schema)
    const expected=ts.createSourceFile(file,canonical,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
    if(print(helper)!==print(expected.statements.find(ts.isFunctionDeclaration),expected)){
      refuse("source-child helper has manual edits; retain it for review");continue
    }
    const calls=references(symbol(helper.name)).filter(node=>node!==helper.name)
    if(!calls.length || calls.some(node=>!ownedCall(node))){
      refuse("source-child helper has manual observations; retain it for review");continue
    }
    if(imports.some(decl=>references(symbol(decl.importClause.namedBindings.name)).some(node=>node!==decl.importClause.namedBindings.name && !inside(node)))){
      refuse("source-child helper shares authored imports; retain it for review");continue
    }
    const moduleName=fresh("__vibelangSourceChildPlatform"), parent=fresh("__vibelangParentURL")
    const f=ts.factory
    const prop=(object,key)=>f.createPropertyAccessExpression(object,key)
    const call=(expression,args)=>f.createCallExpression(expression,undefined,args)
    const resolved=call(prop(call(f.createIdentifier("createRequire"),[f.createIdentifier(parent)]),"resolve"),[f.createIdentifier("specifier")])
    // These two compiler exports are file targets for both Node conditions.
    // Return a URL just as import.meta.resolve did, including escaped paths.
    const loader=prop(call(f.createIdentifier("pathToFileURL"),[resolved]),"href")
    const resolver=f.createArrowFunction(undefined,undefined,[f.createParameterDeclaration(undefined,undefined,"specifier")],undefined,f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),loader)
    const old=helper.parameters[2]
    const parameter=f.updateParameterDeclaration(old,old.modifiers,old.dotDotDotToken,old.name,old.questionToken,old.type,resolver)
    const parentParameter=f.createParameterDeclaration(undefined,undefined,parent,undefined,f.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),f.createStringLiteral(""))
    const fn=f.updateFunctionDeclaration(helper,[f.createModifier(ts.SyntaxKind.ExportKeyword)],helper.asteriskToken,helper.name,helper.typeParameters,[...helper.parameters.slice(0,2),parameter,parentParameter],helper.type,helper.body)
    const transformed=ts.transform(fn,[context=>node=>{
      const visit=node=>{
        if(ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text===url && node.name.text==="fileURLToPath") return f.createIdentifier("fileURLToPath")
        if(ts.isIdentifier(node) && node.text===schema) return f.createIdentifier("Schema")
        return ts.visitEachChild(node,visit,context)
      }
      return ts.visitNode(node,visit)
    }])
    const body=['import { createRequire } from "node:module"','import { fileURLToPath, pathToFileURL } from "node:url"','import { Schema } from "effect"',print(transformed.transformed[0])].join("\n\n")
    transformed.dispose()
    const rendered="module "+moduleName+" {\n"+body.split("\n").map(line=>line?"  "+line:"").join("\n")+"\n}\nimport { "+helper.name.text+" } from "+moduleName+"\n"
    const at=Math.min(...imports.map(node=>node.getStart(source)))
    edits.push({start:at,end:at,text:rendered})
    for(const declaration of imports)edits.push({start:declaration.getStart(source),end:declaration.end,text:""})
    edits.push({start:helper.getFullStart(),end:helper.end,text:""})
    for(const node of calls)edits.push({start:node.parent.arguments.at(-1).end,end:node.parent.arguments.at(-1).end,text:", undefined, import.meta.url"})
    converted.push({file,line,helper:helper.name.text,module:moduleName,resolver:"createRequire(parentURL)",preloads:["vibelang/register","vibelang/bun"]})
  }
  let after=text
  for(const edit of edits.sort((a,b)=>b.start-a.start||b.end-a.end))after=after.slice(0,edit.start)+edit.text+after.slice(edit.end)
  return {text:after,converted,refused}
}

export function prepareSourceChildModules(files, ts, {read,write}) {
  const converted=[],refused=[]
  for(const file of files){
    const result=sourceChildModule(read(file),file,ts)
    if(result.text!==read(file))write(file,result.text)
    converted.push(...result.converted);refused.push(...result.refused)
  }
  return {converted,refused}
}
