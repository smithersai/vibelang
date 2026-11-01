#!/usr/bin/env node
// Website installation metadata is a registry snapshot, independent of main's candidate.
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { renderReleasePage } from "./release-docs.mjs"

const root = fileURLToPath(new URL("../../", import.meta.url))
const semver = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/
const tools = ["vibelang", "vibelang-runtime", "vibelang-vite", "vibelang-unplugin", "create-vibelang"]
const read = path => JSON.parse(readFileSync(path, "utf8"))
export const platformNames = manifest => Object.keys(manifest.optionalDependencies ?? {})
  .filter(name => /^(?:vibelang-(?:darwin|linux|win32|freebsd)-|@vibelang\/cli-win32-)/.test(name)).sort()

export function resolveSiteRelease({ env = process.env, npm = args => execFileSync("npm", ["view", ...args, "--tag=latest"], { encoding: "utf8", timeout: 30000 }), repository = root, requirePublished = false } = {}) {
  if (env.VIBELANG_SITE_RELEASE_FILE) return read(env.VIBELANG_SITE_RELEASE_FILE)
  const version = env.VIBELANG_RELEASE_VERSION || npm(["vibelang", "version"]).trim()
  if (!semver.test(version)) throw new Error("published-site: invalid npm release version " + version)
  // Explicit candidate overrides support offline tarball rehearsals. Normal site
  // builds always query npm and fail closed; never fall back to the candidate.
  const candidate = read(join(repository, "packages/compiler/package.json"))
  const rehearsal = !requirePublished && env.VIBELANG_RELEASE_VERSION === candidate.version
  const compiler = rehearsal ? candidate : JSON.parse(npm(["vibelang@" + version, "--json"]))
  const runtime = rehearsal ? read(join(repository, "packages/runtime/package.json")) : JSON.parse(npm(["vibelang-runtime@" + version, "--json"]))
  if (compiler.version !== version || runtime.version !== version || !platformNames(compiler).length || !semver.test(runtime.peerDependencies?.effect)) {
    throw new Error("published-site: incomplete registry release metadata for " + version)
  }
  const names = [...tools, ...platformNames(compiler)]
  const packages = {}
  for (const name of names) {
    const manifest = rehearsal ? { version } : JSON.parse(npm([name + "@" + version, "--json"]))
    const versions = rehearsal ? [version] : Array.isArray(manifest.versions) ? manifest.versions : JSON.parse(npm([name, "versions", "--json"]))
    packages[name] = { ...manifest, versions: Array.isArray(versions) ? versions : [versions] }
    if (packages[name].version !== version || !packages[name].versions.includes(version)) throw new Error("published-site: unpublished " + name + "@" + version)
  }
  return { compiler, runtime, packages }
}

