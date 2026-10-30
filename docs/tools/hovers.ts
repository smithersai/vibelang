// Run from the repository root: bun docs/tools/hovers.ts [--compiler path] [--root docs/user] [--cache dir] [--filter text]
//
// Asks the VibeLang language server for the hovers and diagnostics of the docs'
// code blocks and caches them per page as Twoslash nodes, so that a Twoslash
// renderer can show the compiler's own hovers without running the compiler.
// One `vibelang --lsp --stdio` session reads the projects that check-snippets.ts
// builds. A page's entry is reused while its blocks, the compiler binary, the
// packages its projects import, and these tools are unchanged.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { type Block, defaultCompiler, extract, linkModules, markdownPages, runtimeDir, writeProject } from "./check-snippets"
import { leaks } from "./leaks"
import { ResponseError, type Server, startServer } from "./lsp"

const repo = resolve(import.meta.dir, "../..")

// Twoslash's node shapes (twoslash-protocol): offsets, lines, and characters
// count from 0 within the block's code, in UTF-16 code units.
export type HoverNode = { type: "hover"; start: number; length: number; line: number; character: number; target: string; text: string; docs?: string }
export type ErrorNode = { type: "error"; start: number; length: number; line: number; character: number; code: string; level: "error" | "warning"; text: string }
// A block's entry is a Twoslash result: its code, as the fence holds it, and its nodes.
export type BlockHovers = { number: number; code: string; nodes: (HoverNode | ErrorNode)[] }
// A hover request that the server answered with an error, kept so a cached page still reports it.
export type Failure = { block: number; line: number; character: number; target: string; error: string }
export type PageHovers = { key: string; page: string; blocks: BlockHovers[]; failures: Failure[] }
export type Summary = { pages: number; hits: number; misses: number; hovers: number; errors: number; failures: (Failure & { page: string })[]; milliseconds: number }

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)])

// What every page's hovers depend on besides its blocks: the compiler binary,
// the packages and the runtime (runtimeDir) that the projects import, and the
// tools that build the projects and the nodes.
export function baseKey(compiler: string): string {
  const binary = compiler.includes("/") ? compiler : Bun.which(compiler)
  if (!binary) throw new Error(`Compiler not found: ${compiler}`)
  const inputs = [
    binary,
    ...["docs/tools/hovers.ts", "docs/tools/lsp.ts", "docs/tools/check-snippets.ts"].map(path => join(repo, path)),
    ...["experiments/bun.lock", "docs/tools/bun.lock", "packages/runtime/bun.lock", "packages/vite/src/index.d.ts"].map(path => join(repo, path)),
    join(runtimeDir(), "package.json"),
    ...files(join(runtimeDir(), "dist")).filter(path => path.endsWith(".d.ts")).sort()
  ]
  const hash = new Bun.CryptoHasher("sha256")
  for (const input of inputs) hash.update(readFileSync(input)).update("\0")
  return hash.digest("hex")
}

export function pageKey(base: string, blocks: Block[]): string {
  return new Bun.CryptoHasher("sha256").update(JSON.stringify([base, blocks.map(b => [b.number, b.source])])).digest("hex")
}

