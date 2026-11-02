// Declaration-file reading for the parity harness: a lexer, a splitter into
// top-level declarations, and the normalization that makes the fork's and the
// mapper's .d.ts text comparable. Ported from the spike's compare.py, which
// rewrote `import("effect/Effect").` to `Effect.` and collapsed whitespace;
// here every qualified name is resolved to the module that declares it.
//
// Normalization never touches a name the file itself declares, so two services
// with the same members stay different, and it never rewrites `any` or
// `unknown`.

export type Token = { kind: "id" | "str" | "num" | "punct"; text: string }

// lex splits declaration text into tokens. Comments and whitespace are dropped:
// JSDoc and layout are not part of a declaration's meaning.
export function lex(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2)
      i = end < 0 ? n : end + 2
    } else if (c === '"' || c === "'") {
      let j = i + 1
      while (j < n && text[j] !== c) j += text[j] === "\\" ? 2 : 1
      tokens.push({ kind: "str", text: text.slice(i, j + 1) })
      i = j + 1
    } else if (c === "`") {
      // A template literal type; ${...} holes nest braces.
      let j = i + 1
      let depth = 0
      while (j < n) {
        if (text[j] === "\\") j += 2
        else if (depth === 0 && text[j] === "`") break
        else if (text[j] === "$" && text[j + 1] === "{") (depth++, (j += 2))
        else if (depth > 0 && text[j] === "}") (depth--, j++)
        else j++
      }
      tokens.push({ kind: "str", text: text.slice(i, j + 1) })
      i = j + 1
    } else if (/[A-Za-z_$#]/.test(c)) {
      let j = i + 1
      while (j < n && /[\w$]/.test(text[j])) j++
      tokens.push({ kind: "id", text: text.slice(i, j) })
      i = j
    } else if (/[0-9]/.test(c)) {
      let j = i + 1
      while (j < n && /[\w.]/.test(text[j])) j++
      tokens.push({ kind: "num", text: text.slice(i, j) })
      i = j
    } else if (text.startsWith("=>", i) || text.startsWith("?.", i)) {
      tokens.push({ kind: "punct", text: text.slice(i, i + 2) })
      i += 2
    } else if (text.startsWith("...", i)) {
      tokens.push({ kind: "punct", text: "..." })
      i += 3
    } else {
      tokens.push({ kind: "punct", text: c })
      i++
    }
  }
  return tokens
}

const opens: Record<string, string> = { "(": ")", "[": "]", "{": "}", "<": ">" }
const closes = new Set([")", "]", "}", ">"])
const blockKinds = new Set(["class", "interface", "namespace", "module", "enum", "global"])
const modifiers = new Set(["export", "declare", "default", "abstract", "async"])

// splitStatements cuts a .d.ts token stream into top-level statements. A
// class, interface, namespace, or enum ends at the brace that closes its body;
// anything else ends at a semicolon at depth 0. In a declaration file `<` and
// `>` are always brackets, and the lexer keeps `=>` whole.
export function splitStatements(tokens: Token[]): Token[][] {
  const statements: Token[][] = []
  let start = 0
  let depth = 0
  let block: boolean | undefined
  let i = 0
  for (; i < tokens.length; i++) {
    const t = tokens[i]
    if (block === undefined && t.kind === "id" && !modifiers.has(t.text)) block = blockKinds.has(t.text)
    if (t.kind === "punct" && opens[t.text]) depth++
    else if (t.kind === "punct" && closes.has(t.text)) {
      depth--
      if (depth === 0 && t.text === "}" && block) {
        // `declare module "x" { }` and friends: the body closed the statement.
        statements.push(tokens.slice(start, i + 1))
        start = i + 1
        block = undefined
      }
    } else if (depth === 0 && t.kind === "punct" && t.text === ";") {
      if (i > start) statements.push(tokens.slice(start, i + 1))
      start = i + 1
      block = undefined
    }
  }
  if (start < tokens.length) statements.push(tokens.slice(start))
  return statements
}

export type ImportBinding = { local: string; module: string; member: string | undefined }

// A unit is one top-level declaration, keyed by name. Function overloads and
// merged declarations of one name join one unit; overloads counts functions.
export type Unit = {
  key: string
  kind: string
  name: string
  exported: boolean
  overloads: number
  statements: Token[][]
}

export type DeclarationFile = {
  imports: ImportBinding[]
  units: Unit[]
  // script is true when the file has no import or export: its declarations
  // are global, so each one is part of the file's surface.
  script: boolean
}

