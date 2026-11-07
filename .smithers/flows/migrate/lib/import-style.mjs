// EK4842's fix renames an Effect module imported under a JavaScript global's
// name: `import { Array } from "effect"` becomes `import { Array as Arr }
// from "effect"`, and each use `Array.take(...)` becomes `Arr.take(...)`.
// That alias is the language's default, but a repository's own lint may
// forbid aliased value imports, and some also forbid star imports. After
// `--fix`, the migration writes the form the repository's rules accept:
//
//   aliases allowed              import { Array as Arr } from "effect"   (unchanged)
//   aliases forbidden            import * as Arr from "effect/Array"     (uses unchanged)
//   aliases and stars forbidden  import { take } from "effect/Array"     (Arr.take(...) becomes take(...))
//
// The last form refuses when a member's name is already bound or read in the
// file, or when the module binding is used other than as `Arr.member`.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, posix } from "node:path"
import { lintConfigs } from "./lint-paths.mjs"

// The JavaScript globals Effect's root also exports as modules (EK4842).
const globalModules = new Set(["Array", "String", "Number", "Boolean", "Function", "Symbol", "BigInt", "RegExp"])
const sgconfig = /(?:^|\/)sgconfig\.ya?ml$/

const enabled = (text) => !/^severity:[ \t]*["']?(?:off|hint|info)["']?[ \t]*(?:#.*)?$/m.test(text)

/**
 * What the repository's lint forbids among import forms: { aliases, stars }.
 * An ast-grep rule under an sgconfig.yml that matches an import specifier's
 * alias forbids aliases; one that matches a namespace import forbids stars, as
 * does an enabled Oxlint or ESLint `import/no-namespace`. Rules whose severity
 * is off, hint or info forbid nothing.
 */
export function importStylePolicy(root, tracked) {
  const policy = { aliases: false, stars: false, rules: [] }
  const roots = tracked.filter((file) => sgconfig.test(file)).map(posix.dirname)
  const read = (file) => existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8") : null
  for (const file of tracked) {
    if (!/\.ya?ml$/.test(file) || sgconfig.test(file) || !roots.some((dir) => dir === "." || file.startsWith(dir + "/"))) continue
    const text = read(file)
    if (text === null || !/^rule:/m.test(text) || !enabled(text)) continue
    if (/kind:[ \t]*import_specifier\b/.test(text) && /field:[ \t]*alias\b/.test(text)) {
      policy.aliases = true
      policy.rules.push({ file, forbids: "aliases" })
    }
    if (/kind:[ \t]*namespace_import\b/.test(text)) {
      policy.stars = true
      policy.rules.push({ file, forbids: "stars" })
    }
  }
  for (const file of lintConfigs(tracked)) {
    const text = read(file)
    const rule = text && /["'](?:import|import-x)\/no-namespace["'][ \t]*:[ \t]*(?:\[[ \t]*)?(["']?)([\w-]+)\1/.exec(text)
    if (rule && !["off", "0", "allow"].includes(rule[2])) {
      policy.stars = true
      policy.rules.push({ file, forbids: "stars" })
    }
  }
  return policy
}

const trivia = new Set(["range", "loc", "parent", "tokens", "comments"])

// Each node with its parent and the key it sits under.
function walk(node, visit, parent = null, key = null) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, parent, key)
    return
  }
  if (!node || typeof node !== "object" || typeof node.type !== "string") return
  visit(node, parent, key)
  for (const k of Object.keys(node)) if (!trivia.has(k)) walk(node[k], visit, node, k)
}

// Whether an identifier at parent[key] names a property or a key rather than
// binding or reading a variable.
function namesProperty(parent, key) {
  if (!parent) return false
  if (parent.type === "MemberExpression" && key === "property" && !parent.computed) return true
  if (parent.type === "TSQualifiedName" && key === "right") return true
  if (["Property", "MethodDefinition", "PropertyDefinition", "TSPropertySignature", "TSMethodSignature", "TSEnumMember"].includes(parent.type) &&
    key === "key" && !parent.computed && !parent.shorthand) return true
  if (parent.type === "ImportSpecifier" && key === "imported" && parent.imported.range[0] !== parent.local.range[0]) return true
  if (parent.type === "ExportSpecifier" && key === "exported") return true
  return false
}

// The statement's text range including its line break, so removing it
// leaves no blank line.
function statementRange(text, node) {
  let end = node.range[1]
  if (text[end] === "\r") end++
  if (text[end] === "\n") end++
  return [node.range[0], end]
}

