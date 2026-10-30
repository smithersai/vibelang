// Checks the repository content smithers.sh serves for VibeLang: the guest chat's instructions
// (.smithers/instructions/app.md), the repo home (.smithers/home.json), the convert flow's prompt and
// the vibelang.sh hero (docs/site/converter/hero.json). It blocks the docs deploy, because these files
// are what the converter, the repo home and the chat say about VibeLang.
//
//   bun docs/tools/check-smithers-content.ts
//
// app.md: under 24 KiB; every link resolves to a docs page or a repository file; every VibeLang block
// passes check-snippets.ts; the install block matches what create-vibelang prints. home.json: what
// smithers.sh's reader accepts (home.ts), every block of a known kind, existing markdown paths. prompt.md: not stale. hero.json: the
// hero golden case, with matching hashes. Golden source stays out of examples/ and prompt.md.
import { heldoutProblems } from "../../.smithers/flows/convert/check-heldout.mjs"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import * as Home from "./home.ts"

const repo = resolve(import.meta.dir, "../..")
export const appLimit = 24 * 1024

/** Maps a link in app.md to the repository file that proves it resolves, or a reason it cannot. */
export function linkTarget(url: string): { file?: string; ok?: true; error?: string } {
  let parsed: URL
  try { parsed = new URL(url) } catch { return { error: "not a URL" } }
  if (parsed.protocol !== "https:") return { error: "not https" }
  if (parsed.hostname === "vibelang.sh") {
    if (parsed.pathname === "/" || parsed.pathname === "") return { ok: true }
    const page = parsed.pathname.replace(/^\//, "")
    const md = page.replace(/\.(?:html|md)$/, "") + ".md"
    return page.startsWith("spec/") ? { file: join("docs/design/src", md.slice("spec/".length)) } : { file: join("docs/user/src", md) }
  }
  if (parsed.hostname === "smithers.sh") {
    const blob = /^\/effeck\/effeck\/blob\/main\/(.+)$/.exec(parsed.pathname)
    if (blob) return { file: decodeURIComponent(blob[1]) }
    if (parsed.pathname === "/effeck/effeck/issues" || parsed.pathname === "/effeck/effeck") return { ok: true }
  }
  return { error: "links go to vibelang.sh pages or effeck/effeck on smithers.sh only" }
}

export function links(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(/https:\/\/[^\s)<>`"]+/g)].map((m) => m[0].replace(/[.,;:]+$/, "")))]
}

/** The fenced blocks of a language under one `## ` section. */
export function sectionBlocks(markdown: string, heading: string, lang: string): string[] {
  const start = markdown.indexOf(`## ${heading}`)
  if (start < 0) return []
  const end = markdown.indexOf("\n## ", start + 1)
  const section = markdown.slice(start, end < 0 ? undefined : end)
  return [...section.matchAll(new RegExp("```" + lang + "\\n([\\s\\S]*?)```", "g"))].map((m) => m[1].trim())
}

/** What create-vibelang prints for an npm user: the scaffold command and its next steps. */
export function createVibeLangSteps(): { commands: string[]; editor: string[] } {
  const scratch = mkdtempSync(join(tmpdir(), "vibelang-create-"))
  try {
    // A relative target, as a reader types it: create-vibelang echoes it in its `cd` step.
    const run = spawnSync("node", [join(repo, "packages/create-vibelang/bin/create-vibelang.mjs"), "my-app", "--no-install"], {
      cwd: scratch, encoding: "utf8", env: { ...process.env, npm_config_user_agent: "npm/11.0.0 node/v26.0.0" }
    })
    if (run.status !== 0) throw new Error(`create-vibelang failed: ${run.stderr}`)
    const lines = run.stdout.split("\n").map((l) => l.trim())
    const next = lines.slice(lines.indexOf("Next steps:") + 1)
    // --no-install adds the install step; a real `npm create` runs it itself.
    const commands = ["npm create vibelang@latest my-app", ...next.filter((l) => l.startsWith("cd ") || l.startsWith("npm run start")).map((l) => l.replace(/\s{2,}.*$/, ""))]
    const editor = lines.filter((l) => l.startsWith("code --install-extension"))
    return { commands, editor }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

const homeLimit = 128 * 1024
const invalid: Record<Home.Invalid, string> = {
  json: "is not JSON",
  shape: "needs an object with a blocks array or a sections array, not both, and contributors role or anyone",
  sections: `declares more than ${Home.maximumSections} sections`,
  section: "has a section that isn't an object with a blocks array, or whose title or audience breaks its bounds",
  blocks: `declares more than ${Home.maximumBlocks} blocks`,
  block: "has a block that breaks its kind's schema: a bound, HTML in a string, or a link that isn't http(s)"
}

/**
 * What smithers.sh's reader (docs/tools/home.ts, a copy of @smthrs/views' Home.read) refuses, plus what it would
 * skip or fail to show: a block of a kind it doesn't know, a home with no blocks, and a markdown file that is missing.
 */
export function homeProblems(document: string, exists: (path: string) => boolean): string[] {
  const problems: string[] = []
  if (Buffer.byteLength(document) > homeLimit) problems.push("home.json is over 128 KiB")
  const home = Home.read(document)
  if (home._tag === "Invalid") {
    const at = home.at === undefined ? "" : ` (section ${home.at.section}${home.at.block === undefined ? "" : `, block ${home.at.block}`})`
    return [...problems, `home.json ${invalid[home.reason]}${at}`]
  }
  for (const { section, block, type } of home.skipped) problems.push(`section ${section}, block ${block}: unknown type ${type}, which smithers.sh skips`)
  if (home.sections.every((section) => section.blocks.length === 0)) problems.push("home.json declares no blocks")
  for (const section of home.sections) {
    for (const block of section.blocks) if (block.type === "markdown" && !exists(block.path)) problems.push(`markdown file is missing: ${block.path}`)
  }
  return problems
}

const sha = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`

function appSnippetProblems(): string[] {
  const scratch = mkdtempSync(join(tmpdir(), "vibelang-content-"))
  const problems: string[] = []
  try {
    const json = join(scratch, "snippets.json")
    const snippets = spawnSync("bun", [join(repo, "docs/tools/check-snippets.ts"), "--root", join(repo, ".smithers/instructions"), "--json", json], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    try {
      const report = JSON.parse(readFileSync(json, "utf8"))
      const blocks = report.pages.flatMap((p: { blocks: Array<{ status: string }> }) => p.blocks)
      const bad = blocks.filter((b: { status: string }) => b.status !== "ok")
      if (!blocks.length) problems.push("app.md has no checked VibeLang block")
      if (bad.length) problems.push(`app.md: ${bad.length} snippet(s) do not pass check-snippets.ts:\n${snippets.stdout.slice(-1500)}`)
    } catch {
      problems.push(`check-snippets.ts did not report on app.md (exit ${snippets.status}):\n${(snippets.stdout + snippets.stderr).slice(-1500)}`)
    }
    return problems
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

async function main() {
  const problems: string[] = []
  const at = (path: string) => join(repo, path)
  const app = readFileSync(at(".smithers/instructions/app.md"), "utf8")
  if (Buffer.byteLength(app) >= appLimit) problems.push(`app.md is ${Buffer.byteLength(app)} bytes; the limit is ${appLimit}`)
  for (const url of links(app)) {
    const target = linkTarget(url)
    if (target.error) problems.push(`app.md: ${url}: ${target.error}`)
    else if (target.file && !existsSync(at(target.file))) problems.push(`app.md: ${url} does not resolve (${target.file} is missing)`)
  }
  const { commands, editor } = createVibeLangSteps()
  const [install, editorBlock] = sectionBlocks(app, "Install", "sh")
  if (install !== commands.join("\n")) problems.push(`app.md's install block must be:\n${commands.join("\n")}\nnot:\n${install ?? "(missing)"}`)
  for (const line of (editorBlock ?? "").split("\n")) if (line && !editor.includes(line)) problems.push(`app.md: "${line}" is not what create-vibelang prints`)

  problems.push(...appSnippetProblems())

  problems.push(...homeProblems(readFileSync(at(".smithers/home.json"), "utf8"), (p) => existsSync(at(p))).map((p) => `home.json: ${p}`))

  problems.push(...heldoutProblems())

  const prompt = spawnSync("node", [at(".smithers/flows/convert/build-prompt.mjs"), "--check"], { encoding: "utf8" })
  if (prompt.status !== 0) problems.push(prompt.stderr.trim() || "prompt.md is stale")

  const hero = JSON.parse(readFileSync(at("docs/site/converter/hero.json"), "utf8"))
  const golden = ".smithers/flows/convert/golden/01-hero-batch-lookup/"
  if (hero.effect !== readFileSync(at(golden + "input.ts"), "utf8") || hero.vibelang !== readFileSync(at(golden + "expected.vibe"), "utf8")) problems.push("hero.json differs from golden case 01")
  if (hero.receipt?.inputSha !== sha(hero.effect) || hero.receipt?.outputSha !== sha(hero.vibelang)) problems.push("hero.json's receipt hashes do not match its code")

  if (problems.length) {
    console.error(problems.map((p) => `check-smithers-content: ${p}`).join("\n"))
    process.exit(1)
  }
  console.log(`check-smithers-content: app.md ${Buffer.byteLength(app)} bytes, ${links(app).length} links, install block, snippets, home.json, prompt.md and hero.json pass`)
}

if (import.meta.main) await main()