function parseImport(statement: Token[], imports: ImportBinding[]) {
  const from = statement.findIndex((t) => t.text === "from")
  const moduleToken = from >= 0 ? statement[from + 1] : statement.find((t) => t.kind === "str")
  if (!moduleToken || moduleToken.kind !== "str") return
  const module = moduleToken.text.slice(1, -1)
  const clause = statement.slice(1, from < 0 ? 1 : from).filter((t) => t.text !== "type")
  let k = 0
  while (k < clause.length) {
    const t = clause[k]
    if (t.text === "*" && clause[k + 1]?.text === "as") {
      imports.push({ local: clause[k + 2].text, module, member: undefined })
      k += 3
    } else if (t.text === "{") {
      k++
      while (k < clause.length && clause[k].text !== "}") {
        if (clause[k].text === ",") {
          k++
          continue
        }
        const imported = clause[k].text
        let local = imported
        if (clause[k + 1]?.text === "as") {
          local = clause[k + 2].text
          k += 3
        } else k++
        imports.push({ local, module, member: imported })
      }
      k++
    } else if (t.kind === "id") {
      imports.push({ local: t.text, module, member: "default" })
      k++
    } else k++
  }
}

// parseDeclarationFile reads one .d.ts into import bindings and units.
export function parseDeclarationFile(text: string): DeclarationFile {
  const imports: ImportBinding[] = []
  const units = new Map<string, Unit>()
  const exportedNames = new Set<string>()
  let moduleSyntax = false
  for (const statement of splitStatements(lex(text))) {
    const head = statement[0]
    if (!head) continue
    if (head.text === "import" && statement[1]?.text !== "(") {
      moduleSyntax = true
      parseImport(statement, imports)
      continue
    }
    let k = 0
    let exported = false
    while (k < statement.length && statement[k].kind === "id" && modifiers.has(statement[k].text)) {
      if (statement[k].text === "export") exported = true
      k++
    }
    if (exported) moduleSyntax = true
    const kindToken = statement[k]
    if (exported && kindToken?.text === "{") {
      // export { a, b as c } [from "m"];  export {};
      const close = statement.findIndex((t) => t.text === "}")
      const names = statement.slice(k + 1, close).filter((t) => t.kind === "id" && t.text !== "as" && t.text !== "type")
      const fromAt = statement.findIndex((t) => t.text === "from")
      if (fromAt >= 0) {
        const key = `export from ${canonicalSpecifier((statement[fromAt + 1]?.text ?? "").slice(1, -1))}`
        const unit = units.get(key)
        if (unit) unit.statements.push(statement)
        else units.set(key, { key, kind: "reexport", name: key, exported: true, overloads: 1, statements: [statement] })
      } else {
        // `export { local as name }` marks a local declaration exported.
        for (let m = k + 1; m < close; m++) {
          if (statement[m].kind === "id" && statement[m].text !== "as" && statement[m - 1]?.text !== "as") exportedNames.add(statement[m].text)
        }
        if (names.length === 0) continue
        // Visibility alone loses the exported name: changing or dropping
        // `export { local as Public }` must change the compared surface.
        // Keep the lists in one unit, alongside the local declarations.
        const key = "export local"
        const unit = units.get(key)
        if (unit) unit.statements.push(statement)
        else units.set(key, { key, kind: "reexport", name: key, exported: true, overloads: 1, statements: [statement] })
      }
      continue
    }
    if (exported && (kindToken?.text === "*" || kindToken?.text === "=")) {
      const key = statement.map((t) => (t.kind === "str" ? `"${canonicalSpecifier(t.text.slice(1, -1))}"` : t.text)).join(" ")
      units.set(key, { key, kind: "reexport", name: key, exported: true, overloads: 1, statements: [statement] })
      continue
    }
    if (!kindToken) continue
    let kind = kindToken.text
    let nameToken = statement[k + 1]
    if (kind === "type" || kind === "function" || kind === "const" || kind === "let" || kind === "var" || blockKinds.has(kind)) {
      if (kind === "function" && nameToken?.text === "*") nameToken = statement[k + 2]
    } else {
      kind = "other"
      nameToken = kindToken
    }
    // Declarations that share a name are one unit, whatever their kinds:
    // overloads, a class and its namespace, an interface and its const.
    const name = nameToken?.text ?? "?"
    const key = name
    const unit = units.get(key)
    if (unit) {
      unit.statements.push(statement)
      if (kind === "function") unit.overloads++
      if (!unit.kind.split("+").includes(kind)) unit.kind += `+${kind}`
      unit.exported ||= exported
    } else {
      units.set(key, { key, kind, name, exported, overloads: 1, statements: [statement] })
    }
  }
  for (const unit of units.values()) if (exportedNames.has(unit.name)) unit.exported = true
  // TypeScript prints a class whose base is a call (TaggedError("NotFound"),
  // a service key) with a helper, `declare const NotFound_base: ...`. The
  // helper is part of the class's declaration, so it joins the class's unit.
  for (const [key, unit] of units) {
    const owner = /^(.+)_base(?:_\d+)?$/.exec(unit.name)?.[1]
    const target = owner !== undefined ? units.get(owner) : undefined
    if (target && target.kind.includes("class") && unit.kind === "const") {
      target.statements = [...unit.statements, ...target.statements]
      units.delete(key)
    }
  }
  const list = [...units.values()]
  if (!moduleSyntax) for (const unit of list) unit.exported = true
  return { imports, units: list, script: !moduleSyntax }
}