// The words of code that a reader can hover, outside comments and strings:
// identifiers and keywords, since VibeLang describes its keywords, and the
// topic % of a pipe. A template literal's substitutions are code.
const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(`(?:[^`\\]|\\.)*`)|(\d[\w.]*)|([A-Za-z_$][\w$]*|%)/g
export function words(code: string, offset = 0): { start: number; target: string }[] {
  const out: { start: number; target: string }[] = []
  for (const m of code.matchAll(TOKEN)) {
    const [text, , , template, , word] = m
    if (word) out.push({ start: offset + m.index!, target: word })
    if (!template) continue
    for (let i = 1; i < text.length - 1; i++) {
      if (text[i] === "\\") i++
      else if (text[i] === "$" && text[i + 1] === "{") {
        let depth = 1, end = i + 2
        for (; end < text.length - 1 && depth; end++) depth += text[end] === "{" ? 1 : text[end] === "}" ? -1 : 0
        out.push(...words(text.slice(i + 2, end - 1), offset + m.index! + i + 2))
        i = end - 1
      }
    }
  }
  return out
}

// Hovers link declarations to file:/// URIs on the build machine and can name
// the temporary project, whose paths are given. Keep each link's text and
// make paths relative.
export function sanitize(text: string, projects: string[]): string {
  let out = text.replace(/\[([^\]]*)\]\(file:[^)]*\)/g, "$1").replace(/file:\/\/\S*/g, "")
  for (const dir of projects) out = out.replaceAll(dir + "/", "./")
  return out
    .replace(/\/[^\s"'`()[\]]*\/node_modules\/(?=[^\s/])/g, "")
    .replaceAll(repo + "/", "")
}

// VibeLang's notes, which the quick info hooks in typescript/tsc/internal/vibelang
// write, come before the declaration's JSDoc in a hover. The server separates
// them with a `---` rule when there is JSDoc (1742d881). Older servers joined
// both into one Markdown string, so without the rule the notes are known by
// their openings; a note missing here is kept as if it were the JSDoc's first
// paragraph.
const NOTE = /^(?:Runs (?:here|the left side|the body|the block)|Passed by name|Plain JavaScript:|Method syntax:|An escape hatch:|Layer:|Provides the service|Waits for the operand|Joins the fiber|Starts each program|Replaced by|The value of `)/
const RULE = "\n\n---\n\n"

const paragraphsOf = (text: string) => text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
// A JSDoc summary is its first paragraph, unless that is a tag, a heading, or an example.
const summaryOf = (paragraph: string | undefined) => (paragraph && !/^(?:\*@|\*\*|`{3})/.test(paragraph) ? [paragraph] : [])

// Keeps the notes and the JSDoc's first paragraph.
export function trimDocs(documentation: string): string {
  const rule = documentation.indexOf(RULE)
  if (rule >= 0) {
    const notes = paragraphsOf(documentation.slice(0, rule))
    return [...notes, ...summaryOf(paragraphsOf(documentation.slice(rule + RULE.length))[0])].join("\n\n")
  }
  const paragraphs = paragraphsOf(documentation)
  let i = 0
  while (i < paragraphs.length && NOTE.test(paragraphs[i])) i++
  return [...paragraphs.slice(0, i), ...summaryOf(paragraphs[i])].join("\n\n")
}

