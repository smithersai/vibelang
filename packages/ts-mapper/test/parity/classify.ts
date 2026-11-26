// Source-text classification for the parity manifest. Every signal here reads
// a case's own sources (and, for L2, the frozen fork declaration); none reads
// what the projector produced. These are cheap text heuristics, by design:
// the manifest records their answer so a reviewer can correct a site by hand.

// blank replaces comments and string literal text with spaces, keeping
// offsets, so later regexes see only code. Template holes stay code.
export function blank(text: string): string {
  const out = text.split("")
  const n = text.length
  let i = 0
  const fill = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " "
  }
  function template(): void {
    // text[i] is the opening backtick
    const start = i
    i++
    let literalStart = i
    while (i < n && text[i] !== "`") {
      if (text[i] === "\\") i += 2
      else if (text[i] === "$" && text[i + 1] === "{") {
        fill(literalStart, i)
        i += 2
        code("}")
        i++ // the closing brace
        literalStart = i
      } else i++
    }
    fill(literalStart, i)
    void start
    i++
  }
  function code(until: string | undefined): void {
    let depth = 0
    while (i < n) {
      const c = text[i]
      if (until !== undefined && c === until && depth === 0) return
      if (c === "{") depth++
      else if (c === "}") depth--
      if (c === "/" && text[i + 1] === "/") {
        const end = text.indexOf("\n", i)
        const stop = end < 0 ? n : end
        fill(i, stop)
        i = stop
      } else if (c === "/" && text[i + 1] === "*") {
        const end = text.indexOf("*/", i + 2)
        const stop = end < 0 ? n : end + 2
        fill(i, stop)
        i = stop
      } else if (c === '"' || c === "'") {
        let j = i + 1
        while (j < n && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1
        fill(i + 1, j)
        i = j + 1
      } else if (c === "`") {
        template()
      } else i++
    }
  }
  code(undefined)
  return out.join("")
}

export type SourceDeclaration = {
  name: string
  kind: string
  exported: boolean
  start: number
  end: number
  // body is the blanked code of the whole statement.
  body: string
  isFunction: boolean
  generator: boolean
  generic: boolean
  // annotatedReturn: the function writes a return type; undefined when not a function.
  annotatedReturn: boolean | undefined
  // inferredChannels: the written return type has an `infer` channel (D57).
  inferredChannels: boolean
}

// `service class Names` is the older spelling of `service Names` (EK2120).
const headPattern =
  /^(export\s+)?(default\s+)?(declare\s+)?(abstract\s+)?(async\s+|effect\s+)?(function\s*\*?|const|let|var|class|interface|type|service|control|error|schema|layer|enum|namespace)\s+(?:class\s+)?([A-Za-z_$][\w$]*)/

// matchClose returns the index just past the bracket that closes code[open].
function matchClose(code: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "<": ">", "[": "]", "{": "}" }
  const opener = code[open]
  const closer = pairs[opener]
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === "=" && code[i + 1] === ">") {
      i++
      continue
    }
    if (code[i] === opener) depth++
    else if (code[i] === closer) {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return code.length
}

function skipSpace(code: string, i: number): number {
  while (i < code.length && /\s/.test(code[i])) i++
  return i
}

// statementStarts returns the offsets of the top-level statements of one
// .vibe or .ts source in blanked code. A top-level statement starts at
// column 0 outside any bracket, which holds for every source in the corpus.
export function statementStarts(code: string): number[] {
  const starts: number[] = []
  let depth = 0
  for (let i = 0; i < code.length; i++) {
    const c = code[i]
    if ((i === 0 || code[i - 1] === "\n") && depth === 0 && /[A-Za-z_$@]/.test(c)) starts.push(i)
    if (c === "{" || c === "(" || c === "[") depth++
    else if (c === "}" || c === ")" || c === "]") depth = Math.max(0, depth - 1)
  }
  return starts
}

