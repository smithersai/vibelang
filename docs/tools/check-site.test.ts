import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkSite } from "./check-site"

const social = '<meta property="og:image" content="https://vibelang.sh/card.png"><meta name="twitter:image" content="https://vibelang.sh/card.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="VibeLang">'

const topNav = '<header data-v-gutter-top><nav><a href="https://github.com/smithersai/vibelang">GitHub</a></nav></header>'

test("checks built routes, headings and self-contained images", async () => {
  const root = mkdtempSync(join(tmpdir(), "check-site-"))
  try {
    mkdirSync(join(root, "guide"))
    writeFileSync(join(root, "card.png"), "image")
    writeFileSync(join(root, "index.html"), social + topNav + '<a href="/guide#start">Guide</a>')
    writeFileSync(join(root, "guide/index.html"), social + topNav + '<h1 id="start">Guide</h1><a href="/">Home</a>')
    await checkSite(root)
    for (const html of ['<a href="/missing">Missing</a>', '<a href="/guide#missing">Missing</a>', '<img src="https://example.com/image.png">']) {
      writeFileSync(join(root, "index.html"), social + topNav + html)
      await expect(checkSite(root)).rejects.toThrow()
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("requires social metadata on every page and local HTTPS image targets", async () => {
  const root = mkdtempSync(join(tmpdir(), "check-social-"))
  try {
    writeFileSync(join(root, "card.png"), "image")
    writeFileSync(join(root, "index.html"), social + topNav)
    await checkSite(root)
    for (const key of ["og:image", "twitter:image", "og:image:width", "og:image:height", "og:image:alt"]) {
      writeFileSync(join(root, "index.html"), topNav + social.replace(new RegExp('<meta (?:property|name)="' + key + '"[^>]*>'), ''))
      await expect(checkSite(root)).rejects.toThrow(key)
    }
    for (const url of ["/card.png", "http://vibelang.sh/card.png", "https://vibelang.sh/missing.png"]) {
      writeFileSync(join(root, "index.html"), topNav + social.replaceAll("https://vibelang.sh/card.png", url))
      await expect(checkSite(root)).rejects.toThrow("og:image")
    }
    writeFileSync(join(root, "index.html"), social + topNav)
    writeFileSync(join(root, "404.html"), "No metadata")
    await expect(checkSite(root)).rejects.toThrow("404.html: og:image")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("requires the repository link in the top nav on the home page and docs pages", async () => {
  const root = mkdtempSync(join(tmpdir(), "check-top-nav-"))
  try {
    mkdirSync(join(root, "guide"))
    writeFileSync(join(root, "card.png"), "image")
    const routes = ["index.html", "guide/index.html"]
    for (const route of routes) writeFileSync(join(root, route), social + topNav)
    await checkSite(root)
    for (const route of routes) {
      for (const html of [
        "",
        '<main><a href="https://github.com/smithersai/vibelang">GitHub</a></main>',
        '<aside><a href="https://github.com/smithersai/vibelang">GitHub</a></aside>',
        '<header data-v-gutter-top></header><a href="https://github.com/smithersai/vibelang">GitHub</a>',
        topNav.replace("smithersai/vibelang", "smithersai/other"),
      ]) {
        writeFileSync(join(root, route), social + html)
        await expect(checkSite(root)).rejects.toThrow(route + ": missing top-nav GitHub link")
      }
      writeFileSync(join(root, route), social + topNav)
    }
    await checkSite(root)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("allows Vocs standalone routes without nav while retaining their other checks", async () => {
  const root = mkdtempSync(join(tmpdir(), "check-standalone-"))
  try {
    mkdirSync(join(root, "_root.d"))
    mkdirSync(join(root, "404.d"))
    writeFileSync(join(root, "card.png"), "image")
    for (const route of ["404.html", "_root.d/index.html", "404.d/index.html"])
      writeFileSync(join(root, route), social)
    await checkSite(root)
    writeFileSync(join(root, "404.html"), "")
    await expect(checkSite(root)).rejects.toThrow("404.html: og:image")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("collects page links and images while deduplicating repeated diagnostics", async () => {
  const root = mkdtempSync(join(tmpdir(), "check-collected-page-"))
  try {
    writeFileSync(join(root, "card.png"), "image")
    writeFileSync(join(root, "index.html"), social + topNav +
      '<a href="/missing#intro">Missing</a><a href="/missing#intro">Repeated</a>' +
      '<img src="/missing.png"><img src="data:image/png;base64,AAAA">')
    const error = await checkSite(root).then(() => undefined, error => error)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe([
      "index.html: /missing#intro (missing page)",
      "index.html: missing image /missing.png"
    ].join("\n"))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
