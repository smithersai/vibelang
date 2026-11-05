import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { unplugin } from "./index.js"

// An unchanged test can still name a .ts entry after that source migrates.
// Resolve only missing disk entries; native files and Bun's in-memory files
// retain their usual priority. No broad onResolve hook touches virtual files.
function migratedEntries(config) {
  if (!Array.isArray(config?.entrypoints)) return
  const cwd = process.cwd()
  const virtual = new Set(Object.keys(config.files || {}).map((file) => resolve(cwd, file)))
  const entries = config.entrypoints.map((entry) => {
    if (typeof entry !== "string" || !entry.endsWith(".ts") || entry.endsWith(".d.ts")) return entry
    const path = resolve(cwd, entry)
    if (virtual.has(path) || existsSync(path)) return entry
    const stem = path.slice(0, -3)
    if (virtual.has(stem + ".tsx") || existsSync(stem + ".tsx")) return entry
    return existsSync(stem + ".vibe") ? entry.slice(0, -3) + ".vibe" : entry
  })
  if (entries.some((entry, index) => entry !== config.entrypoints[index])) config.entrypoints = entries
}

export default function vibelang(options) {
  const plugin = unplugin.bun(options)
  const setup = plugin.setup
  return {
    ...plugin,
    setup(build) {
      migratedEntries(build.config)
      return setup.call(this, build)
    }
  }
}
