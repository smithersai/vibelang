#!/usr/bin/env node
// Checks what readers of the live docs site receive for a published release:
//
//   node scripts/release/live-site.mjs --version <version> [--registry <url>] [--typescript <version>] [https://vibelang.sh]
//
// It uses only Node's built-ins, so it runs from a release bundle that holds
// scripts/release/ and nothing else. docs/tools/deployed-release.mjs, the site's
// postdeploy check, uses the same functions. npm's published optional
// dependencies are authoritative: release repacking can omit platforms that
// remain in the source compiler manifest.
import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const semver = String.raw`\d+\.\d+\.\d+(?:-[\w.-]+)?`
export const releaseRoutes = [
  "/", "/setup.md", "/getting-started/004-installation",
  "/getting-started/004-installation.md", "/llms.txt",
  "/setup/release-notes", "/setup/release-notes.md"
]
function visibleText(text) {
  return text.replace(/(<(?:span|dt)\b[^>]*>\s*version\s*<\/(?:span|dt)>)/gi, "$1 ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<h2\b[^>]*>/gi, "\n## ").replace(/<\/h2>/gi, "\n")
    .replace(/<\/?(?:p|div|tr|td|th|li|section|br|h[13456])\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
      if (entity.startsWith("#")) {
        const n = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))
        return n <= 0x10ffff ? String.fromCodePoint(n) : match
      }
      return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[entity.toLowerCase()]
    })
}
function releasePageProblems(route, body, { version, expectedOutput, exactOutput, platforms }) {
  const problems = []
  if (body === undefined) return problems
  const html = route === "/" || !/\.(?:md|txt)$/.test(route)
  const text = html ? visibleText(body) : body
  const problem = message => problems.push(route + ": " + message)
  const notes = route.startsWith("/setup/release-notes")
  if (notes) {
    const headings = [...text.matchAll(new RegExp("^##\\s+(v?" + semver + ")\\s*$", "gm"))]
    const current = headings[0]
    if (!current || current[1].replace(/^v/, "") !== version) problem(`latest release notes are ${current?.[1] ?? "missing"}; expected ${version}`)
    // Even the newest bug list describes old pins and retired commands.
    // Check the release heading, but treat the whole page as history.
    return problems
  }
  const pins = [
    ...text.matchAll(new RegExp("\\b((?:create-)?vibelang(?:-[a-z0-9-]+)?)@(" + semver + ")", "g")),
    ...text.matchAll(new RegExp('["\\x27]((?:create-)?vibelang(?:-[a-z0-9-]+)?)["\\x27]\\s*:\\s*["\\x27](' + semver + ')["\\x27]', "g"))
  ]
  for (const [, name, pin] of pins) if (pin !== version) problem(`pin ${name}@${pin}; expected ${version}`)
  const labels = [...text.matchAll(new RegExp("\\b(?:VibeLang|vibelang|[Vv]ersion|Rehearsed for|In)\\s+(" + semver + ")", "g"))]
  for (const [label, pin] of labels) if (pin !== version) problem(`release label ${label.trim()}; expected ${version}`)
  if (["/", "/getting-started/004-installation", "/getting-started/004-installation.md"].includes(route) &&
      !labels.some(([, pin]) => pin === version)) problem("missing current release label " + version)
  for (const [output] of text.matchAll(new RegExp("VibeLang " + semver + " \\(TypeScript [^\\)]+\\)", "g"))) {
    if (exactOutput ? output !== expectedOutput : !output.startsWith(expectedOutput)) problem(`--version output ${output}; expected ${expectedOutput}`)
  }
  if (route === "/setup.md" && !text.includes(expectedOutput)) problem("missing expected --version output " + expectedOutput)
  for (const [, pin] of text.matchAll(new RegExp("npm view vibelang@" + semver + " version[\\x60\\s]*and expect [\\x60\\s]*(" + semver + ")", "g"))) {
    if (pin !== version) problem(`npm view expected ${pin}; expected ${version}`)
  }
  if (route === "/llms.txt") {
    for (const path of ["/setup.md", "/getting-started/004-installation.md", "/setup/release-notes.md"]) {
      if (!text.includes(path)) problem("missing Markdown link " + path)
    }
  }
  if (platforms && ["/", "/setup.md", "/getting-started/004-installation", "/getting-started/004-installation.md"].includes(route)) {
    const install = route.startsWith("/getting-started/")
    if (install) {
      const listed = [...new Set(text.match(/(?:\bvibelang-(?:darwin|linux|win32|freebsd)|@smthrs\/cli-win32)-(?:arm64|x64)\b/g) ?? [])].sort()
      for (const name of new Set([...platforms, ...listed])) {
        if (!platforms.includes(name)) problem("platform " + name + " is not published in npm latest")
        else if (!listed.includes(name)) problem("missing published platform " + name)
      }
    }
    for (const [os, label] of [["darwin", "macOS"], ["linux", "Linux"]]) {
      if (platforms.some(p => p.startsWith("vibelang-" + os)) && !text.includes(label)) problem("platform list missing " + label)
    }
    for (const arch of ["arm64", "x64"]) {
      if (platforms.some(p => p.endsWith("-" + arch)) && !text.includes(arch)) problem("platform list missing " + arch)
    }
    const nativeWindows = platforms.some(p => /^(?:vibelang-win32-|@smthrs\/cli-win32-)/.test(p))
    if (!nativeWindows) {
      if (!/\bWSL\b/.test(text)) problem("platform list missing Windows via WSL guidance")
      if (/vibelang-win32-|@smthrs\/cli-win32-|Windows on (?:arm64|x64)|(?:native )?Windows (?:binaries |packages )?(?:are )?(?:available|supported|published)|Windows\s*\|/i.test(text)) {
        problem("platform list advertises native Windows, absent from npm latest")
      }
    }
  }
  return problems
}
export async function deployedReleaseProblems({
  baseUrl = "https://vibelang.sh",
  registryUrl = "https://registry.npmjs.org/vibelang/latest",
  manifest, typescriptVersion, fetchImpl = fetch
}) {
  const problems = []
  const version = manifest.version
  if (!new RegExp("^" + semver + "$").test(version)) throw new Error("Invalid compiler release metadata")
  // Without the TypeScript version (a release bundle has no checkout), --version
  // output must still name this VibeLang version.
  const exactOutput = Boolean(typescriptVersion)
  const expectedOutput = exactOutput ? `VibeLang ${version} (TypeScript ${typescriptVersion})` : `VibeLang ${version} (TypeScript `
  async function get(url, label, json = false) {
    try {
      const response = await fetchImpl(url, {
        cache: "no-store", headers: { "Cache-Control": "no-cache" },
        signal: AbortSignal.timeout(20000)
      })
      if (!response.ok) throw new Error("HTTP " + response.status)
      return json ? await response.json() : await response.text()
    } catch (error) {
      problems.push(label + ": fetch failed: " + error.message)
      return undefined
    }
  }
  const [latest, ...bodies] = await Promise.all([
    get(registryUrl, "npm latest", true),
    ...releaseRoutes.map(route => get(new URL(route, baseUrl), route))
  ])
  let platforms
  if (latest) {
    if (latest.version !== version) problems.push(`npm latest: ${latest.version}; compiler manifest: ${version}`)
    platforms = Object.keys(latest.optionalDependencies ?? {}).filter(name => name.startsWith("vibelang-") || name.startsWith("@smthrs/cli-win32-")).sort()
    if (!platforms.length) problems.push("npm latest: missing published platform packages")
    for (const name of platforms) {
      if (latest.optionalDependencies[name] !== version || manifest.optionalDependencies?.[name] !== version) {
        problems.push(`npm latest: platform ${name}@${latest.optionalDependencies[name]} differs from compiler manifest ${manifest.optionalDependencies?.[name] ?? "(absent)"}; expected ${version}`)
      }
    }
  }
  for (const [index, route] of releaseRoutes.entries()) {
    problems.push(...releasePageProblems(route, bodies[index], { version, expectedOutput, exactOutput, platforms }))
  }
  // Every page in the sitemap except the release notes: none may teach
  // `vibelang --fix`, which is not a compiler option (TS5023). The release notes
  // are history. Before a publish their first section is the previous release,
  // which documented the option, and a release's own bug list names it.
  const sitemap = await get(new URL("/sitemap.xml", baseUrl), "/sitemap.xml")
  if (sitemap !== undefined) {
    const routes = [...new Set([...sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(([, loc]) => new URL(loc).pathname))]
    if (!routes.length) problems.push("/sitemap.xml: lists no pages")
    const fetched = new Map(releaseRoutes.map((route, index) => [route, bodies[index]]))
    const queue = routes.filter(route => !fetched.has(route))
    await Promise.all(Array.from({ length: 8 }, async () => {
      for (let route; (route = queue.shift()) !== undefined;) fetched.set(route, await get(new URL(route, baseUrl), route))
    }))
    for (const route of routes) {
      const body = fetched.get(route)
      if (body === undefined) continue
      if (route.startsWith("/setup/release-notes")) continue
      const text = /\.(?:md|txt)$/.test(route) ? body : visibleText(body)
      const count = text.match(/\bvibelang\s+--fix\b/g)?.length ?? 0
      if (count) problems.push(`${route}: teaches \`vibelang --fix\` ${count} time(s); the compiler rejects it (TS5023)`)
    }
  }
  return [...new Set(problems)]
}

/** Reads <release>'s manifest from the registry, checks the served site, prints the result and returns the exit status. */
export async function checkLiveSite({ release, registry, typescriptVersion, baseUrl, label = "live-site" }) {
  const registryBase = new URL(registry ?? "https://registry.npmjs.org/")
  if (!registryBase.pathname.endsWith("/")) registryBase.pathname += "/"
  const manifest = await fetch(new URL("vibelang/" + encodeURIComponent(release), registryBase), { cache: "no-store", signal: AbortSignal.timeout(20000) })
    .then(response => response.ok ? response.json() : { version: release, missing: "HTTP " + response.status })
    .catch(error => ({ version: release, missing: error.message }))
  if (manifest.missing) {
    console.error(`${label}: vibelang@${release} is not in ${registryBase.href}: ${manifest.missing}`)
    return 1
  }
  return report(label, manifest.version, await deployedReleaseProblems({
    baseUrl, registryUrl: new URL("vibelang/latest", registryBase).href, manifest, typescriptVersion
  }))
}

export function report(label, version, problems) {
  for (const problem of problems) console.error(label + ": " + problem)
  if (problems.length) {
    console.error(`${label}: ${problems.length} mismatch(es); check the deployed assets and npm latest before declaring the deploy complete`)
    return 1
  }
  console.log(`${label}: served docs match compiler ${version}, npm latest and published platforms`)
  return 0
}
// Compare real paths: run through a symlinked checkout, a plain comparison skipped every check and exited 0.
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const usage = "usage: node scripts/release/live-site.mjs --version <version> [--registry <url>] [--typescript <version>] [https://vibelang.sh]"
  const args = process.argv.slice(2)
  const take = name => { const at = args.indexOf(name); return at < 0 ? undefined : args.splice(at, 2)[1] ?? "" }
  const release = take("--version"), registry = take("--registry"), typescript = take("--typescript")
  if (args.length > 1 || !release || registry === "" || typescript === "") {
    console.error(usage)
    process.exitCode = 2
  } else process.exitCode = await checkLiveSite({ release, registry, typescriptVersion: typescript, baseUrl: args[0] })
}
