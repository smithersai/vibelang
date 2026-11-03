// Generated from scripts/api-identity-nominal.mjs; run node scripts/sync-api-identity.mjs --write.
// Two snapshots of one package must share the identity of corresponding
// nominal declarations. Otherwise even unchanged enums, private classes and
// unique symbols fail tsc's identity helper solely because of their file path.
// Reify those identities as shared unique-symbol keys in the virtual program.
// All member types, visibility, enum names and constant values remain checked.
import { relative, resolve } from "node:path"

export function alignNominalIdentity(ts, program, before, after, brandFile, entryMaps, ambientNames = new Map()) {
  const printer = ts.createPrinter()
  const checker = program.getTypeChecker()
  const factory = ts.factory
  const brands = new Map()
  const output = new Map()
  const literal = text => factory.createStringLiteral(text.replaceAll("\\", "/"))
  const importType = (name, query = false) => factory.createImportTypeNode(
    factory.createLiteralTypeNode(literal(brandFile)), undefined, factory.createIdentifier(name), undefined, query)
  const keyFor = (source, node) => {
    let path
    for (const [entries, base] of [[entryMaps[0], before], [entryMaps[1], after]]) {
      if (source.fileName !== base && !source.fileName.startsWith(base + "/")) continue
      const entry = Object.entries(entries).filter(([, file]) => file === source.fileName).map(([key]) => key).sort()[0]
      path = entry !== undefined ? "entry:" + entry : relative(base, source.fileName).replace(/\.d\.vibe\.ts$/, ".d.ts")
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
  const brandKey = id => factory.createComputedPropertyName(factory.createPropertyAccessExpression(factory.createIdentifier("__api_nominal"), id))
  const brandType = id => factory.createTypeLiteralNode([factory.createPropertySignature(
    [factory.createModifier(ts.SyntaxKind.ReadonlyKeyword)], brandKey(id), undefined, factory.createKeywordTypeNode(ts.SyntaxKind.VoidKeyword))])
  for (const source of program.getSourceFiles()) {
    const own = [before, after].some(base => source.fileName === base || source.fileName.startsWith(base + "/"))
    if (!own || source.fileName.includes("/node_modules/")) continue
    let changed = false
    const transform = context => {
      const visit = node => {
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
    if (changed) {
      const prelude = ts.isExternalModule(source)
        ? `import type * as __api_nominal from ${JSON.stringify(brandFile.replaceAll("\\", "/"))};\n`
        : `declare var __api_nominal: typeof import(${JSON.stringify(brandFile.replaceAll("\\", "/"))});\n`
      // Triple-slash directives must precede every statement, including imports.
      output.set(resolve(source.fileName), printer.printFile(transformed.transformed[0]) + "\n" + prelude)
    }
    transformed.dispose()
  }
  output.set(brandFile, "export {};\n" + [...brands.values()].map(id => `export declare const ${id}: unique symbol;`).join("\n"))
  return output
}