// statementLines returns the [first, last] 1-based lines of each top-level
// statement, comments before the next statement included.
export function statementLines(text: string): [number, number][] {
  const code = blank(text)
  const starts = statementStarts(code)
  const lineOf = (offset: number) => code.slice(0, offset).split("\n").length
  return starts.map((start, k) => [lineOf(start), lineOf(k + 1 < starts.length ? starts[k + 1] - 1 : code.length)])
}

// scanDeclarations finds the top-level declarations of one source.
export function scanDeclarations(text: string): SourceDeclaration[] {
  const code = blank(text)
  const starts = statementStarts(code)
  const declarations: SourceDeclaration[] = []
  starts.forEach((start, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : code.length
    const statement = code.slice(start, end)
    const m = headPattern.exec(statement)
    if (!m) return
    const keyword = m[6].replace(/\s+/g, "")
    const generator = keyword === "function*"
    const kind = generator ? "function" : keyword
    const name = m[7]
    let isFunction = false
    let generic = false
    let annotatedReturn: boolean | undefined
    let inferredChannels = false
    const afterName = m[0].length
    if (kind !== "function" && kind !== "const" && kind !== "let" && kind !== "var") generic = statement[skipSpace(statement, afterName)] === "<"
    if (kind === "function") {
      isFunction = true
      let i = skipSpace(statement, afterName)
      if (statement[i] === "<") {
        generic = true
        i = skipSpace(statement, matchClose(statement, i))
      }
      if (statement[i] === "(") {
        const close = matchClose(statement, i)
        annotatedReturn = statement[skipSpace(statement, close)] === ":"
        const lineEnd = statement.indexOf("\n", close)
        inferredChannels = annotatedReturn && /\binfer\b/.test(statement.slice(close, lineEnd < 0 ? undefined : lineEnd))
      }
    } else if (kind === "const" || kind === "let" || kind === "var") {
      let i = skipSpace(statement, afterName)
      let typed = false
      if (statement[i] === ":") typed = true // const f: T = ... gives the whole type
      const eq = statement.indexOf("=", i)
      if (eq >= 0 && statement[eq + 1] !== ">") {
        let j = skipSpace(statement, eq + 1)
        if (statement.startsWith("async", j)) j = skipSpace(statement, j + 5)
        if (statement[j] === "<") {
          generic = true
          j = skipSpace(statement, matchClose(statement, j))
        }
        if (statement.startsWith("function", j)) {
          isFunction = true
          const paren = statement.indexOf("(", j)
          if (paren >= 0) annotatedReturn = typed || statement[skipSpace(statement, matchClose(statement, paren))] === ":"
        } else if (statement[j] === "(") {
          const close = matchClose(statement, j)
          const after = skipSpace(statement, close)
          if (statement[after] === ":" || statement.startsWith("=>", after)) {
            isFunction = true
            annotatedReturn = typed || statement[after] === ":"
          }
        } else {
          const ident = /^[A-Za-z_$][\w$]*\s*=>/.exec(statement.slice(j))
          if (ident) {
            isFunction = true
            annotatedReturn = typed
          }
        }
      }
    }
    declarations.push({
      name,
      kind,
      exported: Boolean(m[1]),
      start,
      end,
      body: statement,
      isFunction,
      generator,
      generic,
      annotatedReturn,
      inferredChannels,
    })
  })
  return declarations
}

// recursiveNames returns the functions of one file that call themselves or
// sit on a call cycle with other functions of the same file (D52).
export function recursiveNames(declarations: SourceDeclaration[]): Set<string> {
  const functions = declarations.filter((d) => d.isFunction)
  const names = new Set(functions.map((d) => d.name))
  const edges = new Map<string, Set<string>>()
  for (const f of functions) {
    const body = f.body.slice(f.body.indexOf(f.name) + f.name.length)
    const out = new Set<string>()
    for (const g of names) if (new RegExp(`(?<![\\w$.])${escape(g)}\\s*\\(`).test(body)) out.add(g)
    edges.set(f.name, out)
  }
  // Tarjan's strongly connected components.
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const recursive = new Set<string>()
  let counter = 0
  function visit(v: string) {
    index.set(v, counter)
    low.set(v, counter)
    counter++
    stack.push(v)
    onStack.add(v)
    for (const w of edges.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w)
        low.set(v, Math.min(low.get(v)!, low.get(w)!))
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!))
    }
    if (low.get(v) === index.get(v)) {
      const component: string[] = []
      let w: string
      do {
        w = stack.pop()!
        onStack.delete(w)
        component.push(w)
      } while (w !== v)
      if (component.length > 1 || edges.get(v)?.has(v)) for (const c of component) recursive.add(c)
    }
  }
  for (const v of names) if (!index.has(v)) visit(v)
  return recursive
}

