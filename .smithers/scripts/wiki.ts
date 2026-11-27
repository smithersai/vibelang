#!/usr/bin/env bun
/**
 * Builds, validates, and publishes the Obsidian-compatible VibeLang Wiki
 * (`docs/wiki/`) to Smithers Cloud's `wiki` repository feed
 * (`https://smithers.sh/smithersai/vibelang/-/wiki`).
 *
 * Usage:
 *   bun .smithers/scripts/wiki.ts --check
 *   bun .smithers/scripts/wiki.ts --write .uphill/wiki-feed.json
 *   bun .smithers/scripts/wiki.ts --publish
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"

const repoRoot = resolve(import.meta.dir, "../..")
const defaultWikiDir = join(repoRoot, "docs/wiki")

export interface WikiFeedNote {
  readonly path: string
  readonly title: string
  readonly markdown: string
  readonly tags: ReadonlyArray<string>
  readonly updatedAt: string
}

export interface WikiBuildResult {
  readonly notes: ReadonlyArray<WikiFeedNote>
  readonly errors: ReadonlyArray<string>
  readonly backlinks: Readonly<Record<string, ReadonlyArray<string>>>
}

function stemOf(notePath: string): string {
  const base = notePath.split("/").at(-1) ?? notePath
  return base.replace(/\.md$/i, "")
}

export function parseFrontmatter(source: string): {
  readonly title?: string
  readonly tags: ReadonlyArray<string>
  readonly body: string
} {
  if (!source.startsWith("---\n") && !source.startsWith("---\r\n")) {
    return { tags: [], body: source }
  }
  const end = source.indexOf("\n---", 3)
  if (end === -1) return { tags: [], body: source }
  const header = source.slice(4, end)
  const body = source.slice(end + 4).replace(/^\r?\n/, "")
  let title: string | undefined
  const tags: string[] = []
  for (const rawLine of header.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.startsWith("title:")) {
      const value = line.slice("title:".length).trim().replace(/^["']|["']$/g, "")
      if (value !== "") title = value
    } else if (line.startsWith("tags:")) {
      const value = line.slice("tags:".length).trim().replace(/^\[|\]$/g, "")
      for (const tag of value.split(",")) {
        const clean = tag.trim().replace(/^["']|["']$/g, "")
        if (clean !== "") tags.push(clean)
      }
    }
  }
  return { title, tags, body }
}

/** Matches apps/mvp/plugins/wiki/src/model.ts extractWikilinks exactly. */
export function extractWikilinks(markdown: string): ReadonlyArray<string> {
  const targets: string[] = []
  let fenced = false
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const pattern = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(line)) !== null) {
      const target = match[1]!.trim()
      if (target !== "" && !targets.includes(target)) targets.push(target)
    }
  }
  return targets
}

function resolveTarget(target: string, paths: ReadonlyArray<string>): string | undefined {
  const lower = target.toLowerCase()
  const withExt = lower.endsWith(".md") ? lower : `${lower}.md`
  return (
    paths.find((p) => p.toLowerCase() === withExt || p.toLowerCase() === lower) ??
    paths.find((p) => stemOf(p).toLowerCase() === lower)
  )
}

function walkMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return []
  const found: string[] = []
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) found.push(...walkMarkdown(full))
    else if (entry.endsWith(".md")) found.push(full)
  }
  return found
}

export function buildWiki(
  wikiDir = defaultWikiDir,
  extraNotes: ReadonlyArray<WikiFeedNote> = []
): WikiBuildResult {
  const errors: string[] = []
  const files = walkMarkdown(wikiDir)
  const notes: WikiFeedNote[] = []

  for (const file of files) {
    const rel = relative(wikiDir, file).split("\\").join("/")
    const raw = readFileSync(file, "utf8")
    if (raw.includes("\u0000")) {
      errors.push(`${rel}: contains NUL byte`)
      continue
    }
    const fm = parseFrontmatter(raw)
    const title = fm.title ?? stemOf(rel)
    if (!title.trim()) errors.push(`${rel}: missing title`)
    const mtime = statSync(file).mtime.toISOString()
    notes.push({
      path: rel,
      title,
      markdown: raw,
      tags: fm.tags,
      updatedAt: mtime
    })
  }

  for (const extra of extraNotes) notes.push(extra)

  const sorted = [...notes].sort((a, b) => a.path.localeCompare(b.path))
  const allPaths = sorted.map((n) => n.path)
  const incoming = new Map<string, string[]>()

  if (sorted.length === 0) {
    errors.push(`no wiki markdown notes found in ${wikiDir}`)
  }

  for (const note of sorted) {
    const fm = parseFrontmatter(note.markdown)
    const links = extractWikilinks(fm.body)
    for (const target of links) {
      const resolved = resolveTarget(target, allPaths)
      if (!resolved) {
        errors.push(`${note.path}: broken wikilink [[${target}]]`)
        continue
      }
      if (resolved !== note.path) {
        const list = incoming.get(resolved) ?? []
        if (!list.includes(note.path)) list.push(note.path)
        incoming.set(resolved, list)
      }
    }
  }

  const payloadBytes = Buffer.byteLength(JSON.stringify({ notes: sorted }))
  if (payloadBytes > 950 * 1024) {
    errors.push(`wiki feed payload is ${payloadBytes} bytes (cap 950 KiB for 1 MiB feed limit)`)
  }

  return {
    notes: sorted,
    errors,
    backlinks: Object.fromEntries([...incoming.entries()].sort(([a], [b]) => a.localeCompare(b)))
  }
}

