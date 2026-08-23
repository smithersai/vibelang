import { comptime } from "smithers:comptime"

/**
 * **Provisional** example of the source-level loader registration candidate for
 * docs/ASSET_LOADERS.md open question 2.
 *
 * The compiler recognizes the default export below by checker identity against
 * `"smithers:comptime"`, erases the compiler-owned import, and runs only the
 * loader function — inside the existing no-permission Deno sandbox, never in
 * the compiler process. `context.import` is the only way additional inputs
 * enter the build, so the schema read here becomes a tracked dependency edge.
 *
 * The YAML subset is deliberately narrow, mirroring the Markdown front-matter
 * subset: anything a reader could interpret two ways is an error rather than a
 * silently different value.
 */

interface LoaderAsset {
  readonly path: string
  text(): string
}

interface LoaderContext {
  readonly target: string
  readonly options: Readonly<Record<string, unknown>>
  import(specifier: string, options?: Record<string, unknown>): Promise<{ readonly module: { readonly value: unknown } }>
}

type Scalar = string | number | boolean
type Entry = Scalar | Scalar[] | Record<string, Scalar>

const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/
/** Scalars whose YAML readers disagree. The subset demands quotes for these. */
const AMBIGUOUS = /^(?:~|[Nn]ull|NULL|[Yy]es|YES|[Nn]o|NO|[Oo]n|ON|[Oo]ff|OFF|True|TRUE|False|FALSE|[-+]?\.(?:inf|nan))$/

const scalar = (text: string, where: string): Scalar => {
  if (text.length === 0) throw new Error(`${where}: empty value; write a quoted string`)
  const quote = text[0]
  if (quote === '"' || quote === "'") {
    if (text.length < 2 || !text.endsWith(quote)) throw new Error(`${where}: unterminated quoted scalar`)
    const inner = text.slice(1, -1)
    if (inner.includes(quote) || inner.includes("\\")) {
      throw new Error(`${where}: this subset has no escapes inside a quoted scalar`)
    }
    return inner
  }
  if (text === "true") return true
  if (text === "false") return false
  if (NUMBER.test(text)) return Number(text)
  if (AMBIGUOUS.test(text)) throw new Error(`${where}: ambiguous YAML scalar '${text}'; quote it to keep a string`)
  if (/^[-?:,[\]{}#&*!|>%@`]/.test(text)) throw new Error(`${where}: quote a scalar that starts with '${text[0]}'`)
  if (text.includes(": ") || text.includes(" #")) throw new Error(`${where}: quote a scalar containing ': ' or ' #'`)
  return text
}

const parse = (source: string, path: string): Record<string, Entry> => {
  const value: Record<string, Entry> = {}
  const lines = source.split("\n")
  let index = 0
  while (index < lines.length) {
    const raw = lines[index] ?? ""
    const where = `${path}:${index + 1}`
    if (raw.includes("\t")) throw new Error(`${where}: this subset does not allow tabs`)
    const text = raw.replace(/\r$/, "")
    if (text.trim() === "" || text.trimStart().startsWith("#")) {
      index += 1
      continue
    }
    if (text.trimStart().length !== text.length) throw new Error(`${where}: a mapping key starts at column 1`)
    const colon = text.indexOf(":")
    if (colon < 0) throw new Error(`${where}: entries are written as 'key: value'`)
    const key = text.slice(0, colon).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) throw new Error(`${where}: invalid mapping key '${key}'`)
    if (Object.hasOwn(value, key)) throw new Error(`${where}: duplicate key '${key}'`)
    const rest = text.slice(colon + 1).trim()
    index += 1
    if (rest !== "") {
      value[key] = scalar(rest, where)
      continue
    }
    const items: Scalar[] = []
    const nested: Record<string, Scalar> = {}
    let list: boolean | undefined
    while (index < lines.length) {
      const child = (lines[index] ?? "").replace(/\r$/, "")
      if (child.trim() === "" || child.trimStart().startsWith("#")) {
        index += 1
        continue
      }
      if (child.trimStart().length === child.length) break
      const childWhere = `${path}:${index + 1}`
      if (!child.startsWith("  ") || child[2] === " ") {
        throw new Error(`${childWhere}: this subset supports one nested level indented by exactly two spaces`)
      }
      const content = child.slice(2)
      const isItem = /^-(?: |$)/.test(content)
      if (list === undefined) list = isItem
      if (list !== isItem) throw new Error(`${childWhere}: a block mixes list items and mapping entries`)
      if (isItem) {
        items.push(scalar(content.replace(/^-[ ]*/, "").trimEnd(), childWhere))
      } else {
        const childColon = content.indexOf(":")
        if (childColon < 0) throw new Error(`${childWhere}: nested entries are written as 'key: value'`)
        const childKey = content.slice(0, childColon).trim()
        if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(childKey)) throw new Error(`${childWhere}: invalid mapping key '${childKey}'`)
        if (Object.hasOwn(nested, childKey)) throw new Error(`${childWhere}: duplicate key '${key}.${childKey}'`)
        nested[childKey] = scalar(content.slice(childColon + 1).trim(), childWhere)
      }
      index += 1
    }
    if (list === undefined) throw new Error(`${where}: key '${key}' has no value`)
    value[key] = list ? items : nested
  }
  return value
}

/** Computed string keys keep a `__proto__` field a data property. */
const literal = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(literal).join(", ")}]`
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{ ${Object.keys(record).map((key) => `[${JSON.stringify(key)}]: ${literal(record[key])}`).join(", ")} }`
  }
  return JSON.stringify(value)
}

const load = async (asset: LoaderAsset, context: LoaderContext) => {
  const source = asset.text()
  const value = parse(source, asset.path)
  // Tracked context: this edge enters the incremental graph and the cache key.
  const schema = (await context.import("./app.schema.json", { type: "json", mode: "const" })).module.value
  const required = (schema as { readonly required?: readonly string[] }).required ?? []
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new Error(`${asset.path}: missing required key '${key}'`)
  }
  const head = "const value = "
  const emittedTypeScript = `${head}${literal(value)} as const;\nexport default value;\n`
  const spans = Object.keys(value).map((key) => ({
    generatedOffset: Math.max(head.length, emittedTypeScript.indexOf(JSON.stringify(key))),
    sourceOffset: Math.max(0, source.indexOf(`${key}:`)),
  }))
  return {
    format: "yaml",
    value,
    emittedTypeScript,
    declaration: 'declare const value: typeof import("./asset.generated.ts").default;\nexport default value;\n',
    diagnostics: [],
    spans: [{ generatedOffset: head.length, sourceOffset: 0 }, ...spans],
  }
}

export default comptime.loader("yaml", load)
