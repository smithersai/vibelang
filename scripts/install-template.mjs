import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const base = process.env.BUN_CREATE_DIR || join(process.env.HOME, ".bun-create")
const destination = resolve(base, "vibelang")
// A template is setup's own when its package.json depends on the compiler.
// Templates from earlier setups carry a marker file instead, which bun create
// copied into every project.
function isOwnTemplate(directory) {
  if (existsSync(join(directory, ".vibelang-template"))) return true
  try {
    const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"))
    return Boolean(pkg.devDependencies?.["vibelang"])
  } catch {
    return false
  }
}
if (existsSync(destination) && !isOwnTemplate(destination)) {
  console.error(`setup: refusing to replace an unrelated template at ${destination}`)
  process.exit(1)
}
mkdirSync(dirname(destination), { recursive: true })
// Copy and rewrite the complete replacement before moving the usable template.
const staging = mkdtempSync(join(dirname(destination), ".vibelang-template-"))
const pending = join(staging, "next")
const previous = join(staging, "previous")
let cleanup = true
try {
  cpSync(join(root, "templates/app"), pending, {
    recursive: true,
    filter: (path) => !["node_modules", "dist", ".prototype", "bun.lock"].includes(path.split("/").at(-1))
  })
  const packagePath = join(pending, "package.json")
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"))
  pkg.dependencies["vibelang-runtime"] = `file:${join(root, "packages/runtime/vibelang-runtime.tgz")}`
  pkg.devDependencies["vibelang"] = `file:${join(root, "packages/compiler")}`
  pkg.devDependencies["vibelang-vite"] = `file:${join(root, "packages/vite")}`
  writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n")
  const hadPrevious = lstatSync(destination, { throwIfNoEntry: false }) !== undefined
  if (hadPrevious) renameSync(destination, previous)
  try {
    renameSync(pending, destination)
  } catch (error) {
    if (hadPrevious) {
      try { renameSync(previous, destination) }
      catch (restoreError) {
        // Keep the backup when another process prevents restoration.
        cleanup = false
        throw new AggregateError([error, restoreError], "setup: previous template retained at " + previous)
      }
    }
    throw error
  }
} finally {
  if (cleanup) rmSync(staging, { recursive: true, force: true })
}
console.log(`setup: installed template at ${destination}`)
