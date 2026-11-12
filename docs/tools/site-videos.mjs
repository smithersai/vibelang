#!/usr/bin/env node
// Every video the site embeds records the VibeLang version it was recorded with in
// site/videos/manifest.json. The ordinary check keeps the manifest complete; the
// release check (scripts/deploy-docs.sh) also requires each recorded version to be
// the release the site states, so a page never plays an older compiler's output.
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../", import.meta.url))
const pageFile = /\.(?:mdx?|tsx?)$/
const videoTag = /<video\b([^>]*)>([\s\S]*?)<\/video>/g
const attribute = (text, name) => new RegExp(`\\b${name}="\\/videos\\/([^"]+)"`).exec(text)?.[1]
const reference = /\/videos\/([A-Za-z0-9._-]+\.(?:mp4|jpg|png|webm|webp))/g

function walk(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(path)
    return [path]
  })
}

const sha256 = path => createHash("sha256").update(readFileSync(path)).digest("hex")

// Pages embed a video as <video poster="/videos/X.jpg"><source src="/videos/X.mp4">.
export function siteEmbeds(repository = root) {
  const embeds = new Map()
  const references = new Map()
  for (const path of walk(join(repository, "site/src")).filter(path => pageFile.test(path))) {
    const text = readFileSync(path, "utf8")
    const page = relative(repository, path).replaceAll("\\", "/")
    for (const [, attributes, body] of text.matchAll(videoTag)) {
      const video = attribute(attributes, "src") ?? attribute(body, "src")
      if (!video) continue
      const poster = attribute(attributes, "poster") ?? null
      if (!embeds.has(video)) embeds.set(video, { poster, pages: [] })
      embeds.get(video).pages.push(page)
    }
    for (const [, file] of text.matchAll(reference)) {
      if (!references.has(file)) references.set(file, [])
      references.get(file).push(page)
    }
  }
  return { embeds, references }
}

export function videoManifestProblems(repository = root, { release } = {}) {
  const problems = []
  const publicDir = join(repository, "site/public/videos")
  const manifestPath = join(repository, "site/videos/manifest.json")
  if (!existsSync(manifestPath)) return ["site/videos/manifest.json: missing; record each embedded video's VibeLang version there"]
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  const videos = manifest.videos ?? {}
  const { embeds, references } = siteEmbeds(repository)

  for (const [video, { poster, pages }] of embeds) {
    const entry = videos[video]
    if (entry?.removed) {
      problems.push(`site/videos/manifest.json: ${video} was removed (${entry.removed}), but ${pages[0]} still embeds it`)
      continue
    }
    if (!entry) {
      problems.push(`site/videos/manifest.json: ${video} is embedded by ${pages[0]} but has no entry; record the VibeLang version it shows`)
      continue
    }
    if (entry.poster !== poster) problems.push(`site/videos/manifest.json: ${video} lists poster ${entry.poster}, but ${pages[0]} uses ${poster}`)
  }
  for (const [video, entry] of Object.entries(videos)) {
    if (entry.removed !== undefined) {
      if (typeof entry.removed !== "string" || !entry.removed.trim()) problems.push(`site/videos/manifest.json: ${video} needs "removed": the reason it was taken off the site`)
      continue
    }
    if (!embeds.has(video)) problems.push(`site/videos/manifest.json: ${video} is listed but no page embeds it; remove the entry and the file`)
    if (entry.version !== null && !/^\d+\.\d+\.\d+$/.test(entry.version ?? "")) problems.push(`site/videos/manifest.json: ${video} needs "version": the VibeLang version it shows, or null when unknown`)
  }
  for (const file of [...embeds.keys(), ...[...embeds.values()].map(e => e.poster).filter(Boolean)]) {
    if (!existsSync(join(publicDir, file))) problems.push(`site/public/videos/${file}: embedded by a page but missing`)
  }
  // A file nobody links is still served at /videos/<file>.
  for (const file of existsSync(publicDir) ? readdirSync(publicDir) : []) {
    if (!references.has(file)) problems.push(`site/public/videos/${file}: no page links it, but the site serves it; delete it`)
  }

  // A recording receipt binds a video by digest to the compiler that produced it.
  const receipts = walk(join(repository, "site/videos"))
    .filter(path => path.endsWith(".json") && resolve(path) !== resolve(manifestPath))
    .map(path => ({ path: relative(repository, path), receipt: JSON.parse(readFileSync(path, "utf8")) }))
  const digests = new Map()
  for (const video of Object.keys(videos)) {
    const file = join(publicDir, video)
    if (existsSync(file)) digests.set(sha256(file), video)
  }
  for (const { path, receipt } of receipts) {
    const video = digests.get(receipt.videoSha256)
    if (!video) continue
    if (videos[video].removed !== undefined) continue
    const recorded = videos[video].version
    if (receipt.compilerVersion && recorded !== receipt.compilerVersion) {
      problems.push(`site/videos/manifest.json: ${video} records ${recorded}, but ${path} recorded it with ${receipt.compilerVersion}`)
    }
    // A composition shows one version only when every segment shows it.
    if (receipt.kind === "composition") {
      const versions = new Set(receipt.segments.map(segment => videos[segment.file]?.version ?? null))
      const single = versions.size === 1 ? [...versions][0] : null
      if (recorded !== single) problems.push(`site/videos/manifest.json: ${video} is composed by ${path}; its version is ${JSON.stringify(single)} (the one version all segments record, else null), not ${JSON.stringify(recorded)}`)
    }
  }

  if (release !== undefined) {
    for (const [video, entry] of Object.entries(videos)) {
      if (entry.removed !== undefined) continue
      if (entry.version !== release) {
        const shown = entry.version === null ? "records no VibeLang version" : `records VibeLang ${entry.version}`
        problems.push(`site/public/videos/${video}: ${shown}, but the site states ${release}; re-record it with ${release} and update site/videos/manifest.json`)
      }
    }
  }
  return problems
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const release = args[0] === "--release" ? args[1] : undefined
  if ((args.length && args[0] !== "--release") || (args[0] === "--release" && !/^\d+\.\d+\.\d+/.test(release ?? ""))) {
    console.error("usage: node docs/tools/site-videos.mjs [--release <version>]")
    process.exitCode = 2
  } else {
    const problems = videoManifestProblems(root, { release })
    for (const problem of problems) console.error(problem)
    if (problems.length) process.exitCode = 1
    else console.log(release ? `site-videos: every embedded video records VibeLang ${release}` : "site-videos: every embedded video has a manifest entry")
  }
}