function escape(s: string): string {
  return s.replace(/[$]/g, "\\$")
}

// trustedNames: names declared right after a JSDoc block that holds
// `@vibelang trusted` or `@throws` (D5, D23), in any source of the case. L5
// makes trust a value, so their callers' declarations migrate.
export function trustedNames(text: string): Set<string> {
  const names = new Set<string>()
  const doc = /\/\*\*[\s\S]*?\*\//g
  let m: RegExpExecArray | null
  while ((m = doc.exec(text))) {
    if (!/@vibelang\s+trusted|@throws\b/.test(m[0])) continue
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 200)
    const decl = /^\s*(?:export\s+)?(?:declare\s+)?(?:async\s+)?(?:function\s*\*?|const|let|class)?\s*([A-Za-z_$][\w$]*)/.exec(after)
    if (decl) names.add(decl[1])
  }
  return names
}

// tsAuthoredKeys: classes in the case's .ts files that extend a Context key.
export function tsAuthoredKeys(text: string): Set<string> {
  const keys = new Set<string>()
  for (const m of text.matchAll(/class\s+([A-Za-z_$][\w$]*)\s+extends\s+Context\.(?:Service|Tag|Reference|Key)\b/g)) keys.add(m[1])
  return keys
}

// wireCallsWithManyArguments counts `wire(...)` calls with more than one
// argument in blanked code (L7: wire takes consumers first).
export function wireCallsWithManyArguments(code: string): number {
  let count = 0
  for (const m of code.matchAll(/(?<![\w$.])wire\s*\(/g)) {
    const open = m.index! + m[0].length - 1
    let depth = 0
    let commas = 0
    let nonEmpty = false
    for (let i = open; i < code.length; i++) {
      const c = code[i]
      if (c === "(" || c === "[" || c === "{") depth++
      else if (c === ")" || c === "]" || c === "}") {
        depth--
        if (depth === 0) break
      } else if (c === "," && depth === 1) commas++
      else if (depth >= 1 && !/\s/.test(c)) nonEmpty = true
    }
    if (nonEmpty && commas >= 1) count++
  }
  return count
}

// The members a TS-authored Context key owns itself (L8).
const keyOwnMembers = ["pipe", "of", "use", "key", "name", "length", "call", "apply", "bind"]

export type Lanes = string[]

// lanesOf returns the source-text migration lanes of one declaration.
export function lanesOf(
  declaration: SourceDeclaration,
  context: { recursive: Set<string>; trusted: Set<string>; keys: Set<string> }
): Lanes {
  const lanes: string[] = []
  const body = declaration.body
  if (/catch\s*\(\s*[A-Za-z_$][\w$]*\s*:/.test(body)) lanes.push("L4")
  for (const name of context.trusted) {
    if (new RegExp(`(?<![\\w$])${escape(name)}(?![\\w$])`).test(body)) {
      lanes.push("L5")
      break
    }
  }
  // L6: a function on a call cycle writes its E and R. One with a full
  // contract, or a plain return annotation (D67), already does.
  if (context.recursive.has(declaration.name) && (declaration.annotatedReturn === false || declaration.inferredChannels)) lanes.push("L6")
  if (wireCallsWithManyArguments(body) > 0) lanes.push("L7")
  for (const key of context.keys) {
    if (new RegExp(`(?<![\\w$.])${escape(key)}\\s*\\.\\s*(${keyOwnMembers.join("|")})(?![\\w$])`).test(body)) {
      lanes.push("L8")
      break
    }
  }
  return lanes
}