// Normalizer resolves qualified names to the module that declares them.
export type NormalizeContext = {
  // effectModules maps a namespace that effect's index re-exports (Effect,
  // Layer, ...) to its subpath module (effect/Effect).
  effectModules: Map<string, string>
  // reexports maps a package (the mapper's prelude, vibelang-runtime) to the
  // names it re-exports unchanged and their origin:
  // vibelang-runtime -> Effect -> { module: "effect", member: "Effect" }.
  reexports: Map<string, Map<string, { module: string; member: string }>>
  // aliases maps a package to the type aliases it exports for another
  // module's type, as canonical names: vibelang-runtime -> Effect ->
  // effect/Effect#Effect, for its `type Effect<A, E, R> = EffectModule.Effect<A, E, R>`.
  // A bare name with no member access means the alias; the mapper's prelude
  // exports Effect only as a namespace, so its bare Effect<...> stays apart.
  aliases: Map<string, Map<string, string>>
}

// canonicalSpecifier: a relative specifier names a source without its
// extension, so ./users.js, ./users.vibe, and ./users are one module.
export function canonicalSpecifier(specifier: string): string {
  if (!specifier.startsWith(".")) return specifier
  return specifier.replace(/(\.d)?(\.vibe)?\.(js|mjs|cjs|ts|mts|cts|tsx|jsx|vibe)$/, "")
}

function resolveRoot(ctx: NormalizeContext, module: string, members: string[]): string {
  let mod = canonicalSpecifier(module)
  let rest = members
  const origin = rest.length > 0 ? ctx.reexports.get(mod)?.get(rest[0]) : undefined
  if (origin) {
    mod = origin.module
    rest = [origin.member, ...rest.slice(1)]
  }
  if (mod === "effect" && rest.length > 0 && ctx.effectModules.has(rest[0])) {
    mod = ctx.effectModules.get(rest[0])!
    rest = rest.slice(1)
  }
  return rest.length > 0 ? `${mod}#${rest.join(".")}` : `${mod}#`
}

// normalizeTokens returns the canonical token texts of one statement:
// `import("m").A.B` and an imported `A.B` both become `m#A.B`, after the
// specifier and prelude rules above. Names the file declares stay as written.
export function normalizeTokens(statement: Token[], imports: ImportBinding[], ctx: NormalizeContext): string[] {
  const bound = new Map(imports.map((b) => [b.local, b]))
  const out: string[] = []
  for (let i = 0; i < statement.length; i++) {
    const t = statement[i]
    const prev = statement[i - 1]
    const isMemberAccess = prev && prev.text === "."
    // An exported name is a public name, even when an import binds the
    // same spelling locally. Only the local side of an alias resolves.
    const publicExportName = statement[0]?.text === "export" && statement[1]?.text === "{" &&
      (statement[i + 1]?.text === "," || statement[i + 1]?.text === "}")
    if (publicExportName && t.kind === "id") {
      out.push(t.text)
      continue
    }
    if (t.kind === "id" && t.text === "import" && statement[i + 1]?.text === "(" && statement[i + 2]?.kind === "str") {
      // import("m", { with: { "resolution-mode": "import" } }).A.B
      let j = i + 3
      let depth = 1
      while (j < statement.length && depth > 0) {
        if (statement[j].text === "(") depth++
        else if (statement[j].text === ")") depth--
        j++
      }
      const members: string[] = []
      while (statement[j]?.text === "." && statement[j + 1]?.kind === "id") {
        members.push(statement[j + 1].text)
        j += 2
      }
      out.push(resolveRoot(ctx, statement[i + 2].text.slice(1, -1), members))
      i = j - 1
      continue
    }
    if (t.kind === "id" && !isMemberAccess && bound.has(t.text) && statement[i + 1]?.text !== ":") {
      const binding = bound.get(t.text)!
      const alias = statement[i + 1]?.text !== "." && binding.member !== undefined ? ctx.aliases.get(canonicalSpecifier(binding.module))?.get(binding.member) : undefined
      if (alias) {
        out.push(alias)
        continue
      }
      const members = binding.member === undefined ? [] : [binding.member]
      let j = i + 1
      while (statement[j]?.text === "." && statement[j + 1]?.kind === "id") {
        members.push(statement[j + 1].text)
        j += 2
      }
      out.push(resolveRoot(ctx, binding.module, members))
      i = j - 1
      continue
    }
    if (t.kind === "str") out.push(`"${prev?.text === "from" ? canonicalSpecifier(t.text.slice(1, -1)) : t.text.slice(1, -1)}"`)
    else out.push(t.text)
  }
  return out
}

