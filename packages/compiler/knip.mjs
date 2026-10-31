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
// `schema` a constant, as in the compiler's ESTree), after the JSDoc written
// before it, whose tags Knip reads; each dynamic import of a
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
  // The JSDoc comments written before an export, between it and the statement
  // before it, as TypeScript attaches them: Knip reads their tags, such as
  // `/** @public */`, which keeps an export no other module imports. A comment
  // on the line where the statement before ends is that statement's.
  const comments = program.comments ?? []
  const docs = (node, after) => {
    const first = comments.find((c) =>
      c.type === "Block" && c.value.startsWith("*") &&
      c.range[0] >= after && c.range[1] <= node.range[0] &&
      (after === 0 || text.slice(after, c.range[0]).includes("\n")))
    // Preserve intervening comments as well: Knip's own TypeScript reader
    // treats an ordinary comment after a JSDoc tag as an attachment barrier.
    return first ? text.slice(first.range[0], node.range[0]) : ""
  }
  program.body.forEach((node, i) => {
    const doc = docs(node, i ? program.body[i - 1].range[1] : 0)
    if (node.type === "ExportAllDeclaration" || (node.type === "ExportNamedDeclaration" && !node.declaration)) lines.push(doc + source(node))
    // TypeScript gives a statement's JSDoc to its first declaration only.
    else if (node.type === "ExportNamedDeclaration") lines.push(...stubs(node.declaration, typeReads(node.declaration)).map((stub, i) => (i ? "" : doc) + stub))
    else if (node.type === "ExportDefaultDeclaration") lines.push(doc + "export default 0")
  })
  const reads = new Set()
  visit(program, (node) => {
    if (node.type === "ImportExpression" && node.source?.type === "Literal" && typeof node.source.value === "string") reads.add(`import(${JSON.stringify(node.source.value)})`)
    else if (node.type === "MemberExpression" && !node.computed && node.object?.type === "Identifier" && namespaces.has(node.object.name) && node.property?.type === "Identifier") reads.add(`${node.object.name}.${node.property.name}`)
    else if ((node.type === "TSQualifiedName") && node.left?.type === "Identifier" && namespaces.has(node.left.name) && node.right?.type === "Identifier") reads.add(`${node.left.name}.${node.right.name}`)
  })
  for (const read of reads) lines.push(`${read}`)
  return lines.join("\n") + "\n"
}

// The stub export of a declaration: its names, without its body, and the
// types its signature reads (reads), which Knip counts as uses of the exports
// they name.
function stubs(declaration, reads) {
  const name = declaration.id?.name
  const types = reads.length ? `[${reads.join(", ")}]` : ""
  const value = types ? `0 as unknown as ${types}` : "0"
  switch (declaration.type) {
    case "VariableDeclaration": {
      // Knip applies a variable statement's tags to all its exported names.
      // Keep its bindings together so the JSDoc keeps that statement scope.
      const bindings = declaration.declarations.flatMap((d) => names(d.id))
      return bindings.length ? [`export const ${bindings.map((n) => `${n} = ${value}`).join(", ")}`] : []
    }
    case "FunctionDeclaration":
    case "TSDeclareFunction": return name ? [`export function ${name}(${types ? `..._: ${types}` : ""}) {}`] : []
    case "ClassDeclaration": return name ? [`export class ${name} {${types ? ` _?: ${types} ` : ""}}`] : []
    case "TSTypeAliasDeclaration": return [`export type ${name} = ${types || "unknown"}`]
    case "TSInterfaceDeclaration": return [`export interface ${name} {${types ? ` _?: ${types} ` : ""}}`]
    case "TSEnumDeclaration": return [`export enum ${name} {}`]
    case "TSModuleDeclaration": return declaration.id?.type === "Identifier" ? [`export namespace ${name} {}`] : []
    default: return name ? [`export const ${name} = ${value}`] : []
  }
}

// The types an exported declaration's signature reads, outside its function
// bodies: each name a type reference or a typeof query starts with, except
// the declaration's own type parameters. Knip counts such a read as a use of
// the export it names, and a read in a body as none, as for TypeScript:
// `export function read(input: typeof sample)` uses the export sample.
function typeReads(declaration) {
  const found = new Set()
  const parameters = new Set()
  const functions = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"])
  const root = (name) => {
    while (name?.type === "TSQualifiedName") name = name.left
    return name?.type === "Identifier" ? name.name : undefined
  }
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) if (item !== null && typeof item === "object") walk(item)
      return
    }
    if (node.type === "TSTypeParameter") parameters.add(typeof node.name === "string" ? node.name : node.name?.name)
    if (node.type === "TSTypeReference" && root(node.typeName)) found.add(root(node.typeName))
    if (node.type === "TSTypeQuery" && root(node.exprName)) found.add(`typeof ${root(node.exprName)}`)
    for (const [key, value] of Object.entries(node)) {
      if (key === "range" || key === "loc" || value === null || typeof value !== "object") continue
      if (key === "body" && functions.has(node.type)) continue
      walk(value)
    }
  }
  walk(declaration)
  return [...found].filter((read) => !parameters.has(read))
}

// The names a binding pattern declares.
function names(pattern) {
  if (!pattern) return []
  switch (pattern.type) {
    case "Identifier": return [pattern.name]
    case "ObjectPattern": return pattern.properties.flatMap((p) => names(p.type === "RestElement" ? p : p.value))
    case "ArrayPattern": return pattern.elements.flatMap(names)
    case "RestElement": return names(pattern.argument)
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
