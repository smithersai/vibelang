// Generate both D252 ABIs from D152's module list and pinned declarations.
// Run with bun; --check makes generated output part of the drift gate.
import ts from 'typescript'
import fs from 'node:fs'
import path from 'node:path'
// Type-only emission keeps unused proven calls tree-shakeable; the shared
// overload interfaces also preserve Exit's structural subtype of Effect.
const root = path.resolve(import.meta.dir, '../../../..')
const fork = fs.readFileSync(root + '/typescript/tsc/internal/vibelang/datamethods.go', 'utf8')
const modules = [...fork.match(/var methodModules = map\[string\]bool\{([\s\S]*?)\n\}/)![1].matchAll(/"(\w+)":\s*true/g)].map(m => m[1]).sort()
// D295: data-first functions whose receiver is not named self, such as
// Cause.findErrorOption(input), by the parameter name the fork accepts.
const dataFirst = new Map([...fork.match(/var dataFirstParameters = map\[string\]string\{([\s\S]*?)\n\}/)![1].matchAll(/"(\w+\.\w+)":\s*"(\w+)"/g)].map(m => [m[1], m[2]] as const))
const takesSelfFirst = (mod: string, name: string, first: string) => first === 'self' || first.endsWith('OrOptions') || dataFirst.get(mod + '.' + name) === first
const effectDir = root+'/docs/tools/node_modules/effect/dist'
const declarations = new Map(modules.map(mod=>[mod, effectDir+'/'+mod+'.d.ts']))
const program = ts.createProgram([...declarations.values()], {target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true, types: []})
const checker = program.getTypeChecker()
const idsByModule = new Map(modules.map(mod=>[mod, [...fs.readFileSync(declarations.get(mod)!,'utf8').matchAll(/(?:declare const|export type) \w*TypeId\s*(?::|=)\s*["']([^"']+)["']/g)].map(m=>m[1])]))
const coexisting = new Set<string>()
// Inherited brands are declaration facts: Exit extends Effect, and Cause's
// branded errors inherit Effect.TypeId through YieldableError. No pair is guessed.
for (const file of declarations.values()) {
 const visit = (node: ts.Node) => {
  if (ts.isInterfaceDeclaration(node)) {
   const type = checker.getTypeAtLocation(node)
   const homes = modules.filter(mod=>idsByModule.get(mod)!.some(id=>checker.getPropertyOfType(type,id)))
   for (let i=0;i<homes.length;i++) for(let j=i+1;j<homes.length;j++) coexisting.add(homes[i]+'#'+homes[j])
  }
  ts.forEachChild(node,visit)
 }; visit(program.getSourceFile(file)!)
}
const printer = ts.createPrinter({removeComments: true})
const print = (n: ts.Node, sf: ts.SourceFile) => printer.printNode(ts.EmitHint.Unspecified, n, sf)
const foreignIds = modules.filter(m=>m!=='Effect').flatMap(m=>[...fs.readFileSync(declarations.get(m)!,'utf8').matchAll(/(?:declare const|export type) \w*TypeId\s*(?::|=)\s*["']([^"']+)["']/g)].map(x=>x[1]))
// An inherited Effect method must not become an Exit-only value's method.
const modelAliases: string[] = ['type $D152EffectReceiver = { '+[...new Set(foreignIds)].map(id=>`readonly ${JSON.stringify(id)}?: never`).join('; ')+' };']
const guardSignatures = new Set<string>()
// Exit is structurally an Effect: its overload must precede Effect fallback.
const effectOverloads = new Set<string>()
const overloads = new Map<string, Set<string>>()
let imports: string[] = [], augment: string[] = [], entries: string[] = []
// The facts the projector's hand-kept tables (data_methods_table.go) record.
const brandedMembers = new Map<string, Set<string>>(), selfFirstNames = new Map<string, Set<string>>()
const predicateExports = new Set<string>(), curriedNames = new Set<string>()
const candidates = new Map<string, string[]>()
for (const mod of modules) {
 const sf = program.getSourceFile(declarations.get(mod)!)!
 const aliases = new Map<string,string>()
 const add = (name:string, source:string, exported:string, namespace=false) => {
  if (aliases.has(name)) return
  const alias = '$D152'+mod+'_'+name; aliases.set(name,alias)
  imports.push(namespace ? `import type * as ${alias} from "${source}"` : `import type { ${exported} as ${alias} } from "${source}"`)
 }
 for (const s of sf.statements) {
  if (ts.isImportDeclaration(s) && s.importClause?.namedBindings) {
   const source=(s.moduleSpecifier as ts.StringLiteral).text.replace(/^\.\//,'effect/').replace(/\.ts$/,'')
   const b=s.importClause.namedBindings
   if(ts.isNamespaceImport(b)) add(b.name.text,source,'',true)
   else for(const x of b.elements) add(x.name.text,source,x.propertyName?.text??x.name.text)
  } else if ((ts.isInterfaceDeclaration(s)||ts.isTypeAliasDeclaration(s)||ts.isClassDeclaration(s)||ts.isModuleDeclaration(s)) && s.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword) && s.name) add(s.name.text,'effect/'+mod,s.name.text)
 }
 const methods: {name:string,sig:ts.SignatureDeclaration}[]=[]
 const collect=(name:string,n:ts.Node)=>{
  if(ts.isParenthesizedTypeNode(n)) {collect(name,n.type);return}
  if(ts.isIntersectionTypeNode(n)) {for(const type of n.types)collect(name,type);return}
  if ((ts.isFunctionDeclaration(n)||ts.isCallSignatureDeclaration(n)||ts.isFunctionTypeNode(n)) && n.parameters[0] && ts.isIdentifier(n.parameters[0].name) && takesSelfFirst(mod,name,n.parameters[0].name.text)) methods.push({name,sig:n})
 }
 for(const s of sf.statements) {
  if(ts.isFunctionDeclaration(s)&&s.name) collect(s.name.text,s)
  if(ts.isVariableStatement(s)) for(const d of s.declarationList.declarations) if(ts.isIdentifier(d.name)&&d.type) {
   if(ts.isTypeLiteralNode(d.type)) for(const m of d.type.members) collect(d.name.text,m)
   else collect(d.name.text,d.type)
  }
 }
 for(const s of sf.statements) if(ts.isExportDeclaration(s)&&s.exportClause&&ts.isNamedExports(s.exportClause)&&!s.moduleSpecifier) for(const spec of s.exportClause.elements) {
  const original=spec.propertyName?.text??spec.name.text
  for(const m of [...methods]) if(m.name===original&&spec.name.text!==original) methods.push({name:spec.name.text,sig:m.sig})
 }
 const exported = new Set<string>()
 for (const node of sf.statements) {
  if(ts.canHaveModifiers(node)&&ts.getModifiers(node)?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)) {
   if(ts.isFunctionDeclaration(node)&&node.name) exported.add(node.name.text)
   if(ts.isVariableStatement(node)) for(const d of node.declarationList.declarations) if(ts.isIdentifier(d.name)) exported.add(d.name.text)
  }
  if(ts.isExportDeclaration(node)&&node.exportClause&&ts.isNamedExports(node.exportClause)) for(const spec of node.exportClause.elements) exported.add(spec.name.text)
 }
 for(let i=methods.length-1;i>=0;i--) if(!exported.has(methods[i].name)) methods.splice(i,1)
 const own = new Set<string>()
 const interfaces: {node:ts.InterfaceDeclaration,space:string[]}[]=[]
 const walk=(n:ts.Node,space:string[]=[])=>{
  if(ts.isInterfaceDeclaration(n)) {interfaces.push({node:n,space});for(const m of n.members) if(m.name&&ts.isIdentifier(m.name)) own.add(m.name.text)}
  ts.forEachChild(n,c=>walk(c,ts.isModuleDeclaration(n)&&ts.isIdentifier(n.name)?[...space,n.name.text]:space))
 };walk(sf)
 // Augment value models, never configuration records: adding required methods
 // to Retry.Options would reject ordinary { times: 1 } module calls.
 const byName = new Map(interfaces.map(i=>[[...i.space,i.node.name.text].join('.'),i]))
 const branded = new Set<ts.InterfaceDeclaration>()
 for(const {node} of interfaces) if(node.members.some(m=>m.name&&ts.isComputedPropertyName(m.name)&&ts.isIdentifier(m.name.expression)&&m.name.expression.text.endsWith('TypeId'))) branded.add(node)
 for(let changed=true;changed;) {
  changed=false
  for(const {node,space} of interfaces) if(!branded.has(node)) for(const clause of node.heritageClauses??[]) for(const type of clause.types) {
   const name=type.expression.getText(sf)
   const base=byName.get([...space,name].join('.'))??byName.get(name)
   if(base&&branded.has(base.node)) {branded.add(node);changed=true}
  }
 }
 own.clear()
 for(const node of branded) for(const member of node.members) if(member.name&&ts.isIdentifier(member.name)) own.add(member.name.text)

 const names=[...new Set(methods.map(m=>m.name))].sort()
 selfFirstNames.set(mod, new Set(names))
 brandedMembers.set(mod, new Set(own))
 // Exported spellings of each declared name: `export { catch_ as catch }`.
 const spellings=new Map<string,string[]>()
 const spell=(name:string)=>[...(exported.has(name)?[name]:[]),...(spellings.get(name)??[])]
 for(const s of sf.statements) if(ts.isExportDeclaration(s)&&s.exportClause&&ts.isNamedExports(s.exportClause)&&!s.moduleSpecifier) for(const spec of s.exportClause.elements) {
  const original=spec.propertyName?.text??spec.name.text
  if(original!==spec.name.text) spellings.set(original,[...(spellings.get(original)??[]),spec.name.text])
 }
 // A curried (data-last) declaration returns a function whose first
 // parameter is the receiver, as pipe(self, f(args)) needs.
 const shapes=(name:string,n:ts.Node)=>{
  if(ts.isParenthesizedTypeNode(n)) {shapes(name,n.type);return}
  if(ts.isIntersectionTypeNode(n)) {for(const type of n.types)shapes(name,type);return}
  if(ts.isTypeLiteralNode(n)) {for(const member of n.members)shapes(name,member);return}
  if(!(ts.isFunctionDeclaration(n)||ts.isCallSignatureDeclaration(n)||ts.isFunctionTypeNode(n))||!n.type)return
  if(ts.isFunctionTypeNode(n.type)&&n.type.parameters[0]&&ts.isIdentifier(n.type.parameters[0].name)&&takesSelfFirst(mod,name,n.type.parameters[0].name.text)) for(const x of spell(name)) curriedNames.add('effect/'+mod+'#'+x)
  if(ts.isTypePredicateNode(n.type)&&!n.type.assertsModifier) for(const x of spell(name)) predicateExports.add('effect/'+mod+'#'+x)
 }
 for(const s of sf.statements) {
  if(ts.isFunctionDeclaration(s)&&s.name) shapes(s.name.text,s)
  if(ts.isVariableStatement(s)) for(const d of s.declarationList.declarations) if(ts.isIdentifier(d.name)&&d.type) shapes(d.name.text,d.type)
 }
 for (const name of names) {
  if (!candidates.has(name)) candidates.set(name, [])
  candidates.get(name)!.push(mod)
 }
 // Retain all module identities, including those without a call-site candidate.
 // This prevents a specialized value such as Exit from falling back to Effect.
 const ids=[...sf.text.matchAll(/(?:declare const|export type) \w*TypeId\s*(?::|=)\s*["']([^"']+)["']/g)].map(m=>m[1])
 entries.push(`  ${JSON.stringify(mod)}: ${JSON.stringify([...new Set(ids)])}`)
 const valueModels=interfaces.filter(({node})=>branded.has(node)&&!/^(?:Variance(?:Struct)?|Proto|ReasonProto)$/.test(node.name.text))
 modelAliases.push(`type $D152${mod}Models = ${valueModels.map(({node,space})=>`import("effect/${mod}").${[...space,node.name.text].join('.')}${node.typeParameters?.length?'<'+node.typeParameters.map(()=>'any').join(', ')+'>':''}`).join(' | ')};`)
 const lines:string[]=[]
 for(const {node,space} of interfaces) {
  if(!branded.has(node)||/^(?:Variance(?:Struct)?|Proto|ReasonProto)$/.test(node.name.text))continue
  if(!node.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)&&space.length===0)continue
  const typeParams=node.typeParameters?.map(t=>print(t,sf)).join(', ')
  const body:string[]=[]
  for(const {name,sig} of methods) {
   if(own.has(name)||name==='pipe'||name==='toString'||name==='toJSON')continue
   const locals=new Set(sig.typeParameters?.map(t=>t.name.text)??[])
   const result=ts.transform(sig,[ctx=>node=>{
    const visit=(n:ts.Node):ts.VisitResult<ts.Node>=>{
     if(ts.isTypePredicateNode(n)&&ts.isIdentifier(n.parameterName)&&n.parameterName.text==='self') return ts.factory.updateTypePredicateNode(n,n.assertsModifier,ts.factory.createThisTypeNode(),n.type?ts.visitNode(n.type,visit) as ts.TypeNode:undefined)
     if(ts.isIdentifier(n)&&!(n.parent&&ts.isQualifiedName(n.parent)&&n.parent.right===n)&&!(n.parent&&ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n)&&aliases.has(n.text)&&!locals.has(n.text)) return ts.factory.createIdentifier(aliases.get(n.text)!)
     return ts.visitEachChild(n,visit,ctx)
    };return ts.visitNode(node,visit) as typeof node
   }]).transformed[0] as ts.SignatureDeclaration
   const generics=result.typeParameters?.length ? '<'+result.typeParameters.map(t=>print(t,sf)).join(', ')+'>' : ''
   const params=result.parameters.map((p,i)=>i===0?(mod==='Effect'?'this: ('+print(p.type!,sf)+') & $D152EffectReceiver':'this: '+print(p.type!,sf)):print(p,sf)).join(', ')
   if(result.type&&ts.isTypePredicateNode(result.type)&&result.type.type) {
    guardSignatures.add(`export declare function $dataGuard${generics}(value: ${print(result.parameters[0].type!,sf)} & $D152${mod}Models, name: ${JSON.stringify(name)}, args: [${result.parameters.slice(1).map(p=>print(p,sf)).join(', ')}], result: boolean): value is ${print(result.type.type,sf)};`)
   }
   const declaration = `    ${JSON.stringify(name)}${generics}(${params}): ${print(result.type!,sf)};`
   if(!overloads.has(name)) overloads.set(name,new Set())
   overloads.get(name)!.add(declaration)
   if(mod==='Effect')effectOverloads.add(declaration)
   if(!body.includes('@@METHOD:'+name+'@@')) body.push('@@METHOD:'+name+'@@')
  }
  if(body.length) lines.push(...space.map(s=>`  namespace ${s} {`),`  interface ${node.name.text}${typeParams?'<'+typeParams+'>':''} extends ${body.map(x=>'$D152Method_'+x.slice(9,-2)).join(', ')} {}`,...space.map(()=> '  }'))
 }
 augment.push(`declare module "effect/${mod}" {\n${lines.join('\n')}\n}`)
}
const marker='// BEGIN GENERATED D252 DATA METHODS'
const prelude=root+'/packages/ts-mapper/prelude.d.ts'
const header=fs.readFileSync(prelude,'utf8').split(marker)[0].trimEnd()
// The non-predicate witness takes the receiver member's parameter tuple, so
// its copied callbacks retain the same contextual types as the real call.
const outputs=new Map([[prelude,header+'\n\n'+marker+'\n// Generated by cmd/vibelang-data-methods/generate.ts; do not edit.\n'+imports.join('\n')+'\n\n'+modelAliases.join('\n')+'\n'+[...guardSignatures].join('\n')+'\nexport declare function $dataGuard<V, K extends keyof V, R>(value: V, name: K, args: V[K] extends (...args: infer Args) => unknown ? Args : never, result: R): R;\n\n'+[...overloads].map(([name,sigs])=>`interface $D152Method_${name} {\n${[...sigs].sort((a,b)=>Number(effectOverloads.has(a))-Number(effectOverloads.has(b))).join('\n')}\n}`).join('\n')+'\n'+augment.join('\n\n')+'\n'],[root+'/packages/runtime/src/data-methods-table.ts','// Generated by cmd/vibelang-data-methods/generate.ts; do not edit.\n// TypeId metadata only: dispatch functions are imported by each call site.\nexport const dataMethodTypeIds: Readonly<Record<string, readonly string[]>> = {\n'+entries.join(',\n')+'\n}\n']])
// The executable rendering reads this index to import only the named functions.
let go = '// Code generated by cmd/vibelang-data-methods/generate.ts; DO NOT EDIT.\n\npackage vibelangmapper\n\n// dataMethodCandidates names the declaring modules of each D152 self-first export.\n// Runtime TypeIds choose among these imports; method names never choose a receiver.\nvar dataMethodCandidates = map[string][]string{\n'+[...candidates].sort(([a],[b])=>a < b ? -1 : a > b ? 1 : 0).map(([name,mods])=>`  ${JSON.stringify(name)}: {${mods.map(m=>JSON.stringify(m)).join(', ')}},`).join('\n')+'\n}\n'
// A shared name is unsafe only when two of its candidate modules can coexist.
const ambiguous = [...candidates].filter(([,mods])=>mods.some((a,i)=>mods.slice(i+1).some(b=>coexisting.has([a,b].sort().join('#'))))).map(([name])=>name).sort()
go += '\n// dataMethodAmbiguous rejects names whose candidate TypeIds coexist (D253).\nvar dataMethodAmbiguous = map[string]bool{\n'+ambiguous.map(name=>` ${JSON.stringify(name)}: true,`).join('\n')+'\n}\n'
const formatted = Bun.spawnSync(['gofmt'], {stdin: new TextEncoder().encode(go)})
if(formatted.exitCode !== 0) throw new Error(new TextDecoder().decode(formatted.stderr))
outputs.set(root+'/typescript/tsc/internal/vibelangmapper/data_methods_candidates.go',new TextDecoder().decode(formatted.stdout))
// The projector's hand-kept tables must agree with the declarations: a stale
// own member keeps a D152 call as a member call (issue #460), and a stale
// method or guard name changes what the projection lowers.
const tableFile=root+'/typescript/tsc/internal/vibelangmapper/data_methods_table.go'
const tableText=fs.readFileSync(tableFile,'utf8')
const goVar=(name:string)=>{const m=tableText.match(new RegExp('\\nvar '+name+' = map\\[[^{]*\\{([\\s\\S]*?)\\n?\\}\\n'));if(!m)throw new Error('missing table '+name+' in '+tableFile);return m[1]}
const flatKeys=(body:string)=>new Set([...body.matchAll(/"([^"]+)":\s*true/g)].map(m=>m[1]))
const nestedKeys=(body:string)=>new Map([...body.matchAll(/"(effect\/\w+)":\s*\{([^}]*)\}/g)].map(m=>[m[1],flatKeys(m[2])] as const))
const drift:string[]=[]
const compare=(table:string,expected:Set<string>,actual:Set<string>)=>{
 const extra=[...actual].filter(x=>!expected.has(x)).sort(), missing=[...expected].filter(x=>!actual.has(x)).sort()
 if(extra.length)drift.push(table+' lists names the declarations do not: '+extra.join(', '))
 if(missing.length)drift.push(table+' omits declared names: '+missing.join(', '))
}
const ownTable=nestedKeys(goVar('dataOwnMembers')), methodTable=nestedKeys(goVar('dataMethods'))
// An own member decides only for a D152 name, so compare those: a name the
// value interfaces do not declare must not block the module call.
for(const [mod,members] of ownTable) {
 const methods=selfFirstNames.get(mod.slice(7))??new Set(), branded=brandedMembers.get(mod.slice(7))??new Set()
 const relevant=(set:Set<string>)=>new Set([...set].filter(name=>methods.has(name)&&!['pipe','toString','toJSON'].includes(name)))
 compare('dataOwnMembers['+mod+'] (D152 names)',relevant(branded),relevant(members))
}
for(const [mod,names] of methodTable) compare('dataMethods['+mod+']',selfFirstNames.get(mod.slice(7))??new Set(),names)
compare('dataGuards',predicateExports,flatKeys(goVar('dataGuards')))
const methodKeys=new Set([...methodTable].flatMap(([mod,names])=>[...names].map(name=>mod+'#'+name)))
compare('dataLastMethods',new Set([...curriedNames].filter(key=>methodKeys.has(key))),flatKeys(goVar('dataLastMethods')))
// Drift recorded when this check landed (#460), to be fixed in
// data_methods_table.go. The list may only shrink: a new disagreement, or a
// recorded one that no longer holds, fails --check.
const knownDrift=new Set([
 'dataOwnMembers[effect/Cause] (D152 names) omits declared names: annotate, annotations',
 'dataGuards lists names the declarations do not: effect/Exit#hasDies, effect/Exit#hasFails, effect/Exit#hasInterrupts',
])
const fresh=drift.filter(line=>!knownDrift.has(line)), resolved=[...knownDrift].filter(line=>!drift.includes(line))
if(fresh.length||resolved.length) {
 const message=[...(fresh.length?['data_methods_table.go disagrees with the pinned effect declarations:',...fresh.map(x=>'  '+x)]:[]),
  ...(resolved.length?['remove from knownDrift in cmd/vibelang-data-methods/generate.ts:',...resolved.map(x=>'  '+x)]:[])].join('\n')
 if(process.argv.includes('--check'))throw new Error(message)
 console.error(message)
}
for(const [file,text] of outputs) {
 if(process.argv.includes('--check')) {if(fs.readFileSync(file,'utf8')!==text)throw new Error('D252 generated output drift: '+file)}
 else fs.writeFileSync(file,text)
}
