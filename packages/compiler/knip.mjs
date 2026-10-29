// vibelang/knip: a Knip compiler for .vibe files.
//
//   // knip.config.ts
//   import vibelang from "vibelang/knip"
//   export default { compilers: { vibe: vibelang } }
//
// Knip reads what a compiler returns as a TypeScript module, for its imports
// and exports. This one returns a .vibe module's surface: each import and
// re-export as the file writes it, which is TypeScript syntax; a stub for
// each exported declaration under its name (an `error` is a class, a
// `schema` a constant, as in the compiler's ESTree); each dynamic import of a
// literal path; each member a namespace import reads (`Users.find`), so Knip
// sees which of that module's exports are used; and vibelang-runtime, which
// the module's JavaScript imports. Bodies are left out: no
// TypeScript parser reads VibeLang's own forms. The compiler's ESTree
// (`vibelang --estree`) finds them, as for vibelang/eslint.
import { parseESTree } from "./eslint.mjs"

/**
 * Returns the TypeScript module Knip reads for a .vibe file.
 *
 * @param {string} text The file's text.
 * @param {string} [path] Its path, for the compiler's messages.
 */
export function compile(text, path = "file.vibe") {
  const program = parseESTree(text, path)
  const source = (node) => text.slice(node.range[0], node.range[1])
  const lines = ['import "vibelang-runtime"']
  const namespaces = new Set()
  const imports = (body) => {
    for (const node of body) {
      if (node.type === "ImportDeclaration") {
        lines.push(source(node))
        for (const specifier of node.specifiers) if (specifier.type === "ImportNamespaceSpecifier") namespaces.add(specifier.local.name)
      } else if (node.type === "VibeModuleDeclaration" && node.body) {
        // A module declaration's body is TypeScript with imports of its own (D283).
        imports(Array.isArray(node.body) ? node.body : node.body.body ?? [])
      }
    }
  }
  imports(program.body)
  for (const node of program.body) {
    if (node.type === "ExportAllDeclaration" || (node.type === "ExportNamedDeclaration" && !node.declaration)) lines.push(source(node))
    else if (node.type === "ExportNamedDeclaration") lines.push(...stubs(node.declaration))
    else if (node.type === "ExportDefaultDeclaration") lines.push("export default 0")
  }
  const reads = new Set()
  visit(program, (node) => {
    if (node.type === "ImportExpression" && node.source?.type === "Literal" && typeof node.source.value === "string") reads.add(`import(${JSON.stringify(node.source.value)})`)
    else if (node.type === "MemberExpression" && !node.computed && node.object?.type === "Identifier" && namespaces.has(node.object.name) && node.property?.type === "Identifier") reads.add(`${node.object.name}.${node.property.name}`)
    else if ((node.type === "TSQualifiedName") && node.left?.type === "Identifier" && namespaces.has(node.left.name) && node.right?.type === "Identifier") reads.add(`${node.left.name}.${node.right.name}`)
  })
  for (const read of reads) lines.push(`${read}`)
  return lines.join("\n") + "\n"
}

// The stub export of a declaration: its names, without its body.
function stubs(declaration) {
  const name = declaration.id?.name
  switch (declaration.type) {
    case "VariableDeclaration": return declaration.declarations.flatMap((d) => names(d.id)).map((n) => `export const ${n} = 0`)
    case "FunctionDeclaration":
    case "TSDeclareFunction": return name ? [`export function ${name}() {}`] : []
    case "ClassDeclaration": return name ? [`export class ${name} {}`] : []
    case "TSTypeAliasDeclaration": return [`export type ${name} = unknown`]
    case "TSInterfaceDeclaration": return [`export interface ${name} {}`]
    case "TSEnumDeclaration": return [`export enum ${name} {}`]
    case "TSModuleDeclaration": return declaration.id?.type === "Identifier" ? [`export namespace ${name} {}`] : []
    default: return name ? [`export const ${name} = 0`] : []
  }
}

// The names a binding pattern declares.
function names(pattern) {
  if (!pattern) return []
  switch (pattern.type) {
    case "Identifier": return [pattern.name]
    case "ObjectPattern": return pattern.properties.flatMap((p) => names(p.type === "RestElement" ? p.argument : p.value))
    case "ArrayPattern": return pattern.elements.flatMap((e) => names(e?.type === "RestElement" ? e.argument : e))
    case "AssignmentPattern": return names(pattern.left)
    default: return []
  }
}

function visit(node, see) {
  if (Array.isArray(node)) {
    for (const item of node) if (item !== null && typeof item === "object") visit(item, see)
    return
  }
  if (typeof node.type === "string") see(node)
  for (const [key, value] of Object.entries(node)) {
    if (key !== "range" && key !== "loc" && value !== null && typeof value === "object") visit(value, see)
  }
}

export default compile
