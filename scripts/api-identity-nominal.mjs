// Two snapshots of one package must share the identity of corresponding
// nominal declarations. Otherwise even unchanged enums, private classes and
// unique symbols fail tsc's identity helper solely because of their file path.
// Reify those identities as shared unique-symbol keys in the virtual program.
// All member types, visibility, enum names and constant values remain checked.
import { relative, resolve } from "node:path"
import { ownsFile } from "./api-identity-ownership.mjs"

export function alignNominalIdentity(ts, program, before, after, brandFile, entryMaps, ambientNames = new Map()) {
  const printer = ts.createPrinter()
  const checker = program.getTypeChecker()
  const factory = ts.factory
  const brands = new Map()
  const output = new Map()
  const literal = text => factory.createStringLiteral(text.replaceAll("\\", "/"))
  const importType = (name, query = false) => factory.createImportTypeNode(
    factory.createLiteralTypeNode(literal(brandFile)), undefined, factory.createIdentifier(name), undefined, query)
  // A nested snapshot belongs to its most specific input root.
  const snapshots = [[entryMaps[0], before], [entryMaps[1], after]].sort((a, b) => b[1].length - a[1].length)
  // Published export paths prove correspondence even when a declaration moves
  // behind a private re-export. Local names and physical paths cannot do that.
  // Keep one origin per symbol so splitting or merging public aliases still
  // changes at least one exported identity.
  const publicOrigins = new Map()
  const unalias = symbol => symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
  for (const [entries, base] of snapshots) {
    for (const [entry, file] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) {
      const source = program.getSourceFile(file)
      const module = source && checker.getSymbolAtLocation(source)
      const seen = new Set()
      const visit = (module, path) => {
        if (seen.has(module)) return
        seen.add(module)
        for (const exported of checker.getExportsOfModule(module).sort((a, b) => a.name.localeCompare(b.name))) {
          const symbol = unalias(exported)
          const owned = symbol.declarations?.some(node => {
            const file = node.getSourceFile().fileName
            return ownsFile(base, file) && !file.includes("/node_modules/")
          })
          if (!owned) continue
          const names = [...path, exported.name]
          if (!publicOrigins.has(symbol)) publicOrigins.set(symbol, "public:" + JSON.stringify([entry, ...names]))
          if (symbol.flags & ts.SymbolFlags.Module) visit(symbol, names)
        }
      }
      if (module) visit(module, [])
    }
  }
  const keyFor = (source, node) => {
    if ((ts.isVariableDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) &&
      node.name && ts.isIdentifier(node.name)) {
      const publicOrigin = publicOrigins.get(checker.getSymbolAtLocation(node.name))
      if (publicOrigin) return publicOrigin
    }
    let path
    for (const [entries, base] of snapshots) {
      if (source.fileName !== base && !ownsFile(base, source.fileName)) continue
      const entry = Object.entries(entries).filter(([, file]) => file === source.fileName).map(([key]) => key).sort()[0]
      path = entry !== undefined ? "entry:" + entry : relative(base, source.fileName).replace(/\.d\.vibex?\.ts$/, ".d.ts")
      break
    }
    const names = []
    for (let parent = node; parent && !ts.isSourceFile(parent); parent = parent.parent) {
      if (parent.name && (ts.isClassDeclaration(parent) || ts.isModuleDeclaration(parent) || ts.isVariableDeclaration(parent) || ts.isEnumDeclaration(parent))) names.unshift(ambientNames.get(parent.name.text) ?? parent.name.getText(source))
    }
    if (node.name && ts.isClassDeclaration(node)) {
      const module = checker.getSymbolAtLocation(source)
      const symbol = checker.getSymbolAtLocation(node.name)
      const exported = module && checker.getExportsOfModule(module).filter(s =>
        (s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s) === symbol).map(s => s.name).sort()[0]
      if (exported) names[names.length - 1] = exported
    }
    return path + ":" + names.join(".")
  }
  const brand = (source, node) => {
    const key = keyFor(source, node)
    if (!brands.has(key)) brands.set(key, "b" + brands.size)
    return brands.get(key)
  }
  // tsc never calls two `infer` declarations identical, and it compares a
  // mapped type's `as` clause by reference, so an unchanged generic alias using
  // either fails strict identity unless its whole file is proved equal, and so
  // does every generic export over it. Each side states such an alias in a form
  // without them, where a signature's own type parameters compare by position.
  // The strict probe of those forms is the proof; the after side then forwards
  // to the before side, so one alias serves both.
  const inferProofs = [], forwarded = new Map(), appended = new Map()
  const usesInfer = node => ts.isInferTypeNode(node) || ts.isMappedTypeNode(node) && Boolean(node.nameType) ||
    Boolean(ts.forEachChild(node, usesInfer))
  const typeParameters = ({ statement, source }) => statement.typeParameters.map(parameter => printer.printNode(ts.EmitHint.Unspecified,
    factory.updateTypeParameterDeclaration(parameter, undefined, parameter.name, parameter.constraint, parameter.default), source)).join(", ")
  const withoutInfer = ({ statement, source }) => {
    const form = context => {
      // `{ [K in C as N]: T }` becomes `["__api_mapped", modifiers, <K extends C>() => [N, T]]`:
      // equal forms mean equal constraints, `as` types, templates and modifiers.
      const mapped = (node, inner) => {
        const key = node.typeParameter
        const token = t => t ? ts.tokenToString(t.kind) : ""
        const signature = factory.createFunctionTypeNode([factory.updateTypeParameterDeclaration(key, undefined, key.name,
          ts.visitNode(key.constraint, inner), undefined)], [], factory.createTupleTypeNode([ts.visitNode(node.nameType, inner),
          node.type ? ts.visitNode(node.type, inner) : factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)]))
        return factory.createTupleTypeNode([factory.createLiteralTypeNode(factory.createStringLiteral("__api_mapped")),
          factory.createLiteralTypeNode(factory.createStringLiteral(token(node.readonlyToken) + "|" + token(node.questionToken))), signature])
      }
      const conditional = node => {
        if (ts.isMappedTypeNode(node) && node.nameType) return mapped(node, conditional)
        if (!ts.isConditionalTypeNode(node)) return ts.visitEachChild(node, conditional, context)
        const scoped = new Map()
        const extended = child => {
          if (ts.isConditionalTypeNode(child)) return conditional(child)
          if (ts.isMappedTypeNode(child) && child.nameType) return mapped(child, extended)
          if (!ts.isInferTypeNode(child)) return ts.visitEachChild(child, extended, context)
          const parameter = child.typeParameter, name = parameter.name.text
          // `infer` takes a constraint from its position; a parameter needs it written.
          const implied = !parameter.constraint && checker.getBaseConstraintOfType(checker.getTypeAtLocation(child))
          if (!scoped.has(name)) scoped.set(name, implied ? factory.updateTypeParameterDeclaration(parameter, undefined, parameter.name,
            checker.typeToTypeNode(implied, statement, ts.NodeBuilderFlags.NoTruncation), undefined) : parameter)
          return factory.createTypeReferenceNode(name)
        }
        // Still a conditional: its true branch keeps the narrowing of the check.
        const stated = factory.updateConditionalTypeNode(node, ts.visitNode(node.checkType, conditional),
          ts.visitNode(node.extendsType, extended), ts.visitNode(node.trueType, conditional), ts.visitNode(node.falseType, conditional))
        return scoped.size ? factory.createParenthesizedType(factory.createFunctionTypeNode([...scoped.values()], [], stated)) : stated
      }
      return node => ts.visitNode(node, conditional)
    }
    const transformed = ts.transform(statement.type, [form])
    const text = printer.printNode(ts.EmitHint.Unspecified, transformed.transformed[0], source)
    transformed.dispose()
    return text
  }
  const inferAliases = base => {
    const found = new Map()
    for (const source of program.getSourceFiles()) {
      if (!ownsFile(base, source.fileName) || source.fileName.includes("/node_modules/") || !ts.isExternalModule(source)) continue
      if (snapshots.find(([, root]) => ownsFile(root, source.fileName))[1] !== base) continue
      if (source.statements.some(node => ts.isExportAssignment(node) && node.isExportEquals)) continue
      const path = relative(base, source.fileName).replace(/\.d\.vibex?\.ts$/, ".d.ts")
      for (const statement of source.statements)
        if (ts.isTypeAliasDeclaration(statement) && statement.typeParameters && usesInfer(statement.type))
          found.set(path + ":" + statement.name.text, { path, statement, source })
    }
    return found
  }
  const append = (source, text) => appended.set(source.fileName, (appended.get(source.fileName) ?? "") + text)
  const afterAliases = inferAliases(after)
  for (const [key, a] of inferAliases(before)) {
    const b = afterAliases.get(key)
    // Different parameters stay with the strict probe, which reports them.
    if (!b || b.source === a.source || typeParameters(a) !== typeParameters(b)) continue
    const id = "__api_infer_" + inferProofs.length, parameters = typeParameters(a), name = a.statement.name.text
    const args = a.statement.typeParameters.map(parameter => parameter.name.text).join(", ")
    append(a.source, `export type ${id}<${parameters}> = ${name}<${args}>;\nexport type ${id}_form = <${parameters}>() => ${withoutInfer(a)};\n`)
    append(b.source, `export type ${id}_form = <${parameters}>() => ${withoutInfer(b)};\n`)
    forwarded.set(b.statement, { file: a.source.fileName, id })
    inferProofs.push({ entrypoint: a.path, export: name, a: `import(${JSON.stringify(a.source.fileName)}).${id}_form`,
      b: `import(${JSON.stringify(b.source.fileName)}).${id}_form` })
  }
  const brandKey = id => factory.createComputedPropertyName(factory.createPropertyAccessExpression(factory.createIdentifier("__api_nominal"), id))
  const brandType = id => factory.createTypeLiteralNode([factory.createPropertySignature(
    [factory.createModifier(ts.SyntaxKind.ReadonlyKeyword)], brandKey(id), undefined, factory.createKeywordTypeNode(ts.SyntaxKind.VoidKeyword))])
  for (const source of program.getSourceFiles()) {
    const own = [before, after].some(base => source.fileName === base || ownsFile(base, source.fileName))
    if (!own || source.fileName.includes("/node_modules/")) continue
    let changed = false
    const transform = context => {
      const visit = node => {
        if (forwarded.has(node)) {
          const { file, id } = forwarded.get(node)
          changed = true
          return factory.updateTypeAliasDeclaration(node, node.modifiers, node.name, node.typeParameters,
            factory.createImportTypeNode(factory.createLiteralTypeNode(literal(file)), undefined, factory.createIdentifier(id),
              node.typeParameters.map(parameter => factory.createTypeReferenceNode(parameter.name))))
        }
        if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.KeyOfKeyword) {
          const resolved = checker.typeToTypeNode(checker.getTypeFromTypeNode(node), undefined, ts.NodeBuilderFlags.NoTruncation)
          const literalKeys = n => ts.isLiteralTypeNode(n) || n.kind === ts.SyntaxKind.NeverKeyword ||
            (ts.isUnionTypeNode(n) && n.types.every(literalKeys))
          if (resolved && literalKeys(resolved)) {
            changed = true
            return resolved
          }
        }
        if (ts.isVariableDeclaration(node) && node.type && ts.isTypeOperatorNode(node.type) && node.type.operator === ts.SyntaxKind.UniqueKeyword) {
          changed = true
          return factory.updateVariableDeclaration(node, node.name, node.exclamationToken, importType(brand(source, node), true), node.initializer)
        }
        if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
          const visibilityMarkers = new Set()
          const members = node.members.map(member => {
            const visibility = member.modifiers?.find(m => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword)
            const privateName = member.name && ts.isPrivateIdentifier(member.name)
            if ((!visibility && !privateName) || ts.isConstructorDeclaration(member)) return ts.visitEachChild(member, visit, context)
            changed = true
            const copy = factory.cloneNode(member)
            copy.modifiers = factory.createNodeArray((member.modifiers ?? []).filter(m => m !== visibility))
            if (privateName) copy.name = factory.createStringLiteral(member.name.getText(source))
            if (ts.isPropertyDeclaration(copy) && !copy.type) copy.type = factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)
            // Private declarations may elide signatures that would be implicit-any
            // errors once made public. Materialize their original checker types.
            const typeNode = type => checker.typeToTypeNode(type, member, ts.NodeBuilderFlags.NoTruncation)
            if ((ts.isGetAccessorDeclaration(member) || ts.isMethodDeclaration(member)) && !copy.type) {
              copy.type = typeNode(checker.getReturnTypeOfSignature(checker.getSignatureFromDeclaration(member)))
            }
            if (copy.parameters) copy.parameters = factory.createNodeArray(copy.parameters.map(parameter =>
              parameter.type ? parameter : factory.updateParameterDeclaration(parameter, parameter.modifiers,
                parameter.dotDotDotToken, parameter.name, parameter.questionToken,
                typeNode(checker.getTypeAtLocation(parameter)), parameter.initializer)))
            // Preserve the original name so this["privateField"] keeps working.
            // The visibility metadata remains part of the structural contract.
            const staticModifier = member.modifiers?.find(m => m.kind === ts.SyntaxKind.StaticKeyword)
            const markerKey = (staticModifier ? "static:" : "instance:") + member.name.getText(source)
            const transformedMember = ts.visitEachChild(copy, visit, context)
            // A get/set pair is one property, with one visibility marker.
            if (visibilityMarkers.has(markerKey)) return transformedMember
            visibilityMarkers.add(markerKey)
            const marker = factory.createPropertyDeclaration(
              [...(staticModifier ? [staticModifier] : []), factory.createModifier(ts.SyntaxKind.ReadonlyKeyword)],
              factory.createStringLiteral("__api_visibility_" + member.name.getText(source)), undefined,
              factory.createLiteralTypeNode(factory.createStringLiteral(privateName ? "#" : ts.tokenToString(visibility.kind))), undefined)
            return [transformedMember, marker]
          }).flat()
          if (members.some((m, i) => m !== node.members[i]) && node.members.some(m => m.name && (ts.isPrivateIdentifier(m.name) || m.modifiers?.some(x => x.kind === ts.SyntaxKind.PrivateKeyword || x.kind === ts.SyntaxKind.ProtectedKeyword)))) {
            members.push(factory.createPropertyDeclaration(
              [factory.createModifier(ts.SyntaxKind.ReadonlyKeyword)], brandKey(brand(source, node)), undefined,
              factory.createKeywordTypeNode(ts.SyntaxKind.VoidKeyword), undefined))
          }
          return ts.isClassDeclaration(node)
            ? factory.updateClassDeclaration(node, node.modifiers, node.name, node.typeParameters, node.heritageClauses, members)
            : factory.updateClassExpression(node, node.modifiers, node.name, node.typeParameters, node.heritageClauses, members)
        }
        if (ts.isEnumDeclaration(node)) {
          changed = true
          const id = brand(source, node)
          const entries = node.members.map(member => {
            const value = checker.getConstantValue(member)
            const type = typeof value === "string" ? factory.createLiteralTypeNode(literal(value))
              : typeof value === "number" ? factory.createLiteralTypeNode(value < 0
                ? factory.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, factory.createNumericLiteral(-value)) : factory.createNumericLiteral(value))
              : factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword)
            return { member, type: factory.createIntersectionTypeNode([type, brandType(id)]) }
          })
          const qualified = member => factory.createTypeReferenceNode(factory.createQualifiedName(node.name, factory.createIdentifier(member.name.text)), undefined)
          const mods = node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ? [factory.createModifier(ts.SyntaxKind.ExportKeyword)] : []
          const ambientMods = source.isDeclarationFile && !ts.isSourceFile(node.parent)
            ? mods : [...mods, factory.createModifier(ts.SyntaxKind.DeclareKeyword)]
          const namespace = factory.createModuleDeclaration(ambientMods, node.name,
            factory.createModuleBlock(entries.map(({member, type}) => ts.setOriginalNode(factory.createTypeAliasDeclaration(
              [factory.createModifier(ts.SyntaxKind.ExportKeyword)], member.name.text, undefined, type), member))), ts.NodeFlags.Namespace)
          const properties = entries.map(({member}) => factory.createPropertySignature(
            [factory.createModifier(ts.SyntaxKind.ReadonlyKeyword)], member.name, undefined, qualified(member)))
          const enumSymbol = checker.getSymbolAtLocation(node.name)
          const enumType = checker.getTypeOfSymbolAtLocation(enumSymbol, node.name)
          for (const index of checker.getIndexInfosOfType(enumType)) properties.push(factory.createIndexSignature(
            index.isReadonly ? [factory.createModifier(ts.SyntaxKind.ReadonlyKeyword)] : undefined,
            [factory.createParameterDeclaration(undefined, undefined, "key", undefined, checker.typeToTypeNode(index.keyType, undefined, ts.NodeBuilderFlags.NoTruncation))],
            checker.typeToTypeNode(index.type, undefined, ts.NodeBuilderFlags.NoTruncation)))
          const variable = factory.createVariableStatement(ambientMods, factory.createVariableDeclarationList([
            factory.createVariableDeclaration(node.name, undefined, factory.createTypeLiteralNode(properties), undefined)
          ], ts.NodeFlags.Const))
          const type = factory.createTypeAliasDeclaration(mods, node.name, undefined,
            entries.length ? factory.createUnionTypeNode(entries.map(({member}) => qualified(member))) : factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword))
          ts.setOriginalNode(type, node)
          return [type, variable, namespace]
        }
        return ts.visitEachChild(node, visit, context)
      }
      return node => ts.visitNode(node, visit)
    }
    const transformed = ts.transform(source, [transform])
    if (changed || appended.has(source.fileName)) {
      const prelude = ts.isExternalModule(source)
        ? `import type * as __api_nominal from ${JSON.stringify(brandFile.replaceAll("\\", "/"))};\n`
        : `declare var __api_nominal: typeof import(${JSON.stringify(brandFile.replaceAll("\\", "/"))});\n`
      // Triple-slash directives must precede every statement, including imports.
      output.set(resolve(source.fileName), printer.printFile(transformed.transformed[0]) + "\n" + prelude + (appended.get(source.fileName) ?? ""))
    }
    transformed.dispose()
  }
  output.inferProofs = inferProofs
  output.set(brandFile, "export {};\n" + [...brands.values()].map(id => `export declare const ${id}: unique symbol;`).join("\n"))
  return output
}