/**
 * Rewrites the EK4842 aliases in one module's text to the form policy
 * accepts. ast is the module's ESTree with ranges (`vibelang --estree`).
 * Returns { text, rewritten, refused }: text is null when nothing changed;
 * rewritten lists { local, module, form }; refused lists { local, reason }.
 */
export function applyImportStyle(text, ast, policy) {
  const result = { text: null, rewritten: [], refused: [] }
  if (!policy.aliases) return result
  const imports = ast.body.filter((node) => node.type === "ImportDeclaration" && node.source.value === "effect" && node.importKind !== "type")
  const edits = []
  for (const declaration of imports) {
    // A default or namespace binding beside the named ones keeps its statement.
    if (declaration.specifiers.some((s) => s.type !== "ImportSpecifier")) continue
    const aliased = declaration.specifiers.filter((s) => s.type === "ImportSpecifier" && s.importKind !== "type" &&
      globalModules.has(s.imported.name) && s.local.name !== s.imported.name)
    const kept = declaration.specifiers.filter((s) => !aliased.includes(s))
    const added = []
    for (const specifier of aliased) {
      const local = specifier.local.name, module = "effect/" + specifier.imported.name
      if (!policy.stars) {
        added.push(`import * as ${local} from "${module}"`)
        result.rewritten.push({ local, module, form: "namespace" })
        continue
      }
      const uses = [], others = [], names = new Map()
      walk(ast, (node, parent, key) => {
        if (node.type !== "Identifier" || namesProperty(parent, key)) return
        if (node === specifier.local) return
        if (node.name === local) {
          if (parent?.type === "MemberExpression" && key === "object" && !parent.computed && parent.property.type === "Identifier") uses.push(parent)
          else others.push(node)
        } else names.set(node.name, (names.get(node.name) ?? 0) + 1)
      })
      const members = [...new Set(uses.map((use) => use.property.name))].sort()
      const taken = members.filter((member) => names.has(member))
      const refuse = (reason) => {
        kept.push(specifier)
        result.refused.push({ local, reason })
      }
      if (others.length) refuse(`${local} is used other than as ${local}.member, which a named import cannot write`)
      else if (!members.length) refuse(`${local} has no member use`)
      else if (taken.length) refuse(`the file already binds or reads ${taken.join(", ")}, the names a named import of ${module} would take`)
      else {
        added.push(`import { ${members.join(", ")} } from "${module}"`)
        for (const use of uses) edits.push({ start: use.range[0], end: use.range[1], text: use.property.name })
        result.rewritten.push({ local, module, form: "named", members })
      }
    }
    if (!added.length) continue
    const [start, end] = statementRange(text, declaration)
    const lines = kept.length ? ["import { " + kept.map((s) => text.slice(...s.range)).join(", ") + " } from " + text.slice(...declaration.source.range)] : []
    edits.push({ start, end, text: [...lines, ...added].join("\n") + text.slice(declaration.range[1], end) })
  }
  if (!edits.length) return result
  edits.sort((a, b) => b.start - a.start)
  result.text = edits.reduce((all, edit) => all.slice(0, edit.start) + edit.text + all.slice(edit.end), text)
  return result
}

/**
 * Applies the repository's import style to the batch's converted modules
 * after `--fix`. parse(text, file) returns a module's ESTree. Returns the
 * policy and each rewrite and refusal by file; refused modules keep the
 * fix's alias, which the repository's lint then reports.
 */
export function applyRepositoryImportStyle(root, files, tracked, parse) {
  const { aliases, stars, rules } = importStylePolicy(root, tracked)
  const result = { aliases, stars, rules, rewritten: [], refused: [] }
  if (!aliases) return result
  for (const file of files) {
    if (!/\.vibex?$/.test(file) || !existsSync(join(root, file))) continue
    const text = readFileSync(join(root, file), "utf8")
    if (!/\bfrom[ \t]*["']effect["']/.test(text)) continue
    let next
    try {
      next = applyImportStyle(text, parse(text, file), { aliases, stars })
    } catch (error) {
      result.refused.push({ file, local: null, reason: "does not parse: " + error.message })
      continue
    }
    for (const rewrite of next.rewritten) result.rewritten.push({ file, ...rewrite })
    for (const refusal of next.refused) result.refused.push({ file, ...refusal })
    if (next.text !== null) writeFileSync(join(root, file), next.text)
  }
  return result
}
