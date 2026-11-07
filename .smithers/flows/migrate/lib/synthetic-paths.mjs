// A fresh temporary directory contains synthetic fixture files, not the
// repository source with the same relative name. Preserve that distinction.
import { posix } from "node:path"
import { isFixtureFile, isTestFile } from "./inventory.mjs"

export function syntheticPathOperands(ts, source, file) {
  if (!(isTestFile(file) || isFixtureFile(file)) || !source.text.includes("mkdtemp")) return () => false
  const options = { noLib:true, noResolve:true, allowJs:true }
  const host = { ...ts.createCompilerHost(options), getSourceFile:name => name === file ? source : undefined }
  const checker = ts.createProgram({rootNames:[file],options,host}).getTypeChecker()
  const imported = new Map(), namespaces = new Map()
  const nameOf = node => node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) ? node.text : null
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue
    const module = statement.moduleSpecifier.text
    if (!["node:fs","fs","node:fs/promises","fs/promises","node:path","path"].includes(module)) continue
    const bindings = statement.importClause?.namedBindings
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.set(bindings,module)
    if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements)
      if (!element.isTypeOnly) imported.set(element,{module,name:(element.propertyName ?? element.name).text})
  }
  const binding = (node,map) => checker.getSymbolAtLocation(node)?.declarations?.map(d=>map.get(d)).find(Boolean)
  const called = node => {
    if (ts.isIdentifier(node)) return binding(node,imported)
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const module = binding(node.expression,namespaces)
      if (module) return {module,name:node.name.text}
    }
  }
  const fresh = (node,seen=new Set(),awaited=false) => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node))) {
      if (ts.isAwaitExpression(node)) awaited=true
      node=node.expression
    }
    if (!node || seen.has(node)) return false
    seen.add(node)
    if (ts.isIdentifier(node)) {
      const declaration=checker.getSymbolAtLocation(node)?.valueDeclaration
      return !!declaration && ts.isVariableDeclaration(declaration) &&
        !!(declaration.parent.flags & ts.NodeFlags.Const) && fresh(declaration.initializer,seen,awaited)
    }
    if (!ts.isCallExpression(node) || node.questionDotToken || node.arguments.length!==1) return false
    const fn=called(node.expression)
    return !!fn && (awaited && ["node:fs/promises","fs/promises"].includes(fn.module) && fn.name==="mkdtemp" ||
      ["node:fs","fs"].includes(fn.module) && fn.name==="mkdtempSync")
  }
  const inside = value => {
    const path=posix.normalize(value.replaceAll("\\","/"))
    return !/^(?:\/|[A-Za-z]:)/.test(path) && path!==".." && !path.startsWith("../")
  }
  const path = call => {
    const fn=called(call.expression)
    if (!fn || !["node:path","path"].includes(fn.module) || !["join","resolve"].includes(fn.name) ||
        call.arguments.length<2 || !fresh(call.arguments[0])) return false
    const parts=call.arguments.slice(1)
    if (!parts.every(p=>ts.isStringLiteralLike(p) && !/^(?:[\\/]|[A-Za-z]:)/.test(p.text))) return false
    const relative=posix.normalize(parts.map(p=>p.text.replaceAll("\\","/")).join("/"))
    return relative!==".." && !relative.startsWith("../")
  }
  const cwd = object => {
    for (const property of [...object.properties].reverse()) {
      if (ts.isSpreadAssignment(property) || nameOf(property.name)===null) return false
      if (nameOf(property.name)==="cwd") return ts.isPropertyAssignment(property) && fresh(property.initializer)
    }
    return false
  }
  return node => {
    if (ts.isCallExpression(node) && path(node)) return true
    let input=false
    for (let at=node.parent; at && !ts.isStatement(at); at=at.parent) {
      if (ts.isCallExpression(at) && path(at)) return true
      if (ts.isPropertyAssignment(at) && ["entry","entryPoints","input"].includes(nameOf(at.name))) input=true
      if (input && ts.isStringLiteralLike(node) && inside(node.text) && ts.isObjectLiteralExpression(at) && cwd(at)) return true
    }
    return false
  }
}
