import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const defaultCache = fileURLToPath(new URL("../.cache/stock-reference", import.meta.url))
const versions = JSON.parse(readFileSync(new URL("../cases/reference-install/package.json", import.meta.url), "utf8")).dependencies

// All case runners consume the locked install produced by the build graph.
export function referenceModules(modules, packages = ["effect", "typescript"]) {
  const directory = resolve(modules || join(process.env.VIP7_REFERENCE_CACHE || defaultCache, "node_modules"))
  for (const name of packages) {
    const manifest = join(directory, name, "package.json")
    let version
    try {
      version = JSON.parse(readFileSync(manifest, "utf8")).version
    } catch (cause) {
      throw new Error(`Cannot read ${manifest}. Run smthrs build //typescript/vibelang:stock-reference.`, { cause })
    }
    if (version !== versions[name]) {
      throw new Error(`Expected ${name}@${versions[name]} in ${directory}, found ${version}. Run smthrs build //typescript/vibelang:stock-reference.`)
    }
  }
  return directory
}