export function renderSiteRelease(path, text, snapshot, sourceEffect) {
  if (!snapshot || /(?:^|\/)(?:spec|vips)\//.test(path)) return text
  const version = snapshot.compiler.version
  if (/(?:^|\/)release-notes\.(?:md|mdx)$/.test(path)) {
    const sections = text.split(/(?=^## )/m)
    const published = sections.findIndex(section => new RegExp("^## " + version.replaceAll(".", "\\.") + "(?: \\(unreleased\\))?\\s*\n").test(section))
    if (published < 0) throw new Error("published-site: release notes missing npm version " + version)
    return sections[0] + sections.slice(published).join("").replace(new RegExp("^(## " + version.replaceAll(".", "\\.") + ") \\(unreleased\\)", "m"), "$1")
  }
  if (/(?:^|\/)compiler-gaps\.(?:md|mdx)$/.test(path)) return text
  const effect = snapshot.runtime.peerDependencies.effect
  let output = renderReleasePage(path === "index.mdx" ? "site/src/pages/index.mdx" : path, text, version, effect)
  if (sourceEffect && sourceEffect !== effect) output = output.replaceAll(sourceEffect, effect)
  const platforms = platformNames(snapshot.compiler)
  const windows = platforms.some(name => /win32-/.test(name))
  const support = "Version " + version + " provides native packages for " +
    [...new Set(platforms.map(name => /darwin/.test(name) ? "macOS" : /linux/.test(name) ? "Linux" : /win32/.test(name) ? "Windows" : "FreeBSD"))].join(", ") +
    " on " + [...new Set(platforms.map(name => name.split("-").at(-1)))].sort().join(" and ") + "." +
    (windows ? "" : " Native Windows packages are not published for this version; use WSL.")
  output = output.replace(/^Version \d+\.\d+\.\d+[^\n]*(?:native packages|native binaries|six native packages)[^\n]*/gm, support)
  output = output.replace(/Version \d+\.\d+\.\d+ provides native packages[^\n]*/g, support)
  // Filter the source table and include any newly published platform.
  if (/004-installation\.(?:md|mdx)$/.test(path)) {
    const labels = { darwin: "macOS", linux: "Linux", win32: "Windows", freebsd: "FreeBSD" }
    const rows = platforms.map(name => {
      const [, os, arch] = /(?:vibelang-|@vibelang\/cli-)(\w+)-(\w+)$/.exec(name) ?? []
      const label = os === "darwin" ? (arch === "arm64" ? "macOS on Apple silicon" : "macOS on Intel") : labels[os] + " on " + arch
      return "| " + label + " | \x60" + name + "\x60 | " + (os === "linux" && arch === "x64" ? "Yes" : "No") + " |"
    })
    output = output.replace(/\| Platform \| Package \| Rehearsed for [^\n]+\n\|[^\n]+\n(?:\|[^\n]+\n)+/, "| Platform | Package | Rehearsed for " + version + " |\n| --- | --- | --- |\n" + rows.join("\n") + "\n")
  }
  return output
}

export function visibleSiteText(text) {
  return text.replace(/<h2\b[^>]*>/gi, "\n## ").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<\/(?:p|div|tr|li|h[1-6])>|<br\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "").replace(/&(?:quot|#34);/g, '"').replace(/&(?:apos|#39);/g, "'").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
}

export function installReferences(body) {
  const refs = []
  const native = text => text.match(/(?:\bvibelang-(?:darwin|linux|win32|freebsd)|@vibelang\/cli-win32)-(?:arm64|x64)\b/g) ?? []
  const tables = [...body.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>|^\s*\|[^\n]+/gm)].map(match => match[0])
  for (const line of visibleSiteText(body).split("\n")) {
    if (!/\b(?:npm|pnpm|bun|yarn)\s+(?:add|install|i|create)\b/.test(line)) continue
    for (const [, name, version] of line.matchAll(/(?<![\w/-])((?:@vibelang\/cli-[a-z0-9-]+|(?:create-)?vibelang(?:-[a-z0-9-]+)?))@([^\s\x60"\x27<>),;]+)/g)) {
      refs.push({ name: /\b(?:npm|bun) create vibelang/.test(line) && name === "vibelang" ? "create-vibelang" : name, version })
    }
    for (const name of native(line)) if (!line.includes(name + "@")) refs.push({ name })
  }
  // A platform table and an install command promise availability. A release
  // note describing an unpublished rehearsal package makes no such promise.
  for (const name of native(visibleSiteText(tables.join("\n")))) refs.push({ name })
  return refs
}

export function builtInstallProblems(directory, snapshot) {
  const problems = []
  const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)])
  let checked = 0
  for (const file of files(directory)) {
    if (!/\.(?:html|md|txt)$/.test(file)) continue
    const body = readFileSync(file, "utf8")
    const text = visibleSiteText(body)
    const historical = /\/(?:spec|vips)\/|\/(?:release-notes|compiler-gaps)(?:\.(?:md|html)|\/index\.html)$/.test(file)
    // Historical release instructions describe their own published version.
    if (/\/release-notes(?:\.(?:md|html)|\/index\.html)$/.test(file)) {
      const headings = [...text.matchAll(/^## (\d+\.\d+\.\d+(?:-[\w.-]+)?)(?: \(unreleased\))?\s*$/gm)]
      if (headings[0]?.[1] !== snapshot.compiler.version) problems.push(file + ": latest release notes differ from npm " + snapshot.compiler.version)
    }
    for (const { name, version } of installReferences(body)) {
      checked++
      const expected = version && version !== "latest" ? version : snapshot.compiler.version
      const manifest = snapshot.packages[name]
      if (!(manifest?.versions ?? [manifest?.version]).includes(expected)) problems.push(file + ": unpublished install " + name + "@" + expected)
      else if (!historical && expected !== snapshot.compiler.version) problems.push(file + ": install " + name + "@" + expected + "; expected npm latest " + snapshot.compiler.version)
      if (version === "latest" && (snapshot.packages[name]?.["dist-tags"]?.latest ?? expected) !== expected) problems.push(file + ": " + name + "@latest differs from npm compiler " + expected)
    }
  }
  if (!checked) problems.push("published-site: no install references found in " + directory)
  return [...new Set(problems)]
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, path] = process.argv.slice(2)
  if (mode === "--snapshot" && path) {
    writeFileSync(path, JSON.stringify(resolveSiteRelease(), null, 2) + "\n")
  } else if (mode === "--check" && path) {
    // Always query the registry here, independently of the build snapshot.
    const snapshot = resolveSiteRelease({ env: { ...process.env, VIBELANG_SITE_RELEASE_FILE: "", VIBELANG_RELEASE_VERSION: "" }, requirePublished: true })
    const problems = builtInstallProblems(path, snapshot)
    for (const problem of problems) console.error(problem)
    if (problems.length) process.exitCode = 1
    else console.log("published-site: install references resolve in npm " + snapshot.compiler.version)
  } else { console.error("usage: node docs/tools/published-site.mjs --snapshot <file> | --check <built-site>"); process.exitCode = 2 }
}