// The server writes a hover as a typescript fence holding the quick info,
// followed by its documentation.
export function parseHover(markdown: string, projects: string[]): { text: string; docs?: string } | undefined {
  const fence = /^(`{3,})typescript\n([\s\S]*?)\n\1(?:\n|$)/.exec(markdown)
  if (!fence) return undefined
  const docs = sanitize(trimDocs(markdown.slice(fence[0].length)), projects)
  return { text: sanitize(fence[2], projects), ...(docs ? { docs } : {}) }
}

const lineStarts = (code: string) => [0, ...[...code.matchAll(/\n/g)].map(m => m.index! + 1)]
function position(starts: number[], start: number) {
  let line = 0
  while (line + 1 < starts.length && starts[line + 1] <= start) line++
  return { line, character: start - starts[line] }
}

// A keyword's hover can repeat the declaration it introduces, as `function`
// does; the name keeps it.
const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof interface let new null return static super switch this throw true try type typeof var void while with yield".split(" "))
function withoutRepeats(nodes: HoverNode[]): HoverNode[] {
  return nodes.filter((node, i) => {
    const next = nodes[i + 1]
    return !(RESERVED.has(node.target) && next && next.line === node.line && next.text === node.text && next.docs === node.docs)
  })
}

async function pageHovers(server: Server, dir: string, blocks: Block[]): Promise<{ blocks: BlockHovers[]; failures: Failure[] }> {
  const { filenames, offsets } = writeProject(dir, blocks)
  const projects = [...new Set([realpathSync(dir), dir])]
  const uri = (block: Block) => pathToFileURL(join(dir, filenames.get(block.number)!)).href
  for (const block of blocks) {
    const file = filenames.get(block.number)!
    server.notify("textDocument/didOpen", { textDocument: { uri: uri(block), languageId: file.endsWith(".ts") ? "typescript" : "vibe", version: 1, text: readFileSync(join(dir, file), "utf8") } })
  }
  const failures: Failure[] = []
  const result = await Promise.all(blocks.map(async (block): Promise<BlockHovers> => {
    const textDocument = { uri: uri(block) }
    const offset = offsets.get(filenames.get(block.number)!)!
    const starts = lineStarts(block.source)
    const hovers = await Promise.all(words(block.source).map(async ({ start, target }) => {
      const at = position(starts, start)
      try {
        const hover = await server.request("textDocument/hover", { textDocument, position: { line: at.line + offset, character: at.character } })
        const parsed = hover && parseHover(hover.contents?.value ?? String(hover.contents), projects)
        return parsed ? [{ type: "hover" as const, start, length: target.length, ...at, target, ...parsed }] : []
      } catch (error) {
        if (!(error instanceof ResponseError)) throw error
        failures.push({ block: block.number, ...at, target, error: error.message })
        return []
      }
    }))
    const report = await server.request("textDocument/diagnostic", { textDocument })
    const errors: ErrorNode[] = []
    for (const d of report?.items ?? []) {
      const line = d.range.start.line - offset
      if (d.severity > 2 || line < 0 || line >= starts.length) continue
      const start = starts[line] + d.range.start.character
      const endLine = d.range.end.line - offset
      const end = Math.min(block.source.length, endLine < starts.length ? starts[endLine] + d.range.end.character : block.source.length)
      errors.push({ type: "error", start, length: Math.max(1, end - start), line, character: d.range.start.character,
        code: `${d.source === "EK" ? "EK" : "TS"}${d.code}`, level: d.severity === 1 ? "error" : "warning", text: sanitize(d.message, projects) })
    }
    return { number: block.number, code: block.source, nodes: [...withoutRepeats(hovers.flat()), ...errors].sort((a, b) => a.start - b.start) }
  }))
  for (const block of blocks) server.notify("textDocument/didClose", { textDocument: { uri: uri(block) } })
  failures.sort((a, b) => a.block - b.block || a.line - b.line || a.character - b.character)
  return { blocks: result, failures }
}

// Own both resources even when starting or closing the server fails.
async function withHoverServer(compiler: string, use: (server: Server, temp: string) => Promise<void>): Promise<void> {
  const temp = mkdtempSync(join(tmpdir(), "vibelang-hovers-"))
  try {
    const server = startServer([compiler, "--lsp", "--stdio"])
    try {
      await use(server, temp)
    } finally {
      await server.close()
    }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

// Brings the cache up to date for the pages under root and returns what it did.
export async function updateHovers(options: { compiler: string; root: string; cache: string; filter?: string }): Promise<Summary> {
  const started = performance.now()
  const base = baseKey(options.compiler)
  const pages = markdownPages(options.root).filter(p => relative(options.root, p).includes(options.filter ?? ""))
    .map(path => ({ page: relative(options.root, path), blocks: extract(readFileSync(path, "utf8")) }))
    .filter(p => p.blocks.length)
    .map(p => ({ ...p, key: pageKey(base, p.blocks), file: join(options.cache, p.page.replace(/\.md$/, ".json")) }))
  const read = (file: string): PageHovers | undefined => { try { return JSON.parse(readFileSync(file, "utf8")) } catch { return undefined } }
  const entries = new Map(pages.map(p => [p.file, read(p.file)]))
  const stale = pages.filter(p => entries.get(p.file)?.key !== p.key)
  if (stale.length) {
    await withHoverServer(options.compiler, async (server, temp) => {
      linkModules(temp)
      await server.request("initialize", { processId: process.pid, rootUri: null, workspaceFolders: null,
        capabilities: { general: { positionEncodings: ["utf-16"] }, textDocument: { hover: { contentFormat: ["markdown"] }, diagnostic: {} } } })
      server.notify("initialized", {})
      // The server answers several pages' requests at once. On an Apple
      // Silicon Mac, four pages at a time took 8 s for the docs, against 17
      // to 21 s for one at a time and 11 s for eight.
      let next = 0
      await Promise.all(Array.from({ length: 4 }, async () => {
        for (let index = next++; index < stale.length; index = next++) {
          const page = stale[index]
          const entry: PageHovers = { key: page.key, page: page.page, ...await pageHovers(server, join(temp, String(index)), page.blocks) }
          const text = JSON.stringify(entry)
          const problems = leaks(text)
          if (problems.length) throw new LeakError(`${page.page}: ${problems.join("; ")}`)
          mkdirSync(dirname(page.file), { recursive: true })
          writeFileSync(page.file, text)
          entries.set(page.file, entry)
        }
      }))
    })
  }
  if (!options.filter && existsSync(options.cache)) {
    const current = new Set(pages.map(p => p.file))
    for (const file of files(options.cache)) if (file.endsWith(".json") && !current.has(file)) rmSync(file)
  }
  const all = [...entries.values()].filter(Boolean) as PageHovers[]
  const nodes = all.flatMap(e => e.blocks.flatMap(b => b.nodes))
  return { pages: pages.length, hits: pages.length - stale.length, misses: stale.length,
    hovers: nodes.filter(n => n.type === "hover").length, errors: nodes.filter(n => n.type === "error").length,
    failures: all.flatMap(e => e.failures.map(f => ({ page: e.page, ...f }))), milliseconds: Math.round(performance.now() - started) }
}

export class LeakError extends Error {}

async function main() {
  const args = process.argv.slice(2)
  const option = (name: string, fallback: string) => {
    const i = args.indexOf(name)
    if (i < 0) return fallback
    if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`${name} requires a value`)
    return args.splice(i, 2)[1]
  }
  if (args.includes("--help")) {
    console.log("bun docs/tools/hovers.ts [--compiler path] [--root docs/user] [--cache .cache/docs-hovers] [--filter text]")
    return
  }
  const selected = option("--compiler", defaultCompiler())
  const options = {
    compiler: selected.includes("/") ? resolve(selected) : selected,
    root: resolve(option("--root", join(repo, "docs/user"))),
    cache: resolve(option("--cache", join(repo, ".cache/docs-hovers"))),
    filter: option("--filter", "")
  }
  if (args.length) throw new Error(`Unknown argument: ${args.join(" ")}`)
  const summary = await updateHovers(options)
  console.log(`hovers: ${summary.pages} pages, ${summary.hits} cached, ${summary.misses} refreshed; ${summary.hovers} hover nodes, ${summary.errors} error nodes; ${(summary.milliseconds / 1000).toFixed(1)} s`)
  if (summary.failures.length) {
    // Each failed request is a language server defect. One example per message reproduces it.
    const byError = Map.groupBy(summary.failures, f => f.error)
    console.error(`hovers: the server failed ${summary.failures.length} hover requests:`)
    for (const [error, list] of byError) console.error(`  ${list.length} × ${error}\n    e.g. ${list[0].page} block ${list[0].block}, line ${list[0].line + 1}, column ${list[0].character + 1}, ${JSON.stringify(list[0].target)}`)
  }
}

if (import.meta.main) main().catch(error => { console.error(error.message); process.exitCode = error instanceof LeakError ? 1 : 2 })
