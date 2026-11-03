import { sameGeneratedCode } from "./generated-helper-shape.mjs"
// Adapt private canonical helper bindings to the launcher's native import policy.
// The core generator still checks ownership against its canonical template.
const marker = "/* VibeLang source-child binding. */"
const helperName = /^__vibelangSourceChild\d*$/
function parse(text, ts, file) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.getScriptKindFromFileName(file))
  const options = { noLib: true, noResolve: true, allowJs: true }
  const host = { ...ts.createCompilerHost(options), getSourceFile: name => name === file ? source : undefined }
  const checker = ts.createProgram({ rootNames: [file], options, host }).getTypeChecker()
  const helpers = source.statements.filter(node => ts.isFunctionDeclaration(node) && helperName.test(node.name?.text ?? ""))
  const inside = node => helpers.some(helper => helper.pos <= node.pos && node.end <= helper.end)
  const walk = (node, visit) => {
    visit(node)
    ts.forEachChild(node, child => { walk(child, visit) })
    for (const doc of node.jsDoc ?? []) walk(doc, visit)
  }
  const references = name => {
    const binding = checker.getSymbolAtLocation(name), result = []
    walk(source, node => {
      if (!ts.isIdentifier(node) || node === name) return
      let value = checker.getSymbolAtLocation(node)
      if (ts.isShorthandPropertyAssignment(node.parent)) value = checker.getShorthandAssignmentValueSymbol(node.parent) ?? value
      if (ts.isExportSpecifier(node.parent)) value = checker.getExportSpecifierLocalTargetSymbol(node.parent) ?? value
      if (binding && value === binding) result.push(node)
    })
    return result
  }
  return { source, helpers, inside, walk, references }
}
const apply = (text, edits) => {
  for (const edit of edits.sort((a,b) => b.start-a.start || b.end-a.end)) text = text.slice(0,edit.start) + edit.text + text.slice(edit.end)
  return text
}
const roles = [
  { member: "Schema", module: "effect", canonical: "effect/Schema", prefix: "__vibelangSchema", namespace: true },
  { member: "fileURLToPath", module: "node:url", canonical: "node:url", prefix: "__vibelangNodeURL", namespace: false },
]
export function canonicalSourceChildImports(text, ts, file) {
  if (!text.includes("// VibeLang source-child loader arguments.")) return text
  const context = parse(text, ts, file), {source,helpers,inside,references,walk} = context
  if (!helpers.length || source.parseDiagnostics.length) return text
  const names = new Set(), edits = [], imports = []
  walk(source,node => { if(ts.isIdentifier(node)) names.add(node.text) })
  for (const role of roles) {
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== role.module || statement.importClause?.isTypeOnly) continue
      const named = statement.importClause?.namedBindings
      if (!named || !ts.isNamedImports(named)) continue
      for (const item of named.elements) {
        if (item.isTypeOnly || item.propertyName || item.name.text !== role.member) continue
        const refs = references(item.name), owned = refs.filter(inside)
        if (!owned.length) continue
        let name = role.prefix
        for(let i=2;names.has(name);i++) name=role.prefix+i
        names.add(name)
        imports.push('import * as '+name+' from "'+role.canonical+'"')
        for (const node of owned) edits.push({start:node.getStart(source),end:node.end,text:name+(role.namespace?"":".fileURLToPath")})
        // Only our marked, otherwise unobserved import may disappear on prune.
        if (sameGeneratedCode(statement.getText(source), 'import { '+marker+' '+item.name.text+' } from "'+role.module+'"', ts) && named.elements.length===1 &&
            !statement.importClause.name && refs.every(inside)) {
          const newline=/^\r?\n/.exec(text.slice(statement.end))?.[0].length??0
          edits.push({start:statement.getStart(source),end:statement.end+newline,text:""})
        }
        break
      }
      if (imports.some(line=>line.endsWith('"'+role.canonical+'"'))) break
    }
  }
  if (!edits.length) return text
  let index=0
  while(index<source.statements.length && ts.isExpressionStatement(source.statements[index]) && ts.isStringLiteralLike(source.statements[index].expression)) index++
  const at=source.statements[index]?.getStart(source)??text.length
  // Compose an insertion at the start of a removed import as a single edit.
  const removed=edits.find(edit=>edit.start===at && edit.end>at && !edit.text)
  if(removed) removed.text=imports.join("\n")+"\n"
  else edits.push({start:at,end:at,text:imports.join("\n")+"\n"})
  return apply(text,edits)
}
export function nativeSourceChildImports(text, ts, file) {
  const {source,helpers,inside,references,walk}=parse(text,ts,file)
  if (!helpers.length || source.parseDiagnostics.length) return {text,refusals:[]}
  const edits=[],refusals=[]
  for(const role of roles) {
    const statement=source.statements.find(node=>{
      const named=node.importClause?.namedBindings
      return ts.isImportDeclaration(node) && node.moduleSpecifier.text===role.canonical &&
        !node.importClause?.isTypeOnly && !node.importClause?.name && named && ts.isNamespaceImport(named) &&
        new RegExp("^"+(role.namespace?"__vibelangSchema":"__vibelang(?:NodeURL|FileURLToPath)")+"\\d*$").test(named.name.text)
    })
    if(!statement) continue
    const binding=statement.importClause.namedBindings.name, refs=references(binding)
    const refuse=reason=>refusals.push({line:source.getLineAndCharacterOfPosition(statement.getStart(source)).line+1,reason})
    if(!refs.length || refs.some(node=>!inside(node)) ||
        (!role.namespace && refs.some(node=>!ts.isPropertyAccessExpression(node.parent) || node.parent.expression!==node || node.parent.name.text!=="fileURLToPath"))) {
      refuse("generated source-child import has manual observations; retain it for import policy review")
      continue
    }
    let existing
    for(const node of source.statements) {
      if(!ts.isImportDeclaration(node) || node.moduleSpecifier.text!==role.module || node.importClause?.isTypeOnly) continue
      const named=node.importClause?.namedBindings
      if(named && ts.isNamedImports(named)) existing=named.elements.find(item=>!item.isTypeOnly && !item.propertyName && item.name.text===role.member)
      if(existing) break
    }
    let collision=false
    if(!existing) walk(source,node=>{if(ts.isIdentifier(node) && node.text===role.member &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.name===node) &&
      !(ts.isImportSpecifier(node.parent) && node.parent.propertyName===node)) collision=true})
    if(collision) {
      refuse("source-child "+role.member+" import conflicts with an authored binding; choose its native import binding by hand")
      continue
    }
    for(const node of refs) {
      const target=role.namespace?node:node.parent
      edits.push({start:target.getStart(source),end:target.end,text:role.member})
    }
    const newline=/^\r?\n/.exec(text.slice(statement.end))?.[0].length??0
    edits.push({start:statement.getStart(source),end:statement.end+(existing?newline:0),
      text:existing?"":'import { '+marker+' '+role.member+' } from "'+role.module+'"'})
  }
  return {text:apply(text,edits),refusals}
}

// Temporary canonical imports must not move a refusal away from its source.
export function sourceChildImportRefusals(original, canonical, refusals, ts, file) {
  if (original === canonical || !refusals.length) return refusals
  const parse = text => ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.getScriptKindFromFileName(file))
  const before = parse(original), after = parse(canonical)
  const functions = source => source.statements.filter(node=>ts.isFunctionDeclaration(node)&&helperName.test(node.name?.text??""))
  const ranges = functions(after).flatMap(node=>{
    const prior = functions(before).find(candidate=>candidate.name.text===node.name.text)
    if(!prior) return []
    const first=after.getLineAndCharacterOfPosition(node.getStart(after)).line+1
    const last=after.getLineAndCharacterOfPosition(node.end).line+1
    const delta=before.getLineAndCharacterOfPosition(prior.getStart(before)).line+1-first
    return [{first,last,delta}]
  })
  return refusals.map(refusal=>{
    const range=ranges.find(item=>item.first<=refusal.line && refusal.line<=item.last)
    return range?{...refusal,line:refusal.line+range.delta}:refusal
  })
}
