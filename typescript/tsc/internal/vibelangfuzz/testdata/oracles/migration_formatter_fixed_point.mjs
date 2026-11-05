import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const { formatSource } = await import(pathToFileURL(resolve("packages/compiler/format.mjs")).href)
const { source, style } = JSON.parse(readFileSync(0, "utf8"))
let stage = "first"
try {
  const once = formatSource(source, "Application.vibe", style)
  stage = "second"
  const twice = formatSource(once, "Application.vibe", style)
  console.log(JSON.stringify({ ok: once === twice, once, twice, stage, error: once === twice ? "" : "formatting its own output changes the file" }))
} catch (error) {
  // Missing executables/dependencies and other setup failures remain hard errors.
  if (!/Formatting not stable\. Bailed after \d+ tries\./.test(error.message)) throw error
  console.log(JSON.stringify({ ok: false, stage, error: error.message }))
}
