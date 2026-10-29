import { stripRunDirectives, stripDecisionReferences } from "../../site/scripts/user-docs.mjs"
// Markdown copies and llms.txt for the single Vocs site. Extracted from the former renderer.
import { Marked, type Tokens } from "marked"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, extname, join, relative, resolve } from "node:path"
import { pageKeys, readSidebar } from "./sidebar"

export function buildMarkdown(site: string, facts: Record<string, string>) {
  const repo = resolve(import.meta.dir, "../..")
  const root = join(repo, "docs/user")
  const { src, design, fileOf, keyOf } = pageKeys(repo)
  if (existsSync(join(src, "spec"))) throw new Error("docs/user/src/spec collides with specification pages")
  const where = (key: string) => relative(repo, fileOf(key))
  const output = (key: string) => key.replace(/\.md$/, ".html")
  const slug = (s: string) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s/g, "-")
  const { navigation, order } = readSidebar(readFileSync(join(root, "inventory.md"), "utf8"), repo)
  function files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry =>
      entry.isDirectory() ? files(join(dir, entry.name)) : entry.isFile() && entry.name.endsWith(".md") ? [relative(src, join(dir, entry.name))] : [])
  }
  // Read a snapshot: writers can keep working, and validation and rendering use the same bytes.
  const sources = new Map(files(src).map(path => [path, stripDecisionReferences(stripRunDirectives(readFileSync(join(src, path), "utf8")))]))
  const errors: string[] = []
  for (const name of readdirSync(design).filter(f => f.endsWith(".md")).sort()) {
    const markdown = readFileSync(join(design, name), "utf8").replace(/\{\{(\w+)\}\}/g, (match, fact: string) => {
      if (!(fact in facts)) errors.push(`docs/design/src/${name}: unknown placeholder ${match}`)
      return facts[fact] ?? match
    })
    sources.set(`spec/${name}`, stripRunDirectives(markdown))
    if (!order.some(p => p.path === `spec/${name}`)) errors.push(`inventory.md: the sidebar is missing docs/design/src/${name}`)
  }
  for (const page of order) if (!sources.has(page.path)) errors.push(`inventory.md: missing ${where(page.path)}`)
  if (errors.length) throw new Error(errors.join("\n"))
  const external = (href: string) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)
  // Returns the link to write, or undefined for a repository file that is not a
  // page: the site publishes only pages, so such a link keeps its text and loses its target.
  function pageLink(href: string, source: string, destination: string): string | undefined {
    if (!href || external(href) || href.startsWith("#") || href.startsWith("?")) return href
    const [, encoded = "", suffix = ""] = /^([^?#]*)([\s\S]*)$/.exec(href)!
    let path: string
    try { path = decodeURIComponent(encoded) } catch {
      errors.push(`${where(source)}: malformed internal link ${JSON.stringify(href)}`)
      return href
    }
    // A leading slash means the site root, not the host filesystem root.
    const target = path.startsWith("/") ? fileOf(join(".", path)) : resolve(dirname(fileOf(source)), path)
    const md = target.replace(/\.html$/i, ".md")
    const resolved = [md, extname(md) ? "" : md + ".md"].map(keyOf).find(key => key !== undefined && sources.has(key))
    if (resolved) return relative(dirname(destination), output(resolved)).split("/").map(encodeURIComponent).join("/") + suffix
    if (!path.startsWith("/") && target.startsWith(repo + "/") && existsSync(target)) return undefined
    errors.push(`${where(source)}: internal link ${JSON.stringify(href)} points to missing page ${relative(repo, md)}`)
    return href
  }
  const ids = new Map<string, Set<string>>()
  const owners = new Map<string, string[]>()
  const headings = new Marked({ gfm: true })
  for (const [source, markdown] of sources) {
    const found = new Set<string>()
    headings.walkTokens(headings.lexer(markdown), token => {
      if (token.type !== "heading") return
      const plain = (headings.parseInline(token.text) as string).replace(/<[^>]*>/g, "")
        .replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e]!)
      const base = slug(plain)
      let id = base, n = 0
      while (found.has(id)) id = base + "-" + (++n)
      found.add(id)
      if (source.startsWith("spec/")) owners.set(id, [...owners.get(id) ?? [], output(source)])
    })
    ids.set(output(source), found)
  }
  const first = order[0]!
  const firstChapter = order.find(p => p.path.startsWith("spec/"))!
  // Every source page is published as Markdown at its path with .md, for coding agents and other plain-text readers. A copy is the page's
  // source text: each link to a page becomes that page's .md copy on the site, a
  // bare specification fragment moves to its chapter as on the HTML page, and a
  // link to a repository file that is not a page keeps only its text. Code keeps
  // its text. llms.txt (llmstxt.org) lists the copies, one section per sidebar view.
  // Every copy uses the single public docs origin.
  const origin = "https://vibelang.sh"
  // A code span, which stays as written, or an inline link, the only link form the sources use.
  const LINK = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)|\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\(([^()\s]*)\)/g
  const lexer = new Marked({ gfm: true })
  function markdownLink(href: string, source: string): string | undefined {
    if (!href || external(href) || href.startsWith("?")) return href
    if (href.startsWith("#")) {
      const id = decodeURIComponent(href.slice(1))
      const owner = source.startsWith("spec/") && !ids.get(output(source))!.has(id) ? owners.get(id) : undefined
      return owner?.length === 1 ? `${origin}/${owner[0]!.replace(/\.html$/, ".md")}${href}` : href
    }
    const link = pageLink(href, source, "index.html")
    return link === undefined ? undefined : `${origin}/${link.replace(/\.html(?=[?#]|$)/, ".md")}`
  }
  function markdownCopy(source: string, markdown: string): string {
    const found: string[] = []
    const out: string[] = []
    let prose: string[] = []
    let fence: string | undefined
    const flush = () => {
      if (prose.length) out.push(prose.join("\n").replace(LINK, (match, ticks: string | undefined, text: string, href: string) => {
        if (ticks !== undefined) return match
        found.push(href)
        const link = markdownLink(href, source)
        return link === undefined ? text : `[${text}](${link})`
      }))
      prose = []
    }
    for (const line of markdown.split("\n")) {
      const bare = line.replace(/^[\s>]*/, "").trimEnd()
      const marker = /^(`{3,}|~{3,})/.exec(bare)?.[1]
      if (fence === undefined && marker) { flush(); fence = marker; out.push(line) }
      else if (fence !== undefined) {
        out.push(line)
        if (marker?.[0] === fence[0] && marker.length >= fence.length && bare === marker) fence = undefined
      } else prose.push(line)
    }
    flush()
    // The scan must find exactly the links marked finds, or a link would keep its repository path.
    const expected: string[] = []
    lexer.walkTokens(lexer.lexer(markdown), token => {
      if (token.type === "link" && token.raw.startsWith("[")) expected.push((token as Tokens.Link).href)
    })
    if (found.join("\n") !== expected.join("\n")) errors.push(`${where(source)}: the Markdown copy finds ${found.length} links where marked finds ${expected.length}`)
    return out.join("\n")
  }
  const copies = new Map<string, string>()
  for (const [source, markdown] of sources) copies.set(source, markdownCopy(source, markdown))
  for (const [copy, page] of [["index.md", first], ["spec/index.md", firstChapter]] as const) {
    if (copies.has(copy)) errors.push(`${where(copy)} would collide with the Markdown copy of ${output(copy)}`)
    copies.set(copy, copies.get(page.path)!)
  }
  // The summary repeats the README's first paragraph. docs/user/llms-essentials.md
  // follows it: the forms an agent needs before writing code, so it can start
  // without reading pages first (check-snippets compiles its blocks). An agent
  // harness may show only the first 2,000 bytes of a large file, so the title,
  // summary and essentials come first and must fit in that.
  const essentials = stripRunDirectives(readFileSync(join(root, "llms-essentials.md"), "utf8")).trim()
    .replace(/\]\((?!https?:)([^)]+\.md)\)/g, (_, page: string) => `](${origin}/${page})`)
  const llms = [
    "# VibeLang",
    "",
    "> VibeLang is a language for building reliable TypeScript in the AI era, built on Effect. It gives Effect a simple, readable syntax that compiles to JavaScript with TypeScript declarations, with a typed boundary to TypeScript and npm.",
    "",
    essentials,
    "",
    "Before writing or reviewing a .vibe file, read the shipped VibeLang skill at `node_modules/vibelang/skills/vibelang/SKILL.md` (in this repository: `packages/compiler/skills/vibelang/SKILL.md`). It explains the forms, rules and idioms beside their Effect equivalents.",
    "",
    `VibeLang is v0. The language will change in major, breaking ways. It is not suitable for production use. To set up VibeLang in a project, read [Set up VibeLang](${origin}/setup.md) and follow it. Each link below is a page's Markdown; remove \`.md\` for the page with navigation.`,
    ...navigation.flatMap(item => item.kind === "view" ? ["", `## ${item.label}`, ""]
      : item.kind === "page" ? [`- [${item.page.label}](${origin}/${item.page.path})${item.page.group ? `: ${item.page.group}` : ""}`] : []),
    ""
  ].join("\n")
  if (errors.length) throw new Error([...new Set(errors)].join("\n"))
  for (const [path, text] of [...copies, ["llms.txt", llms] as const]) {
    const destination = join(site, path)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, text)
  }
  console.log("Markdown: " + copies.size + " copies and llms.txt with " + order.length + " links.")
}