function loadFeedConfig(): { url: string; repo: string; key: string } {
  if (process.env.SMITHERS_FEED_TOKEN) {
    return {
      url: process.env.SMITHERS_FEED_URL || "https://smithers.sh",
      repo: process.env.SMITHERS_FEED_REPO || "smithersai/vibelang",
      key: process.env.SMITHERS_FEED_TOKEN
    }
  }
  const cfgPath = process.env.SMITHERS_FEED_CONFIG ?? join(homedir(), ".config/vibelang-factory/smithers.json")
  if (!existsSync(cfgPath)) {
    throw new Error(`feed config not found at ${cfgPath} and SMITHERS_FEED_TOKEN is unset`)
  }
  return JSON.parse(readFileSync(cfgPath, "utf8")) as { url: string; repo: string; key: string }
}

async function publishWikiFeed(notes: ReadonlyArray<WikiFeedNote>): Promise<void> {
  const cfg = loadFeedConfig()
  const endpoint = `${cfg.url.replace(/\/+$/, "")}/api/repos/${cfg.repo}/feeds`
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.key}`
    },
    body: JSON.stringify({
      set: {
        wiki: {
          visibility: "public",
          body: { notes }
        }
      }
    })
  })
  if (!res.ok) {
    throw new Error(`wiki feed publish failed with HTTP ${res.status}`)
  }
  const json = (await res.json()) as { written: number; unchanged: number; deleted: number }
  console.log(
    `wiki: published ${notes.length} notes to ${cfg.repo} (written=${json.written}, unchanged=${json.unchanged})`
  )
}

async function main() {
  const args = process.argv.slice(2)
  const check = args.includes("--check")
  const publish = args.includes("--publish")
  const writeIdx = args.indexOf("--write")
  const writeOut = writeIdx >= 0 ? args[writeIdx + 1] : undefined

  const extra: WikiFeedNote[] = []
  const auditMdPath = join(repoRoot, ".uphill/lighthouse-audit.md")
  if ((publish || writeOut) && existsSync(auditMdPath)) {
    const auditMd = readFileSync(auditMdPath, "utf8")
    extra.push({
      path: "Factory/Live-Backpressure-Snapshot.md",
      title: "Live Backpressure Audit Snapshot",
      tags: ["backpressure", "lighthouse", "uphill", "live"],
      updatedAt: new Date().toISOString(),
      markdown: `---\ntitle: Live Backpressure Audit Snapshot\ntags: [backpressure, lighthouse, uphill, live]\n---\n\n# Live Backpressure Audit Snapshot\n\n${auditMd}\nSee [[Backpressure-and-Uphill]], [[Trust-and-Cache-Model]], and [[Smithers-Cloud-Setup]] for methodology.\n`
    })
  }

  const result = buildWiki(defaultWikiDir, extra)
  if (result.errors.length > 0) {
    for (const err of result.errors) console.error(`wiki: ${err}`)
    process.exit(1)
  }

  if (writeOut) {
    const target = resolve(repoRoot, writeOut)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, JSON.stringify({ notes: result.notes }, null, 2) + "\n", "utf8")
    console.log(`wiki: wrote ${result.notes.length} notes to ${target}`)
  }

  if (publish) {
    await publishWikiFeed(result.notes)
  }

  if (check || (!writeOut && !publish)) {
    const backlinked = Object.keys(result.backlinks).length
    console.log(`wiki: ok (${result.notes.length} notes, ${backlinked} backlinked targets, 0 broken wikilinks)`)
  }
}

if (import.meta.main) {
  await main()
}
