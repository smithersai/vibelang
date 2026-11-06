import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../..", import.meta.url))
const registry = "https://registry.npmjs.org"
const receipt = "docs/tools/shim-publication.json"
const packageName = "vibelang-typescript"

export function registryVersions(result) {
  if (result?.error?.code === "E404") return []
  const versions = typeof result === "string" ? [result] : result
  if (!Array.isArray(versions) || versions.some(version => typeof version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version))) {
    throw new Error("the registry did not return package versions or E404")
  }
  return versions
}

export function proposalIsOpen(text) {
  return /^\*\*Status:\*\*\s+open\b/im.test(text)
}

export function shimAvailabilityProblems(text, { versions = [], open = true, file = "document" } = {}) {
  const problems = []
  if (open && !/\b(?:preview|experimental)\b/i.test(text)) {
    problems.push(file + ": identify the open proposal as a preview")
  }
  const unavailable = /\b(?:unpublished|not\s+(?:(?:yet|currently)\s+)?(?:published|available)[^.!?\n]*\bnpm)\b/i.test(text)
  if (versions.length && unavailable) problems.push(file + ": update the unpublished status after recording publication")
  if (!versions.length && !unavailable) {
    problems.push(file + ": state that the replacement package is not available from npm")
  }
  for (const match of text.matchAll(/\bnpm:vibelang-typescript(?:@(\d+\.\d+\.\d+(?:[-+][\w.-]+)?))?/g)) {
    if (!versions.length || match[1] && !versions.includes(match[1])) {
      const line = text.slice(0, match.index).split("\n").length
      problems.push(file + ":" + line + ": the npm alias names an unavailable replacement package; use the checkout preview")
    }
  }
  return problems
}

export function checkShimAvailability(repository = root) {
  const publication = JSON.parse(readFileSync(join(repository, receipt), "utf8"))
  if (publication.registry !== registry || publication.package !== packageName) throw new Error("invalid shim publication receipt")
  const versions = registryVersions(publication.versions)
  const open = proposalIsOpen(readFileSync(join(repository, "docs/design/vips/0042-vibelang-in-ts-files-open.md"), "utf8"))
  return ["docs/user/src/setup/typescript-shim.md", "packages/typescript-shim/README.md"].flatMap(file =>
    shimAvailabilityProblems(readFileSync(join(repository, file), "utf8"), { versions, open, file }))
}

export function recordShimPublication(repository = root, query = () => {
  try {
    return JSON.parse(execFileSync("npm", ["view", packageName, "versions", "--json", "--registry", registry],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))
  } catch (error) {
    let response
    try { response = JSON.parse(String(error.stdout)) } catch { throw error }
    if (response?.error?.code !== "E404") throw error
    return response
  }
}) {
  const versions = registryVersions(query())
  const value = { generatedBy: "node docs/tools/shim-availability.mjs --record", registry, package: packageName, versions }
  const file = join(repository, receipt)
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n")
  return value
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--record")) {
    const value = recordShimPublication()
    console.log(packageName + ": " + (value.versions.length ? value.versions.length + " published versions" : "not available from npm"))
  } else {
    const problems = checkShimAvailability()
    for (const problem of problems) console.error(problem)
    console.log("shim availability: " + problems.length + " failures")
    process.exitCode = problems.length ? 1 : 0
  }
}
