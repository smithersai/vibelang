#!/usr/bin/env node
// Check what readers receive, independently of the source/build checks.
// npm's published optional dependencies are authoritative: release repacking
// can omit platforms that remain in the source compiler manifest.
import { readFileSync } from "node:fs"
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
function releasePageProblems(route, body, { version, expectedOutput, platforms }) {
  const problems = []
  if (body === undefined) return problems
  const html = route === "/" || !/\.(?:md|txt)$/.test(route)
  let text = html ? visibleText(body) : body
  const problem = message => problems.push(route + ": " + message)
  const notes = route.startsWith("/setup/release-notes")
  if (notes) {
    const headings = [...text.matchAll(new RegExp("^##\\s+(v?" + semver + ")\\s*$", "gm"))]
    const current = headings[0]
    if (!current || current[1].replace(/^v/, "") !== version) problem(`latest release notes are ${current?.[1] ?? "missing"}; expected ${version}`)
    // Historical examples and comparisons keep the versions they describe.
    text = current ? text.slice(current.index, headings[1]?.index ?? text.length) : ""
  }
  const pins = [
    ...text.matchAll(new RegExp("\\b((?:create-)?vibelang(?:-[a-z0-9-]+)?)@(" + semver + ")", "g")),
    ...text.matchAll(new RegExp('["\\x27]((?:create-)?vibelang(?:-[a-z0-9-]+)?)["\\x27]\\s*:\\s*["\\x27](' + semver + ')["\\x27]', "g"))
  ]
  for (const [, name, pin] of pins) if (pin !== version) problem(`pin ${name}@${pin}; expected ${version}`)
  if (!notes) {
    const labels = [...text.matchAll(new RegExp("\\b(?:VibeLang|vibelang|[Vv]ersion|Rehearsed for|In)\\s+(" + semver + ")", "g"))]
    for (const [label, pin] of labels) if (pin !== version) problem(`release label ${label.trim()}; expected ${version}`)
    if (["/", "/getting-started/004-installation", "/getting-started/004-installation.md"].includes(route) &&
        !labels.some(([, pin]) => pin === version)) problem("missing current release label " + version)
  }
  for (const [output] of text.matchAll(new RegExp("VibeLang " + semver + " \\(TypeScript [^\\)]+\\)", "g"))) {
    if (output !== expectedOutput) problem(`--version output ${output}; expected ${expectedOutput}`)
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
      const listed = [...new Set(text.match(/(?:\bvibelang-(?:darwin|linux|win32|freebsd)|@vibelang\/cli-win32)-(?:arm64|x64)\b/g) ?? [])].sort()
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
    const nativeWindows = platforms.some(p => /^(?:vibelang-win32-|@vibelang\/cli-win32-)/.test(p))
    if (!nativeWindows) {
      if (!/\bWSL\b/.test(text)) problem("platform list missing Windows via WSL guidance")
      if (/vibelang-win32-|@vibelang\/cli-win32-|Windows on (?:arm64|x64)|(?:native )?Windows (?:binaries |packages )?(?:are )?(?:available|supported|published)|Windows\s*\|/i.test(text)) {
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
  if (!new RegExp("^" + semver + "$").test(version) || !typescriptVersion) throw new Error("Invalid compiler release metadata")
  const expectedOutput = `VibeLang ${version} (TypeScript ${typescriptVersion})`
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
    platforms = Object.keys(latest.optionalDependencies ?? {}).filter(name => name.startsWith("vibelang-") || name.startsWith("@vibelang/cli-win32-")).sort()
    if (!platforms.length) problems.push("npm latest: missing published platform packages")
    for (const name of platforms) {
      if (latest.optionalDependencies[name] !== version || manifest.optionalDependencies?.[name] !== version) {
        problems.push(`npm latest: platform ${name}@${latest.optionalDependencies[name]} differs from compiler manifest ${manifest.optionalDependencies?.[name] ?? "(absent)"}; expected ${version}`)
      }
    }
  }
  for (const [index, route] of releaseRoutes.entries()) {
    problems.push(...releasePageProblems(route, bodies[index], { version, expectedOutput, platforms }))
  }
  return [...new Set(problems)]
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3) {
    console.error("usage: node docs/tools/deployed-release.mjs [https://vibelang.sh]")
    process.exitCode = 2
  } else {
    const manifest = JSON.parse(readFileSync(new URL("../../packages/compiler/package.json", import.meta.url), "utf8"))
    const core = readFileSync(new URL("../../typescript/tsc/internal/core/version.go", import.meta.url), "utf8")
    const typescriptVersion = /var version = "([^"]+)"/.exec(core)?.[1]
    const problems = await deployedReleaseProblems({ baseUrl: process.argv[2], manifest, typescriptVersion })
    for (const problem of problems) console.error("deployed-release: " + problem)
    if (problems.length) {
      console.error(`deployed-release: ${problems.length} mismatch(es); check the deployed assets and npm latest before declaring the deploy complete`)
      process.exitCode = 1
    } else console.log(`deployed-release: served docs match compiler ${manifest.version}, npm latest and published platforms`)
  }
}