// unitText is a unit's canonical text: its statements, normalized, joined.
export function unitText(unit: Unit, file: DeclarationFile, ctx: NormalizeContext): string {
  return unit.statements.map((s) => normalizeTokens(s, file.imports, ctx).join(" ")).join(" ")
}

// sortUnions puts the members of each simple union in a canonical order.
// TypeScript prints a union in type-creation order, which differs between
// the fork and stock TypeScript though the type is the same. A union element
// that holds a conditional, a function type, or a type predicate is left as
// printed.
export function sortUnions(tokens: string[]): string[] {
  let i = 0
  function group(close: string | undefined): string[] {
    const elements: string[][] = [[]]
    const separators: string[] = []
    while (i < tokens.length) {
      const t = tokens[i]
      if (close !== undefined && t === close) break
      i++
      if (t === "(" || t === "[" || t === "{" || t === "<") {
        const inner = group(opens[t])
        i++ // the closer
        elements.at(-1)!.push(t, ...inner, opens[t])
      } else if (t === "," || t === ";") {
        separators.push(t)
        elements.push([])
      } else elements.at(-1)!.push(t)
    }
    const out: string[] = []
    elements.forEach((element, k) => {
      out.push(...sortElement(element))
      if (k < separators.length) out.push(separators[k])
    })
    return out
  }
  function sortElement(element: string[]): string[] {
    // Split at top-level `|`; groups are already flattened, so track depth.
    const parts: string[][] = [[]]
    let depth = 0
    let simple = true
    for (const t of element) {
      if (t === "(" || t === "[" || t === "{" || t === "<") depth++
      else if (t === ")" || t === "]" || t === "}" || t === ">") depth--
      if (depth === 0 && (t === "?" || t === ":" || t === "=>" || t === "extends" || t === "is" || t === "=")) simple = false
      if (depth === 0 && t === "|") parts.push([])
      else parts.at(-1)!.push(t)
    }
    const members = parts.filter((p) => p.length > 0)
    if (!simple || members.length < 2) return element
    return members
      .map((p) => p.join(" "))
      .sort()
      .flatMap((p, k) => (k === 0 ? p.split(" ") : ["|", ...p.split(" ")]))
  }
  return group(undefined)
}

// countWeak counts `any` and `unknown` in canonical text: a mapper declaration
// with more of them than the fork's has lost type information.
export function countWeak(text: string): number {
  return (text.match(/(?<![\w$#.])(any|unknown)(?![\w$])/g) ?? []).length
}

// firstDifference returns the index of the first differing token.
export function firstDifference(a: string[], b: string[]): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

const keywordLike = new Set([
  "export", "declare", "function", "const", "class", "interface", "type", "namespace", "readonly", "extends",
  "implements", "new", "typeof", "keyof", "infer", "never", "void", "string", "number", "boolean", "any",
  "unknown", "undefined", "null", "true", "false", "symbol", "bigint", "object", "abstract", "static", "is",
  "asserts", "unique", "default", "let", "var", "enum"
])

// shapeToken generalizes a canonical token for a mismatch shape: local names
// become Id, string literals "…", and a qualified name keeps its module
// member (effect/Effect#Effect), which is what tells shapes apart.
export function shapeToken(t: string | undefined): string {
  if (t === undefined) return "∅"
  if (t.startsWith('"')) return '"…"'
  if (t.includes("#")) return t.replace(/^\.\/.*#/, "./…#")
  if (/^[A-Za-z_$][\w$]*$/.test(t) && !keywordLike.has(t)) return "Id"
  return t
}
